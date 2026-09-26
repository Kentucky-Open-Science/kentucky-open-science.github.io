// @ts-check
// Site-quality checks that axe cannot express, plus content acceptance tests
// for the KOS board's content tasks.
//
// Test IDs:
//   links/<page>    every internal link resolves; no placeholder href="#" links
//   motion/<page>   with prefers-reduced-motion: reduce, nothing keeps animating (WCAG 2.2.2 / 2.3.3)
//   focus/<page>    every element reached with Tab shows a visible focus indicator (WCAG 2.4.7)
//   content/*       acceptance tests for content tasks (see each test's comment)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { ROOT, PAGES, applyBaseline, readSiteFile, siteFileExists } = require('./helpers');

const ORG_URL = 'https://github.com/Kentucky-Open-Science/';

// ---------------------------------------------------------------------------
// links/<page>
// ---------------------------------------------------------------------------
for (const pageName of PAGES) {
  const id = `links/${pageName}`;
  test(id, async ({ page }) => {
    applyBaseline(id);
    await page.goto(pageName);
    const hrefs = await page.$$eval('a[href]', (as) =>
      as.map((a) => ({ href: a.getAttribute('href') || '', text: (a.textContent || '').trim().slice(0, 40) })),
    );
    const problems = [];
    for (const { href, text } of hrefs) {
      if (href === '#' || href === '' || href.startsWith('javascript:')) {
        problems.push(`placeholder link "${text}" (href="${href}")`);
        continue;
      }
      if (/^(https?:|mailto:|tel:)/i.test(href)) continue; // external: not checked offline
      const [file, fragment] = href.split('#');
      const target = file ? file : pageName;
      if (!siteFileExists(target)) {
        problems.push(`broken link "${text}" -> ${href} (no such file: ${target})`);
        continue;
      }
      if (fragment) {
        const html = readSiteFile(target);
        const idRe = new RegExp(`\\sid\\s*=\\s*["']${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);
        if (!idRe.test(html)) problems.push(`broken fragment "${text}" -> ${href} (no id="${fragment}" in ${target})`);
      }
    }
    expect(problems.join('\n'), `link problems on ${pageName}`).toBe('');
  });
}

// ---------------------------------------------------------------------------
// motion/<page>
// ---------------------------------------------------------------------------
for (const pageName of PAGES) {
  const id = `motion/${pageName}`;
  test(id, async ({ browser }) => {
    applyBaseline(id);
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(pageName);
    await page.waitForTimeout(300);
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map((a) => {
          const effect = /** @type {KeyframeEffect} */ (a.effect);
          const el = effect && effect.target;
          const tag = el ? el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : '') : '?';
          const timing = effect ? effect.getTiming() : {};
          // @ts-ignore animationName exists on CSSAnimation
          return `${tag}: ${a.animationName || a.constructor.name} (iterations=${timing.iterations})`;
        }),
    );
    await context.close();
    expect(
      running.join('\n'),
      `animations still running on ${pageName} with prefers-reduced-motion: reduce`,
    ).toBe('');
  });
}

// ---------------------------------------------------------------------------
// focus/<page>
// ---------------------------------------------------------------------------
for (const pageName of PAGES) {
  const id = `focus/${pageName}`;
  test(id, async ({ page }) => {
    applyBaseline(id);
    await page.goto(pageName);
    const problems = [];
    const seen = new Set();
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const key = el.tagName + '|' + (el.getAttribute('href') || el.id || el.textContent || '').trim().slice(0, 40);
        const outlineVisible = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
        const shadowVisible = cs.boxShadow !== 'none';
        const disabled = el.matches(':disabled');
        return { key, visible: outlineVisible || shadowVisible, disabled, rect: el.getBoundingClientRect().width > 0 };
      });
      if (!info) break; // focus wrapped back to the document
      if (seen.has(info.key)) break; // cycled
      seen.add(info.key);
      if (!info.visible && info.rect && !info.disabled) problems.push(`no visible focus indicator: ${info.key}`);
    }
    expect(seen.size, `no focusable elements reached by Tab on ${pageName}`).toBeGreaterThan(0);
    expect(problems.join('\n'), `focus visibility on ${pageName}`).toBe('');
  });
}

// ---------------------------------------------------------------------------
// reflow/<page>  (WCAG 1.4.10 Reflow, Level AA)
// At a 320 CSS px wide viewport the page must not require horizontal
// scrolling: content reflows into one column instead of overflowing.
// ---------------------------------------------------------------------------
for (const pageName of PAGES) {
  const id = `reflow/${pageName}`;
  test(id, async ({ browser }) => {
    applyBaseline(id);
    const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
    const page = await context.newPage();
    await page.goto(pageName);
    const m = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      offenders: Array.from(document.querySelectorAll('body *'))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 6)
        .map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : '')),
    }));
    await context.close();
    expect(
      m.scrollWidth <= m.innerWidth ? '' : `page is ${m.scrollWidth}px wide in a ${m.innerWidth}px viewport; overflowing: ${m.offenders.join(', ')}`,
      `horizontal overflow on ${pageName} at 320px`,
    ).toBe('');
  });
}

// ---------------------------------------------------------------------------
// content/* — acceptance tests for content tasks
// ---------------------------------------------------------------------------

// content/no-dead-forms
// No page may ship a form that cannot be used: every <form> needs an action
// (or a submit handler that does something), and no control may be disabled
// as a way of saying "not implemented".
test('content/no-dead-forms', async ({ page }) => {
  const id = 'content/no-dead-forms';
  applyBaseline(id);
  const problems = [];
  for (const pageName of PAGES) {
    await page.goto(pageName);
    const found = await page.$$eval('form', (forms) =>
      forms.map((f) => ({
        action: f.getAttribute('action') || '',
        onsubmit: f.getAttribute('onsubmit') || '',
        ariaDisabled: f.getAttribute('aria-disabled') || '',
        disabledControls: f.querySelectorAll('input:disabled, textarea:disabled, select:disabled, button:disabled').length,
      })),
    );
    for (const f of found) {
      if (!f.action) problems.push(`${pageName}: <form> has no action attribute`);
      if (/return\s+false/.test(f.onsubmit)) problems.push(`${pageName}: <form onsubmit="return false"> swallows submissions`);
      if (f.ariaDisabled === 'true') problems.push(`${pageName}: <form aria-disabled="true">`);
      if (f.disabledControls) problems.push(`${pageName}: ${f.disabledControls} disabled form control(s)`);
    }
  }
  expect(problems.join('\n')).toBe('');
});

// content/404-page
// GitHub Pages serves 404.html for unknown URLs. It must exist, be listed in
// tests/pages.json, and link back to the home page.
test('content/404-page', async () => {
  const id = 'content/404-page';
  applyBaseline(id);
  const problems = [];
  if (!siteFileExists('404.html')) problems.push('404.html does not exist');
  else if (!/href=["']\/?(index\.html)?["']/.test(readSiteFile('404.html'))) problems.push('404.html has no link to the home page');
  if (!PAGES.includes('404.html')) problems.push('404.html is not listed in tests/pages.json');
  expect(problems.join('\n')).toBe('');
});

// content/meta-description
// Every page needs a non-empty <meta name="description"> (used by search
// engines and by assistive tech that summarizes pages).
test('content/meta-description', async ({ page }) => {
  const id = 'content/meta-description';
  applyBaseline(id);
  const problems = [];
  for (const pageName of PAGES) {
    await page.goto(pageName);
    const desc = await page.$eval('meta[name="description"]', (m) => m.getAttribute('content') || '').catch(() => null);
    if (desc === null) problems.push(`${pageName}: no <meta name="description">`);
    else if (desc.trim().length < 50) problems.push(`${pageName}: description is only ${desc.trim().length} characters`);
  }
  expect(problems.join('\n')).toBe('');
});

// content/no-placeholder-brand
// The site currently presents itself as "The Web Archive Project" (a 2002-era
// parody). Every page must identify the site as Kentucky Open Science and
// contain none of the placeholder brand strings.
test('content/no-placeholder-brand', async () => {
  const id = 'content/no-placeholder-brand';
  applyBaseline(id);
  const banned = ['Web Archive Project', 'WebArchive', 'GeoCities Holdings', 'NetCorp', 'webarchive.com'];
  const problems = [];
  for (const pageName of PAGES) {
    const html = readSiteFile(pageName);
    for (const s of banned) if (html.toLowerCase().includes(s.toLowerCase())) problems.push(`${pageName} still contains "${s}"`);
    if (!/Kentucky Open Science/i.test(html)) problems.push(`${pageName} does not mention "Kentucky Open Science"`);
  }
  expect(problems.join('\n')).toBe('');
});

// content/site-title
// Every page's <title> must end with "Kentucky Open Science" so tabs and
// screen-reader page announcements identify the site (WCAG 2.4.2).
test('content/site-title', async ({ page }) => {
  const id = 'content/site-title';
  applyBaseline(id);
  const problems = [];
  for (const pageName of PAGES) {
    await page.goto(pageName);
    const title = await page.title();
    if (!/Kentucky Open Science\s*$/.test(title)) problems.push(`${pageName}: <title> is "${title}"`);
  }
  expect(problems.join('\n')).toBe('');
});

// content/projects-page
// A projects.html page must exist, be listed in tests/pages.json (so it is
// covered by every other check), be linked from the primary nav of every
// page, and link to at least five repositories in the Kentucky-Open-Science
// GitHub organization.
test('content/projects-page', async ({ page }) => {
  const id = 'content/projects-page';
  applyBaseline(id);
  const problems = [];
  if (!siteFileExists('projects.html')) problems.push('projects.html does not exist');
  if (!PAGES.includes('projects.html')) problems.push('projects.html is not listed in tests/pages.json');
  for (const pageName of PAGES) {
    const html = readSiteFile(pageName);
    if (!/<nav[\s\S]*?href=["']projects\.html["'][\s\S]*?<\/nav>/i.test(html)) problems.push(`${pageName}: primary <nav> has no link to projects.html`);
  }
  if (siteFileExists('projects.html')) {
    await page.goto('projects.html');
    const repoLinks = await page.$$eval('a[href]', (as, org) => as.map((a) => a.href).filter((h) => h.startsWith(org) && h.length > org.length), ORG_URL);
    if (new Set(repoLinks).size < 5) problems.push(`projects.html links to ${new Set(repoLinks).size} org repositories (need >= 5)`);
  }
  expect(problems.join('\n')).toBe('');
});

// content/skip-link
// Every page must start with a "skip to main content" link that is the first
// focusable element and targets the <main> element (WCAG 2.4.1 technique G1).
test('content/skip-link', async ({ page }) => {
  const id = 'content/skip-link';
  applyBaseline(id);
  const problems = [];
  for (const pageName of PAGES) {
    await page.goto(pageName);
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const href = el.getAttribute('href') || '';
      const targetId = href.startsWith('#') ? href.slice(1) : '';
      const target = targetId ? document.getElementById(targetId) : null;
      return { text: (el.textContent || '').trim(), href, targetsMain: !!target && target.tagName === 'MAIN' };
    });
    if (!first) problems.push(`${pageName}: nothing focusable`);
    else if (!/skip/i.test(first.text) || !first.targetsMain) problems.push(`${pageName}: first Tab stop is "${first.text}" (${first.href}), not a skip link to <main>`);
  }
  expect(problems.join('\n')).toBe('');
});

// content/readme
// The repository must have a README.md that tells a newcomer how to run the
// checks (mentions `npm test`).
test('content/readme', async () => {
  const id = 'content/readme';
  applyBaseline(id);
  const p = path.join(ROOT, 'README.md');
  expect(fs.existsSync(p), 'README.md exists').toBe(true);
  expect(fs.readFileSync(p, 'utf8')).toMatch(/npm test/);
});
