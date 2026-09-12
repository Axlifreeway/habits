// Генерирует фальшивые записи в .demo/, чтобы посмотреть, как сайт выглядит
// с реальным наполнением. Ничего в entries/ не трогает.
//   node scripts/demo.mjs && CONFIG_FILE=.demo/config.json ENTRIES_DIR=.demo/entries OUT_DIR=.demo/dist node scripts/build.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT, loadConfig, serializeEntry, addDays } from './lib/data.mjs';

const demoRoot = path.join(ROOT, '.demo');
const entriesOut = path.join(demoRoot, 'entries');
fs.rmSync(demoRoot, { recursive: true, force: true });
fs.mkdirSync(entriesOut, { recursive: true });

const cfg = loadConfig();
cfg.start = '2026-09-01';
fs.writeFileSync(path.join(demoRoot, 'config.json'), JSON.stringify(cfg, null, 2));

// --- минимальный PNG-энкодер (нужен только демо-картинке) ---

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, paint) {
  const px = Buffer.alloc(width * height * 3, 0xf4);
  const set = (x, y, r, g, b) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  };
  paint(set, width, height);

  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    px.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function stroke(set, x0, y0, x1, y1, shade, weight) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    for (let w = -weight; w <= weight; w++) {
      for (let v = -weight; v <= weight; v++) {
        const fade = shade + Math.round(Math.random() * 40);
        set(x + w, y + v, fade, fade, fade);
      }
    }
  }
}

// Каракули «сферы с тенью» — примерно то, что рисуют на первой неделе.
function sketch(seed) {
  return (set, W, H) => {
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const cx = W * 0.42, cy = H * 0.46, r = Math.min(W, H) * 0.26;
    for (let pass = 0; pass < 3; pass++) {
      let prev = null;
      for (let a = 0; a <= 360; a += 3) {
        const rad = (a * Math.PI) / 180;
        const jitter = 1 + (rnd() - 0.5) * 0.03;
        const p = [cx + Math.cos(rad) * r * jitter, cy + Math.sin(rad) * r * jitter];
        if (prev) stroke(set, prev[0], prev[1], p[0], p[1], 60, 1);
        prev = p;
      }
    }
    for (let i = 0; i < 260; i++) {
      const a = Math.PI * 0.25 + rnd() * Math.PI * 0.9;
      const rr = r * (0.35 + rnd() * 0.6);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      stroke(set, x, y, x + 16 + rnd() * 14, y + 16 + rnd() * 14, 120, 0);
    }
    const sy = cy + r * 1.02;
    for (let i = 0; i < 160; i++) {
      const x = cx + (rnd() - 0.35) * r * 2.4;
      stroke(set, x, sy + rnd() * 14, x + 20 + rnd() * 20, sy + rnd() * 16, 140, 0);
    }
    stroke(set, W * 0.08, sy + 26, W * 0.92, sy + 26 + (rnd() - 0.5) * 8, 150, 0);
  };
}

// --- сами записи ---

