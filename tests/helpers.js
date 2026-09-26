'use strict';
// Shared helpers for the acceptance-test harness.
//
// Every test in this suite has a stable ID (its Playwright title), e.g.
//   a11y/index.html/color-contrast
//   a11y/projects/DALE-CT.html/list        (pages can live in subdirectories)
//   html/guestbook.html
//   links/about.html
//   motion/index.html
//   focus/tech.html
//   content/projects-page
// Task issues on the KOS board reference these IDs in FAIL_TO_PASS / PASS_TO_PASS.
//
// tests/known-failures.json is the ratchet baseline: IDs listed there are
// *expected* to fail on main. A test listed there that starts passing is
// reported as a failure ("expected to fail, but passed") until the ID is
// removed from the baseline — so every fix must also shrink the baseline,
// and nobody can hide a regression by adding to it (the PR gate checks).

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
// The built site under test (tests/global-setup.js builds it from tests/fixtures/).
const SITE = path.join(ROOT, '_site-test');
const PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, 'pages.json'), 'utf8'));
const KNOWN_FAILURES = new Set(
  JSON.parse(fs.readFileSync(path.join(__dirname, 'known-failures.json'), 'utf8')),
);

/** Mark the current test as an expected failure if its ID is in the baseline. */
function applyBaseline(id) {
  test.fail(
    KNOWN_FAILURES.has(id),
    `${id} is listed in tests/known-failures.json (expected to fail). ` +
      'If you fixed it, remove the ID from the baseline.',
  );
}

/** Read a file of the built site (path relative to the site root). */
function readSiteFile(rel) {
  return fs.readFileSync(path.join(SITE, rel), 'utf8');
}

function siteFileExists(rel) {
  const p = path.join(SITE, rel);
  return p.startsWith(SITE) && fs.existsSync(p) && fs.statSync(p).isFile();
}

module.exports = { ROOT, SITE, PAGES, KNOWN_FAILURES, applyBaseline, readSiteFile, siteFileExists };
