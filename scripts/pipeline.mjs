#!/usr/bin/env node
// Pipeline: ambil job dari jobs/pending -> render video -> upload ke YouTube / Instagram -> pindahkan job ke jobs/done.
//
// Pemakaian:
//   node scripts/pipeline.mjs                 # proses job + upload
//   node scripts/pipeline.mjs --render-only   # hanya render, tidak upload (untuk uji)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishReel } from './lib/instagram.mjs';
import { renderVideo } from './lib/render.mjs';
import { env, exists, log, notify, readJson, writeJson } from './lib/util.mjs';
import { uploadToYoutube } from './lib/youtube.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = {
  pending: path.join(ROOT, 'jobs/pending'),
  done: path.join(ROOT, 'jobs/done'),
  failed: path.join(ROOT, 'jobs/failed'),
  out: path.join(ROOT, 'out'),
  data: path.join(ROOT, 'data'),
};

const RENDER_ONLY = process.argv.includes('--render-only');
const MAX_JOBS = Number(env('MAX_JOBS_PER_RUN', '1'));
const MAX_ATTEMPTS = Number(env('MAX_ATTEMPTS', '3'));
const MAX_SECONDS = Number(env('MAX_VIDEO_SECONDS', '90'));
const KEEP_VIDEOS = env('KEEP_VIDEOS') === '1';
const STALE_LOCK_MS = 3 * 60 * 60 * 1000;

async function acquireLock() {
  const lockFile = path.join(DIRS.data, 'pipeline.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockFile, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => fs.rm(lockFile, { force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const { mtimeMs } = await fs.stat(lockFile);
      if (Date.now() - mtimeMs < STALE_LOCK_MS) return null;
      log('Lock lama ditemukan (lebih dari 3 jam), dihapus.');
      await fs.rm(lockFile, { force: true });
    }
  }
  return null;
}

function validateJob(job) {
  const props = job?.props;
  if (!props || typeof props !== 'object') throw new Error('Job tidak valid: field "props" wajib ada.');
  if (typeof props.title !== 'string' || !props.title.trim()) {
    throw new Error('Job tidak valid: props.title wajib berupa teks.');
  }
  if (!Array.isArray(props.points) || props.points.length === 0 || props.points.some((p) => typeof p !== 'string')) {
    throw new Error('Job tidak valid: props.points wajib berupa array teks (minimal 1).');
  }
}

const withShortsTag = (text) => (/#shorts/i.test(text) ? text : `${text}\n\n#Shorts`);

async function processJob(file) {
  const jobId = path.basename(file, '.json').replace(/[^a-zA-Z0-9_-]/g, '_');
  const jobPath = path.join(DIRS.pending, file);
  const statePath = path.join(DIRS.data, 'state', `${jobId}.json`);
  const videoPath = path.join(DIRS.out, `${jobId}.mp4`);

  log(`=== Job ${jobId} ===`);
  const state = await readJson(statePath, { attempts: 0 });
  const errors = [];
  let job;

  try {
    job = JSON.parse(await fs.readFile(jobPath, 'utf8'));
    validateJob(job);
  } catch (err) {
    await moveJob(file, DIRS.failed);
    await notify(`❌ Job ${jobId} ditolak: ${err.message}`);
    log('✖', err.message);
    return false;
  }

  const targets = job.targets ?? env('DEFAULT_TARGETS', 'youtube,instagram').split(',').map((t) => t.trim()).filter(Boolean);
  const todo = targets.filter((t) => !state[t]?.done);
  const caption = job.instagram?.caption ?? job.caption ?? job.props.title;

  state.attempts += 1;
  await writeJson(statePath, state);

  try {
    if (!(await exists(videoPath))) {
      const { seconds } = await renderVideo({
        root: ROOT,
        props: job.props,
        outputLocation: videoPath,
        maxSeconds: MAX_SECONDS,
      });
      log(`Render selesai (${seconds.toFixed(0)} detik): ${videoPath}`);
    } else {
      log('Video sudah ada dari run sebelumnya, render dilewati.');
    }

    if (RENDER_ONLY) {
      state.attempts -= 1;
      await writeJson(statePath, state);
      log('--render-only: upload dilewati.');
      return true;
    }

    for (const target of todo) {
      try {
        if (target === 'youtube') {
          const yt = job.youtube ?? {};
          const result = await uploadToYoutube({
            file: videoPath,
            title: yt.title ?? job.props.title,
            description: withShortsTag(yt.description ?? caption),
            tags: yt.tags ?? [],
            privacyStatus: yt.privacyStatus ?? env('YT_PRIVACY', 'private'),
            categoryId: yt.categoryId ?? env('YT_CATEGORY_ID', '22'),
          });
          state.youtube = { done: true, ...result };
        } else if (target === 'instagram') {
          const result = await publishReel({ file: videoPath, caption, jobId, dataDir: DIRS.data });
          state.instagram = { done: true, ...result };
        } else if (target === 'mock') {
          // Target uji: tidak mengunggah ke mana pun. Berguna untuk mengetes antrean dan cron.
          state.mock = { done: true };
        } else {
          throw new Error(`Target tidak dikenal: "${target}" (pilihan: youtube, instagram, mock)`);
        }
        await writeJson(statePath, state);
        log(`✔ ${target} selesai`);
      } catch (err) {
        errors.push(`${target}: ${err.message}`);
        log(`✖ ${target}: ${err.message}`);
      }
    }
  } catch (err) {
    errors.push(`render: ${err.message}`);
    log(`✖ render: ${err.message}`);
  }

  if (errors.length === 0) {
    await moveJob(file, DIRS.done);
    if (!KEEP_VIDEOS) await fs.rm(videoPath, { force: true });
    const links = [state.youtube?.url, state.instagram?.permalink].filter(Boolean).join('\n');
    await notify(`✅ Job ${jobId} selesai.\n${links}`.trim());
    return true;
  }

  state.lastError = errors.join(' | ');
  await writeJson(statePath, state);

  if (state.attempts >= MAX_ATTEMPTS) {
    await moveJob(file, DIRS.failed);
    await notify(`❌ Job ${jobId} gagal ${state.attempts}x dan dipindah ke jobs/failed.\n${state.lastError}`);
  } else {
    await notify(`⚠️ Job ${jobId} gagal (percobaan ${state.attempts}/${MAX_ATTEMPTS}), dicoba lagi di run berikutnya.\n${state.lastError}`);
  }
  return false;
}

async function moveJob(file, destDir) {
  await fs.rename(path.join(DIRS.pending, file), path.join(destDir, file));
}

async function main() {
  for (const dir of Object.values(DIRS)) await fs.mkdir(dir, { recursive: true });

  const release = await acquireLock();
  if (!release) {
    log('Run lain masih berjalan (data/pipeline.lock ada). Keluar.');
    return;
  }
  const onSignal = async () => {
    await release();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const files = (await fs.readdir(DIRS.pending)).filter((f) => f.endsWith('.json')).sort();
    if (files.length === 0) {
      log('Tidak ada job di jobs/pending.');
      return;
    }
    let failures = 0;
    for (const file of files.slice(0, MAX_JOBS)) {
      if (!(await processJob(file))) failures += 1;
    }
    if (failures > 0) process.exitCode = 1;
  } finally {
    await release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
