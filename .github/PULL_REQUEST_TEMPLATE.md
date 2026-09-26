<!--
KOS task-board PR. Keep every section: the acceptance gate parses this body.
If this PR is NOT for a board task, delete the "KOS-Task" line and the
Provenance section; everything else still applies.
-->

KOS-Task: #<!-- task number, e.g. 12 -->

## Summary

<!-- What changed and why, in two or three sentences. Mention anything the reviewer should look at first. -->

## Provenance

- Model(s): <!-- e.g. Claude Opus 5.5, GPT-5.2 -->
- Harness: <!-- e.g. Claude Code 2.x, Codex CLI, Cursor, by hand -->
- Approx. usage: <!-- e.g. ~2 sessions / ~400k tokens / 90 minutes wall clock -->

## Tests

<!-- Paste the FAIL_TO_PASS IDs from the task and confirm they pass. `npm test` must be green and tests/known-failures.json must have shrunk by exactly those IDs. -->

## Attestations (all required)

- [ ] I hold the lease on the task above (I commented `/claim` and am the assignee).
- [ ] A human (me) read every line of this diff before opening the PR.
- [ ] I ran `npm test` locally and it passes; I removed only the task's FAIL_TO_PASS IDs from `tests/known-failures.json`.
- [ ] This PR touches only the task's scope; no unrelated changes, no new dependencies unless the task asks for them.
- [ ] No secrets, credentials, or personal data are included.
