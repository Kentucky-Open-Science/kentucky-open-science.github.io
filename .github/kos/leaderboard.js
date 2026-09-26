#!/usr/bin/env node
'use strict';
// Collect the task board's state from this repository's issues into
// data/board.json: open tasks (for bounties.html) and points (for
// leaderboard.html). tools/build.js renders both pages from that file.
//
//   GITHUB_TOKEN=... node .github/kos/leaderboard.js [--out data/board.json]
//
// Points come from the `kos:accepted` marker written into each task when its PR
// merged (so history is frozen even if config.json changes later). Reviewers who
// approved the PR get config.points.reviewerShare of the task's points.

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

/** Pure: turn issue lists into the board data. Exported for tests. */
function summarize({ accepted, open, repo = REPO, now = new Date() }) {
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
      prUrl: `https://github.com/${repo}/pull/${m.pr}`,
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
  const tasks = [];
  for (const issue of open) {
    const state = lib.stateOf(issue.labels, config);
    if (!state || !(state in status)) continue;
    status[state]++;
    const lease = lib.readMarker(issue.body, 'lease');
    const size = lib.sizeOf(issue.labels, config);
    tasks.push({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      state,
      size,
      points: lib.pointsFor(size, config),
      holder: lease ? lease.holder : (issue.assignees && issue.assignees[0] && issue.assignees[0].login) || null,
      expires: lease && state === 'leased' ? lease.expires : null,
      pr: lease && lease.pr ? lease.pr : null,
    });
  }
  tasks.sort((a, b) => a.number - b.number);

  return { generated: new Date(now).toISOString(), repo, status, accepted: completions.length, tasks, leaderboard, completions };
}

async function collect() {
  const L = config.labels;
  const base = `https://api.github.com/repos/${REPO}/issues`;
  const accepted = (await ghPaginate(`${base}?state=closed&labels=${encodeURIComponent(L.accepted)}&per_page=100`)).filter((i) => !i.pull_request);
  const open = (await ghPaginate(`${base}?state=open&labels=${encodeURIComponent(L.task)}&per_page=100`)).filter((i) => !i.pull_request);
  return summarize({ accepted, open });
}

async function main(argv) {
  const i = argv.indexOf('--out');
  const dataPath = path.join(ROOT, i >= 0 ? argv[i + 1] : config.board.dataFile);
  const data = await collect();
  // Keep the previous timestamp when nothing else changed, so scheduled runs
  // do not produce an empty "update" commit.
  try {
    const previous = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const strip = (d) => JSON.stringify({ ...d, generated: null });
    if (strip(previous) === strip(data)) data.generated = previous.generated;
  } catch {
    /* first run */
  }
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`board: ${data.tasks.length} open task(s), ${data.completions.length} completion(s), ${data.leaderboard.length} contributor(s) -> ${path.relative(ROOT, dataPath)}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { collect, summarize };