const reading = [
  {
    day: 0,
    title: 'The Grug Brained Developer',
    author: 'Carson Gross',
    source: 'grugbrain.dev',
    url: 'https://grugbrain.dev/',
    minutes: '12',
    body: `Текст про то, что главный враг разработчика — сложность, и что её надо душить в зародыше, а не героически побеждать потом.

## Что зацепило

- **Сложность накапливается незаметно.** Не бывает одного решения, которое всё испортило: портят сто маленьких «ну тут же логично добавить флаг».
- Автор советует говорить «я пока не понимаю эту часть» вместо того, чтобы делать вид, что понял. Это дешевле обходится.
- Отдельно про тесты: интеграционные важнее юнитов, потому что ловят то, что реально ломается.

## Что я забираю себе

Раньше я думал, что читать чужой код тяжело, потому что я мало знаю. Теперь думаю, что чаще код просто *объективно* переусложнён, и это не мой личный недостаток.

> «Хороший инженер — это тот, кто сумел не построить лишнего.»

Спорный момент: автор почти отрицает абстракции. Мне кажется, он воюет не с абстракциями, а с преждевременными.`,
  },
  {
    day: 1,
    title: 'Как работает HTTPS: объяснение на пальцах',
    author: 'Илья Григорик',
    source: 'High Performance Browser Networking',
    url: 'https://hpbn.co/transport-layer-security-tls/',
    minutes: '18',
    body: `Разбирался, что именно происходит между «вбил адрес» и «появился замочек».

1. Клиент и сервер договариваются о версии протокола и наборе шифров.
2. Сервер присылает сертификат, клиент проверяет цепочку до корневого центра.
3. Стороны вырабатывают общий сеансовый ключ, дальше всё симметрично — это быстро.

Главное открытие: сертификат не шифрует трафик. Он только подтверждает, *с кем* ты разговариваешь. Шифрование — отдельная часть, и я эти две вещи в голове склеивал.

Ещё запомнил, что TLS 1.3 выкинул кучу старых шифров и сократил рукопожатие до одного круга вместо двух. Отсюда и заметная разница в скорости.`,
  },
  {
    day: 3,
    title: 'Почему дедлайны не работают',
    author: 'Максим Дорофеев',
    source: 'Блог',
    url: 'https://example.com/deadlines',
    minutes: '9',
    body: `Короткая заметка про то, что дедлайн — это не мотиватор, а ограничитель. Он не заставляет работать, он заставляет резать объём.

- Если задача не начата, дедлайн просто сдвигает панику ближе к концу.
- Работает не срок, а маленький следующий шаг, который можно сделать прямо сейчас.
- Автор предлагает формулировать задачи глаголом: не «отчёт», а «открыть таблицу и выписать три цифры».

Попробовал применить к этому челленджу: вместо «читать статью» записал себе «открыть вкладку со статьёй за завтраком». Пока работает.`,
  },
  {
    day: 4,
    title: 'A Brief History of the Numeric Keypad',
    author: 'Sarah Zhang',
    source: 'Atlas Obscura',
    url: 'https://example.com/keypad',
    minutes: '7',
    body: `Про то, почему на телефоне единица сверху, а на калькуляторе — снизу.

Оказывается, это не случайность и не злой умысел: раскладку калькулятора унаследовали от механических арифмометров, а телефонную Bell Labs проектировали с нуля и **специально** тестировали на людях. Выяснилось, что операторы набирали слишком быстро для тогдашней электроники, и раскладку выбрали такую, которая немного *замедляет* ввод.

Люблю такие истории: то, что выглядит как бардак, почти всегда оказалось чьим-то осознанным компромиссом при других вводных.`,
  },
  {
    day: 6,
    title: 'Rendering on the Web',
    author: 'Jason Miller, Addy Osmani',
    source: 'web.dev',
    url: 'https://web.dev/rendering-on-the-web/',
    minutes: '22',
    body: `Тяжёлая статья, читал в два захода. Про спектр между «всё рисует сервер» и «всё рисует браузер».

## Основные варианты

- **SSR** — сервер отдаёт готовый HTML. Быстрый первый экран, дорогой сервер.
- **CSR** — браузер собирает страницу сам. Дешёвый хостинг, долгий старт.
- **Статика** — HTML собран заранее. Быстро и дёшево, но не годится для персонального контента.
- **Гидрация** — компромисс, у которого свои болячки: HTML приехал, а кликать ещё нельзя.

## Вывод для себя

Мой календарь — ровно случай статики: контента мало, он один для всех, меняется раз в день. Никакого смысла тащить сюда фреймворк нет, и хорошо, что я это теперь могу объяснить, а не просто чувствую.`,
  },
  {
    day: 7,
    title: 'Ne Plus Ultra: письмо о привычках',
    author: 'James Clear',
    source: '3-2-1 Newsletter',
    url: 'https://example.com/habits',
    minutes: '5',
    body: `Мысль, ради которой стоило читать: пропуск одного дня не ломает привычку, ломает пропуск двух подряд.

Первый пропуск — случайность. Второй — уже новый шаблон поведения. Поэтому правило простое: **никогда не пропускать дважды**.

Как раз про то, как я устроил себе этот челлендж: без обнуления счётчика, но с видимой дыркой в календаре. Дырка неприятна ровно настолько, чтобы на следующий день сесть и сделать.`,
  },
  {
    day: 8,
    title: 'The Art of Command Line',
    author: 'Joshua Levy',
    source: 'GitHub',
    url: 'https://github.com/jlevy/the-art-of-command-line',
    minutes: '25',
    body: `Не столько статья, сколько длинный список приёмов. Читал по диагонали, выписал то, чего не знал.

- \`ctrl-r\` — поиск по истории команд. Пользовался стрелками вверх как дикарь.
- \`!!\` — предыдущая команда целиком; \`sudo !!\` — классика.
- \`cd -\` возвращает в предыдущий каталог.
- \`xargs\` для превращения списка строк в аргументы — до сих пор обходил стороной.

Понял, что мой терминал я использую процентов на десять. Не буду учить всё сразу — взял четыре штуки выше и буду ими пользоваться неделю.`,
  },
  {
    day: 10,
    title: 'Why Do Cats Purr?',
    author: 'Ed Yong',
    source: 'The Atlantic',
    url: 'https://example.com/purr',
    minutes: '11',
    body: `Читал вечером после работы, специально взял что-то лёгкое.

Короткий ответ: никто точно не знает. Есть гипотеза, что мурлыканье на частоте 25–150 Гц ускоряет заживление костей, и что кошки так себя лечат. Есть версия попроще — это сигнал «мне не угрожают, продолжай».

Понравилось, как автор честно держит рамку: описывает три конкурирующие гипотезы и ни одну не выдаёт за истину. Обычно в научпопе наоборот — берут самую эффектную и подают как факт.`,
  },
];

