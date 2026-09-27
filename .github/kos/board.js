'use strict';
// Slash-command handler for task issues. Runs from .github/workflows/kos-board.yml
// on every new issue comment, via actions/github-script.
//
//   /claim    lease this task (one lease per person at a time)
//   /release  give the lease back early (holder or maintainer)
//   /extend   add another lease period (holder; limited by config.lease.maxExtensions)
//   /status   print the task state
//
// State machine (labels are the source of truth; the lease marker holds timing):
//   triage -> ready -> leased -> submitted -> accepted
//                ^        |          |
//                +--------+----------+   (release / expiry / PR closed unmerged)

const lib = require('./lib');

async function board({ github, context, core, config = lib.CONFIG, now = new Date() }) {
  const payload = context.payload;
  const issue = payload.issue;
  const comment = payload.comment;
  if (!issue || !comment || issue.pull_request) return { handled: false, reason: 'not an issue comment' };
  if (comment.user && comment.user.type === 'Bot') return { handled: false, reason: 'bot comment' };

  const cmd = lib.parseCommand(comment.body);
  if (!cmd) {
    // Say so when a shell mangled the command, instead of staying silent.
    const meant = lib.parseMangledCommand(comment.body);
    if (!meant || !lib.isTask(issue.labels, config)) return { handled: false, reason: 'no command' };
    const where = `${context.repo.owner}/${context.repo.repo}`;
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issue.number,
      body: [
        `@${comment.user.login} that looks like \`/${meant}\` after your shell turned it into a file path (Git Bash on Windows does this to arguments that start with \`/\`), so nothing happened. Post it again with:`,
        '',
        '```',
        `echo /${meant} | gh issue comment ${issue.number} --repo ${where} --body-file -`,
        '```',
        '',
        `or type \`/${meant}\` in a comment here on GitHub.`,
      ].join('\n'),
    });
    return { handled: true, cmd: meant, ok: false, reason: 'command mangled by the shell' };
  }
  if (!lib.isTask(issue.labels, config)) return { handled: false, reason: 'not a task' };

  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  const number = issue.number;
  const actor = comment.user.login;
  const L = config.labels;

  const say = (body) => github.rest.issues.createComment({ ...repo, issue_number: number, body });
  const addLabel = (name) => github.rest.issues.addLabels({ ...repo, issue_number: number, labels: [name] });
  const removeLabel = async (name) => {
    try {
      await github.rest.issues.removeLabel({ ...repo, issue_number: number, name });
      return true;
    } catch (e) {
      if (e && e.status === 404) return false; // already gone
      throw e;
    }
  };
  const setBody = (body) => github.rest.issues.update({ ...repo, issue_number: number, body });

  // Always re-read the issue: the payload can be stale when comments arrive quickly.
  const fresh = (await github.rest.issues.get({ ...repo, issue_number: number })).data;
  const state = lib.stateOf(fresh.labels, config);
  const lease = lib.readMarker(fresh.body, 'lease');
  const holder = lease ? lease.holder : (fresh.assignees && fresh.assignees[0] && fresh.assignees[0].login) || null;

  async function isMaintainer(login) {
    try {
      const r = await github.rest.repos.getCollaboratorPermissionLevel({ ...repo, username: login });
      return ['admin', 'write', 'maintain'].includes(r.data.permission);
    } catch {
      return false;
    }
  }

  if (cmd === 'status') {
    const lines = [`**State:** \`${state || 'untracked'}\``];
    if (lease) lines.push(`**Lease:** @${lease.holder}, expires ${lib.fmt(lease.expires)} (${Math.max(0, lib.hoursLeft(lease, now)).toFixed(1)} h left, ${lease.extensions} extension(s) used)`);
    await say(lines.join('\n'));
    return { handled: true, cmd, state };
  }

  if (cmd === 'claim') {
    if (state !== 'ready') {
      await say(`@${actor} this task is not claimable right now (state: \`${state || 'untracked'}\`${holder ? `, held by @${holder}` : ''}).`);
      return { handled: true, cmd, ok: false, reason: 'not ready' };
    }
    // One lease per person at a time.
    const mine = await github.paginate(github.rest.issues.listForRepo, { ...repo, state: 'open', labels: L.leased, assignee: actor, per_page: 100 });
    const held = mine.filter((i) => !i.pull_request && i.number !== number);
    if (held.length) {
      await say(`@${actor} you already hold a lease on #${held[0].number}. Finish it, or comment \`/release\` there first — one task at a time.`);
      return { handled: true, cmd, ok: false, reason: 'already holds a lease' };
    }
    // Compare-and-swap on the ready label: whoever removes it first wins.
    const won = await removeLabel(L.ready);
    if (!won) {
      await say(`@${actor} someone else claimed this task a moment ago.`);
      return { handled: true, cmd, ok: false, reason: 'lost race' };
    }
    const newLease = lib.newLease(actor, now, config);
    try {
      await github.rest.issues.addAssignees({ ...repo, issue_number: number, assignees: [actor] });
    } catch (e) {
      // Roll back so the task does not get stuck half-claimed.
      await addLabel(L.ready);
      await say(`@${actor} GitHub would not let me assign you (${e.message}). The task is still open; a maintainer can assign you by hand.`);
      return { handled: true, cmd, ok: false, reason: 'not assignable' };
    }
    await addLabel(L.leased);
    await setBody(lib.writeMarker(fresh.body, 'lease', newLease));
    await say(
      [
        `🔒 Leased to @${actor} until **${lib.fmt(newLease.expires)}** (${config.lease.hours} h).`,
        '',
        `- Work on a branch, run \`npm test\`, and open a PR whose body contains \`KOS-Task: #${number}\` and the filled-in provenance section.`,
        `- Comment \`/extend\` for another ${config.lease.hours} h (max ${config.lease.maxExtensions}), or \`/release\` to give the task back.`,
        `- If the lease expires the task returns to the pool and unmerged work is discarded; the next claimant starts from the original snapshot.`,
      ].join('\n'),
    );
    await lib.refreshSite({ github, context, core }, config);
    return { handled: true, cmd, ok: true, lease: newLease };
  }

  if (cmd === 'release') {
    if (state !== 'leased' && state !== 'submitted') {
      await say(`@${actor} nothing to release (state: \`${state || 'untracked'}\`).`);
      return { handled: true, cmd, ok: false, reason: 'not leased' };
    }
    if (actor !== holder && !(await isMaintainer(actor))) {
      await say(`@${actor} only the lease holder (@${holder}) or a maintainer can release this task.`);
      return { handled: true, cmd, ok: false, reason: 'not holder' };
    }
    if (holder) {
      try {
        await github.rest.issues.removeAssignees({ ...repo, issue_number: number, assignees: [holder] });
      } catch (e) {
        core.warning(`could not unassign ${holder}: ${e.message}`);
      }
    }
    await removeLabel(L.leased);
    await removeLabel(L.submitted);
    await addLabel(L.ready);
    await setBody(lib.writeMarker(fresh.body, 'lease', null));
    await say(`🔓 Released by @${actor}. The task is open for a new \`/claim\`.`);
    await lib.refreshSite({ github, context, core }, config);
    return { handled: true, cmd, ok: true };
  }

  if (cmd === 'extend') {
    if (state !== 'leased' || !lease) {
      await say(`@${actor} there is no active lease to extend (state: \`${state || 'untracked'}\`).`);
      return { handled: true, cmd, ok: false, reason: 'not leased' };
    }
    if (actor !== holder) {
      await say(`@${actor} only the lease holder (@${holder}) can extend.`);
      return { handled: true, cmd, ok: false, reason: 'not holder' };
    }
    if (lease.extensions >= config.lease.maxExtensions) {
      await say(`@${actor} this lease has already been extended ${lease.extensions} time(s), the maximum. Open a PR with what you have, or \`/release\`.`);
      return { handled: true, cmd, ok: false, reason: 'max extensions' };
    }
    const updated = { ...lease, expires: lib.addHours(lease.expires, config.lease.hours), extensions: lease.extensions + 1, warned: false };
    await setBody(lib.writeMarker(fresh.body, 'lease', updated));
    await say(`⏱️ Extended. New expiry: **${lib.fmt(updated.expires)}** (${updated.extensions}/${config.lease.maxExtensions} extensions used).`);
    await lib.refreshSite({ github, context, core }, config);
    return { handled: true, cmd, ok: true, lease: updated };
  }

  return { handled: false, reason: 'unknown command' };
}

module.exports = board;
