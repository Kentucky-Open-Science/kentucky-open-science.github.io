'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../lib');
const board = require('../board');
const expiry = require('../expiry');
const prState = require('../pr-state');
const { makeIssue, fakeGithub, core, context } = require('./fake-github');

const L = lib.CONFIG.labels;
const NOW = new Date('2026-09-26T12:00:00.000Z');
const comment = (login, body) => ({ user: { login, type: 'User' }, body });
const lastComment = (gh) => gh.__comments[gh.__comments.length - 1].body;

// ---------------------------------------------------------------------------
// /claim
// ---------------------------------------------------------------------------

test('/claim leases a ready task', async () => {
  const issue = makeIssue(5, { labels: [L.task, L.ready, L.sizes.S], body: '### Problem statement\n\nx' });
  const gh = fakeGithub({ issues: [issue] });
  const r = await board({ github: gh, context: context({ issue, comment: comment('ann', '/claim') }), core, now: NOW });
  assert.equal(r.ok, true);
  assert.ok(issue.labels.has(L.leased) && !issue.labels.has(L.ready));
  assert.ok(issue.assignees.has('ann'));
  const lease = lib.readMarker(issue.body, 'lease');
  assert.equal(lease.holder, 'ann');
  assert.equal(lease.expires, '2026-09-28T12:00:00.000Z');
  assert.match(lastComment(gh), /Leased to @ann until \*\*2026-09-28 12:00 UTC\*\*/);
});

