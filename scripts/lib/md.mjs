// Маленький markdown-рендерер. Умеет ровно то, что нужно для конспекта:
// заголовки, списки, цитаты, жирный/курсив, код, ссылки, картинки, черту.

const PH_OPEN = String.fromCharCode(0xe000);
const PH_CLOSE = String.fromCharCode(0xe001);

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeUrl(u) {
  const t = String(u).trim();
  if (/^(https?:|mailto:|#|\/|\.\/|[\w.-]+\.(png|jpe?g|gif|webp|avif)$)/i.test(t)) return escapeHtml(t);
  return '#';
}

function inline(src) {
  const codes = [];
  let s = String(src).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return PH_OPEN + (codes.length - 1) + PH_CLOSE;
  });
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_, alt, u) => `<img src="${safeUrl(u)}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, txt, u) => `<a href="${safeUrl(u)}" rel="noopener">${txt}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(«—-])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(new RegExp(PH_OPEN + '([0-9]+)' + PH_CLOSE, 'g'),
    (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  return s;
}

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const flushList = (tag, items) => {
    out.push(`<${tag}>` + items.map((t) => `<li>${inline(t)}</li>`).join('') + `</${tag}>`);
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(6, h[1].length + 1); // h1 отдан заголовку страницы
      out.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s{0,3}[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s{0,3}[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s{0,3}[-*+]\s+/, ''));
        i++;
      }
      flushList('ul', items);
      continue;
    }

    if (/^\s{0,3}\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s{0,3}\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s{0,3}\d+[.)]\s+/, ''));
        i++;
      }
      flushList('ol', items);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s{0,3}([-*+]\s|\d+[.)]\s|>|#{1,6}\s|```)/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return out.join('\n');
}

// Голый текст для превью в ленте.
export function plainText(src, limit = 220) {
  let s = String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > limit) s = s.slice(0, limit).replace(/\s+\S*$/, '') + '…';
  return s;
}
