#!/usr/bin/env node
// Cek token Instagram dan tampilkan ID akun Instagram (untuk IG_USER_ID).
// Hanya untuk IG_LOGIN_TYPE=instagram. Jalankan: npm run ig:whoami
const token = process.env.IG_ACCESS_TOKEN;
const version = process.env.IG_API_VERSION || 'v26.0';

if (!token) {
  console.error('Isi IG_ACCESS_TOKEN di .env dulu.');
  process.exit(1);
}
if (process.env.IG_LOGIN_TYPE === 'facebook') {
  console.error(
    'Untuk IG_LOGIN_TYPE=facebook, ID akun Instagram diambil dari field instagram_business_account milik Facebook Page. Lihat dokumentasi Meta.',
  );
  process.exit(1);
}

const res = await fetch(`https://graph.instagram.com/${version}/me?fields=user_id,username`, {
  headers: { Authorization: `Bearer ${token}` },
});
const data = await res.json();
if (!res.ok) {
  console.error('Token ditolak:', JSON.stringify(data));
  process.exit(1);
}
console.log(`Akun: @${data.username}`);
console.log(`IG_USER_ID=${data.user_id}`);
