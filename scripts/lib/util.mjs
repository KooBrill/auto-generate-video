import fs from 'node:fs/promises';
import path from 'node:path';

export const env = (name, fallback = '') => (process.env[name] ?? '').trim() || fallback;

export const required = (name) => {
  const value = env(name);
  if (!value) throw new Error(`Env ${name} belum diisi (cek file .env)`);
  return value;
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const log = (...args) => {
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: process.env.TZ || 'UTC' });
  console.log(`[${stamp}]`, ...args);
};

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// Notifikasi Telegram (opsional). Kalau env tidak diisi, fungsi ini tidak melakukan apa-apa.
export async function notify(text) {
  const token = env('TELEGRAM_BOT_TOKEN');
  const chatId = env('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch (err) {
    log('Notifikasi Telegram gagal:', err.message);
  }
}
