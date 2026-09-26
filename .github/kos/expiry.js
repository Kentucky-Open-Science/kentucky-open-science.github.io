'use strict';
// Lease-expiry sweep. Runs hourly from .github/workflows/kos-lease-expiry.yml.
//
// For every open issue labeled kos:leased:
//   - no lease marker            -> repair: start a fresh lease for the assignee (and say so)
//   - expired                    -> unassign, back to kos:ready, drop the marker, comment
//   - < warnHoursBefore left     -> one warning comment (marker.warned = true)

const lib = require('./lib');

async function expiry({ github, context, core, config = lib.CONFIG, now = new Date() }) {
  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  const L = config.labels;
  const issues = await github.paginate(github.rest.issues.listForRepo, { ...repo, state: 'open', labels: L.leased, per_page: 100 });
  const summary = { checked: 0, expired: [], warned: [], repaired: [] };

  for (const issue of issues) {
    if (issue.pull_request) continue;
    summary.checked++;
    const number = issue.number;
    const say = (body) => github.rest.issues.createComment({ ...repo, issue_number: number, body });
    let lease = lib.readMarker(issue.body, 'lease');

    if (!lease) {
      const assignee = issue.assignees && issue.assignees[0] && issue.assignees[0].login;
      if (!assignee) {
        // Leased label but nobody assigned and no marker: return it to the pool.
        await github.rest.issues.removeLabel({ ...repo, issue_number: number, name: L.leased }).catch(() => {});
        await github.rest.issues.addLabels({ ...repo, issue_number: number, labels: [L.ready] });
        await say('🔓 This task was labeled as leased but had no holder; returned to the pool.');
        summary.repaired.push(number);
        continue;
      }
      lease = lib.newLease(assignee, now, config);
      await github.rest.issues.update({ ...repo, issue_number: number, body: lib.writeMarker(issue.body, 'lease', lease) });
      await say(`🔧 Lease record was missing; started a fresh ${config.lease.hours} h lease for @${assignee} (expires ${lib.fmt(lease.expires)}).`);
      summary.repaired.push(number);
      continue;
    }

    if (lib.isExpired(lease, now)) {
      try {
        await github.rest.issues.removeAssignees({ ...repo, issue_number: number, assignees: [lease.holder] });
      } catch (e) {
        core.warning(`#${number}: could not unassign ${lease.holder}: ${e.message}`);
      }
      await github.rest.issues.removeLabel({ ...repo, issue_number: number, name: L.leased }).catch(() => {});
      await github.rest.issues.addLabels({ ...repo, issue_number: number, labels: [L.ready] });
      await github.rest.issues.update({ ...repo, issue_number: number, body: lib.writeMarker(issue.body, 'lease', null) });
      await say(
        `⌛ The lease held by @${lease.holder} expired at ${lib.fmt(lease.expires)}. ` +
          'The task is back in the pool; any unmerged work is discarded and the next claimant starts from the original snapshot. ' +
          '(If you were mid-way, you may `/claim` again if nobody else has.)',
      );
      summary.expired.push(number);
      continue;
    }

    const left = lib.hoursLeft(lease, now);
    if (!lease.warned && left <= config.lease.warnHoursBefore) {
      const updated = { ...lease, warned: true };
      await github.rest.issues.update({ ...repo, issue_number: number, body: lib.writeMarker(issue.body, 'lease', updated) });
      await say(
        `⏰ @${lease.holder} your lease expires in about ${Math.max(1, Math.round(left))} h (${lib.fmt(lease.expires)}). ` +
          `Open your PR before then, comment \`/extend\`${lease.extensions >= config.lease.maxExtensions ? ' (no extensions left)' : ''}, or \`/release\`.`,
      );
      summary.warned.push(number);
    }
  }

  if (summary.expired.length || summary.repaired.length) await lib.refreshSite({ github, context, core }, config);
  core.info(`lease sweep: checked ${summary.checked}, expired ${summary.expired.join(', ') || '-'}, warned ${summary.warned.join(', ') || '-'}, repaired ${summary.repaired.join(', ') || '-'}`);
  return summary;
}

module.exports = expiry;
