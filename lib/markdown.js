// Safe Markdown renderer for study articles (CertLab Write-ups).
// No dependencies. Raw HTML in the source is escaped, never rendered, and
// only a fixed set of structural tags is ever generated. Links with a
// javascript:, data: or vbscript: scheme are dropped to plain text.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function slugify(value = '') {
  return String(value)
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function isSafeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('#')) return true;
  if (/^(javascript|data|vbscript):/i.test(value)) return false;
  return /^(https?:)?\/\//i.test(value) || /^[a-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/i.test(value);
}

function renderInline(text) {
  // Escape first, then restore only the inline constructs we generate.
  let out = escHtml(text);
  // Images must be handled before links: ![alt](src)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, src) => {
    if (!isSafeUrl(src)) return escHtml(alt);
    return `<img src="${escHtml(src)}" alt="${escHtml(alt)}" loading="lazy">`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, href) => {
    if (!isSafeUrl(href)) return label;
    const external = /^https?:\/\//i.test(href);
    const attrs = external ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${escHtml(href)}"${attrs}>${label}</a>`;
  });
  out = out.replace(/`([^`]+)`/g, (match, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

function renderTableCell(text) {
  return `<td>${renderInline(text.trim())}</td>`;
}

function isTableSeparator(line) {
  const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

export function extractHeadings(markdown = '') {
  const headings = [];
  const seen = new Map();
  let inFence = false;
  for (const rawLine of String(markdown).split('\n')) {
    const line = rawLine.trim();
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const match = /^(#{1,4})\s+(.+)$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/[*`_]/g, '').trim();
    const base = slugify(text) || 'section';
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    headings.push({ level: match[1].length, text, id: count === 1 ? base : `${base}-${count}` });
  }
  return headings;
}

export function renderMarkdownWithToc(markdown = '') {
  const headings = extractHeadings(markdown);
  const headingIds = new Map();
  headings.forEach((h) => { headingIds.set(`${h.level}:${h.text}`, h.id); });
  // Re-derive ids in document order for rendering (duplicate texts get
  // the same sequence as extractHeadings, because both walk top-down).
  const used = new Map();
  const nextHeadingId = (level, text) => {
    const base = slugify(text.replace(/[*`_]/g, '').trim()) || 'section';
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

  const lines = String(markdown).split('\n');
  let html = '';
  let i = 0;
  let inFence = false;
  let fenceLang = '';
  let fenceBuf = [];

  const closeFence = () => {
    const lang = /^[a-z0-9_-]+$/i.test(fenceLang) ? fenceLang.toLowerCase() : '';
    html += `<pre><code${lang ? ` class="language-${escHtml(lang)}"` : ''}>${escHtml(fenceBuf.join('\n'))}</code></pre>`;
    fenceBuf = [];
    inFence = false;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (/^```/.test(line)) {
      if (inFence) closeFence();
      else { inFence = true; fenceLang = line.slice(3).trim(); fenceBuf = []; }
      i += 1;
      continue;
    }
    if (inFence) { fenceBuf.push(raw); i += 1; continue; }

    if (!line) { i += 1; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { html += '<hr>'; i += 1; continue; }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/[*`_]/g, '').trim();
      html += `<h${level} id="${escHtml(nextHeadingId(level, text))}" tabindex="-1">${renderInline(heading[2].trim())}</h${level}>`;
      i += 1;
      continue;
    }

    if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      html += `<blockquote>${buf.map((b) => `<p>${renderInline(b)}</p>`).join('')}</blockquote>`;
      continue;
    }

    // Table: header row followed by a separator row.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      html += '<div class="table-wrap"><table><thead><tr>';
      html += header.map((c) => `<th>${renderInline(c)}</th>`).join('');
      html += '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        html += `<tr>${splitRow(lines[i]).map(renderTableCell).join('')}</tr>`;
        i += 1;
      }
      html += '</tbody></table></div>';
      continue;
    }

    // Lists (unordered or ordered), one level of nesting by indent.
    if (/^([-*•]|\d+[.)])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^(\s*)([-*•]|\d+[.)])\s+/.test(lines[i])) {
        const m = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        items.push({ indent: m[1].length, ordered: /^\d/.test(m[2]), text: m[3] });
        i += 1;
      }
      const ordered = items[0].ordered;
      const tag = ordered ? 'ol' : 'ul';
      html += `<${tag} class="article-list">`;
      html += items.map((item) => `<li>${renderInline(item.text)}</li>`).join('');
      html += `</${tag}>`;
      continue;
    }

    // Plain paragraph: gather consecutive non-blank lines.
    const buf = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*[-*•]\s|\s*\d+[.)]\s)/.test(lines[i].trim())) {
      buf.push(lines[i].trim());
      i += 1;
    }
    html += `<p>${buf.map(renderInline).join(' ')}</p>`;
  }

  if (inFence) closeFence();
  return { html, headings };
}

export function renderMarkdown(markdown = '') {
  return renderMarkdownWithToc(markdown).html;
}
