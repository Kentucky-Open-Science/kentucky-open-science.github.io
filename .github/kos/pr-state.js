'use strict';
// Task state transitions driven by pull requests. Runs from
// .github/workflows/kos-pr-state.yml on `pull_request_target` — which has write
// permissions — so this file must NEVER execute anything from the PR branch.
// It only reads PR metadata from the event payload and calls the API.
//
//   PR opened/reopened/edited by the lease holder, linked to a leased task
//       -> task becomes kos:submitted (lease clock stops)
//   PR merged                                  -> kos:accepted, points awarded, issue closed
//   PR closed without merge                    -> task returns to kos:leased with a fresh lease

const lib = require('./lib');

async function prState({ github, context, core, config = lib.CONFIG, now = new Date() }) {
  const pr = context.payload.pull_request;
  const action = context.payload.action;
  if (!pr) return { handled: false, reason: 'no pull_request in payload' };

  const taskNumber = lib.parseTaskRef(pr.body);
  if (!taskNumber) return { handled: false, reason: 'PR does not reference a task' };

  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  const L = config.labels;
  const author = pr.user.login;

  let issue;
  try {
    issue = (await github.rest.issues.get({ ...repo, issue_number: taskNumber })).data;
  } catch (e) {
    core.warning(`#${taskNumber} not found: ${e.message}`);
    return { handled: false, reason: 'task not found' };
  }
  if (issue.pull_request || !lib.isTask(issue.labels, config)) return { handled: false, reason: 'referenced issue is not a task' };

  const state = lib.stateOf(issue.labels, config);
  const lease = lib.readMarker(issue.body, 'lease');
  const holder = lease ? lease.holder : null;
  const sayIssue = (body) => github.rest.issues.createComment({ ...repo, issue_number: taskNumber, body });
  const sayPR = (body) => github.rest.issues.createComment({ ...repo, issue_number: pr.number, body });
  const swap = async (from, to) => {
    for (const f of [].concat(from)) await github.rest.issues.removeLabel({ ...repo, issue_number: taskNumber, name: f }).catch(() => {});
    await github.rest.issues.addLabels({ ...repo, issue_number: taskNumber, labels: [to] });
  };

  // ----- opened / reopened / edited -----------------------------------------
  if (action === 'opened' || action === 'reopened' || action === 'edited' || action === 'ready_for_review') {
    if (state === 'accepted') return { handled: false, reason: 'task already accepted' };
    if (holder !== author) {
      if (action === 'opened') {
        await sayPR(
          `This PR references task #${taskNumber}, but the lease is held by ${holder ? `@${holder}` : 'nobody'}. ` +
            `Comment \`/claim\` on #${taskNumber} first (one lease per person), then re-open or edit this PR. ` +
            'The acceptance gate will not pass until the PR author holds the lease.',
        );
      }
      return { handled: true, ok: false, reason: 'author is not the lease holder' };
    }
    if (state === 'leased') {
      await swap(L.leased, L.submitted);
      await github.rest.issues.update({ ...repo, issue_number: taskNumber, body: lib.writeMarker(issue.body, 'lease', { ...lease, pr: pr.number, submitted: new Date(now).toISOString() }) });
      await sayIssue(`📬 @${author} submitted #${pr.number} for review. The lease clock is paused while the PR is open.`);
      await lib.refreshSite({ github, context, core }, config);
      return { handled: true, ok: true, transition: 'leased->submitted' };
    }
    return { handled: true, ok: true, transition: 'none', state };
  }

  // ----- closed --------------------------------------------------------------
  if (action === 'closed') {
    if (pr.merged) {
      if (holder && holder !== author) {
        await sayIssue(`⚠️ #${pr.number} by @${author} was merged, but the lease was held by @${holder}. A maintainer should reconcile credit manually.`);
      }
      const size = lib.sizeOf(issue.labels, config);
      const points = lib.pointsFor(size, config);
      let reviewers = [];
      try {
        const reviews = await github.paginate(github.rest.pulls.listReviews, { ...repo, pull_number: pr.number, per_page: 100 });
        reviewers = [...new Set(reviews.filter((r) => r.state === 'APPROVED' && r.user && r.user.login !== author).map((r) => r.user.login))];
      } catch (e) {
        core.warning(`could not list reviews for #${pr.number}: ${e.message}`);
      }
      const accepted = {
        pr: pr.number,
        solver: author,
        mergedBy: (pr.merged_by && pr.merged_by.login) || null,
        mergedAt: pr.merged_at || new Date(now).toISOString(),
        size: size || null,
        points,
        reviewers,
        reviewerPoints: Math.round(points * config.points.reviewerShare),
      };
      const body = lib.writeMarker(lib.writeMarker(issue.body, 'lease', null), 'accepted', accepted);
      await swap([L.leased, L.submitted, L.ready], L.accepted);
      await github.rest.issues.update({ ...repo, issue_number: taskNumber, body, state: 'closed', state_reason: 'completed' });
      const reviewerNote = reviewers.length ? ` Reviewer credit (+${accepted.reviewerPoints} each): ${reviewers.map((r) => '@' + r).join(', ')}.` : '';
      await sayIssue(`🏆 Accepted via #${pr.number}. **+${points} points** to @${author} (size ${size || 'unspecified'}).${reviewerNote} The leaderboard updates within a few minutes.`);
      // Rebuild the bounty board and leaderboard now rather than waiting for the nightly run.
      await lib.refreshSite({ github, context, core }, config);
      return { handled: true, ok: true, transition: `${state}->accepted`, accepted };
    }
    // Closed without merge.
    if (state === 'submitted' && holder === author) {
      const fresh = { ...lib.newLease(author, now, config), extensions: lease ? lease.extensions : 0 };
      await swap(L.submitted, L.leased);
      await github.rest.issues.update({ ...repo, issue_number: taskNumber, body: lib.writeMarker(issue.body, 'lease', fresh) });
      await lib.refreshSite({ github, context, core }, config);
      await sayIssue(`↩️ #${pr.number} was closed without merging. @${author} still holds the lease; a fresh ${config.lease.hours} h clock started (expires ${lib.fmt(fresh.expires)}). Open a new PR, or \`/release\`.`);
      return { handled: true, ok: true, transition: 'submitted->leased' };
    }
    return { handled: true, ok: true, transition: 'none', state };
  }

  return { handled: false, reason: `unhandled action ${action}` };
}

module.exports = prState;
