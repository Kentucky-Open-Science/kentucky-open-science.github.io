'use strict';
// Just enough Markdown handling to turn a repository README into wiki content:
// a short plain-text summary, the section headings (linked to GitHub's anchors),
// and a plain-text body for the search index. Nothing here produces HTML — the
// site builder escapes everything it prints — so a hostile README cannot inject
// markup into the site.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip inline Markdown/HTML from one line or paragraph, leaving readable text. */
function inlineText(s) {
  return decodeEntities(
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
      .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '') // reference images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1') // reference links
      .replace(/<(https?:\/\/[^>\s]+)>/g, '$1') // autolinks
      .replace(/<\/?[a-z][^>]*>/gi, '') // inline HTML tags
      .replace(/`+([^`]*)`+/g, '$1') // code spans
      .replace(/(\*\*|__)(.+?)\1/g, '$2') // bold
      .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2') // italics
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/\$([^$\n]+)\$/g, (_, m) => m.replace(/\\(approx|times|pm|le|ge|sim)\b/g, (x, c) => ({ approx: '≈', times: '×', pm: '±', le: '≤', ge: '≥', sim: '~' })[c]).replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '')) // inline math
      .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1') // escapes
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/** GitHub's heading anchor algorithm (close enough for README headings). */
function githubSlug(text, seen) {
  let slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-'); // no trim: "🚀 Setup" is "#-setup" on GitHub
  if (seen) {
    const n = seen.get(slug) || 0;
    seen.set(slug, n + 1);
    if (n) slug = `${slug}-${n}`;
  }
  return slug;
}

/**
 * Split a README into blocks, skipping fenced code, HTML comments, tables, and
 * link-reference definitions.
 * @returns {{type:'heading'|'para'|'list'|'quote', level?:number, text:string}[]}
 */
function blocks(md) {
  const lines = String(md || '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
  const out = [];
  let buf = [];
  let kind = null;
  let fence = null;
  const flush = () => {
    if (buf.length) out.push({ type: kind || 'para', text: buf.join(' ') });
    buf = [];
    kind = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      flush();
      fence = f[1];
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flush();
      out.push({ type: 'heading', level: h[1].length, text: h[2] });
      continue;
    }
    // Setext headings (Title\n=====)
    const next = lines[i + 1] || '';
    if (!kind && /^\s{0,3}(=+|-+)\s*$/.test(next) && !/^\s*[-*+]\s/.test(line) && !line.includes('|')) {
      flush();
      out.push({ type: 'heading', level: next.trim()[0] === '=' ? 1 : 2, text: line.trim() });
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) || /^\s*\[[^\]]+\]:\s*\S/.test(line) || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush(); // tables, link definitions, horizontal rules
      continue;
    }
    const type = /^\s*>/.test(line) ? 'quote' : /^\s*([-*+]|\d+[.)])\s+/.test(line) ? 'list' : 'para';
    if (kind && kind !== type && type !== 'para') flush();
    if (!kind) kind = type;
    buf.push(line.replace(/^\s*>\s?/, '').replace(/^\s*([-*+]|\d+[.)])\s+/, '• ').trim());
  }
  flush();
  return out;
}

/**
 * @param {string} md  README markdown
 * @param {{name?:string, maxSummary?:number, maxText?:number}} [opts]
 */
function summarize(md, opts = {}) {
  const maxSummary = opts.maxSummary || 900;
  const maxText = opts.maxText || 8000;
  const seen = new Map();
  const headings = [];
  const summary = [];
  const text = [];
  let summaryLen = 0;
  let firstHeading = true;
  for (const b of blocks(md)) {
    if (b.type === 'heading') {
      const t = inlineText(b.text);
      if (!t) continue;
      const anchor = githubSlug(t, seen);
      // The first H1 is almost always the repository name; it is not a section.
      if (firstHeading && b.level === 1) {
        firstHeading = false;
        continue;
      }
      firstHeading = false;
      if (b.level <= 3 && headings.length < 30) headings.push({ level: b.level, text: t, anchor });
      text.push(t);
      continue;
    }
    const t = inlineText(b.text).replace(/^•\s*/, b.type === 'list' ? '• ' : '');
    if (!t || !/[\p{L}]{3,}/u.test(t)) continue; // badge rows, bare URLs, emoji lines
    if ((t.match(/\|/g) || []).length >= 3) continue; // language pickers, nav rows
    text.push(t);
    const room = maxSummary - summaryLen;
    // Whole paragraphs only, except the first, which may be cut to fit.
    if (t.length >= 30 && b.type !== 'list' && (t.length <= room || (!summary.length && room > 0))) {
      const piece = t.length > room ? t.slice(0, room).replace(/\s+\S*$/, '') + ' …' : t;
      summary.push(piece);
      summaryLen += piece.length;
    }
  }
  let body = text.join('\n');
  if (body.length > maxText) body = body.slice(0, maxText).replace(/\s+\S*$/, '') + ' …';
  return { summary, headings, text: body };
}

module.exports = { summarize, inlineText, githubSlug, blocks, decodeEntities };
