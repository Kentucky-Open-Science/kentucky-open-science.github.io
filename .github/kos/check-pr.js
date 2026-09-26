#!/usr/bin/env node
'use strict';
// Acceptance gate for task PRs. Runs in .github/workflows/kos-pr-gate.yml after
// the test suite, with a read-only token (fork-safe). Exits non-zero on failure.
//
// Verifies, for a PR that references a task (KOS-Task: #N or Closes #N):
//   1. the PR author holds the task's lease (assignee + lease marker)
//   2. every FAIL_TO_PASS test ID from the task now passes and is no longer in the baseline
//   3. every PASS_TO_PASS test ID passes ("*" = everything not in FAIL_TO_PASS and not baselined on main)
//   4. tests/known-failures.json did not gain entries (no hiding regressions)
//   5. the PR template's provenance fields are filled and all attestations are checked
// A PR that references no task only needs the suite to be green (checked by the workflow).
//
// Inputs (env): GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_TOKEN (optional),
//               KOS_BASE_REF (git ref of the base branch, e.g. origin/main),
//               GITHUB_STEP_SUMMARY (optional)

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const lib = require('./lib');

const ROOT = path.resolve(__dirname, '..', '..');
const config = lib.CONFIG;

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

async function ghGet(url) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'kos-task-board' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

