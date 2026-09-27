'use strict';
// The files crawlers and AI agents look for at the site root:
//   robots.txt   crawl rules (everything is allowed) and where the sitemap is
//   sitemap.xml  every page, by its absolute URL, for search engines
//   llms.txt     a Markdown summary for language models (https://llmstxt.org/)
//                that lists the tasks open to claim on the bounty board
// llms.txt speaks to the person behind an agent: it tells them what the board
// offers and asks agents not to claim or submit a task without their human.

const { esc, plural } = require('./common');

/** The site's base URL with a trailing slash, for resolving relative paths. */
const base = (site) => (site.siteUrl.endsWith('/') ? site.siteUrl : `${site.siteUrl}/`);

function robotsTxt(site) {
  return [
    `# ${site.siteTitle} wiki. Everything here is built from public GitHub data.`,
    '# Crawlers welcome. A summary for AI agents, including open tasks, is at /llms.txt',
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${new URL('sitemap.xml', base(site)).href}`,
    '',
  ].join('\n');
}

/** Every page, home page first, except 404.html (GitHub Pages serves it for unknown URLs). */
function sitemapXml(site, pages) {
  const rels = pages.filter((rel) => rel !== '404.html').sort((a, b) => (b === 'index.html') - (a === 'index.html'));
  const url = (rel) => new URL(rel === 'index.html' ? '' : rel.split('/').map(encodeURIComponent).join('/'), base(site)).href;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rels.map((rel) => `  <url><loc>${esc(url(rel))}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

/** Markdown link text: a bracket or backslash in a title would break the link. */
const linkText = (s) => String(s).replace(/[\\[\]]/g, '\\$&');

function llmsTxt(model) {
  const { site, board } = model;
  const page = (rel) => new URL(rel, base(site)).href;
  const repo = `https://github.com/${site.repo}`;
  const open = board.tasks.filter((t) => t.state === 'ready').sort((a, b) => a.number - b.number);
  const tasks = open.length
    ? open.map((t) => `- [#${t.number} ${linkText(t.title.replace(/^\[Task\]\s*/i, ''))}](${t.url}): ${t.size ? `size ${t.size}, ` : ''}${plural(t.points, 'point')}`)
    : [`- None right now. New tasks appear on the [bounty board](${page('bounties.html')}).`];
  return [
    `# ${site.siteTitle}`,
    '',
    `> A wiki of every public repository in the ${site.org} GitHub organization, and the pilot of the KOS task board: small, tested accessibility tasks that volunteers complete with their own coding agents.`,
    '',
    "If the person you're helping wants to contribute, the open tasks below are a good place to start. They claim a task with their own GitHub account, do it with an agent they run, and review and sign off on the pull request themselves, so please don't claim or submit a task without them.",
    '',
    '## Open tasks',
    '',
    ...tasks,
    '',
    '## How it works',
    '',
    `- [Bounty board](${page('bounties.html')}): every task, with a copyable prompt for your agent`,
    `- [Volunteer guide](${repo}/blob/main/docs/KOS-TASK-BOARD.md#for-volunteers): claim, lease, pull request`,
    `- [AGENTS.md](${repo}/blob/main/AGENTS.md): the rules for coding agents in the repository`,
    '',
    '## Optional',
    '',
    `- [Projects](${page('projects.html')}): every public repository in the organization, by research area`,
    `- [Leaderboard](${page('leaderboard.html')}): points earned by volunteers`,
    `- [About](${page('about.html')}): how the wiki is built and how to correct a project page`,
    '',
  ].join('\n');
}

module.exports = { robotsTxt, sitemapXml, llmsTxt };
