#!/usr/bin/env node
'use strict';
// One-shot setup for a repository that adopts the KOS task board:
// creates/updates the kos:* labels and files the seed tasks that do not exist yet.
//
//   GITHUB_TOKEN=... node .github/kos/bootstrap.js [--repo owner/name] [--state ready|triage] [--dry-run] [--labels-only]
//
// Idempotent: labels are upserted; a seed task is skipped when an issue with the
// same title already exists (open or closed).

const fs = require('node:fs');
const path = require('node:path');
const lib = require('./lib');

const config = lib.CONFIG;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const REPO = opt('--repo', process.env.GITHUB_REPOSITORY || 'Kentucky-Open-Science/kentucky-open-science.github.io');
const STATE = opt('--state', 'ready');
const DRY = flag('--dry-run');
const TOKEN = process.env.GITHUB_TOKEN;
const API = `https://api.github.com/repos/${REPO}`;

async function gh(method, url, body) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'kos-task-board', Authorization: `Bearer ${TOKEN}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function paginate(url) {
  const out = [];
  let next = url;
  while (next) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'kos-task-board', Authorization: `Bearer ${TOKEN}` };
    const res = await fetch(next, { headers });
    if (!res.ok) throw new Error(`GET ${next} -> HTTP ${res.status}`);
    out.push(...(await res.json()));
    const m = (res.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/);
    next = m ? m[1] : null;
  }
  return out;
}

/** Render a seed task as the markdown the issue form would have produced. */
function renderBody(t) {
  const sizeText = { S: 'S — one agent session, a few files (10 points)', M: 'M — a few sessions, several files (25 points)', L: 'L — multi-session, cross-cutting (60 points)' }[t.size];
  return [
    '### Problem statement',
    '',
    t.problem,
    '',
    '### Deliverable',
    '',
    t.deliverable || 'Pull request to this repository',
    '',
    '### Repository snapshot',
    '',
    t.snapshot || 'main',
    '',
    '### Scope',
    '',
    t.scope,
    '',
    '### FAIL_TO_PASS',
    '',
    t.failToPass.join('\n'),
    '',
    '### PASS_TO_PASS',
    '',
    (t.passToPass && t.passToPass.join('\n')) || '*',
    '',
    '### How to run the tests',
    '',
    '```',
    'npm ci',
    'npx playwright install --with-deps chromium',
    'npm test',
    '```',
    '',
    '### Human acceptance checklist',
    '',
    t.humanChecklist.map((s) => `- ${s}`).join('\n'),
    '',
    '### Hints and pointers',
    '',
    t.hints || '_No response_',
    '',
    '### Size',
    '',
    sizeText,
    '',
    '### Submitting organization / contact (optional)',
    '',
    t.submitter || 'Kentucky Open Science (this repository’s maintainers)',
    '',
    '### Submitter attestations',
    '',
    '- [x] The acceptance criteria above are machine-checkable, or the human checklist names a reviewer who will check them.',
    '- [x] This task contains no secrets, credentials, or private personal data, and the solver will not need any to complete it.',
    '- [x] I understand the solver may use AI coding agents and that all work is reviewed by a human before merge.',
    '',
  ].join('\n');
}

async function upsertLabels() {
  for (const [name, def] of Object.entries(config.labels.definitions)) {
    const existing = await gh('GET', `${API}/labels/${encodeURIComponent(name)}`);
    if (DRY) {
      console.log(`${existing ? 'update' : 'create'} label ${name}`);
      continue;
    }
    if (existing) await gh('PATCH', `${API}/labels/${encodeURIComponent(name)}`, { new_name: name, color: def.color, description: def.description });
    else await gh('POST', `${API}/labels`, { name, color: def.color, description: def.description });
    console.log(`label ${name} ${existing ? 'updated' : 'created'}`);
  }
}

async function seedTasks() {
  const seeds = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-tasks.json'), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', config.tests.baselineFile), 'utf8'));
  const existing = await paginate(`${API}/issues?state=all&labels=${encodeURIComponent(config.labels.task)}&per_page=100`);
  const titles = new Set(existing.filter((i) => !i.pull_request).map((i) => i.title));
  const stateLabel = STATE === 'triage' ? config.labels.triage : config.labels.ready;
  for (const t of seeds) {
    if (titles.has(t.title)) {
      console.log(`skip (exists): ${t.title}`);
      continue;
    }
    // A task must name tests that fail today; anything not in the baseline already passes.
    const passing = t.failToPass.filter((id) => !baseline.includes(id));
    if (passing.length) {
      console.log(`skip (FAIL_TO_PASS not in ${config.tests.baselineFile}: ${passing.join(', ')}): ${t.title}`);
      continue;
    }
    const labels = [config.labels.task, stateLabel, config.labels.sizes[t.size]];
    if (DRY) {
      console.log(`create issue: ${t.title}  [${labels.join(', ')}]  FAIL_TO_PASS=${t.failToPass.join(',')}`);
      continue;
    }
    const issue = await gh('POST', `${API}/issues`, { title: t.title, body: renderBody(t), labels });
    console.log(`created #${issue.number}: ${t.title}`);
    await new Promise((r) => setTimeout(r, 1500)); // be gentle with secondary rate limits
  }
}

async function main() {
  if (!TOKEN && !DRY) {
    console.error('GITHUB_TOKEN is required (a classic token with repo scope, or a fine-grained token with Issues: write).');
    process.exit(2);
  }
  console.log(`repository: ${REPO}${DRY ? ' (dry run)' : ''}`);
  await upsertLabels();
  if (!flag('--labels-only')) await seedTasks();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

module.exports = { renderBody };
