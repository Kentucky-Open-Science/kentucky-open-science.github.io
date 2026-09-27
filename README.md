# Kentucky Open Science — wiki and task board

This repository is two things:

1. **The KOS wiki** at [kentucky-open-science.github.io](https://kentucky-open-science.github.io/): a searchable page for every public repository in the [Kentucky-Open-Science](https://github.com/Kentucky-Open-Science) organization, generated from GitHub data and rebuilt every night.
2. **The pilot of the KOS task board**: organizations post small, testable programming tasks, and volunteers complete them with the AI-agent hours they would otherwise lose at the end of the week. The board is this repository's issues; the rules are in [docs/KOS-TASK-BOARD.md](docs/KOS-TASK-BOARD.md); open tasks are on the [bounty board](https://kentucky-open-science.github.io/bounties.html) and the score is on the [leaderboard](https://kentucky-open-science.github.io/leaderboard.html).

The site is the board's first customer: it is being brought to WCAG 2.1 AA (the standard adopted by the ADA Title II web rule) one claimed task at a time, in public. The retro 1990s look is deliberate and stays; the accessibility problems that come with it are the tasks.

## How the site is built

```
data/projects.json   public repositories      <- tools/fetch-projects.js (GitHub API, public repos only)
data/board.json      tasks + leaderboard      <- .github/kos/leaderboard.js (this repo's issues)
src/                 layout, pages, templates, styles, search
        |
        v  tools/build.js (no dependencies, no network)
_site/               the published site (not committed)
```

The **KOS site** workflow refreshes both data files, builds, and deploys to GitHub Pages on every push to `main`, nightly, and whenever a task changes state. The nightly run commits the refreshed data so the repository records what was published.

Only public repositories are ever read or published: the fetcher asks GitHub for public repositories and re-checks every entry, and the test suite fails if the committed data contains anything else (`content/no-private-repos`).

To fix what a project page says, change the repository on GitHub (its description, topics, or README). Research areas are assigned from GitHub topics; the mapping is in `src/site.json`.

## Run it locally

```bash
npm ci
npm run build        # _site/ from the committed data
npm run serve        # build, then serve at http://127.0.0.1:4173/
npm run fetch        # refresh data/ from GitHub (set GITHUB_TOKEN to avoid rate limits)
```

## Run the checks

```bash
npx playwright install --with-deps chromium   # once
npm test             # acceptance suite: WCAG 2.1 A/AA, HTML validity, links, motion, reflow, content
npm run test:unit    # board bots and site builder
```

`npm test` builds the site into `_site-test/` from **frozen fixtures** in `tests/fixtures/`, not from the nightly data, so test results change only when the site's code changes. Every test has a stable ID; `tests/known-failures.json` lists the ones expected to fail today, and it shrinks as tasks are completed.

| Command | What it does |
| --- | --- |
| `npm run report` | Turn the last run's `reports/playwright.json` into `reports/kos-results.json` (what the PR gate reads) |
| `npm run baseline` | Regenerate `tests/known-failures.json` from the last run (maintainers only) |
| `node tools/make-fixture.js` | Re-freeze `tests/fixtures/projects.json` from `data/` (maintainers only; regenerate the baseline with it) |

## Claim a task

Open the [bounty board](https://kentucky-open-science.github.io/bounties.html) or the [claimable issues](https://github.com/Kentucky-Open-Science/kentucky-open-science.github.io/issues?q=is%3Aissue+is%3Aopen+label%3Akos%3Aready), comment `/claim`, and follow [the volunteer guide](docs/KOS-TASK-BOARD.md#for-volunteers). Coding agents get their instructions from [AGENTS.md](AGENTS.md).

## Submit a task

Use the **KOS task** issue template. A task needs a problem statement, a scope, and the IDs of tests that fail now and must pass when it is done. If no test exists yet, that is the first thing to write.

## Layout

```
src/layout.html            page shell: head, banner, navigation, footer (every page)
src/pages/*.html           hand-written pages (home, about)
src/templates/*.js         data-driven pages (project directory, project pages, bounty board, leaderboard)
src/templates/crawlers.js  robots.txt, sitemap.xml, and llms.txt (open tasks, for AI agents)
src/styles.css, search.js  the stylesheet and the project search
src/claim.js               the bounty board's task dialog (copyable agent prompt)
src/claim-prompt.txt       the wording of that prompt; {{placeholders}} are filled per task
src/site.json              navigation, research areas, site settings
tools/                     build.js, fetch-projects.js, markdown.js, template.js
data/                      nightly snapshots (generated; do not edit by hand)
tests/                     acceptance suite, fixtures, and the known-failures baseline
.github/workflows/         site build/deploy, board commands, lease expiry, PR state, acceptance gate
.github/kos/               the board bots (plain Node, unit-tested), config, seed tasks, bootstrap
docs/KOS-TASK-BOARD.md     the protocol
```
