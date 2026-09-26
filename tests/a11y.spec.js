// @ts-check
// Automated accessibility checks, one test per (page, axe rule).
//
// Two groups:
//   a11y/<page>/<rule>     axe-core rules tagged WCAG 2.0/2.1 A and AA — the
//                          technical standard adopted by the ADA Title II web
//                          rule (28 CFR 35.200). These are the legal baseline.
//   a11y-bp/<page>/<rule>  axe-core "best-practice" rules (landmarks, heading
//                          order, ...). Not legally required; strongly recommended.
//
// Example IDs:  a11y/guestbook.html/label   a11y-bp/index.html/region
//
// axe-core runs ONCE per (page, group); each rule test then reads the cached
// result, so the whole matrix (pages x rules) costs a few seconds.
'use strict';

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const axeCore = require('axe-core');
const { PAGES, applyBaseline } = require('./helpers');

const GROUPS = [
  { prefix: 'a11y', tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  { prefix: 'a11y-bp', tags: ['best-practice'] },
];

/** Render one violation as a readable, actionable message. */
function describeViolation(v) {
  const nodes = v.nodes
    .slice(0, 8)
    .map((n) => {
      const target = Array.isArray(n.target) ? n.target.join(' ') : String(n.target);
      const why = (n.failureSummary || '').split('\n').filter(Boolean).slice(0, 3).join(' | ');
      return `    - ${target}\n      ${why}`;
    })
    .join('\n');
  const more = v.nodes.length > 8 ? `\n    ... and ${v.nodes.length - 8} more node(s)` : '';
  return `[${v.impact}] ${v.id}: ${v.help}\n  ${v.helpUrl}\n${nodes}${more}`;
}

for (const group of GROUPS) {
  const rules = axeCore
    .getRules(group.tags)
    .map((r) => r.ruleId)
    .sort();

  for (const pageName of PAGES) {
    test.describe(`${group.prefix} ${pageName}`, () => {
      /** @type {Map<string, import('axe-core').Result>} */
      const violations = new Map();
      /** @type {string[]} */
      const incomplete = [];

      test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const response = await page.goto(pageName, { waitUntil: 'load' });
        if (!response || !response.ok()) {
          throw new Error(`Could not load ${pageName}: HTTP ${response ? response.status() : 'no response'}`);
        }
        const results = await new AxeBuilder({ page }).withTags(group.tags).analyze();
        for (const v of results.violations) violations.set(v.id, v);
        for (const i of results.incomplete) incomplete.push(i.id);
        await context.close();
      });

      for (const rule of rules) {
        const id = `${group.prefix}/${pageName}/${rule}`;
        test(id, async () => {
          applyBaseline(id);
          const v = violations.get(rule);
          expect(v ? describeViolation(v) : '', `axe rule "${rule}" on ${pageName}`).toBe('');
        });
      }

      // Informational: rules axe could not decide automatically ("needs review").
      // Never fails; the output helps the human reviewer.
      test.afterAll(() => {
        if (incomplete.length) {
          console.log(`[${group.prefix}] ${pageName}: needs manual review for ${[...new Set(incomplete)].join(', ')}`);
        }
      });
    });
  }
}
