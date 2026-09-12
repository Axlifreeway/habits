// Создаёт заготовку записи с компьютера — запасной путь, если не через issue.
//   node scripts/new.mjs reading
//   node scripts/new.mjs drawing --date 2026-09-14 --image "C:/путь/к/рисунку.png"

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, challengeDate, isValidDate, entriesDir, formatDate } from './lib/data.mjs';

const cfg = loadConfig();
const argv = process.argv.slice(2);
const habitId = argv[0];
const habit = cfg.habits.find((h) => h.id === habitId);

if (!habit) {
  console.error(`Укажи привычку: ${cfg.habits.map((h) => h.id).join(' | ')}`);
  process.exit(1);
}

function opt(name) {
  const i = argv.indexOf('--' + name);
  return i !== -1 ? argv[i + 1] : undefined;
}

const date = opt('date') || challengeDate(new Date(), cfg);
if (!isValidDate(date)) {
  console.error(`Дата «${date}» не похожа на ГГГГ-ММ-ДД.`);
  process.exit(1);
}

const dir = path.join(entriesDir(), date);
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${habit.id}.md`);

if (fs.existsSync(file) && !argv.includes('--force')) {
  console.error(`Запись уже есть: ${file}\nОткрой её или добавь --force, чтобы перезаписать.`);
  process.exit(1);
}

let meta;
let body;

if (habit.id === 'reading') {
  meta = { habit: 'reading', date, title: '', url: '', author: '', source: '', minutes: '' };
  body = `Одним абзацем: о чём статья.

## Что зацепило

-
-

## Что я забираю себе

`;
} else {
  meta = { habit: 'drawing', date, title: '', image: '', tool: 'Krita', minutes: '' };
  body = 'Что пробовал, что получилось, что нет.\n';

  const img = opt('image');
  if (img) {
    if (!fs.existsSync(img)) {
      console.error(`Файл не найден: ${img}`);
      process.exit(1);
    }
    const ext = path.extname(img).toLowerCase().replace('.jpeg', '.jpg');
    fs.copyFileSync(img, path.join(dir, 'drawing' + ext));
    meta.image = 'drawing' + ext;
  }
}

// serializeEntry выкидывает пустые поля, а в заготовке они нужны для заполнения.
const head = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n');
fs.writeFileSync(file, `---\n${head}\n---\n\n${body}`);

console.log(`Создано: ${path.relative(process.cwd(), file)}  (${habit.name.toLowerCase()}, ${formatDate(date)})`);
console.log('Заполни файл, потом:  git add -A && git commit -m "день" && git push');
