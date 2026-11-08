import fs from 'node:fs';
import googleYoutube from '@googleapis/youtube';
import { required } from './util.mjs';

const { auth, youtube } = googleYoutube;

export async function uploadToYoutube({ file, title, description, tags, privacyStatus, categoryId }) {
  const oauth2 = new auth.OAuth2(required('YT_CLIENT_ID'), required('YT_CLIENT_SECRET'));
  oauth2.setCredentials({ refresh_token: required('YT_REFRESH_TOKEN') });
  const yt = youtube({ version: 'v3', auth: oauth2 });

  try {
    const res = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title.slice(0, 100),
          description: description.slice(0, 4900),
          tags,
          categoryId,
        },
        status: { privacyStatus, selfDeclaredMadeForKids: false },
      },
      media: { body: fs.createReadStream(file) },
    });
    const videoId = res.data.id;
    return { videoId, url: `https://www.youtube.com/shorts/${videoId}` };
  } catch (err) {
    const reason = err?.errors?.[0]?.reason ?? '';
    const message = String(err?.message ?? err);
    if (message.includes('invalid_grant')) {
      throw new Error(
        'Refresh token YouTube ditolak (invalid_grant). Jalankan ulang youtube:auth untuk membuat token baru. ' +
          'Kalau consent screen masih berstatus Testing, token memang kedaluwarsa tiap 7 hari.',
      );
    }
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      throw new Error('Kuota harian YouTube API habis. Coba lagi setelah kuota reset (tengah malam Pacific Time).');
    }
    throw new Error(`YouTube upload gagal: ${message}`);
  }
}