function baseFile(rel) {
  const ref = process.env.KOS_BASE_REF || 'origin/main';
  try {
    return JSON.parse(execSync(`git show ${ref}:${rel}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

function baseBaseline() {
  return baseFile(config.tests.baselineFile);
}

function basePagesList() {
  return baseFile('tests/pages.json') || [];
}

/**
 * A baseline addition is legitimate only when (a) the ID belongs to a page that
 * does not exist on the base branch and (b) the base baseline already lists the
 * same check for some other page — i.e. the new page merely inherits a
 * site-wide failure. Pure per-page IDs look like `<prefix>/<page>` or
 * `<prefix>/<page>/<rule>`; `content/*` IDs are never inheritable.
 */
function isInheritedNewPageFailure(id, mainBaseline, basePages) {
  const t = lib.splitTestId(id);
  if (!t.page || basePages.includes(t.page)) return false;
  return mainBaseline.some((b) => {
    const m = lib.splitTestId(b);
    return m.page && m.prefix === t.prefix && m.rule === t.rule && m.page !== t.page;
  });
}

async function main() {
  const event = readJson(process.env.GITHUB_EVENT_PATH, {});
  const pr = event.pull_request;
  const lines = [];
  const fail = (msg) => lines.push(`❌ ${msg}`);
  const ok = (msg) => lines.push(`✅ ${msg}`);
  const info = (msg) => lines.push(`ℹ️ ${msg}`);

  if (!pr) {
    console.log('Not a pull_request event; nothing to gate.');
    return 0;
  }

  const taskNumber = lib.parseTaskRef(pr.body);
  const results = readJson(path.join(ROOT, config.tests.resultsFile), null);
  const headBaseline = readJson(path.join(ROOT, config.tests.baselineFile), null);
  const mainBaseline = baseBaseline();

  if (!results) fail(`no test results at ${config.tests.resultsFile} (did the test step run?)`);
  if (!Array.isArray(headBaseline)) fail(`${config.tests.baselineFile} is missing or not a JSON array`);

  // 4. baseline may only shrink — except that a NEW page may inherit a
  //    site-wide failure that main already lists for another page
  //    (e.g. motion/404.html while motion/index.html is still open).
  if (Array.isArray(headBaseline) && Array.isArray(mainBaseline)) {
    const added = headBaseline.filter((id) => !mainBaseline.includes(id));
    const basePages = basePagesList();
    const inherited = added.filter((id) => isInheritedNewPageFailure(id, mainBaseline, basePages));
    const illegal = added.filter((id) => !inherited.includes(id));
    if (illegal.length) fail(`baseline gained ${illegal.length} entr${illegal.length === 1 ? 'y' : 'ies'} (not allowed): ${illegal.join(', ')}`);
    else ok(`baseline did not grow illegitimately (${mainBaseline.length} -> ${headBaseline.length} known failures${inherited.length ? `; ${inherited.length} inherited by a new page: ${inherited.join(', ')}` : ''})`);
  } else if (Array.isArray(headBaseline)) {
    info('could not read the base branch baseline; skipping the no-growth check');
  }

  if (!taskNumber) {
    info('PR references no KOS task (no `KOS-Task: #N` / `Closes #N`); only the test suite applies.');
    return finish(lines, results);
  }

  // Fetch the task (KOS_ISSUE_FILE lets tests supply the issue JSON offline)
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  let issue;
  try {
    issue = process.env.KOS_ISSUE_FILE
      ? readJson(process.env.KOS_ISSUE_FILE, null)
      : await ghGet(`https://api.github.com/repos/${owner}/${repo}/issues/${taskNumber}`);
    if (!issue) throw new Error('empty issue');
  } catch (e) {
    fail(`could not fetch task #${taskNumber}: ${e.message}`);
    return finish(lines, results);
  }
  if (issue.pull_request || !lib.isTask(issue.labels, config)) {
    fail(`#${taskNumber} is not a KOS task (missing \`${config.labels.task}\` label)`);
    return finish(lines, results);
  }
  info(`task #${taskNumber}: ${issue.title}`);

  // 1. lease holder
  const lease = lib.readMarker(issue.body, 'lease');
  const assignees = (issue.assignees || []).map((a) => a.login);
  const author = pr.user && pr.user.login;
  const state = lib.stateOf(issue.labels, config);
  if (state === 'accepted') fail(`task #${taskNumber} is already accepted`);
  else if (!lease || lease.holder !== author || !assignees.includes(author)) {
    fail(`@${author} does not hold the lease on #${taskNumber} (holder: ${lease ? '@' + lease.holder : 'none'}, state: ${state || 'untracked'}). Comment \`/claim\` on the task first.`);
  } else ok(`@${author} holds the lease on #${taskNumber}`);

  // 2 + 3. tests
  const sections = lib.parseSections(issue.body);
  const failToPass = lib.parseTestIds(lib.section(sections, 'FAIL_TO_PASS', 'fail_to_pass (tests that must go from failing to passing)'));
  let passToPass = lib.parseTestIds(lib.section(sections, 'PASS_TO_PASS', 'pass_to_pass (tests that must keep passing)'));
  if (!passToPass.length) passToPass = ['*'];

  if (!failToPass.length) fail('task has no FAIL_TO_PASS test IDs; a maintainer must fix the task before it can be accepted');

  if (results) {
    const T = results.tests || {};
    const unknown = failToPass.filter((id) => !(id in T));
    if (unknown.length) fail(`FAIL_TO_PASS IDs not present in the suite: ${unknown.join(', ')}`);
    const stillFailing = failToPass.filter((id) => id in T && T[id].actual !== 'passed');
    if (stillFailing.length) fail(`FAIL_TO_PASS still failing: ${stillFailing.join(', ')}`);
    const stillBaselined = Array.isArray(headBaseline) ? failToPass.filter((id) => headBaseline.includes(id)) : [];
    if (stillBaselined.length) fail(`FAIL_TO_PASS IDs still listed in ${config.tests.baselineFile} (remove them): ${stillBaselined.join(', ')}`);
    if (!unknown.length && !stillFailing.length && !stillBaselined.length && failToPass.length) ok(`FAIL_TO_PASS (${failToPass.length}) all pass: ${failToPass.join(', ')}`);

    let p2p;
    if (passToPass.includes('*')) {
      const baseline = new Set(Array.isArray(mainBaseline) ? mainBaseline : Array.isArray(headBaseline) ? headBaseline : []);
      p2p = Object.keys(T).filter((id) => !failToPass.includes(id) && !baseline.has(id));
    } else {
      p2p = passToPass;
    }
    const p2pUnknown = p2p.filter((id) => !(id in T));
    const p2pFailing = p2p.filter((id) => id in T && T[id].actual !== 'passed');
    if (p2pUnknown.length) fail(`PASS_TO_PASS IDs not present in the suite: ${p2pUnknown.slice(0, 10).join(', ')}${p2pUnknown.length > 10 ? ' …' : ''}`);
    if (p2pFailing.length) fail(`PASS_TO_PASS regressions: ${p2pFailing.slice(0, 15).join(', ')}${p2pFailing.length > 15 ? ' …' : ''}`);
    if (!p2pUnknown.length && !p2pFailing.length) ok(`PASS_TO_PASS (${p2p.length}) all pass`);
  }

  // 5. provenance
  const prov = lib.parseProvenance(pr.body);
  if (prov.missing.length) fail(`PR provenance fields missing: ${prov.missing.join(', ')}`);
  if (prov.unchecked.length) fail(`unchecked attestation(s): ${prov.unchecked.map((s) => `"${s}"`).join(', ')}`);
  if (!Object.keys(prov.attestations).length) fail('PR body has no attestation checklist — use the pull request template');
  if (!prov.missing.length && !prov.unchecked.length && Object.keys(prov.attestations).length) ok(`provenance: model=${prov.model}; harness=${prov.harness}${prov.usage ? `; usage=${prov.usage}` : ''}`);

  return finish(lines, results);
}

function finish(lines, results) {
  const failed = lines.some((l) => l.startsWith('❌'));
  const header = failed ? '## KOS acceptance gate: ❌ not accepted yet' : '## KOS acceptance gate: ✅ passed';
  const stats = results ? `\n\nSuite: ${results.passed}/${results.total} tests passing, ${results.ok} matching expectation.` : '';
  const out = `${header}\n\n${lines.map((l) => `- ${l}`).join('\n')}${stats}\n`;
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
  return failed ? 1 : 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}

module.exports = { main, isInheritedNewPageFailure };
