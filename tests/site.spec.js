// @ts-check
// Site-quality checks that axe cannot express, plus content acceptance tests
// for the KOS board's content tasks.
//
// Test IDs:
//   links/<page>    every internal link resolves; no placeholder href="#" links
//   motion/<page>   with prefers-reduced-motion: reduce, nothing keeps animating (WCAG 2.3.3)
//   pause/<page>    moving/blinking content longer than 5 s can be paused or stopped (WCAG 2.2.2)
//   linktext/<page> link text says where a link goes; same text, same destination (WCAG 2.4.4)
//   focus/<page>    every element reached with Tab shows a visible focus indicator (WCAG 2.4.7)
//   reflow/<page>   no horizontal scrolling at 320 CSS px (WCAG 1.4.10)
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
      const [fileAndQuery, fragment] = href.split('#');
      const file = fileAndQuery.split('?')[0];
      // Resolve relative to the page's own directory (pages can live in projects/).
      const target = file ? path.posix.normalize(path.posix.join(path.posix.dirname(pageName), file)) : pageName;
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
// pause/<page>  (WCAG 2.2.2 Pause, Stop, Hide, Level A)
// Anything that moves, blinks, or scrolls for more than five seconds must have
// a way to pause, stop, or hide it — independent of prefers-reduced-motion.
// Passes when, after activating a control named "pause"/"stop" (if the page
// has one), no animation is left running that lasts longer than 5 seconds.
// ---------------------------------------------------------------------------
for (const pageName of PAGES) {
  const id = `pause/${pageName}`;
  test(id, async ({ page }) => {
    applyBaseline(id);
    await page.goto(pageName);
    const control = page.getByRole('button', { name: /pause|stop/i }).or(page.getByRole('checkbox', { name: /pause|stop/i })).or(page.getByRole('switch', { name: /pause|stop/i }));
    const hasControl = (await control.count()) > 0;
    if (hasControl) await control.first().click();
    await page.waitForTimeout(200);
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .filter((a) => {
          const t = a.effect ? a.effect.getComputedTiming() : { endTime: Infinity };
          return !Number.isFinite(Number(t.endTime)) || Number(t.endTime) > 5000;
        })
        .map((a) => {
          const el = /** @type {KeyframeEffect} */ (a.effect).target;
          // @ts-ignore animationName exists on CSSAnimation
          return `${el ? el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : '') : '?'}: ${a.animationName || a.constructor.name}`;
        }),
    );
    expect(
      running.join('\n'),
      `animations longer than 5 s still running on ${pageName} ${hasControl ? 'after using the pause control' : '(no pause/stop control found)'}`,
    ).toBe('');
  });
}

