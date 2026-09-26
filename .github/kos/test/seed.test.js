'use strict';
// Consistency checks between the seed tasks, the baseline, and the parsers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib');
const { renderBody } = require('../bootstrap');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const seeds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed-tasks.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'known-failures.json'), 'utf8'));

test('every seed task has the required fields and a valid size', () => {
  for (const t of seeds) {
    assert.ok(t.title.startsWith('[Task] '), t.title);
    assert.ok(t.problem && t.scope && t.humanChecklist.length >= 1, t.title);
    assert.ok(['S', 'M', 'L'].includes(t.size), t.title);
    assert.ok(Array.isArray(t.failToPass) && t.failToPass.length >= 1, t.title);
  }
});

test('every FAIL_TO_PASS ID of a seed task is currently in the baseline', () => {
  const missing = [];
  for (const t of seeds) for (const id of t.failToPass) if (!baseline.includes(id)) missing.push(`${t.title}: ${id}`);
  assert.deepEqual(missing, []);
});

test('every baselined failure is covered by exactly one seed task', () => {
  const owners = {};
  for (const t of seeds) for (const id of t.failToPass) (owners[id] ||= []).push(t.title);
  const uncovered = baseline.filter((id) => !owners[id]);
  const doubled = Object.entries(owners).filter(([, v]) => v.length > 1);
  assert.deepEqual(uncovered, [], 'baseline IDs no task fixes');
  assert.deepEqual(doubled, [], 'IDs claimed by more than one task');
});

test('rendered seed bodies round-trip through the issue-form parser', () => {
  for (const t of seeds) {
    const s = lib.parseSections(renderBody(t));
    assert.deepEqual(lib.parseTestIds(lib.section(s, 'FAIL_TO_PASS')), t.failToPass, t.title);
    assert.deepEqual(lib.parseTestIds(lib.section(s, 'PASS_TO_PASS')), ['*'], t.title);
    assert.ok(lib.section(s, 'Problem statement').length > 50, t.title);
  }
});
