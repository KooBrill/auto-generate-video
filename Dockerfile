FROM node:22-bookworm-slim

# Library yang dibutuhkan Chrome Headless Shell (daftar terbaru: remotion.dev/docs/docker).
# fonts-liberation = font teks template, fonts-noto-color-emoji = emoji.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 \
    libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 \
    libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    fonts-liberation fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Unduh Chrome Headless Shell saat build, bukan saat render.
RUN npx remotion browser ensure

COPY . .

CMD ["node", "scripts/pipeline.mjs"]