// ---------------------------------------------------------------------------
// linktext/<page>  (WCAG 2.4.4 Link Purpose (In Context), Level A)
// Screen-reader users often navigate by a list of links, out of context. Links
// with the same text must lead to the same place, and link text may not be a
// generic phrase such as "More Info" or "click here".
// ---------------------------------------------------------------------------
const GENERIC_LINK_TEXT = /^(more( info(rmation)?)?|read more|learn more|click here|here|link|details|go)$/i;
for (const pageName of PAGES) {
  const id = `linktext/${pageName}`;
  test(id, async ({ page }) => {
    applyBaseline(id);
    await page.goto(pageName);
    const links = await page.$$eval('a[href]', (as) =>
      as.map((a) => ({ name: (a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim(), href: a.href })),
    );
    const problems = [];
    const byName = new Map();
    for (const { name, href } of links) {
      if (!name) problems.push(`link with no text -> ${href}`);
      else if (GENERIC_LINK_TEXT.test(name)) problems.push(`generic link text "${name}" -> ${href}`);
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, new Set());
      byName.get(key).add(href);
    }
    for (const [name, hrefs] of byName) {
      if (name && hrefs.size > 1 && !GENERIC_LINK_TEXT.test(name)) problems.push(`"${name}" links to ${hrefs.size} different places: ${[...hrefs].join(', ')}`);
    }
    expect([...new Set(problems)].join('\n'), `link text on ${pageName}`).toBe('');
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
// projects.html must exist, be listed in tests/pages.json (so it is covered by
// every other check), be linked from the primary nav of every page, and link
// to a wiki page for every project in the data; every project page must link
// to its repository in the Kentucky-Open-Science GitHub organization.
test('content/projects-page', async ({ page }) => {
  const id = 'content/projects-page';
  applyBaseline(id);
  const problems = [];
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'projects.json'), 'utf8'));
  if (!siteFileExists('projects.html')) problems.push('projects.html does not exist');
  if (!PAGES.includes('projects.html')) problems.push('projects.html is not listed in tests/pages.json');
  for (const pageName of PAGES) {
    const html = readSiteFile(pageName);
    if (!/<nav[\s\S]*?href=["'](\.\.\/)*projects\.html["'][\s\S]*?<\/nav>/i.test(html)) problems.push(`${pageName}: primary <nav> has no link to projects.html`);
  }
  if (siteFileExists('projects.html')) {
    await page.goto('projects.html');
    const hrefs = new Set(await page.$$eval('#catalog a[href]', (as) => as.map((a) => a.getAttribute('href'))));
    for (const p of fixture.projects) {
      const rel = `projects/${encodeURIComponent(p.name)}.html`;
      if (!hrefs.has(rel)) problems.push(`projects.html does not link to ${rel}`);
      if (!siteFileExists(`projects/${p.name}.html`)) {
        problems.push(`no page for ${p.name}`);
        continue;
      }
      if (!readSiteFile(`projects/${p.name}.html`).includes(`href="${ORG_URL}${p.name}"`)) problems.push(`projects/${p.name}.html does not link to ${ORG_URL}${p.name}`);
    }
  }
  expect(problems.join('\n')).toBe('');
});

// content/no-private-repos
// PRIVACY GUARD. The wiki must only ever describe public repositories. Checks
// the committed snapshot (data/projects.json, deployed nightly) and the fixture.
test('content/no-private-repos', async () => {
  const id = 'content/no-private-repos';
  applyBaseline(id);
  const problems = [];
  for (const rel of ['data/projects.json', 'tests/fixtures/projects.json']) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const p of data.projects) {
      if (p.visibility !== 'public') problems.push(`${rel}: ${p.name} has visibility "${p.visibility}"`);
      if (!String(p.url).startsWith(ORG_URL)) problems.push(`${rel}: ${p.name} is not in the organization (${p.url})`);
    }
  }
  expect(problems.join('\n')).toBe('');
});

// content/search
// The project search on projects.html finds projects by name, topic, and
// README text, reports the number of matches in a live status message, and
// says so when nothing matches.
test('content/search', async ({ page }) => {
  const id = 'content/search';
  applyBaseline(id);
  await page.goto('projects.html');
  const box = page.getByRole('searchbox', { name: 'Search projects' });
  const status = page.locator('#search-status');
  const results = page.locator('#search-results');

  await box.fill('dale');
  await expect(status).toContainText('match');
  await expect(results.locator('a.project-name').first()).toHaveText('DALE-CT');

  await box.fill('robotics');
  await expect(results.locator('a.project-name', { hasText: 'Temi-VOC-Datasets' })).toBeVisible();

  await box.fill('LeJEPA'); // only in DALE-CT's README text
  await expect(results.locator('a.project-name', { hasText: 'DALE-CT' })).toBeVisible();

  await box.fill('zzqqxx-no-such-project');
  await expect(status).toContainText('No projects match');

  await box.fill('');
  await expect(page.locator('#catalog')).toBeVisible();

  await page.goto('projects.html?q=vllm');
  await expect(results.locator('a.project-name').first()).toHaveText('vllm');
});

