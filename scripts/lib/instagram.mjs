import fs from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, log, readJson, required, sleep, writeJson } from './util.mjs';

// IG_LOGIN_TYPE=instagram  -> "Business Login for Instagram": host graph.instagram.com, video harus lewat URL publik (pakai S3/R2).
// IG_LOGIN_TYPE=facebook   -> "Facebook Login for Business": host graph.facebook.com, video diunggah langsung ke Meta (resumable upload).
const loginType = () => (env('IG_LOGIN_TYPE', 'instagram') === 'facebook' ? 'facebook' : 'instagram');
const apiVersion = () => env('IG_API_VERSION', 'v26.0');
const apiBase = () =>
  `${loginType() === 'facebook' ? 'https://graph.facebook.com' : 'https://graph.instagram.com'}/${apiVersion()}`;

async function igFetch(url, { token, json } = {}) {
  const res = await fetch(url, {
    method: json ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok || data.error) {
    const detail = data.error ? JSON.stringify(data.error) : text;
    throw new Error(`Instagram API ${res.status}: ${detail}`);
  }
  return data;
}

// Token Instagram Login berlaku 60 hari. Fungsi ini menyimpannya di data/ig-token.json dan memperbaruinya otomatis.
async function ensureFreshInstagramToken(dataDir) {
  const seed = required('IG_ACCESS_TOKEN');
  const file = path.join(dataDir, 'ig-token.json');
  let store = await readJson(file, null);

  // Kalau IG_ACCESS_TOKEN di .env diganti, mulai lagi dari token baru itu.
  if (!store || store.seed !== seed) {
    store = { seed, access_token: seed, refreshed_at: Date.now() };
    await writeJson(file, store);
  }

  const ageDays = (Date.now() - store.refreshed_at) / 86_400_000;
  if (ageDays >= Number(env('IG_REFRESH_AFTER_DAYS', '30'))) {
    const url =
      'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' +
      encodeURIComponent(store.access_token);
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(
        'Gagal memperbarui token Instagram (mungkin sudah kedaluwarsa). Buat token baru dan isi ulang IG_ACCESS_TOKEN di .env.',
      );
    }
    store = { ...store, access_token: data.access_token, refreshed_at: Date.now() };
    await writeJson(file, store);
    log('Token Instagram diperbarui (berlaku 60 hari lagi).');
  }
  return store.access_token;
}

function s3Client() {
  return new S3Client({
    region: env('S3_REGION', 'auto'),
    endpoint: env('S3_ENDPOINT') || undefined,
    forcePathStyle: env('S3_FORCE_PATH_STYLE') === '1',
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    // Beberapa penyimpanan S3-compatible (termasuk R2) bermasalah dengan checksum default SDK terbaru.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

// Unggah video ke bucket S3/R2 lalu hasilkan URL yang bisa diunduh server Meta.
// Tanpa S3_PUBLIC_BASE_URL, dipakai presigned URL (bucket tidak perlu dibuat publik).
async function makePublicUrl(file, jobId) {
  const client = s3Client();
  const Bucket = required('S3_BUCKET');
  const Key = `autopost/${jobId}-${Date.now()}.mp4`;

  await client.send(
    new PutObjectCommand({ Bucket, Key, Body: await fs.readFile(file), ContentType: 'video/mp4' }),
  );

  const publicBase = env('S3_PUBLIC_BASE_URL');
  const url = publicBase
    ? `${publicBase.replace(/\/$/, '')}/${Key}`
    : await getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 });

  return {
    url,
    cleanup: async () => {
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key }));
      } catch (err) {
        log('Peringatan: gagal menghapus file sementara di bucket:', err.message);
      }
    },
  };
}

async function resumableUpload(containerId, file, token) {
  const data = await fs.readFile(file);
  const res = await fetch(`https://rupload.facebook.com/ig-api-upload/${apiVersion()}/${containerId}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(data.length) },
    body: data,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload ke rupload.facebook.com gagal (${res.status}): ${text}`);
  log('Upload video ke Meta selesai.');
}

async function waitUntilFinished(containerId, token) {
  const intervalMs = Number(env('IG_POLL_INTERVAL_SEC', '30')) * 1000;
  const maxPolls = Number(env('IG_POLL_MAX', '12'));
  for (let i = 0; i < maxPolls; i++) {
    const { status_code: status } = await igFetch(`${apiBase()}/${containerId}?fields=status_code`, { token });
    log(`Status container Instagram: ${status}`);
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Container Instagram berstatus ${status}`);
    }
    await sleep(intervalMs);
  }
  throw new Error('Timeout menunggu Instagram selesai memproses video.');
}

export async function publishReel({ file, caption, jobId, dataDir }) {
  const type = loginType();
  const token = type === 'instagram' ? await ensureFreshInstagramToken(dataDir) : required('IG_ACCESS_TOKEN');
  const igId = type === 'instagram' ? env('IG_USER_ID', 'me') : required('IG_USER_ID');

  const body = { media_type: 'REELS', caption: caption.slice(0, 2200) };
  if (env('IG_AI_GENERATED') === '1') body.is_ai_generated = true;

  let cleanup = async () => {};
  let container;
  try {
    if (type === 'facebook') {
      container = await igFetch(`${apiBase()}/${igId}/media`, {
        token,
        json: { ...body, upload_type: 'resumable' },
      });
      await resumableUpload(container.id, file, token);
    } else {
      const hosted = await makePublicUrl(file, jobId);
      cleanup = hosted.cleanup;
      container = await igFetch(`${apiBase()}/${igId}/media`, {
        token,
        json: { ...body, video_url: hosted.url },
      });
    }

    await waitUntilFinished(container.id, token);
    const published = await igFetch(`${apiBase()}/${igId}/media_publish`, {
      token,
      json: { creation_id: container.id },
    });

    let permalink;
    try {
      permalink = (await igFetch(`${apiBase()}/${published.id}?fields=permalink`, { token })).permalink;
    } catch {
      // permalink hanya pelengkap, tidak boleh menggagalkan job
    }
    return { mediaId: published.id, permalink };
  } finally {
    await cleanup();
  }
}
