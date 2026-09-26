#!/usr/bin/env node
'use strict';
// Refresh data/projects.json from the GitHub API: every PUBLIC repository in
// the organization, with its languages, README summary, latest release, and
// top contributors. The site builder (tools/build.js) turns that file into the
// wiki pages.
//
//   GITHUB_TOKEN=... node tools/fetch-projects.js [--org Kentucky-Open-Science]
//
// A token is optional but strongly recommended (the unauthenticated API allows
// 60 requests an hour; one refresh makes ~4 per repository).
//
// PRIVACY: this must only ever publish public repositories. The listing asks
// for type=public AND every entry is re-checked below, so running it with a
// token that can see private repositories is still safe. tests/site.spec.js
// (content/no-private-repos) enforces the same rule on the committed data.

const fs = require('node:fs');
const path = require('node:path');
const { summarize } = require('./markdown');

const ROOT = path.resolve(__dirname, '..');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'site.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const ORG = opt('--org', SITE.org);
const OUT = path.join(ROOT, opt('--out', 'data/projects.json'));
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const API = 'https://api.github.com';

async function request(url, accept = 'application/vnd.github+json') {
  const headers = { Accept: accept, 'User-Agent': 'kos-wiki-builder', 'X-GitHub-Api-Version': '2022-11-28' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 404 || res.status === 204 || res.status === 409) return { res, body: null };
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 3) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt * 2;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = accept.includes('raw') ? await res.text() : await res.json();
    return { res, body };
  }
}

async function paginate(url) {
  const out = [];
  let next = url;
  while (next) {
    const { res, body } = await request(next);
    if (!body) break;
    out.push(...body);
    const m = (res.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/);
    next = m ? m[1] : null;
  }
  return out;
}

/** Run fn over items with at most `n` in flight. */
async function pool(items, n, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        results[k] = await fn(items[k], k);
      }
    }),
  );
  return results;
}

function isPublic(r) {
  return r && r.private === false && (r.visibility === undefined || r.visibility === 'public');
}

async function describe(r) {
  const base = `${API}/repos/${r.full_name}`;
  const [languages, readme, release, contributors, detail] = await Promise.all([
    request(`${base}/languages`).then((x) => x.body || {}),
    request(`${base}/readme`, 'application/vnd.github.raw+json').then((x) => x.body),
    request(`${base}/releases/latest`).then((x) => x.body),
    request(`${base}/contributors?per_page=12`).then((x) => x.body || []).catch(() => []),
    r.fork ? request(base).then((x) => x.body) : Promise.resolve(null),
  ]);
  const langTotal = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
  const readmeInfo = typeof readme === 'string' && readme.trim() ? summarize(readme) : null;
  const parent = detail && detail.parent && isPublic(detail.parent)
    ? { fullName: detail.parent.full_name, url: detail.parent.html_url, description: detail.parent.description || '' }
    : null;
  return {
    name: r.name,
    fullName: r.full_name,
    visibility: r.visibility || (r.private ? 'private' : 'public'),
    url: r.html_url,
    description: (r.description || '').trim(),
    homepage: (r.homepage || '').trim(),
    topics: [...(r.topics || [])].sort(),
    language: r.language || null,
    languages: Object.entries(languages)
      .sort((a, b) => b[1] - a[1])
      .map(([name, bytes]) => ({ name, percent: Math.round((bytes / langTotal) * 1000) / 10 }))
      .filter((l) => l.percent >= 0.1),
    license: r.license && r.license.spdx_id && r.license.spdx_id !== 'NOASSERTION'
      ? { spdx: r.license.spdx_id, name: r.license.name }
      : r.license ? { spdx: null, name: r.license.name || 'Other' } : null,
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    hasIssues: !!r.has_issues,
    archived: !!r.archived,
    fork: !!r.fork,
    isTemplate: !!r.is_template,
    parent,
    defaultBranch: r.default_branch,
    createdAt: r.created_at,
    pushedAt: r.pushed_at,
    sizeKb: r.size,
    readme: readmeInfo
      ? { url: `${r.html_url}#readme`, summary: readmeInfo.summary, headings: readmeInfo.headings, text: readmeInfo.text }
      : null,
    release: release && !release.draft
      ? { name: release.name || release.tag_name, tag: release.tag_name, url: release.html_url, publishedAt: release.published_at }
      : null,
    contributors: (Array.isArray(contributors) ? contributors : [])
      .filter((c) => c && c.type !== 'Bot' && !/\[bot\]$/.test(c.login || ''))
      .slice(0, 10)
      .map((c) => ({ login: c.login, url: c.html_url, contributions: c.contributions })),
  };
}

async function main() {
  console.log(`org: ${ORG}${TOKEN ? '' : ' (no token: expect rate limits)'}`);
  const listed = await paginate(`${API}/orgs/${ORG}/repos?type=public&per_page=100&sort=full_name`);
  const repos = listed.filter(isPublic);
  const dropped = listed.length - repos.length;
  if (dropped) console.warn(`dropped ${dropped} non-public repositor${dropped === 1 ? 'y' : 'ies'} from the listing`);
  const projects = await pool(repos, 6, describe);
  projects.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const org = (await request(`${API}/orgs/${ORG}`)).body || {};
  const data = {
    generated: new Date().toISOString(),
    org: { login: ORG, name: org.name || ORG, url: org.html_url || `https://github.com/${ORG}`, description: org.description || '', publicRepos: projects.length },
    projects,
  };

  // Keep the old timestamp when nothing else changed so scheduled refreshes do
  // not produce empty commits.
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const strip = (d) => JSON.stringify({ ...d, generated: null });
    if (strip(prev) === strip(data)) data.generated = prev.generated;
  } catch {
    /* first run */
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log(`projects: ${projects.length} public (${projects.filter((p) => p.fork).length} forks, ${projects.filter((p) => p.archived).length} archived) -> ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

module.exports = { isPublic, describe };
