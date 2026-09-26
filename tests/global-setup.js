'use strict';
// Build the site the tests run against: src/ rendered with the frozen data in
// tests/fixtures/ (not the nightly snapshots in data/), so test results change
// only when the site's code changes.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { SITE } = require('./helpers');

module.exports = async () => {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build.js'), '--data', 'tests/fixtures', '--out', path.relative(path.join(__dirname, '..'), SITE), '--quiet'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
};