// content/bounty-board
// bounties.html lists every task that is open to claim, links each to its
// GitHub issue, and shows its points; the home page links to the board.
test('content/bounty-board', async ({ page }) => {
  const id = 'content/bounty-board';
  applyBaseline(id);
  const problems = [];
  const board = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'board.json'), 'utf8'));
  await page.goto('bounties.html');
  const text = await page.locator('main').innerText();
  for (const t of board.tasks.filter((x) => x.state === 'ready')) {
    const link = page.locator(`main a[href="${t.url}"]`);
    if ((await link.count()) === 0) problems.push(`no link to ready task #${t.number}`);
    if (!text.includes(String(t.points))) problems.push(`points for #${t.number} not shown`);
  }
  if (!/href="bounties\.html"/.test(readSiteFile('index.html'))) problems.push('index.html does not link to bounties.html');
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

// content/claim-prompt
// On bounties.html, clicking a task opens a dialog (instead of GitHub) with a
// prompt a volunteer can paste into their coding agent: it names the task and
// the repository, says how to claim it, and states the rules. "Copy prompt"
// puts it on the clipboard; "Open issue on GitHub" links to the task; Escape
// closes the dialog and returns focus to the task link.
test('content/claim-prompt', async ({ browser }) => {
  const id = 'content/claim-prompt';
  applyBaseline(id);
  const board = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'board.json'), 'utf8'));
  const task = board.tasks.find((t) => t.state === 'ready');
  const context = await browser.newContext();
  const page = await context.newPage();
  // Capture "Copy prompt" instead of writing to the real (OS-wide) clipboard.
  await page.addInitScript(() => {
    // @ts-ignore test hook
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      // @ts-ignore test hook
      value: { writeText: (text) => ((window.__copied = text), Promise.resolve()) },
    });
  });
  try {
    await page.goto('bounties.html');
    const link = page.locator(`main a[href="${task.url}"]`).first();
    await link.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toContainText(`#${task.number}`);
    expect(page.url(), 'the task link must not navigate away').toMatch(/bounties\.html$/);

    const prompt = await dialog.getByRole('textbox').inputValue();
    for (const must of [`#${task.number}`, task.url, 'Kentucky-Open-Science/kentucky-open-science.github.io', '/claim', '/release', '/extend', 'AGENTS.md', 'tests/known-failures.json', 'KOS-Task:', 'npm test']) {
      expect(prompt, `prompt mentions ${must}`).toContain(must);
    }
    expect(prompt, 'every placeholder is filled').not.toMatch(/\{\{\w+\}\}/);

    await expect(dialog.getByRole('link', { name: 'Open issue on GitHub' })).toHaveAttribute('href', task.url);
    await dialog.getByRole('button', { name: 'Copy prompt' }).click();
    await expect(dialog.getByRole('status')).toContainText('copied');
    // @ts-ignore test hook
    expect(await page.evaluate(() => window.__copied)).toBe(prompt);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(link).toBeFocused();
  } finally {
    await context.close();
  }
});

// content/current-page
// The top navigation shows the current section visually (orange tab). The same
// information must be available to assistive technology (WCAG 1.3.1): exactly
// one link in the primary <nav> carries aria-current, and on the section's own
// page (index, projects, bounties, leaderboard, about) its value is "page".
test('content/current-page', async ({ page }) => {
  const id = 'content/current-page';
  applyBaseline(id);
  const problems = [];
  for (const pageName of PAGES) {
    await page.goto(pageName);
    const marked = await page.$$eval('body > nav a[aria-current]:not([aria-current="false"])', (as) =>
      as.map((a) => ({ href: a.getAttribute('href'), value: a.getAttribute('aria-current') })),
    );
    if (marked.length !== 1) {
      problems.push(`${pageName}: ${marked.length} nav links have aria-current (need exactly 1)`);
      continue;
    }
    if (!pageName.includes('/') && (marked[0].href !== pageName || marked[0].value !== 'page')) {
      problems.push(`${pageName}: aria-current is on ${marked[0].href} ("${marked[0].value}"), expected aria-current="page" on the link to ${pageName}`);
    }
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