const drawing = [
  { day: 0, title: 'Первый день: линии', tool: 'Krita, карандаш 2B', minutes: '35',
    body: 'Просто заполнял лист линиями, чтобы привыкнуть к планшету. Рука дрожит, прямая линия не выходит вообще. Заметил, что если вести быстро от плеча, получается ровнее, чем если аккуратно от кисти.' },
  { day: 1, title: 'Сфера и тень', tool: 'Krita', minutes: '50',
    body: 'Первая попытка в объём. Свет сверху слева. Падающая тень получилась слишком резкой и слишком тёмной у края — на самом деле у тени край размывается по мере удаления от предмета. Учту.' },
  { day: 2, title: 'Ещё сферы', tool: 'Krita', minutes: '40',
    body: 'Повторил то же самое три раза подряд. Третья заметно лучше первой: перестал бояться класть тёмное. Раньше всё было серое и вялое, потому что жалел нажим.' },
  { day: 4, title: 'Куб, много кубов', tool: 'Krita', minutes: '30',
    body: 'Перспектива пока на глаз, без линий схода. Видно, что кубы «разъезжаются». Завтра попробую честно построить горизонт и две точки.' },
  { day: 5, title: 'Кружка с натуры', tool: 'Krita', minutes: '55',
    body: 'Рисовал свою кружку. Самое сложное — эллипс сверху: он всё время выходит как лимон с острыми краями. Прочитал, что эллипс надо проводить одним движением, не подправляя. Помогло, но со второго десятка попыток.' },
  { day: 7, title: 'Каракули в обед', tool: 'Krita', minutes: '15',
    body: 'Честно говоря, сегодня почти ничего. Работал допоздна, сел в 00:40 и просто накидал каких-то форм, чтобы не пропускать. Пусть будет — правила есть правила.' },
  { day: 8, title: 'Складки ткани', tool: 'Krita', minutes: '45',
    body: 'Кинул полотенце на стул и рисовал складки. Оказалось интереснее, чем ожидал: складка — это не случайная линия, у неё есть точка натяжения, откуда всё расходится. Если найти её, остальное само выстраивается.' },
  { day: 9, title: 'Рука (попытка первая)', tool: 'Krita', minutes: '60',
    body: 'Классика: рисовал свою левую руку. Получилась варежка. Пальцы сидят не на своих местах, большой палец растёт откуда-то из запястья. Но час просидел и не бросил.' },
  { day: 10, title: 'Рука (попытка вторая)', tool: 'Krita', minutes: '50',
    body: 'Та же рука, но сначала построил блоками — ладонь как коробка, пальцы как цилиндры. Небо и земля по сравнению со вчерашним. Оказывается, «сначала конструкция, потом детали» — это не красивые слова из книжки.' },
];

for (const r of reading) {
  const date = addDays(cfg.start, r.day);
  const dir = path.join(entriesOut, date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'reading.md'), serializeEntry({
    habit: 'reading', date, title: r.title, author: r.author,
    source: r.source, url: r.url, minutes: r.minutes,
  }, r.body));
}

for (const d of drawing) {
  const date = addDays(cfg.start, d.day);
  const dir = path.join(entriesOut, date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'drawing.png'), png(1400, 980, sketch(d.day * 977 + 13)));
  fs.writeFileSync(path.join(dir, 'drawing.md'), serializeEntry({
    habit: 'drawing', date, title: d.title, image: 'drawing.png',
    tool: d.tool, minutes: d.minutes,
  }, d.body));
}

console.log(`Демо готово: ${reading.length} конспектов, ${drawing.length} рисунков в .demo/entries`);
