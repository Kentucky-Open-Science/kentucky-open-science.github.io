#!/usr/bin/env node
'use strict';
// Build the task-board leaderboard: data/leaderboard.json + leaderboard.html.
//
//   node .github/kos/leaderboard.js            # query GitHub (needs GITHUB_TOKEN for rate limits)
//   node .github/kos/leaderboard.js --offline  # re-render the page from the existing data file
//
// Points come from the `kos:accepted` marker written into each task when its PR
// merged (so history is frozen even if config.json changes later). Reviewers who
// approved the PR get config.points.reviewerShare of the task's points.
//
// The page reuses the live site's <header>, <nav> and <footer> from index.html so
// it always matches the rest of the site; only <main> is generated here.

const fs = require('node:fs');
const path = require('node:path');
const lib = require('./lib');

const ROOT = path.resolve(__dirname, '..', '..');
const config = lib.CONFIG;
const REPO = process.env.GITHUB_REPOSITORY || 'Kentucky-Open-Science/kentucky-open-science.github.io';

async function ghPaginate(url) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'kos-task-board' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const out = [];
  let next = url;
  while (next) {
    const res = await fetch(next, { headers });
    if (!res.ok) throw new Error(`GET ${next} -> HTTP ${res.status}`);
    out.push(...(await res.json()));
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    next = m ? m[1] : null;
  }
  return out;
}

async function collect() {
  const L = config.labels;
  const base = `https://api.github.com/repos/${REPO}/issues`;
  const accepted = (await ghPaginate(`${base}?state=closed&labels=${encodeURIComponent(L.accepted)}&per_page=100`)).filter((i) => !i.pull_request);
  const open = (await ghPaginate(`${base}?state=open&labels=${encodeURIComponent(L.task)}&per_page=100`)).filter((i) => !i.pull_request);

  const completions = [];
  for (const issue of accepted) {
    const m = lib.readMarker(issue.body, 'accepted');
    if (!m) continue;
    completions.push({
      task: issue.number,
      title: issue.title,
      url: issue.html_url,
      solver: m.solver,
      size: m.size,
      points: m.points,
      reviewers: m.reviewers || [],
      reviewerPoints: m.reviewerPoints || 0,
      pr: m.pr,
      prUrl: `https://github.com/${REPO}/pull/${m.pr}`,
      mergedAt: m.mergedAt,
    });
  }
  completions.sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : -1));

  const people = {};
  const person = (login) => (people[login] ||= { login, points: 0, tasks: 0, reviews: 0, last: null });
  for (const c of completions) {
    const s = person(c.solver);
    s.points += c.points;
    s.tasks += 1;
    if (!s.last || c.mergedAt > s.last) s.last = c.mergedAt;
    for (const r of c.reviewers) {
      const p = person(r);
      p.points += c.reviewerPoints;
      p.reviews += 1;
      if (!p.last || c.mergedAt > p.last) p.last = c.mergedAt;
    }
  }
  const leaderboard = Object.values(people).sort((a, b) => b.points - a.points || b.tasks - a.tasks || a.login.localeCompare(b.login));
  leaderboard.forEach((p, i) => (p.rank = i + 1));

  const status = { ready: 0, leased: 0, submitted: 0, triage: 0 };
  for (const issue of open) {
    const s = lib.stateOf(issue.labels, config);
    if (s && s in status) status[s]++;
  }

  return { generated: new Date().toISOString(), repo: REPO, status, accepted: completions.length, leaderboard, completions };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pick(html, tag) {
  const m = html.match(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'i'));
  return m ? m[0] : '';
}

function date(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}