test('/claim is refused when the task is not ready', async () => {
  const issue = makeIssue(5, { labels: [L.task, L.leased], assignees: ['bob'], body: lib.writeMarker('', 'lease', lib.newLease('bob', NOW)) });
  const gh = fakeGithub({ issues: [issue] });
  const r = await board({ github: gh, context: context({ issue, comment: comment('ann', '/claim') }), core, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not ready');
  assert.ok(issue.assignees.has('bob') && !issue.assignees.has('ann'));
  assert.match(lastComment(gh), /held by @bob/);
});

test('/claim is refused while the person holds another lease', async () => {
  const held = makeIssue(3, { labels: [L.task, L.leased], assignees: ['ann'] });
  const issue = makeIssue(5, { labels: [L.task, L.ready] });
  const gh = fakeGithub({ issues: [held, issue] });
  const r = await board({ github: gh, context: context({ issue, comment: comment('ann', '/claim') }), core, now: NOW });
  assert.equal(r.reason, 'already holds a lease');
  assert.ok(issue.labels.has(L.ready));
  assert.match(lastComment(gh), /already hold a lease on #3/);
});

test('/claim loses the race when the ready label is already gone', async () => {
  const issue = makeIssue(5, { labels: [L.task, L.ready] });
  const gh = fakeGithub({ issues: [issue] });
  // Simulate a concurrent winner between the payload snapshot and label removal:
  const original = gh.rest.issues.get;
  gh.rest.issues.get = async (p) => {
    const r = await original(p);
    issue.labels.delete(L.ready); // someone else won right after we read
    return r;
  };
  const r = await board({ github: gh, context: context({ issue, comment: comment('ann', '/claim') }), core, now: NOW });
  assert.equal(r.reason, 'lost race');
  assert.ok(!issue.assignees.has('ann'));
});

test('ignores comments on non-tasks, bots, and non-commands', async () => {
  const issue = makeIssue(9, { labels: ['bug'] });
  const gh = fakeGithub({ issues: [issue] });
  assert.equal((await board({ github: gh, context: context({ issue, comment: comment('ann', '/claim') }), core })).handled, false);
  const task = makeIssue(10, { labels: [L.task, L.ready] });
  const gh2 = fakeGithub({ issues: [task] });
  assert.equal((await board({ github: gh2, context: context({ issue: task, comment: { user: { login: 'x[bot]', type: 'Bot' }, body: '/claim' } }), core })).handled, false);
  assert.equal((await board({ github: gh2, context: context({ issue: task, comment: comment('ann', 'nice task') }), core })).handled, false);
  assert.equal(gh2.__comments.length, 0);
});

test('a /claim that Git Bash turned into a path gets a hint instead of silence', async () => {
  const issue = makeIssue(2, { labels: [L.task, L.ready] });
  const gh = fakeGithub({ issues: [issue] });
  const r = await board({ github: gh, context: context({ issue, comment: comment('ann', 'Y:/Program Files/Git/claim') }), core, now: NOW });
  assert.equal(r.handled, true);
  assert.equal(r.ok, false);
  assert.match(lastComment(gh), /@ann .*`\/claim`/);
  assert.match(lastComment(gh), /echo \/claim \| gh issue comment 2 --repo o\/r --body-file -/);
  assert.ok(gh.__store.get(2).labels.has(L.ready), 'the task is not leased');
  // Not a task: stay silent.
  const other = makeIssue(9, { labels: ['bug'] });
  const gh2 = fakeGithub({ issues: [other] });
  assert.equal((await board({ github: gh2, context: context({ issue: other, comment: comment('ann', 'Y:/Program Files/Git/claim') }), core })).handled, false);
  assert.equal(gh2.__comments.length, 0);
});

// ---------------------------------------------------------------------------
// /release and /extend
// ---------------------------------------------------------------------------

function leasedIssue(holder = 'ann', extras = {}) {
  const lease = { ...lib.newLease(holder, NOW), ...extras };
  return makeIssue(5, { labels: [L.task, L.leased], assignees: [holder], body: lib.writeMarker('### Problem statement\n\nx', 'lease', lease) });
}

test('/release by the holder returns the task to the pool', async () => {
  const issue = leasedIssue('ann');
  const gh = fakeGithub({ issues: [issue] });
  const r = await board({ github: gh, context: context({ issue, comment: comment('ann', '/release') }), core, now: NOW });
  assert.equal(r.ok, true);
  assert.ok(issue.labels.has(L.ready) && !issue.labels.has(L.leased));
  assert.equal(issue.assignees.size, 0);
  assert.equal(lib.readMarker(issue.body, 'lease'), null);
});

test('/release by a stranger is refused; by a maintainer is allowed', async () => {
  const issue = leasedIssue('ann');
  const gh = fakeGithub({ issues: [issue], permissions: { sam: 'admin' } });
  const r1 = await board({ github: gh, context: context({ issue, comment: comment('carl', '/release') }), core, now: NOW });
  assert.equal(r1.reason, 'not holder');
  assert.ok(issue.labels.has(L.leased));
  const r2 = await board({ github: gh, context: context({ issue, comment: comment('sam', '/release') }), core, now: NOW });
  assert.equal(r2.ok, true);
  assert.ok(issue.labels.has(L.ready));
});

test('/extend adds a period once, then refuses', async () => {
  const issue = leasedIssue('ann');
  const gh = fakeGithub({ issues: [issue] });
  const r1 = await board({ github: gh, context: context({ issue, comment: comment('ann', '/extend') }), core, now: NOW });
  assert.equal(r1.ok, true);
  assert.equal(r1.lease.expires, '2026-09-30T12:00:00.000Z');
  assert.equal(r1.lease.extensions, 1);
  const r2 = await board({ github: gh, context: context({ issue, comment: comment('ann', '/extend') }), core, now: NOW });
  assert.equal(r2.reason, 'max extensions');
  const r3 = await board({ github: gh, context: context({ issue, comment: comment('bob', '/extend') }), core, now: NOW });
  assert.equal(r3.reason, 'not holder');
});

test('/status reports the lease', async () => {
  const issue = leasedIssue('ann');
  const gh = fakeGithub({ issues: [issue] });
  await board({ github: gh, context: context({ issue, comment: comment('zed', '/status') }), core, now: NOW });
  assert.match(lastComment(gh), /\*\*State:\*\* `leased`/);
  assert.match(lastComment(gh), /@ann, expires 2026-09-28 12:00 UTC \(48\.0 h left/);
});

// ---------------------------------------------------------------------------
// expiry sweep
// ---------------------------------------------------------------------------

test('expiry sweep: expired leases return to the pool, near-expiry gets one warning', async () => {
  const expired = makeIssue(1, { labels: [L.task, L.leased], assignees: ['ann'], body: lib.writeMarker('', 'lease', { ...lib.newLease('ann', '2026-09-20T00:00:00Z') }) });
  const soon = makeIssue(2, { labels: [L.task, L.leased], assignees: ['bob'], body: lib.writeMarker('', 'lease', { ...lib.newLease('bob', NOW), expires: '2026-09-26T15:00:00.000Z' }) });
  const fine = makeIssue(3, { labels: [L.task, L.leased], assignees: ['cy'], body: lib.writeMarker('', 'lease', lib.newLease('cy', NOW)) });
  const broken = makeIssue(4, { labels: [L.task, L.leased], assignees: ['di'], body: 'no marker' });
  const orphan = makeIssue(6, { labels: [L.task, L.leased], body: 'no marker, nobody' });
  const gh = fakeGithub({ issues: [expired, soon, fine, broken, orphan] });
  const s = await expiry({ github: gh, context: context({}), core, now: NOW });
  assert.deepEqual(s.expired, [1]);
  assert.deepEqual(s.warned, [2]);
  assert.deepEqual(s.repaired, [4, 6]);
  assert.ok(expired.labels.has(L.ready) && !expired.labels.has(L.leased) && expired.assignees.size === 0);
  assert.equal(lib.readMarker(expired.body, 'lease'), null);
  assert.equal(lib.readMarker(soon.body, 'lease').warned, true);
  assert.equal(lib.readMarker(broken.body, 'lease').holder, 'di');
  assert.ok(orphan.labels.has(L.ready));
  // second sweep: no duplicate warning
  const s2 = await expiry({ github: gh, context: context({}), core, now: NOW });
  assert.deepEqual(s2.warned, []);
});

// ---------------------------------------------------------------------------
// PR-driven transitions
// ---------------------------------------------------------------------------

const pr = (login, extra = {}) => ({ number: 40, user: { login }, body: 'KOS-Task: #5\n\nsummary', merged: false, ...extra });

test('PR opened by the holder moves the task to submitted', async () => {
  const issue = leasedIssue('ann');
  const gh = fakeGithub({ issues: [issue] });
  const r = await prState({ github: gh, context: context({ pull_request: pr('ann'), action: 'opened' }), core, now: NOW });
  assert.equal(r.transition, 'leased->submitted');
  assert.ok(issue.labels.has(L.submitted) && !issue.labels.has(L.leased));
  assert.equal(lib.readMarker(issue.body, 'lease').pr, 40);
});

test('PR opened by a non-holder is told to claim first', async () => {
  const issue = leasedIssue('ann');
  const gh = fakeGithub({ issues: [issue] });
  const r = await prState({ github: gh, context: context({ pull_request: pr('bob'), action: 'opened' }), core, now: NOW });
  assert.equal(r.ok, false);
  assert.ok(issue.labels.has(L.leased));
  assert.equal(gh.__comments[0].issue_number, 40);
  assert.match(gh.__comments[0].body, /lease is held by @ann/);
});

test('merged PR accepts the task, awards points and reviewer credit, closes it', async () => {
  const issue = leasedIssue('ann');
  issue.labels.add(L.sizes.M);
  issue.labels.delete(L.leased);
  issue.labels.add(L.submitted);
  const gh = fakeGithub({ issues: [issue], reviews: [{ state: 'APPROVED', user: { login: 'sam' } }, { state: 'COMMENTED', user: { login: 'zed' } }, { state: 'APPROVED', user: { login: 'ann' } }] });
  const r = await prState({ github: gh, context: context({ pull_request: pr('ann', { merged: true, merged_by: { login: 'sam' }, merged_at: '2026-09-27T10:00:00Z' }), action: 'closed' }), core, now: NOW });
  assert.equal(r.transition, 'submitted->accepted');
  assert.ok(issue.labels.has(L.accepted) && !issue.labels.has(L.submitted));
  assert.equal(issue.state, 'closed');
  const acc = lib.readMarker(issue.body, 'accepted');
  assert.equal(acc.points, 25);
  assert.equal(acc.solver, 'ann');
  assert.deepEqual(acc.reviewers, ['sam']);
  assert.equal(acc.reviewerPoints, 6);
  assert.equal(lib.readMarker(issue.body, 'lease'), null);
  assert.match(lastComment(gh), /\+25 points\*\* to @ann/);
  assert.equal(gh.__dispatched[gh.__dispatched.length - 1].workflow_id, 'kos-site.yml');
});

test('PR closed without merge returns the task to leased with a fresh clock', async () => {
  const issue = leasedIssue('ann', { pr: 40, expires: '2026-09-26T13:00:00.000Z' });
  issue.labels.delete(L.leased);
  issue.labels.add(L.submitted);
  const gh = fakeGithub({ issues: [issue] });
  const r = await prState({ github: gh, context: context({ pull_request: pr('ann', { merged: false }), action: 'closed' }), core, now: NOW });
  assert.equal(r.transition, 'submitted->leased');
  assert.ok(issue.labels.has(L.leased));
  assert.equal(lib.readMarker(issue.body, 'lease').expires, '2026-09-28T12:00:00.000Z');
});

test('PRs that reference no task are ignored', async () => {
  const gh = fakeGithub({ issues: [] });
  const r = await prState({ github: gh, context: context({ pull_request: { number: 1, user: { login: 'x' }, body: 'docs only' }, action: 'opened' }), core });
  assert.equal(r.handled, false);
});

// ---------------------------------------------------------------------------
// Site refresh + board data
// ---------------------------------------------------------------------------

test('a successful /claim asks the site workflow to rebuild the bounty board', async () => {
  const issue = makeIssue(5, { labels: [L.task, L.ready, L.sizes.S] });
  const gh = fakeGithub({ issues: [issue] });
  await board({ github: gh, context: context({ issue, comment: comment('ann', '/claim') }), core, now: NOW });
  assert.deepEqual(gh.__dispatched.map((d) => d.workflow_id), ['kos-site.yml']);
});

test('a refused /claim does not rebuild the site', async () => {
  const issue = makeIssue(5, { labels: [L.task, L.triage] });
  const gh = fakeGithub({ issues: [issue] });
  await board({ github: gh, context: context({ issue, comment: comment('ann', '/claim') }), core, now: NOW });
  assert.equal(gh.__dispatched.length, 0);
});

test('board data lists open tasks by state with holder, expiry, and points', () => {
  const { summarize } = require('../leaderboard');
  const { view } = require('./fake-github');
  const lease = lib.newLease('ann', NOW);
  const open = [
    view(makeIssue(7, { labels: [L.task, L.ready, L.sizes.M] })),
    view(makeIssue(8, { labels: [L.task, L.leased, L.sizes.S], assignees: ['ann'], body: lib.writeMarker('', 'lease', lease) })),
    view(makeIssue(9, { labels: [L.task, L.submitted], assignees: ['bob'], body: lib.writeMarker('', 'lease', { ...lib.newLease('bob', NOW), pr: 12 }) })),
  ];
  const accepted = [
    view(makeIssue(3, { labels: [L.task, L.accepted, L.sizes.M], state: 'closed', body: lib.writeMarker('', 'accepted', { pr: 4, solver: 'cy', size: 'M', points: 25, reviewers: ['dee'], reviewerPoints: 6, mergedAt: '2026-09-20T00:00:00Z' }) })),
  ];
  const d = summarize({ open, accepted, repo: 'o/r', now: NOW });
  assert.deepEqual(d.status, { ready: 1, leased: 1, submitted: 1, triage: 0 });
  assert.deepEqual(d.tasks.map((t) => [t.number, t.state, t.points, t.holder]), [[7, 'ready', 25, null], [8, 'leased', 10, 'ann'], [9, 'submitted', 10, 'bob']]);
  assert.equal(d.tasks[1].expires, lease.expires);
  assert.equal(d.tasks[2].pr, 12);
  assert.deepEqual(d.leaderboard.map((p) => [p.login, p.points]), [['cy', 25], ['dee', 6]]);
});
