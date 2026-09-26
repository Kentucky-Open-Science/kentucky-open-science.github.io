// @ts-check
// HTML validity, one test per page, using html-validate (offline, no network).
//
// Test ID format:  html/<page>
// Example:         html/index.html
//
// Rule configuration lives in .htmlvalidate.json at the repository root.
'use strict';

const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { HtmlValidate, FileSystemConfigLoader } = require('html-validate');
const { SITE, PAGES, applyBaseline } = require('./helpers');

// FileSystemConfigLoader picks up .htmlvalidate.json at the repository root.
const htmlvalidate = new HtmlValidate(new FileSystemConfigLoader());

function formatMessages(result) {
  return result.results
    .flatMap((file) => file.messages.map((m) => `  ${path.relative(SITE, file.filePath)}:${m.line}:${m.column}  ${m.ruleId}  ${m.message}`))
    .join('\n');
}

for (const pageName of PAGES) {
  const id = `html/${pageName}`;
  test(id, async () => {
    applyBaseline(id);
    const report = await htmlvalidate.validateFile(path.join(SITE, pageName));
    expect(report.valid ? '' : formatMessages(report), `html-validate on ${pageName}`).toBe('');
  });
}
