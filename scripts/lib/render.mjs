import fs from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { env, log } from './util.mjs';

// Bundle cukup dibuat sekali per run, lalu dipakai untuk semua job.
let bundlePromise;
function getBundle(root) {
  bundlePromise ??= bundle({ entryPoint: path.join(root, 'src/index.ts') });
  return bundlePromise;
}

function chromiumOptions() {
  const options = { enableMultiProcessOnLinux: true };
  // Hanya perlu kalau videomu memakai WebGL/Three.js di server tanpa GPU: REMOTION_GL=swangle
  if (env('REMOTION_GL')) options.gl = env('REMOTION_GL');
  return options;
}

function browserOptions() {
  const browserExecutable = env('REMOTION_BROWSER_EXECUTABLE');
  return browserExecutable ? { browserExecutable } : {};
}

export async function renderVideo({ root, props, outputLocation, maxSeconds, compositionId = 'VerticalVideo' }) {
  const serveUrl = await getBundle(root);

  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps: props,
    chromiumOptions: chromiumOptions(),
    ...browserOptions(),
  });

  const seconds = composition.durationInFrames / composition.fps;
  if (seconds > maxSeconds) {
    throw new Error(
      `Video ${seconds.toFixed(0)} detik, melebihi batas MAX_VIDEO_SECONDS=${maxSeconds}. Kurangi jumlah poin atau naikkan batasnya.`,
    );
  }

  // Render ke file sementara dulu; baru di-rename setelah selesai, supaya file setengah jadi tidak pernah dipakai.
  await fs.mkdir(path.dirname(outputLocation), { recursive: true });
  const tmpLocation = outputLocation.replace(/\.mp4$/, '.tmp.mp4');

  let lastLogged = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    // bt709 menghasilkan yuv420p standar (limited range) yang paling aman diterima YouTube dan Instagram.
    colorSpace: 'bt709',
    outputLocation: tmpLocation,
    inputProps: props,
    concurrency: Number(env('RENDER_CONCURRENCY', '2')),
    chromiumOptions: chromiumOptions(),
    ...browserOptions(),
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== lastLogged) {
        lastLogged = pct;
        log(`Render ${pct}%`);
      }
    },
  });

  await fs.rename(tmpLocation, outputLocation);
  return { seconds };
}
