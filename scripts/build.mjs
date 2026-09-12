import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown, plainText, escapeHtml } from './lib/md.mjs';
import {
  ROOT, loadConfig, loadEntries, challengeDate, challengeDays, dayStatus,
  daysBetween, formatDate, weekdayName, weekdayIndex, monthTitle, entriesDir,
} from './lib/data.mjs';

const cfg = loadConfig();
const entries = loadEntries(cfg);
const today = challengeDate(new Date(), cfg);
const outDir = path.resolve(ROOT, process.env.OUT_DIR || 'dist');
const days = challengeDays(cfg);
const lastDay = days.at(-1).date;

const DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)$/i;

function page({ title, body, depth = 0 }) {
  const up = depth ? '../'.repeat(depth) : '';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(cfg.tagline || '')}">
<link rel="stylesheet" href="${up}style.css">
</head>
<body>
<div class="wrap">
${body}
${footer(up)}
</div>
</body>
</html>
`;
}

function footer(up) {
  const repo = cfg.owner && cfg.repo ? `https://github.com/${cfg.owner}/${cfg.repo}` : '';
  const parts = [
    `<a href="${up}index.html">Календарь</a>`,
    `<a href="${up}all.html">Все записи</a>`,
  ];
  if (repo) parts.push(`<a href="${escapeHtml(repo)}" rel="noopener">Исходники на GitHub</a>`);
  parts.push(`<span>Обновлено ${formatDate(today)}</span>`);
  return `<div class="footer">${parts.join('')}</div>`;
}

function imageOf(entry) {
  if (!entry) return null;
  return entry.meta.image || entry.assets.find((a) => IMAGE_RE.test(a)) || null;
}

// --- главная ---

