# Kentucky Open Science — site and task board

This repository is two things:

1. **The KOS website** at [kentucky-open-science.github.io](https://kentucky-open-science.github.io/) — plain HTML and one stylesheet, published by GitHub Pages from `main`.
2. **The pilot of the KOS task board** — a way for organizations to post small, testable programming tasks and for volunteers to complete them with the AI-agent hours they would otherwise lose at the end of the week. The board is this repository's issues; the rules are in [docs/KOS-TASK-BOARD.md](docs/KOS-TASK-BOARD.md); the running score is on the [leaderboard](https://kentucky-open-science.github.io/leaderboard.html).

The site itself is the first customer: it is being brought to WCAG 2.1 AA (the standard adopted by the ADA Title II web rule) one task at a time, in public.

## Run the checks

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

`npm test` runs the acceptance suite in `tests/`: WCAG 2.1 A/AA checks (axe-core) for every page, HTML validity, internal links, reduced-motion behaviour, focus visibility, reflow at 320 px, and the content checks that back the board's content tasks. Every test has a stable ID; `tests/known-failures.json` lists the ones that are expected to fail today, and shrinks as tasks are completed.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run serve` | Serve the site locally at http://127.0.0.1:4173/ |
| `npm run report` | Turn the last run's `reports/playwright.json` into `reports/kos-results.json` (what the PR gate reads) |
| `npm run baseline` | Regenerate `tests/known-failures.json` from the last run (maintainers only) |
| `npm run leaderboard` | Re-render `leaderboard.html` from `data/leaderboard.json` |
| `npm run test:board` | Unit tests for the task-board bots in `.github/kos/` |

## Claim a task

Open the [claimable tasks](https://github.com/Kentucky-Open-Science/kentucky-open-science.github.io/issues?q=is%3Aissue+is%3Aopen+label%3Akos%3Aready), comment `/claim`, and follow [the volunteer guide](docs/KOS-TASK-BOARD.md#for-volunteers). Coding agents get their instructions from [AGENTS.md](AGENTS.md).

## Submit a task

Use the **KOS task** issue template. A task needs a problem statement, a scope, and the IDs of tests that fail now and must pass when it is done. If no test exists yet, that is the first thing to write.

## Layout

```
*.html, styles.css        the site
tests/                    acceptance suite (Playwright + axe-core + html-validate) and the baseline
.github/ISSUE_TEMPLATE/   the task form
.github/PULL_REQUEST_TEMPLATE.md
.github/workflows/        board commands, lease expiry, PR state, acceptance gate, leaderboard
.github/kos/              the bots' logic (plain Node, unit-tested), config, seed tasks, bootstrap
docs/KOS-TASK-BOARD.md    the protocol
data/leaderboard.json     generated
leaderboard.html          generated
```