function render(data) {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const header = pick(index, 'header');
  const nav = pick(index, 'nav')
    .replace(/\s*class="current"/g, '')
    .replace(/href="leaderboard\.html"/, 'href="leaderboard.html" class="current"');
  const footer = pick(index, 'footer');
  const skip = (index.match(/<a[^>]+class="[^"]*skip[^"]*"[^>]*>[\s\S]*?<\/a>/i) || [''])[0];
  const docsUrl = `https://github.com/${esc(data.repo)}/blob/main/docs/KOS-TASK-BOARD.md`;
  const boardUrl = `https://github.com/${esc(data.repo)}/issues?q=is%3Aissue+is%3Aopen+label%3A${encodeURIComponent(config.labels.ready)}`;

  const rows = data.leaderboard.length
    ? data.leaderboard
        .map(
          (p) => `        <tr>
          <td>${p.rank}</td>
          <td><a href="https://github.com/${esc(p.login)}">@${esc(p.login)}</a></td>
          <td>${p.points}</td>
          <td>${p.tasks}</td>
          <td>${p.reviews}</td>
          <td>${esc(date(p.last))}</td>
        </tr>`,
        )
        .join('\n')
    : `        <tr><td colspan="6">No completed tasks yet. Be the first: claim one from the <a href="${boardUrl}">open tasks</a>.</td></tr>`;

  const recent = data.completions
    .slice(0, 25)
    .map(
      (c) => `        <tr>
          <td><a href="${esc(c.url)}">#${c.task}</a> ${esc(c.title)}</td>
          <td><a href="https://github.com/${esc(c.solver)}">@${esc(c.solver)}</a></td>
          <td>${esc(c.size || '–')}</td>
          <td>${c.points}</td>
          <td>${esc(date(c.mergedAt))}</td>
          <td><a href="${esc(c.prUrl)}">PR #${c.pr}</a></td>
        </tr>`,
    )
    .join('\n');

  const recentTable = data.completions.length
    ? `
    <h2 id="recent">Recent completions</h2>
    <section class="table-scroll" tabindex="0" aria-labelledby="recent">
    <table class="specs">
      <caption>Most recent accepted tasks</caption>
      <thead>
        <tr><th scope="col">Task</th><th scope="col">Solver</th><th scope="col">Size</th><th scope="col">Points</th><th scope="col">Merged</th><th scope="col">Pull request</th></tr>
      </thead>
      <tbody>
${recent}
      </tbody>
    </table>
    </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Task Board Leaderboard &mdash; ${esc(config.leaderboard.siteTitle)}</title>
<meta name="description" content="Points and standings for volunteers who complete Kentucky Open Science task-board tasks with their spare AI-agent hours.">
<link rel="stylesheet" href="styles.css">
</head>
<body>
${skip ? skip + '\n' : ''}
${header}

${nav}

<div class="layout">

  <aside class="sidebar">
    <div class="panel">
      <h3>Board status</h3>
      <ul>
        <li><a href="${boardUrl}">${data.status.ready} task${data.status.ready === 1 ? '' : 's'} open to claim</a></li>
        <li>${data.status.leased} leased</li>
        <li>${data.status.submitted} in review</li>
        <li>${data.accepted} accepted</li>
      </ul>
    </div>
    <div class="panel">
      <h3>How points work</h3>
      <ul>
        <li>Size S = ${config.points.bySize.S}, M = ${config.points.bySize.M}, L = ${config.points.bySize.L}</li>
        <li>Approving reviewers earn ${Math.round(config.points.reviewerShare * 100)}%</li>
        <li>One lease per person; expired leases earn nothing</li>
      </ul>
    </div>
    <div class="panel">
      <h3>Get involved</h3>
      <ul>
        <li><a href="${docsUrl}">How the board works</a></li>
        <li><a href="${boardUrl}">Open tasks</a></li>
      </ul>
    </div>
  </aside>

  <main class="main" id="main">
    <h1>Task Board Leaderboard</h1>
    <p class="lede">
      Kentuckians donate the AI-agent hours they would otherwise lose at the end
      of the week to fix real public websites and research software. Every
      accepted task earns points; this page is the running tally.
    </p>

    <h2 id="standings">Standings</h2>
    <section class="table-scroll" tabindex="0" aria-labelledby="standings">
    <table class="specs">
      <caption>Contributors ranked by points</caption>
      <thead>
        <tr><th scope="col">Rank</th><th scope="col">Contributor</th><th scope="col">Points</th><th scope="col">Tasks</th><th scope="col">Reviews</th><th scope="col">Last credited</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
    </section>
${recentTable}

    <p class="lede">Updated ${esc(data.generated.replace('T', ' ').slice(0, 16))} UTC. Generated automatically from accepted tasks; see <a href="${docsUrl}">the task-board guide</a> for the rules.</p>
  </main>
</div>

${footer}

</body>
</html>
`;
}

async function main(argv) {
  const offline = argv.includes('--offline');
  const dataPath = path.join(ROOT, config.leaderboard.dataFile);
  const pagePath = path.join(ROOT, config.leaderboard.pageFile);
  let data;
  if (offline) {
    data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } else {
    data = await collect();
    // Keep the previous timestamp when nothing else changed, so nightly runs
    // do not produce an empty "update" commit.
    let previous = null;
    try {
      previous = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch {
      /* first run */
    }
    if (previous) {
      const strip = (d) => JSON.stringify({ ...d, generated: null });
      if (strip(previous) === strip(data)) data.generated = previous.generated;
    }
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
  }
  fs.writeFileSync(pagePath, render(data));
  console.log(`leaderboard: ${data.leaderboard.length} contributor(s), ${data.completions.length} completion(s) -> ${config.leaderboard.pageFile}${offline ? ' (offline)' : ''}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { collect, render };
