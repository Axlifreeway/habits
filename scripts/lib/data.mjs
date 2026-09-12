import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function loadConfig() {
  const file = process.env.CONFIG_FILE
    ? path.resolve(ROOT, process.env.CONFIG_FILE)
    : path.join(ROOT, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof cfg.tzOffsetHours !== 'number') cfg.tzOffsetHours = 0;
  if (typeof cfg.dayCutoffHour !== 'number') cfg.dayCutoffHour = 0;
  return cfg;
}

// «День» челленджа кончается не в полночь, а в dayCutoffHour по местному времени.
// Поэтому момент времени сдвигаем на (tzOffset - cutoff) часов и берём дату в UTC.
export function challengeDate(when, cfg) {
  const ms = (when instanceof Date ? when : new Date(when)).getTime();
  const shifted = new Date(ms + (cfg.tzOffsetHours - cfg.dayCutoffHour) * 3600e3);
  return shifted.toISOString().slice(0, 10);
}

export function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
}

export function isValidDate(s) {
  return typeof s === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)
    && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_TITLE = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

export function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function monthTitle(year, month) {
  return `${MONTHS_TITLE[month]} ${year}`;
}

export function weekdayName(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return WEEKDAYS[(d.getUTCDay() + 6) % 7];
}

// Понедельник = 0
export function weekdayIndex(iso) {
  return (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

export function parseEntry(raw) {
  const text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[kv[1]] = v;
  }
  return { meta, body: m[2].trim() };
}

export function serializeEntry(meta, body) {
  const head = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ' ')}`)
    .join('\n');
  return `---\n${head}\n---\n\n${String(body).trim()}\n`;
}

export function entriesDir() {
  return process.env.ENTRIES_DIR
    ? path.resolve(ROOT, process.env.ENTRIES_DIR)
    : path.join(ROOT, 'entries');
}

// { '2026-09-13': { reading: {meta, body, files}, drawing: {...} } }
export function loadEntries(cfg) {
  const dir = entriesDir();
  const byDate = {};
  if (!fs.existsSync(dir)) return byDate;
  const habitIds = new Set(cfg.habits.map((h) => h.id));

  for (const dayName of fs.readdirSync(dir).sort()) {
    const dayPath = path.join(dir, dayName);
    if (!isValidDate(dayName) || !fs.statSync(dayPath).isDirectory()) continue;
    const files = fs.readdirSync(dayPath);
    for (const f of files) {
      const id = f.replace(/\.md$/, '');
      if (!f.endsWith('.md') || !habitIds.has(id)) continue;
      const parsed = parseEntry(fs.readFileSync(path.join(dayPath, f), 'utf8'));
      parsed.habit = id;
      parsed.date = dayName;
      parsed.assets = files.filter((x) => !x.endsWith('.md') && x.startsWith(id));
      (byDate[dayName] ||= {})[id] = parsed;
    }
  }
  return byDate;
}

export function challengeDays(cfg) {
  return Array.from({ length: cfg.days }, (_, i) => ({
    date: addDays(cfg.start, i),
    n: i + 1,
  }));
}

export function dayStatus(date, cfg, entries, today) {
  const inRange = daysBetween(cfg.start, date) >= 0 && daysBetween(date, addDays(cfg.start, cfg.days - 1)) >= 0;
  if (!inRange) return 'outside';
  const done = cfg.habits.filter((h) => entries[date] && entries[date][h.id]).length;
  if (done === cfg.habits.length) return 'done';
  if (daysBetween(today, date) > 0) return 'future';
  if (done > 0) return 'partial';
  return 'missed';
}
