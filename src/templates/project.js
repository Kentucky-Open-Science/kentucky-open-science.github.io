'use strict';
// projects/<name>.html: one wiki page per public repository.

const { esc, day, plural, listText, projectItem, areaHref } = require('./common');

function related(p, model) {
  const mine = new Set(p.topics.filter((t) => t !== 'kentucky-open-science'));
  const area = model.areaOf(p);
  return model.projects
    .filter((q) => q !== p)
    .map((q) => {
      const shared = q.topics.filter((t) => mine.has(t)).length;
      const sameArea = model.areaOf(q) === area && area.id !== 'other' && area.id !== 'forks';
      return { q, score: shared * 3 + (sameArea ? 1 : 0) + (q.archived ? -0.5 : 0) };
    })
    .filter((x) => x.score > 0.5)
    .sort((a, b) => b.score - a.score || (a.q.pushedAt < b.q.pushedAt ? 1 : -1))
    .slice(0, 6)
    .map((x) => x.q);
}

function renderProject(p, model) {
  const root = '../';
  const area = model.areaOf(p);
  const topics = p.topics.filter((t) => t !== 'kentucky-open-science');

  const links = [`        <li><a href="${esc(p.url)}">Repository on GitHub</a></li>`];
  if (p.hasIssues) links.push(`        <li><a href="${esc(p.url)}/issues">Issues</a></li>`);
  if (p.homepage && /^https?:\/\//.test(p.homepage)) links.push(`        <li><a href="${esc(p.homepage)}">Project homepage</a></li>`);
  if (p.readme) links.push(`        <li><a href="${esc(p.readme.url)}">Full README</a></li>`);
  if (p.parent) links.push(`        <li><a href="${esc(p.parent.url)}">Upstream: ${esc(p.parent.fullName)}</a></li>`);

  const topicPanel = topics.length
    ? `
    <div class="panel">
      <h3>Topics</h3>
      <ul>
${topics.map((t) => `        <li><a href="${root}projects.html?q=${encodeURIComponent(t)}">${esc(t)}</a></li>`).join('\n')}
      </ul>
    </div>
`
    : '';

  const status = [];
  if (p.archived) status.push('<span class="flag flag-archived">Archived</span> This repository is archived: read-only and no longer maintained.');
  if (p.fork) status.push(`<span class="flag flag-fork">Fork</span> A fork of ${p.parent ? `<a href="${esc(p.parent.url)}">${esc(p.parent.fullName)}</a>` : 'another project'}; the README may describe the upstream project.`);
  if (p.isTemplate) status.push('<span class="flag flag-template">Template</span> A template repository for starting new projects.');

  const overview = p.readme && p.readme.summary.length
    ? `${p.readme.summary.map((s) => `    <p>${esc(s)}</p>`).join('\n')}
    <p class="source-note">From the project&rsquo;s <a href="${esc(p.readme.url)}">README on GitHub</a>.</p>`
    : `    <p>${p.readme ? 'The README has no introductory text yet.' : 'This repository has no README yet.'}
    Details below come from the repository&rsquo;s GitHub metadata.</p>`;

  const facts = [
    ['Repository', `<a href="${esc(p.url)}">${esc(p.fullName)}</a>`],
    ['Research area', `<a href="${areaHref(area, root)}">${esc(area.name)}</a>`],
    ['Primary language', esc(p.language || 'None detected')],
  ];
  if (p.languages.length > 1) facts.push(['Languages', esc(p.languages.slice(0, 6).map((l) => `${l.name} ${l.percent}%`).join(', '))]);
  facts.push(['License', p.license ? esc(p.license.spdx || p.license.name) : 'None specified']);
  facts.push(['Stars / forks', `${p.stars} / ${p.forks}`]);
  facts.push(['Open issues and pull requests', String(p.openIssues)]);
  facts.push(['Created', esc(day(p.createdAt))]);
  facts.push(['Last push', esc(day(p.pushedAt))]);
  facts.push(['Default branch', `<code>${esc(p.defaultBranch)}</code>`]);
  if (p.homepage) facts.push(['Homepage', /^https?:\/\//.test(p.homepage) ? `<a href="${esc(p.homepage)}">${esc(p.homepage)}</a>` : esc(p.homepage)]);
  if (topics.length) facts.push(['Topics', esc(topics.join(', '))]);
  if (p.parent) facts.push(['Forked from', `<a href="${esc(p.parent.url)}">${esc(p.parent.fullName)}</a>${p.parent.description ? ` &mdash; ${esc(p.parent.description)}` : ''}`]);

  const sections = [];
  if (p.release) {
    sections.push(`    <h2 id="release">Latest release</h2>
    <p><a href="${esc(p.release.url)}">${esc(p.release.name)}</a>${p.release.name !== p.release.tag ? ` (<code>${esc(p.release.tag)}</code>)` : ''}, published ${esc(day(p.release.publishedAt))}.</p>`);
  }
  if (p.readme && p.readme.headings.length) {
    sections.push(`    <h2 id="readme-sections">What the README covers</h2>
    <ul class="toc">
${p.readme.headings.map((h) => `      <li class="toc-${h.level}"><a href="${esc(p.url)}#${esc(h.anchor)}">${esc(h.text)}</a></li>`).join('\n')}
    </ul>`);
  }
  if (p.contributors.length) {
    sections.push(`    <h2 id="contributors">Top contributors</h2>
    <ul class="contributors">
${p.contributors.map((c) => `      <li><a href="${esc(c.url)}">@${esc(c.login)}</a> (${plural(c.contributions, 'commit')})</li>`).join('\n')}
    </ul>`);
  }
  const rel = related(p, model);
  if (rel.length) {
    sections.push(`    <h2 id="related">Related projects</h2>
    <ul class="project-list">
${rel.map((q) => projectItem(q, root)).join('\n')}
    </ul>`);
  }

  const description = p.description || (p.readme && p.readme.summary[0]) || '';
  // The lede is the GitHub description; without one, the Overview (README) speaks for itself.
  const lede = p.description
    ? `    <p class="lede">${esc(p.description)}</p>`
    : p.readme && p.readme.summary.length ? '' : '    <p class="lede">No description on GitHub yet.</p>';

  const langs = p.languages.slice(0, 3).map((l) => l.name);
  const metaDescription = `${p.name}: ${description || `a ${p.fork ? 'forked' : 'public'} Kentucky Open Science repository${langs.length ? ` written in ${listText(langs)}` : ''}`}`;

  return {
    title: `${p.name} (project)`,
    description: metaDescription.length > 300 ? metaDescription.slice(0, 297).replace(/\s+\S*$/, '') + '…' : metaDescription,
    body: `<div class="layout">

  <aside class="sidebar">
${model.partial('sidebar-search', root)}
    <div class="panel">
      <h3>Project links</h3>
      <ul>
${links.join('\n')}
      </ul>
    </div>
${topicPanel}  </aside>

  <main class="main">
    <p class="breadcrumb"><a href="${root}projects.html">Projects</a> &raquo; <a href="${areaHref(area, root)}">${esc(area.name)}</a> &raquo; ${esc(p.name)}</p>
    <h1>${esc(p.name)}</h1>
${lede}
${status.map((s) => `    <p class="status-note">${s}</p>`).join('\n')}

    <h2 id="overview">Overview</h2>
${overview}

    <h2 id="facts">At a glance</h2>
    <table class="specs">
      <tbody>
${facts.map(([k, v]) => `      <tr><th>${k}</th><td>${v}</td></tr>`).join('\n')}
      </tbody>
    </table>

${sections.join('\n\n')}

    <h2 id="get">Get the code</h2>
    <pre class="clone"><code>git clone ${esc(p.url)}.git</code></pre>
  </main>
</div>`,
  };
}

module.exports = { renderProject, related };
