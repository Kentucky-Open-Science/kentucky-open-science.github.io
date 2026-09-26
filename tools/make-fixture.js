#!/usr/bin/env node
'use strict';
// Maintainers only: re-freeze tests/fixtures/projects.json from the current
// data/projects.json. The test suite builds the site from this fixture so its
// results change only when the site's code changes; refreshing the fixture can
// change test results, so regenerate the baseline (npm test; npm run baseline)
// in the same pull request and explain why.
//
//   node tools/make-fixture.js [name ...]   # default: the current fixture's projects

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'projects.json');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'projects.json'), 'utf8'));
const current = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const names = process.argv.slice(2).length ? process.argv.slice(2) : current.projects.map((p) => p.name);
const projects = names.map((n) => {
  const p = data.projects.find((x) => x.name === n);
  if (!p) throw new Error(`${n} is not in data/projects.json`);
  return p;
});
const out = { generated: current.generated, org: { ...data.org, publicRepos: projects.length }, projects };
fs.writeFileSync(FIXTURE, JSON.stringify(out, null, 1) + '\n');
console.log(`fixture: ${projects.length} projects -> ${path.relative(ROOT, FIXTURE)}`);
