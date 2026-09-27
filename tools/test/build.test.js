'use strict';
// Unit tests for the site builder: README handling, templating, the files for
// crawlers and agents, and a full build from the test fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { summarize, githubSlug } = require('../markdown');
const { render, esc, frontMatter } = require('../template');
const { robotsTxt, sitemapXml, llmsTxt } = require('../../src/templates/crawlers');

const ROOT = path.resolve(__dirname, '..', '..');

test('README summary skips the title, badges, code, and tables', () => {
  const md = [
    '# my-project',
    '',
    '[![CI](https://x/badge.svg)](https://x) ![logo](logo.png)',
    '',
    'A **fast** tool for [reading](https://example.org) whole-slide images.',
    '',
    '```bash',
    'pip install secret-sauce',
    '```',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '## Getting started',
    '',
    'Run `make` and wait for the build to finish completely.',
  ].join('\n');
  const s = summarize(md);
  assert.deepEqual(s.summary, ['A fast tool for reading whole-slide images.', 'Run make and wait for the build to finish completely.']);
  assert.deepEqual(s.headings, [{ level: 2, text: 'Getting started', anchor: 'getting-started' }]);
  assert.ok(!s.text.includes('secret-sauce'), 'code blocks are not indexed');
});

test('README tags and comments cannot re-form after stripping', () => {
  const s = summarize('Split tags <scr<b>ipt>like this</script> and <!<!-- -->-- hidden --> comments are removed from the summary text.');
  assert.ok(!/<script|<!--/i.test(s.text), s.text);
  assert.ok(!s.text.includes('hidden'), s.text);
});

test('GitHub heading anchors, including duplicates', () => {
  const seen = new Map();
  assert.equal(githubSlug('🚀 Quick Start!', seen), '-quick-start');
  assert.equal(githubSlug('Usage', seen), 'usage');
  assert.equal(githubSlug('Usage', seen), 'usage-1');
});

test('templates escape values, braces included, and never re-render inserted text', () => {
  assert.equal(esc('<a href="x">{{y}}</a>'), '&lt;a href=&quot;x&quot;&gt;&#123;&#123;y&#125;&#125;&lt;/a&gt;');
  const out = render('{{{body}}} {{title}}', { body: '{{title}}', title: '<T>' }, os.tmpdir());
  assert.equal(out, '{{title}} &lt;T&gt;');
  assert.throws(() => render('{{missing}}', {}, os.tmpdir()), /no value for missing/);
});

test('front matter', () => {
  const { meta, body } = frontMatter('---\ntitle: About\nnav: about\n---\n<p>hi</p>\n');
  assert.deepEqual(meta, { title: 'About', nav: 'about' });
  assert.equal(body, '<p>hi</p>\n');
});

test('llms.txt lists only tasks open to claim, in order, with link text that cannot break', () => {
  const site = { siteTitle: 'Kentucky Open Science', org: 'Kentucky-Open-Science', repo: 'o/r', siteUrl: 'https://example.org/' };
  const task = (number, state, title, points = 10) => ({ number, state, title, url: `https://github.com/o/r/issues/${number}`, size: 'S', points });
  const md = llmsTxt({ site, board: { tasks: [task(9, 'ready', '[Task] Fix [the] a\\b link'), task(3, 'ready', '[Task] First', 1), task(5, 'leased', '[Task] Taken')] } });
  assert.match(md, /^# Kentucky Open Science\n\n> /);
  assert.deepEqual(
    md.split('\n').filter((l) => l.startsWith('- [#')),
    ['- [#3 First](https://github.com/o/r/issues/3): size S, 1 point', '- [#9 Fix \\[the\\] a\\\\b link](https://github.com/o/r/issues/9): size S, 10 points'],
  );
  assert.match(llmsTxt({ site, board: { tasks: [] } }), /^- None right now\. New tasks appear on the \[bounty board\]\(https:\/\/example\.org\/bounties\.html\)\.$/m);
});

test('robots.txt and sitemap.xml use absolute URLs; the sitemap starts at the root and skips 404.html', () => {
  const site = { siteTitle: 'KOS', siteUrl: 'https://example.org' }; // no trailing slash on purpose
  assert.match(robotsTxt(site), /^Sitemap: https:\/\/example\.org\/sitemap\.xml$/m);
  const xml = sitemapXml(site, ['about.html', 'index.html', '404.html', 'projects/a b&c.html']);
  assert.deepEqual(
    [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]),
    ['https://example.org/', 'https://example.org/about.html', 'https://example.org/projects/a%20b%26c.html'],
  );
});

test('a full build from the fixtures produces every page and a search index', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kos-site-'));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.js'), '--data', 'tests/fixtures', '--out', out, '--quiet'], { cwd: ROOT });
    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'projects.json'), 'utf8'));
    for (const page of ['index.html', 'projects.html', 'bounties.html', 'leaderboard.html', 'about.html', 'styles.css', 'search.js', 'robots.txt', 'sitemap.xml', 'llms.txt']) {
      assert.ok(fs.existsSync(path.join(out, page)), page);
    }
    for (const p of fixture.projects) assert.ok(fs.existsSync(path.join(out, 'projects', `${p.name}.html`)), p.name);
    const index = JSON.parse(fs.readFileSync(path.join(out, 'search-index.json'), 'utf8'));
    assert.equal(index.projects.length, fixture.projects.length);
    const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(home, /<title>Wiki home &mdash; Kentucky Open Science<\/title>/);
    assert.ok(!/\{\{/.test(home), 'no unrendered template tokens');

    // The bounty board embeds the claim prompt and every open task for src/claim.js.
    const bounties = fs.readFileSync(path.join(out, 'bounties.html'), 'utf8');
    const block = bounties.match(/<script type="application\/json" id="claim-data">([\s\S]*?)<\/script>/);
    assert.ok(block, 'claim-data block');
    assert.ok(!block[1].includes('<'), 'no raw "<" inside the JSON block');
    const claim = JSON.parse(block[1]);
    const board = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'board.json'), 'utf8'));
    assert.deepEqual(Object.keys(claim.tasks).map(Number).sort((a, b) => a - b), board.tasks.map((t) => t.number).sort((a, b) => a - b));
    assert.match(claim.prompt, /\/claim/);
    for (const t of board.tasks) assert.ok(bounties.includes(`data-task="${t.number}"`), `task link #${t.number}`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
