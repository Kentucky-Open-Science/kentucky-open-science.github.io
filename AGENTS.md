# Instructions for coding agents

This repository is the Kentucky Open Science website **and** the pilot of the
KOS task board (`docs/KOS-TASK-BOARD.md`). If you are an agent working here,
you are almost certainly completing a board task on behalf of the person who
launched you. Follow this file exactly; the acceptance gate enforces it.

## The site

- Static HTML + one stylesheet (`styles.css`). No build step, no framework. Keep it that way unless a task says otherwise.
- Pages are listed in `tests/pages.json`; adding a page means adding it there too.
- The retro late-1990s theme is intentional for now. Accessibility fixes must keep the look unless the task says to change it.

## The acceptance suite

```bash
npm ci
npx playwright install --with-deps chromium   # once
npm test                                       # the whole suite, ~40 s
```

Every test has a stable ID which is also its title:

| Prefix | Checks | Source |
| --- | --- | --- |
| `a11y/<page>/<rule>` | WCAG 2.1 A/AA axe-core rules (the ADA Title II standard) | `tests/a11y.spec.js` |
| `a11y-bp/<page>/<rule>` | axe-core best-practice rules | `tests/a11y.spec.js` |
| `html/<page>` | HTML validity (`.htmlvalidate.json`) | `tests/html.spec.js` |
| `links/<page>` | internal links resolve; no `href="#"` placeholders | `tests/site.spec.js` |
| `motion/<page>` | nothing animates under `prefers-reduced-motion: reduce` | `tests/site.spec.js` |
| `focus/<page>` | every Tab stop has a visible focus indicator | `tests/site.spec.js` |
| `reflow/<page>` | no horizontal scroll at 320 px (WCAG 1.4.10) | `tests/site.spec.js` |
| `content/*` | acceptance tests for content tasks | `tests/site.spec.js` |

`tests/known-failures.json` is the baseline of IDs that are expected to fail on
`main`. A baselined test that starts passing **fails the suite** until you
remove its ID from the file. That is deliberate:

- Remove exactly the task's `FAIL_TO_PASS` IDs from the baseline. No more, no fewer.
- Never add an ID to the baseline, with one exception: a **new page** you add to
  `tests/pages.json` inherits site-wide failures that `main` already lists for
  another page (e.g. `motion/404.html` while `motion/index.html` is baselined).
  Add exactly those inherited IDs. The gate rejects every other addition.
- Run a single ID with `npx playwright test -g "content/skip-link"`.

## Completing a board task

1. Confirm the lease. The task issue must be labeled `kos:leased` and assigned to
   your user. If not, comment `/claim` on it and wait until
   `gh issue view <n> --json assignees` shows the user — do not start work on a
   task you do not hold; the gate will reject the PR.
2. Read the task: **Scope**, **FAIL_TO_PASS**, **Human acceptance checklist**.
   Stay inside the scope. If the task is ambiguous, stop and ask the human.
3. Branch from the current `main`: `git switch -c kos/<n>-<slug>`.
4. Implement. Run `npm test` until green. Remove the FAIL_TO_PASS IDs from
   `tests/known-failures.json`.
5. Prepare the PR body from `.github/PULL_REQUEST_TEMPLATE.md`: `KOS-Task: #<n>`,
   a summary, the provenance fields (**model**, **harness**, **approx. usage**),
   the test IDs, and the attestation checklist. Leave the attestations
   **unchecked** and hand the diff to the human: only they may tick the boxes
   and open the PR.
6. Never commit `node_modules/`, `reports/`, or `test-results/`. Never add a
   dependency unless the task asks for it. Never touch `data/leaderboard.json`
   or `leaderboard.html` by hand (they are generated) except when a task tells
   you to run `npm run leaderboard`.

## Useful commands

```bash
gh issue list --label kos:ready                      # claimable tasks
gh issue view <n>                                    # read a task
gh issue comment <n> --body "/claim"                 # claim it
npx playwright test -g "a11y/index.html"             # one page's axe checks
npx playwright test -g "content/"                    # content acceptance tests
npm run test:board                                   # unit tests for the board bots
```
