'use strict';
// projects.html: the full catalog, grouped by research area, with the search
// form that src/search.js enhances. Without JavaScript the whole catalog is
// still there; search needs JavaScript.

const { esc, plural, projectItem, areaLinks } = require('./common');

function renderProjects(model) {
  const { stats } = model;
  const groups = model.areas
    .filter((a) => a.projects.length)
    .map(
      (a) => `    <section class="area" data-area="${esc(a.id)}">
    <h2 id="area-${esc(a.id)}">${esc(a.name)} <span class="count">(${a.projects.length})</span></h2>
    <p class="area-blurb">${esc(a.blurb)}</p>
    <ul class="project-list">
${a.projects.map((p) => projectItem(p, '')).join('\n')}
    </ul>
    </section>`,
    )
    .join('\n\n');

  const jump = model.areas
    .filter((a) => a.projects.length)
    .map((a) => `<a href="#area-${esc(a.id)}">${esc(a.name)}</a>`)
    .join(' &middot;\n      ');

  const langs = stats.languageCounts
    .slice(0, 6)
    .map(([l, n]) => `        <li>${esc(l)}: ${n}</li>`)
    .join('\n');

  return `<div class="layout">

  <aside class="sidebar">
    <div class="panel">
      <h3>Browse by area</h3>
${areaLinks(model, '')}
    </div>

    <div class="panel">
      <h3>By language</h3>
      <ul>
${langs}
      </ul>
    </div>
  </aside>

  <main class="main" id="main">
    <h1>Project directory</h1>
    <p class="lede">
      All ${plural(stats.total, 'public repository', 'public repositories')} in the
      Kentucky Open Science GitHub organization, grouped by research area.
      Search looks at names, descriptions, topics, languages, and README text.
    </p>

    <form class="search-form search-hero" id="project-search" role="search" action="projects.html" method="get">
      <label for="q">Search projects</label>
      <input type="search" id="q" name="q" placeholder="try: chest CT, REDCap, drone" autocomplete="off">
      <button type="submit">Search</button>
      <input type="hidden" name="filters" value="1">
      <fieldset class="search-filters">
        <legend>Include</legend>
        <label><input type="checkbox" name="archived" value="1" checked> archived projects (${stats.archivedAll})</label>
        <label><input type="checkbox" name="forks" value="1" checked> forks of other projects (${stats.forks})</label>
      </fieldset>
    </form>

    <p id="search-status" class="search-status" role="status"></p>
    <ol id="search-results" class="project-list search-results" hidden></ol>

    <div id="catalog">
    <p class="jump">Jump to:
      ${jump}
    </p>

${groups}
    </div>
  </main>
</div>`;
}

module.exports = { renderProjects };
