#!/usr/bin/env node
// Convert a Playwright JSON report into the flat per-test-ID result file the
// KOS PR gate reads, or (re)generate the known-failures baseline.
//
//   node tests/kos-report.js <playwright.json> <kos-results.json>
//   node tests/kos-report.js --baseline <playwright.json> tests/known-failures.json
//
// kos-results.json shape:
//   { "generated": ISO, "tests": { "<id>": { "actual": "passed"|"failed", "expected": "passed"|"failed", "ok": bool } } }
'use strict';

const fs = require('node:fs');

function walk(suite, out) {
  for (const spec of suite.specs || []) {
    const t = (spec.tests || [])[0];
    if (!t) continue;
    const last = (t.results || [])[t.results.length - 1] || {};
    const actual = last.status === 'passed' ? 'passed' : 'failed';
    const expected = t.expectedStatus === 'passed' ? 'passed' : 'failed';
    out[spec.title] = { actual, expected, ok: t.status === 'expected' || t.status === 'flaky' };
  }
  for (const child of suite.suites || []) walk(child, out);
}

function collect(report) {
  const tests = {};
  for (const s of report.suites || []) walk(s, tests);
  return tests;
}

function main(argv) {
  const baseline = argv[0] === '--baseline';
  const args = baseline ? argv.slice(1) : argv;
  const [input, output] = args;
  if (!input || !output) {
    console.error('usage: kos-report.js [--baseline] <playwright.json> <output.json>');
    process.exit(2);
  }
  const report = JSON.parse(fs.readFileSync(input, 'utf8'));
  const tests = collect(report);
  if (baseline) {
    const failing = Object.keys(tests).filter((id) => tests[id].actual !== 'passed').sort();
    fs.writeFileSync(output, JSON.stringify(failing, null, 2) + '\n');
    console.log(`baseline: ${failing.length} failing test(s) of ${Object.keys(tests).length} written to ${output}`);
    return;
  }
  const summary = {
    generated: new Date().toISOString(),
    total: Object.keys(tests).length,
    passed: Object.values(tests).filter((t) => t.actual === 'passed').length,
    ok: Object.values(tests).filter((t) => t.ok).length,
    tests,
  };
  fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
  console.log(`kos-results: ${summary.passed}/${summary.total} passing, ${summary.ok} matching expectation -> ${output}`);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { collect };
