'use strict';
// Generated fragments for src/pages/index.html (the page itself is hand-written).

const { esc, day, projectHref, areaHref, blurb } = require('./common');

const THUMBS = { ai: '🧠', imaging: '🩻', neuro: '⚡', robotics: '🤖', vision: '📷', informatics: '📋', other: '📦', forks: '🍴' };

function card(p, model) {
  const recent = model.isRecent(p);
  const area = model.areaOf(p);
  return `      <div class="product-card">
${recent ? '        <span class="badge-new">UPDATED!</span>\n' : ''}        <div class="thumb">${THUMBS[area.id] || '📦'}</div>
        <div class="name">${esc(p.name)}</div>
        <div class="meta">${esc(p.language || 'No language')} &middot; ${esc(area.name)}</div>
        <div class="price">Updated ${esc(day(p.pushedAt))}</div>
        <div class="desc">${esc(blurb(p, 140) || 'No description on GitHub yet.')}</div>
        <a href="${projectHref(p, '')}" class="buy">More Info</a>
      </div>`;
}

function homeFragments(model) {
  const { site, projects } = model;
  const recent = projects
    .filter((p) => !p.archived && !p.fork)
    .sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : -1))
    .slice(0, 8);

  const areas = model.areas
    .filter((a) => a.projects.length)
    .map(
      (a) =>
        `      <li><a href="${areaHref(a, '')}"><strong>${esc(a.name)}</strong></a> &mdash; ${esc(a.blurb)} <span class="project-meta">${a.projects.length} project${a.projects.length === 1 ? '' : 's'}</span></li>`,
    )
    .join('\n');

  const topicCounts = {};
  for (const p of projects) for (const t of p.topics) if (t !== 'kentucky-open-science') topicCounts[t] = (topicCounts[t] || 0) + 1;
  const topics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([t, n]) => `      <li><a href="projects.html?q=${encodeURIComponent(t)}">${esc(t)}</a> (${n})</li>`)
    .join('\n');

  return {
    counter: String(projects.length).padStart(7, '0'),
    mission: site.mission ? `    <p>${esc(site.mission)}</p>\n` : '',
    areas: `    <ul class="area-list">\n${areas}\n    </ul>`,
    recent: recent.map((p) => card(p, model)).join('\n\n'),
    topics: `    <ul class="topic-cloud">\n${topics}\n    </ul>`,
  };
}

module.exports = { homeFragments };
