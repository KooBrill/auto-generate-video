#!/usr/bin/env node
// Otorisasi YouTube sekali saja untuk mendapatkan refresh token.
// Jalankan di KOMPUTER LOKAL (yang punya browser), bukan di VPS:
//   npm install
//   npm run youtube:auth        (membaca YT_CLIENT_ID dan YT_CLIENT_SECRET dari .env)
import http from 'node:http';
import googleYoutube from '@googleapis/youtube';

const { auth } = googleYoutube;

const clientId = process.env.YT_CLIENT_ID;
const clientSecret = process.env.YT_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Isi YT_CLIENT_ID dan YT_CLIENT_SECRET di file .env dulu (dari OAuth Client ID tipe Desktop app).');
  process.exit(1);
}

const PORT = Number(process.env.AUTH_PORT ?? 53682);
const HOST = process.env.AUTH_HOST ?? '127.0.0.1';
const redirectUri = `http://127.0.0.1:${PORT}/oauth2callback`;
const client = new auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/youtube.upload'],
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirectUri);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Tidak ada parameter code.');
    return;
  }
  try {
    const { tokens } = await client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Berhasil. Kembali ke terminal.');
    if (tokens.refresh_token) {
      console.log('\nRefresh token kamu (simpan sebagai YT_REFRESH_TOKEN di .env VPS):\n');
      console.log(tokens.refresh_token, '\n');
    } else {
      console.log(
        '\nGoogle tidak mengirim refresh token. Cabut akses app ini di https://myaccount.google.com/permissions lalu jalankan ulang.',
      );
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Gagal menukar code.');
    console.error('Gagal menukar code:', err.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, HOST, () => {
  console.log('Buka URL ini di browser, login, lalu izinkan akses:\n');
  console.log(authUrl, '\n');
  console.log(`Menunggu callback di ${redirectUri} ...`);
});
