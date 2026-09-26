'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib');

test('markers: write, read, replace, remove', () => {
  const body = '### Problem statement\n\nfoo\n';
  const withLease = lib.writeMarker(body, 'lease', { holder: 'ann', expires: 'x' });
  assert.match(withLease, /<!-- kos:lease \{"holder":"ann","expires":"x"\} -->$/);
  assert.deepEqual(lib.readMarker(withLease, 'lease'), { holder: 'ann', expires: 'x' });
  assert.equal(lib.readMarker(withLease, 'accepted'), null);
  const replaced = lib.writeMarker(withLease, 'lease', { holder: 'bob' });
  assert.equal((replaced.match(/kos:lease/g) || []).length, 1);
  assert.equal(lib.readMarker(replaced, 'lease').holder, 'bob');
  const removed = lib.writeMarker(replaced, 'lease', null);
  assert.equal(lib.readMarker(removed, 'lease'), null);
  assert.equal(removed, body);
  // two kinds coexist
  const both = lib.writeMarker(withLease, 'accepted', { pr: 3 });
  assert.equal(lib.readMarker(both, 'lease').holder, 'ann');
  assert.equal(lib.readMarker(both, 'accepted').pr, 3);
});

test('issue-form sections and test IDs', () => {
  const body = [
    '### Problem statement',
    '',
    'Something is wrong.',
    '',
    '### FAIL_TO_PASS',
    '',
    '- `content/skip-link`',
    'a11y/index.html/bypass   # comment',
    '',
    '```',
    'motion/about.html',
    '```',
    '',
    '### PASS_TO_PASS',
    '',
    '*',
    '',
    '### Hints and pointers',
    '',
    '_No response_',
  ].join('\n');
  const s = lib.parseSections(body);
  assert.equal(s['problem statement'], 'Something is wrong.');
  assert.deepEqual(lib.parseTestIds(lib.section(s, 'FAIL_TO_PASS')), ['content/skip-link', 'a11y/index.html/bypass', 'motion/about.html']);
  assert.deepEqual(lib.parseTestIds(lib.section(s, 'PASS_TO_PASS')), ['*']);
  assert.deepEqual(lib.parseTestIds(lib.section(s, 'Hints and pointers')), []);
  assert.deepEqual(lib.parseTestIds('all other tests in the suite'), ['*']);
});

test('state, size, points', () => {
  const L = lib.CONFIG.labels;
  assert.equal(lib.stateOf([L.task, L.ready]), 'ready');
  assert.equal(lib.stateOf([{ name: L.task }, { name: L.leased }]), 'leased');
  assert.equal(lib.stateOf([L.task]), null);
  assert.equal(lib.isTask([L.task]), true);
  assert.equal(lib.isTask(['bug']), false);
  assert.equal(lib.sizeOf([L.sizes.M]), 'M');
  assert.equal(lib.pointsFor('M'), lib.CONFIG.points.bySize.M);
  assert.equal(lib.pointsFor(null), lib.CONFIG.points.default);
});

test('lease math', () => {
  const now = '2026-09-26T12:00:00.000Z';
  const lease = lib.newLease('ann', now);
  assert.equal(lease.holder, 'ann');
  assert.equal(lease.expires, '2026-09-28T12:00:00.000Z');
  assert.equal(lib.hoursLeft(lease, '2026-09-28T06:00:00.000Z'), 6);
  assert.equal(lib.isExpired(lease, '2026-09-28T12:00:00.001Z'), true);
  assert.equal(lib.isExpired(lease, '2026-09-28T11:59:59.000Z'), false);
  assert.equal(lib.fmt(lease.expires), '2026-09-28 12:00 UTC');
});

test('commands and task references', () => {
  assert.equal(lib.parseCommand('/claim'), 'claim');
  assert.equal(lib.parseCommand('  /Extend please'), 'extend');
  assert.equal(lib.parseCommand('I would like to /claim this'), null);
  assert.equal(lib.parseCommand('/claimed'), null);
  assert.equal(lib.parseTaskRef('KOS-Task: #12\n\nCloses #7'), 12);
  assert.equal(lib.parseTaskRef('KOS-Task: 12'), 12);
  assert.equal(lib.parseTaskRef('KOS-Task: #<!-- task number -->\n\nFixes #7'), 7);
  assert.equal(lib.parseTaskRef('no refs here'), null);
});

test('provenance parsing: the untouched template is incomplete', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', '..', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');
  const p = lib.parseProvenance(template);
  assert.deepEqual(p.missing, ['Model(s)', 'Harness']);
  assert.equal(Object.keys(p.attestations).length, 5);
  assert.equal(p.unchecked.length, 5);
});

test('provenance parsing: a filled template passes', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', '..', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');
  const filled = template
    .replace(/- Model\(s\):.*$/m, '- Model(s): Claude Opus 5.5')
    .replace(/- Harness:.*$/m, '- Harness: Claude Code 2.1')
    .replace(/- Approx\. usage:.*$/m, '- Approx. usage: ~1 session')
    .replace(/- \[ \]/g, '- [x]');
  const p = lib.parseProvenance(filled);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.unchecked, []);
  assert.equal(p.model, 'Claude Opus 5.5');
  assert.equal(p.harness, 'Claude Code 2.1');
  assert.equal(p.usage, '~1 session');
});
