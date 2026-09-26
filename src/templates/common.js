'use strict';
// Shared pieces for the data-driven pages (projects, project, bounties,
// leaderboard). Everything that prints data goes through esc().

const { esc } = require('../../tools/template');

/** "2026-09-25T18:00:00Z" -> "2026-09-25" */
function day(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Python, PHP, and Java" */
function listText(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function nav(site, current, root) {
  return site.nav
    .map((n) => `  <a href="${root}${esc(n.href)}"${n.id === current ? ' class="current"' : ''}>${esc(n.label)}</a>`)
    .join('\n');
}

function projectHref(p, root) {
  return `${root}projects/${encodeURIComponent(p.name)}.html`;
}

function areaHref(area, root) {
  return `${root}projects.html#area-${esc(area.id)}`;
}

/** One-line description: the GitHub description, else the README's opening, else a note. */
function blurb(p, max = 180) {
  let s = p.description || (p.readme && p.readme.summary[0]) || '';
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') + ' …';
  return s;
}

function flags(p) {
  const out = [];
  if (p.archived) out.push('<span class="flag flag-archived">Archived</span>');
  if (p.fork) out.push('<span class="flag flag-fork">Fork</span>');
  if (p.isTemplate) out.push('<span class="flag flag-template">Template</span>');
  return out.join(' ');
}

function projectMeta(p) {
  const bits = [];
  if (p.language) bits.push(esc(p.language));
  bits.push(`&#9733; ${p.stars}`);
  bits.push(`updated ${day(p.pushedAt)}`);
  return bits.join(' &middot; ');
}

/** A catalog/list entry for one project. */
function projectItem(p, root) {
  const text = blurb(p);
  return `      <li class="project-item" data-name="${esc(p.name)}" data-archived="${p.archived}" data-fork="${p.fork}">
        <a href="${projectHref(p, root)}" class="project-name">${esc(p.name)}</a>
        <span class="project-meta">${projectMeta(p)}</span>${flags(p) ? ` ${flags(p)}` : ''}
        <p class="project-desc">${text ? esc(text) : '<em>No description on GitHub yet.</em>'}</p>
      </li>`;
}

function areaLinks(model, root) {
  const items = model.areas
    .filter((a) => a.projects.length)
    .map((a) => `        <li><a href="${areaHref(a, root)}">${esc(a.name)}</a> (${a.projects.length})</li>`)
    .join('\n');
  return `      <ul>\n${items}\n      </ul>`;
}

module.exports = { esc, day, plural, listText, nav, projectHref, areaHref, blurb, flags, projectMeta, projectItem, areaLinks };
