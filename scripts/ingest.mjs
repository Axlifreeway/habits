// Превращает GitHub issue в запись челленджа.
// Запускается из .github/workflows/entry.yml на событие issues.
// Локально можно проверить так:  EVENT_JSON=payload.json node scripts/ingest.mjs

import fs from 'node:fs';
import path from 'node:path';
import {
  loadConfig, challengeDate, isValidDate, serializeEntry, entriesDir, formatDate,
} from './lib/data.mjs';

const cfg = loadConfig();

const eventPath = process.env.EVENT_JSON || process.env.GITHUB_EVENT_PATH;
if (!eventPath || !fs.existsSync(eventPath)) {
  fail('Не найден payload события GitHub.');
}
const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const issue = event.issue;
if (!issue) fail('В событии нет issue.');

function fail(msg) {
  console.error('ОШИБКА: ' + msg);
  writeOutput('error', msg);
  process.exit(1);
}

function writeOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const safe = String(value).replace(/\r?\n/g, ' ');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${safe}\n`);
}

// --- какая это привычка ---

const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
let habit = cfg.habits.find((h) => labels.includes(h.id));
if (!habit) {
  const t = String(issue.title || '').toLowerCase();
  habit = cfg.habits.find((h) => t.startsWith(h.id));
}
if (!habit) fail(`Не понял, к какой привычке относится issue. Нужна метка ${cfg.habits.map((h) => h.id).join(' или ')}.`);

// --- разбор тела issue (формат GitHub issue forms) ---

function parseForm(body) {
  const out = {};
  const text = String(body || '').replace(/\r\n?/g, '\n');
  const parts = text.split(/^###[ \t]+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase();
    let value = (nl === -1 ? '' : part.slice(nl + 1))
      .split('\n')
      .filter((l) => !/^_(No response|Нет ответа)_$/.test(l.trim()))
      .join('\n')
      .trim();
    out[heading] = value;
  }
  return out;
}

const form = parseForm(issue.body);

function field(...keywords) {
  for (const [heading, value] of Object.entries(form)) {
    if (keywords.some((k) => heading.includes(k))) return value;
  }
  return '';
}

// --- дата ---

let date = field('дата').trim();
if (date && !isValidDate(date)) {
  fail(`Дата «${date}» не похожа на ГГГГ-ММ-ДД.`);
}
if (!date) date = challengeDate(issue.created_at || new Date(), cfg);

// --- картинка ---

const ALLOWED_HOSTS = [
  'github.com', 'www.github.com', 'user-images.githubusercontent.com',
  'raw.githubusercontent.com', 'objects.githubusercontent.com',
  'private-user-images.githubusercontent.com',
];

const EXT_BY_TYPE = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif',
};

function findImageUrl(body) {
  const text = String(body || '');
  const md = text.match(/!\[[^\]]*\]\((https?:[^)\s]+)\)/);
  if (md) return md[1];
  const html = text.match(/<img[^>]+src="(https?:[^"]+)"/i);
  if (html) return html[1];
  const bare = text.match(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif)(?:\?\S*)?/i);
  return bare ? bare[0] : null;
}

function sniffExt(buf) {
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e47')) return '.png';
  if (hex.startsWith('ffd8ff')) return '.jpg';
  if (hex.startsWith('47494638')) return '.gif';
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  if (buf.subarray(4, 12).toString('ascii').startsWith('ftypavif')) return '.avif';
  return null;
}

async function downloadImage(url, destDir, baseName) {
  let u;
  try { u = new URL(url); } catch { fail(`Не смог разобрать ссылку на картинку: ${url}`); }
  if (!ALLOWED_HOSTS.includes(u.hostname)) {
    fail(`Картинка лежит на чужом хосте (${u.hostname}). Перетащи файл прямо в поле issue.`);
  }
  const headers = { 'user-agent': 'habit-calendar' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await fetch(u, { headers, redirect: 'follow' });
  if (!res.ok) fail(`Не смог скачать картинку: HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

  let ext = EXT_BY_TYPE[type];
  if (!ext) {
    const m = u.pathname.match(/\.(png|jpe?g|gif|webp|avif)$/i);
    ext = m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : null;
  }
  if (!ext) ext = sniffExt(buf); // GitHub иногда отдаёт application/octet-stream
  if (!ext) fail(`Это не похоже на картинку (content-type: ${type || 'неизвестен'}).`);

  const MAX = 25 * 1024 * 1024;
  if (buf.length > MAX) fail(`Картинка больше 25 МБ (${(buf.length / 1048576).toFixed(1)} МБ).`);

  fs.mkdirSync(destDir, { recursive: true });
  for (const old of fs.readdirSync(destDir)) {
    if (old.startsWith(baseName + '.') && !old.endsWith('.md')) {
      fs.rmSync(path.join(destDir, old));
    }
  }
  const name = baseName + ext;
  fs.writeFileSync(path.join(destDir, name), buf);
  return { name, bytes: buf.length };
}

// --- сборка записи ---

const dir = path.join(entriesDir(), date);
const meta = { habit: habit.id, date };
let body = '';
let note = '';

if (habit.id === 'reading') {
  meta.title = field('название', 'заголовок') || issue.title.replace(/^reading[:\s-]*/i, '').trim();
  meta.url = field('ссылка', 'адрес');
  meta.author = field('автор');
  meta.source = field('где', 'источник', 'издание');
  meta.minutes = field('время', 'сколько').replace(/[^0-9]/g, '');
  body = field('конспект', 'что вынес', 'о чём');
  if (!body) fail('Конспект пустой — ради него всё и затевалось.');
  if (!meta.title) fail('Не заполнено название статьи.');
} else {
  meta.title = field('название', 'что нарисовал', 'что это') || '';
  meta.tool = field('чем рисовал', 'инструмент', 'в чём');
  meta.minutes = field('сколько', 'время').replace(/[^0-9]/g, '');
  body = field('комментарий', 'что пробовал', 'подпись', 'о рисунке');

  const raw = field('рисунок', 'картинк', 'изображение') || issue.body;
  const url = findImageUrl(raw);
  if (!url) fail('В issue нет картинки. Перетащи файл в поле «Рисунок».');
  const img = await downloadImage(url, dir, 'drawing');
  meta.image = img.name;
  note = `${img.name}, ${(img.bytes / 1048576).toFixed(1)} МБ`;
  if (!body) body = '';
}

fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${habit.id}.md`);
const existed = fs.existsSync(file);
fs.writeFileSync(file, serializeEntry(meta, body));

const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
const verb = existed ? 'Обновлено' : 'Записано';
const summary = `${verb}: ${habit.name.toLowerCase()} за ${formatDate(date)}${note ? ' (' + note + ')' : ''}`;

console.log(summary);
console.log('Файл: ' + rel);
writeOutput('summary', summary);
writeOutput('date', date);
writeOutput('habit', habit.id);
writeOutput('changed', 'yes');
