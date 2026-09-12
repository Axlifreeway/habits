// Проверяет формы issue на то, что GitHub их примет.
//
// Ловит случай, на котором мы уже обожглись: `placeholder: 2026-09-13` без
// кавычек YAML разбирает как дату, а не строку, и GitHub молча выбрасывает
// шаблон целиком — формы просто исчезают со страницы создания issue.
// Полноценного YAML-парсера в проекте нет и не нужно: проверяем построчно.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/data.mjs';

const dir = path.join(ROOT, '.github', 'ISSUE_TEMPLATE');
const problems = [];

// Значения, которые YAML посчитает не строкой: даты, числа, булевы, null.
const NOT_A_STRING = [
  [/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'дата'],
  [/^[0-9]+(\.[0-9]+)?$/, 'число'],
  [/^(true|false|yes|no|on|off)$/i, 'булево значение'],
  [/^(null|~)$/i, 'null'],
];

// Поля, где GitHub ждёт именно строку.
const STRING_KEYS = ['placeholder', 'value', 'label', 'description', 'title', 'name'];

const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && f !== 'config.yml')
  : [];

if (!files.length) problems.push('В .github/ISSUE_TEMPLATE нет ни одной формы.');

for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const lines = text.split('\n');
  const seen = new Set();

  lines.forEach((line, i) => {
    // Ключ может идти как сам по себе, так и первым в элементе списка: «- type: input».
    const m = line.match(/^\s*(?:-\s+)?([a-z_]+):\s*(.+?)\s*$/);
    if (!m) return;
    const [, key, raw] = m;
    if (key === 'type') seen.add('type');

    if (!STRING_KEYS.includes(key)) return;
    if (/^["'|>]/.test(raw)) return; // уже строка: кавычки или блочный скаляр

    for (const [re, what] of NOT_A_STRING) {
      if (re.test(raw)) {
        problems.push(
          `${file}:${i + 1} — ${key}: ${raw} YAML прочитает как ${what}, а GitHub ждёт строку. Возьми в кавычки: ${key}: "${raw}"`
        );
      }
    }
  });

  if (!seen.has('type')) problems.push(`${file} — нет ни одного поля body с type.`);
  for (const need of ['name', 'description', 'body']) {
    if (!new RegExp(`^${need}:`, 'm').test(text)) {
      problems.push(`${file} — отсутствует обязательный ключ ${need}:`);
    }
  }
  if (!/^labels:/m.test(text)) {
    problems.push(`${file} — нет labels, без метки приёмщик записей не запустится.`);
  }
}

if (problems.length) {
  console.error('Формы issue не пройдут проверку GitHub:\n');
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}

console.log(`Формы issue в порядке (${files.length} шт.): ${files.join(', ')}`);
