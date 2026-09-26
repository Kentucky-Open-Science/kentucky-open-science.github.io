#!/usr/bin/env node
'use strict';
// Build the site into _site/ from src/ (templates, styles, scripts) and data/
// (project and board snapshots). No network access, no dependencies.
//
//   node tools/build.js [--out _site] [--data data] [--quiet]
//
// The test suite builds from frozen fixtures instead of the live snapshots:
//   node tools/build.js --data tests/fixtures --out _site-test
//
// Sources:
//   src/layout.html          page shell: <head>, banner, nav, footer
//   src/partials/*.html      shared blocks ({{> name}})
//   src/pages/*.html         hand-written pages (front matter + body)
//   src/templates/*.js       data-driven pages: projects, project, bounties, leaderboard
//   src/styles.css, src/search.js, src/claim.js
//   src/claim-prompt.txt     the prompt the bounty board hands to volunteers' agents
//   src/site.json            nav, research areas, site settings
//   data/projects.json       public repositories (tools/fetch-projects.js)
//   data/board.json          task board + leaderboard (.github/kos/leaderboard.js)

const fs = require('node:fs');
const path = require('node:path');
const { render, frontMatter } = require('./template');
const { nav, day, listText, areaLinks } = require('../src/templates/common');
const { homeFragments } = require('../src/templates/home');
const { renderProjects } = require('../src/templates/projects');
const { renderProject } = require('../src/templates/project');
const { renderBounties } = require('../src/templates/bounties');
const { renderLeaderboard } = require('../src/templates/leaderboard');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = path.resolve(ROOT, outArg >= 0 ? args[outArg + 1] : '_site');
const dataArg = args.indexOf('--data');
const DATA = path.resolve(ROOT, dataArg >= 0 ? args[dataArg + 1] : 'data');
const QUIET = args.includes('--quiet');

const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (fallback !== undefined && e.code === 'ENOENT') return fallback;
    throw e;
  }
};

const EMPTY_BOARD = {
  generated: '1970-01-01T00:00:00.000Z',
  status: { ready: 0, leased: 0, submitted: 0, triage: 0 },
  accepted: 0,
  tasks: [],
  leaderboard: [],
  completions: [],
};

