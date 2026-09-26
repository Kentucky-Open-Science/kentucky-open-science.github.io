'use strict';
// A deliberately tiny template language for the files in src/:
//
//   {{ key.path }}     value, HTML-escaped
//   {{{ key.path }}}   value, inserted as-is (for HTML the builder generated)
//   {{> name }}        include src/partials/<name>.html, rendered with the same context
//
// Page files in src/pages/ may start with a front-matter block:
//
//   ---
//   title: About this wiki
//   description: One or two sentences for search engines.
//   nav: about
//   ---

const fs = require('node:fs');
const path = require('node:path');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    // Braces too, so text from a README can never form a template token.
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

function lookup(ctx, key) {
  let v = ctx;
  for (const part of key.split('.')) {
    if (v == null) return undefined;
    v = v[part];
  }
  return v;
}

function render(tpl, ctx, partialsDir, depth = 0) {
  if (depth > 10) throw new Error('template partials nested too deeply');
  // One pass: values inserted here are never re-scanned for tokens.
  return tpl.replace(/\{\{>\s*([\w-]+)\s*\}\}|\{\{\{\s*([\w.-]+)\s*\}\}\}|\{\{\s*([\w.-]+)\s*\}\}/g, (_, partial, raw, key) => {
    if (partial) return render(fs.readFileSync(path.join(partialsDir, `${partial}.html`), 'utf8'), ctx, partialsDir, depth + 1);
    const v = lookup(ctx, raw || key);
    if (v === undefined) throw new Error(`template: no value for ${raw || key}`);
    return raw ? String(v) : esc(v);
  });
}

function frontMatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

module.exports = { esc, render, frontMatter };