function renderCalendar() {
  const months = [];
  for (const { date } of days) {
    const key = date.slice(0, 7);
    if (!months.length || months.at(-1).key !== key) months.push({ key, dates: [] });
    months.at(-1).dates.push(date);
  }

  return months.map(({ key }) => {
    const [y, m] = key.split('-').map(Number);
    const first = `${key}-01`;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [];

    for (let i = 0; i < weekdayIndex(first); i++) cells.push('<div></div>');

    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${key}-${String(d).padStart(2, '0')}`;
      const status = dayStatus(date, cfg, entries, today);
      const marks = cfg.habits.map((h) => {
        if (status === 'outside') return '';
        const has = entries[date] && entries[date][h.id];
        const cls = has ? 'done' : (daysBetween(today, date) > 0 ? 'future' : 'missed');
        return `<span class="mark ${cls}" title="${escapeHtml(h.name)}"></span>`;
      }).join('');
      const inner = `<span class="num">${d}</span><span class="marks">${marks}</span>`;

      if (status === 'outside' || status === 'future') {
        cells.push(`<div class="cell is-${status}">${inner}</div>`);
      } else {
        cells.push(`<a class="cell is-${status}" href="d/${date}.html">${inner}</a>`);
      }
    }

    return `<section class="month">
<h2>${escapeHtml(monthTitle(y, m - 1))}</h2>
<div class="grid">${DOW.map((w) => `<div class="dow">${w}</div>`).join('')}${cells.join('')}</div>
</section>`;
  }).join('\n');
}

function renderSummary() {
  const elapsed = days.filter((d) => daysBetween(d.date, today) >= 0).length;
  const stats = [];

  if (daysBetween(today, cfg.start) > 0) {
    const left = daysBetween(today, cfg.start);
    stats.push({ b: left, s: plural(left, 'день до старта', 'дня до старта', 'дней до старта') });
  } else if (daysBetween(lastDay, today) > 0) {
    stats.push({ b: `${cfg.days}/${cfg.days}`, s: 'челлендж окончен' });
  } else {
    stats.push({ b: `${elapsed}/${cfg.days}`, s: 'день челленджа' });
  }

  for (const h of cfg.habits) {
    const done = days.filter((d) => entries[d.date] && entries[d.date][h.id]).length;
    stats.push({ b: done, s: String(h.verb || h.name).toLowerCase() });
  }

  // Пропуск — это незакрытая привычка в уже прошедшем дне.
  let missed = 0;
  for (const d of days) {
    if (daysBetween(d.date, today) < 0) continue;
    for (const h of cfg.habits) {
      if (!(entries[d.date] && entries[d.date][h.id])) missed++;
    }
  }
  stats.push({ b: missed, s: plural(missed, 'пропуск', 'пропуска', 'пропусков') });

  return `<div class="summary">${stats
    .map((s) => `<div class="stat"><b>${escapeHtml(String(s.b))}</b><span>${escapeHtml(s.s)}</span></div>`)
    .join('')}</div>`;
}

function buildIndex() {
  const body = `<header class="masthead">
<h1>${escapeHtml(cfg.title)}</h1>
<p class="tagline">${escapeHtml(cfg.tagline || '')}</p>
${cfg.about ? `<p class="about">${escapeHtml(cfg.about)}</p>` : ''}
</header>
${renderSummary()}
${renderCalendar()}
<div class="legend">
<span><i class="done"></i>сделано</span>
<span><i class="missed"></i>пропущено</span>
<span><i class="future"></i>ещё впереди</span>
</div>`;
  return page({ title: cfg.title, body });
}

// --- страница дня ---

function renderReading(e) {
  const { meta, body } = e;
  const bits = [];
  if (meta.author) bits.push(escapeHtml(meta.author));
  if (meta.source) bits.push(escapeHtml(meta.source));
  if (meta.minutes) bits.push(escapeHtml(meta.minutes) + ' мин чтения');
  const title = meta.title || 'Статья';
  const head = meta.url
    ? `<h2><a href="${escapeHtml(meta.url)}" rel="noopener">${escapeHtml(title)}</a></h2>`
    : `<h2>${escapeHtml(title)}</h2>`;
  return `${head}
${bits.length ? `<p class="byline">${bits.join('<span class="sep">·</span>')}</p>` : ''}
<div class="prose">${renderMarkdown(body)}</div>`;
}

function renderDrawing(e) {
  const { meta, body, date } = e;
  const img = imageOf(e);
  const bits = [];
  if (meta.tool) bits.push(escapeHtml(meta.tool));
  if (meta.minutes) bits.push(escapeHtml(meta.minutes) + ' мин');
  const src = `../media/${date}/${encodeURIComponent(img || '')}`;
  const figure = img
    ? `<figure class="artwork"><a href="${src}" rel="noopener">
<img src="${src}" alt="Рисунок за ${escapeHtml(formatDate(date))}">
</a><figcaption>Нажмите, чтобы открыть в полном размере</figcaption></figure>`
    : '';
  return `${meta.title ? `<h2>${escapeHtml(meta.title)}</h2>` : ''}
${bits.length ? `<p class="byline">${bits.join('<span class="sep">·</span>')}</p>` : ''}
${figure}
<div class="prose">${renderMarkdown(body)}</div>`;
}

function renderEntry(habit, e, date) {
  let inner;
  if (!e) {
    const future = daysBetween(today, date) > 0;
    inner = `<div class="blank${future ? ' is-future' : ''}">${escapeHtml(
      future ? 'Этот день ещё не наступил.' : (habit.empty || 'Записи нет.'))}</div>`;
  } else if (habit.id === 'reading') {
    inner = renderReading(e);
  } else {
    inner = renderDrawing(e);
  }
  return `<section class="entry">
<div class="kicker">${escapeHtml(habit.name)}</div>
${inner}
</section>`;
}

function buildDay({ date, n }) {
  const dayEntries = entries[date] || {};
  const body = `<a class="backlink" href="../index.html">← К календарю</a>
<header class="dayhead">
<h1>День ${n}</h1>
<div class="sub">${escapeHtml(formatDate(date))}, ${escapeHtml(weekdayName(date))}</div>
</header>
${cfg.habits.map((h) => renderEntry(h, dayEntries[h.id], date)).join('\n')}`;
  return page({ title: `День ${n} — ${cfg.title}`, body, depth: 1 });
}

// --- лента ---

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function buildFeed() {
  const items = [];
  for (const { date, n } of days) {
    for (const h of cfg.habits) {
      const e = entries[date] && entries[date][h.id];
      if (!e) continue;
      items.push({ date, n, habit: h, entry: e, img: h.id === 'drawing' ? imageOf(e) : null });
    }
  }
  items.reverse();

  const list = items.length
    ? items.map((it) => `<article class="feed-item">
${it.img ? `<img class="thumb" src="media/${it.date}/${encodeURIComponent(it.img)}" alt="" loading="lazy">` : ''}
<div class="when">День ${it.n} · ${escapeHtml(formatDate(it.date))} · ${escapeHtml(it.habit.name)}</div>
<h3><a href="d/${it.date}.html">${escapeHtml(it.entry.meta.title || `${it.habit.name} за ${formatDate(it.date)}`)}</a></h3>
<p>${escapeHtml(plainText(it.entry.body))}</p>
</article>`).join('\n')
    : '<p class="blank">Пока пусто. Всё впереди.</p>';

  const body = `<a class="backlink" href="index.html">← К календарю</a>
<header class="masthead">
<h1>Все записи</h1>
<p class="tagline">${items.length} ${plural(items.length, 'запись', 'записи', 'записей')} по порядку, от свежих к старым.</p>
</header>
${list}`;
  return page({ title: `Все записи — ${cfg.title}`, body });
}

// --- запись на диск ---

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

write(path.join(outDir, 'index.html'), buildIndex());
write(path.join(outDir, 'all.html'), buildFeed());
for (const d of days) write(path.join(outDir, 'd', `${d.date}.html`), buildDay(d));

fs.copyFileSync(path.join(ROOT, 'site', 'style.css'), path.join(outDir, 'style.css'));
fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

let assetCount = 0;
const srcDir = entriesDir();
for (const date of Object.keys(entries)) {
  for (const h of cfg.habits) {
    const e = entries[date][h.id];
    if (!e) continue;
    for (const a of e.assets) {
      const to = path.join(outDir, 'media', date, a);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(srcDir, date, a), to);
      assetCount++;
    }
  }
}

const doneCount = days.filter((d) => dayStatus(d.date, cfg, entries, today) === 'done').length;
console.log(
  `Собрано: ${days.length} дней, ${assetCount} вложений, полных дней ${doneCount}. ` +
  `Сегодня по календарю челленджа: ${today}. → ${path.relative(ROOT, outDir)}`
);