function buildModel() {
  const site = readJson(path.join(SRC, 'site.json'));
  const data = readJson(path.join(DATA, 'projects.json'));
  const board = { ...EMPTY_BOARD, ...readJson(path.join(DATA, 'board.json'), EMPTY_BOARD) };
  const config = readJson(path.join(ROOT, '.github', 'kos', 'config.json'));

  // Only repositories of this organization (fetch-projects.js already keeps only public ones).
  const projects = data.projects.filter((p) => p && p.name && p.url && p.url.startsWith(`https://github.com/${site.org}/`));

  const areas = site.categories.map((c) => ({ ...c, projects: [] }));
  const forks = { ...site.forksCategory, topics: [], projects: [] };
  const byId = Object.fromEntries([...areas, forks].map((a) => [a.id, a]));
  const areaIdOf = new Map();
  for (const p of projects) {
    let id = 'other';
    if (p.fork) id = forks.id;
    else {
      const listed = areas.find((a) => (a.projects || []).includes(p.name));
      const tagged = areas.find((a) => (a.topics || []).some((t) => p.topics.includes(t)));
      id = (listed || tagged || byId.other).id;
    }
    areaIdOf.set(p, id);
  }
  const allAreas = [...areas, forks];
  for (const a of allAreas) a.projects = projects.filter((p) => areaIdOf.get(p) === a.id);
  // Active projects first, then archived; most recently pushed first within each.
  for (const a of allAreas) a.projects.sort((x, y) => Number(x.archived) - Number(y.archived) || (x.pushedAt < y.pushedAt ? 1 : -1));

  const originals = projects.filter((p) => !p.fork);
  const languageCounts = Object.entries(
    originals.reduce((acc, p) => {
      if (p.language) acc[p.language] = (acc[p.language] || 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const generatedMs = new Date(data.generated).getTime();
  const model = {
    site,
    config,
    board,
    data,
    projects,
    areas: allAreas,
    areaOf: (p) => byId[areaIdOf.get(p)],
    isRecent: (p) => generatedMs - new Date(p.pushedAt).getTime() <= site.recentDays * 86400000,
    claimPrompt: fs.readFileSync(path.join(SRC, 'claim-prompt.txt'), 'utf8').replace(/\r\n/g, '\n').trim() + '\n',
    partial: (name, root) => render(fs.readFileSync(path.join(SRC, 'partials', `${name}.html`), 'utf8'), { root, site }, path.join(SRC, 'partials')),
    stats: {
      total: projects.length,
      originals: originals.length,
      active: originals.filter((p) => !p.archived).length,
      archived: originals.filter((p) => p.archived).length,
      archivedAll: projects.filter((p) => p.archived).length,
      forks: projects.length - originals.length,
      languageCounts,
      topLanguages: listText(languageCounts.slice(0, 3).map(([l]) => l)),
      pages: 0,
    },
  };
  return model;
}

function searchIndex(model) {
  return {
    generated: model.data.generated,
    projects: model.projects.map((p) => ({
      name: p.name,
      href: `projects/${encodeURIComponent(p.name)}.html`,
      description: p.description,
      summary: p.readme && p.readme.summary[0] ? p.readme.summary[0].slice(0, 240) : '',
      topics: p.topics.filter((t) => t !== 'kentucky-open-science'),
      language: p.language || '',
      area: model.areaOf(p).name,
      archived: p.archived,
      fork: p.fork,
      stars: p.stars,
      pushed: day(p.pushedAt),
      text: p.readme ? p.readme.text.slice(0, 4000) : '',
    })),
  };
}

function build() {
  const model = buildModel();
  const layout = fs.readFileSync(path.join(SRC, 'layout.html'), 'utf8');
  const partials = path.join(SRC, 'partials');
  const updated = day(model.data.generated);
  const pages = []; // [relative path, html]

  function page(rel, { title, description, current, body, scripts = '' }) {
    const root = '../'.repeat(rel.split('/').length - 1);
    const ctx = { site: model.site, title, description, root, updated, nav: nav(model.site, current, root), body, scripts };
    pages.push([rel, render(layout, ctx, partials)]);
  }

  // Hand-written pages
  const srcPages = fs.readdirSync(path.join(SRC, 'pages')).filter((f) => f.endsWith('.html')).sort();
  model.stats.pages = srcPages.length + model.projects.length + 3; // + projects, bounties, leaderboard
  const home = homeFragments(model);
  for (const file of srcPages) {
    const { meta, body } = frontMatter(fs.readFileSync(path.join(SRC, 'pages', file), 'utf8'));
    const root = '../'.repeat(file.split('/').length - 1);
    const ctx = {
      site: model.site,
      root,
      updated,
      stats: model.stats,
      board: { ...model.board.status, accepted: model.board.accepted },
      home,
      areaLinks: areaLinks(model, root),
    };
    page(file, { title: meta.title || file, description: meta.description || '', current: meta.nav, body: render(body, ctx, partials) });
  }

  // Data-driven pages
  page('projects.html', {
    title: 'Project directory',
    description: `Search and browse all ${model.stats.total} public Kentucky Open Science repositories on GitHub by research area, topic, and language.`,
    current: 'projects',
    body: renderProjects(model),
    scripts: '<script src="search.js"></script>\n',
  });
  for (const p of model.projects) {
    const r = renderProject(p, model);
    page(`projects/${p.name}.html`, { ...r, current: 'projects' });
  }
  page('bounties.html', {
    title: 'Accessibility Bounty Board',
    description: 'Claim a small, tested accessibility fix for the Kentucky Open Science website, complete it with or without a coding agent, and earn points on the leaderboard.',
    current: 'bounties',
    body: renderBounties(model),
    scripts: '<script src="claim.js"></script>\n',
  });
  page('leaderboard.html', {
    title: 'Task Board Leaderboard',
    description: 'Points and standings for volunteers who complete Kentucky Open Science task-board tasks with their spare AI-agent hours.',
    current: 'leaderboard',
    body: renderLeaderboard(model),
  });

  // Write everything to a fresh output directory.
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const [rel, html] of pages) {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
  }
  for (const file of ['styles.css', 'search.js', 'claim.js']) fs.copyFileSync(path.join(SRC, file), path.join(OUT, file));
  fs.writeFileSync(path.join(OUT, 'search-index.json'), JSON.stringify(searchIndex(model)));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  if (!QUIET) console.log(`built ${pages.length} pages (${model.projects.length} projects) -> ${path.relative(ROOT, OUT) || '.'}`);
  return { pages: pages.map(([rel]) => rel), model };
}

if (require.main === module) {
  try {
    build();
  } catch (e) {
    console.error(e.stack || e.message || e);
    process.exit(1);
  }
}

module.exports = { build, buildModel };
