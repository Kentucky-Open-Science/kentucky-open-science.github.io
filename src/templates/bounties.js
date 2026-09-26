'use strict';
// bounties.html: the task board as a page. Data comes from data/board.json,
// which .github/kos/leaderboard.js collects from the repository's issues.
//
// Each open task's link opens a dialog (src/claim.js) with a ready-to-paste
// prompt for the volunteer's coding agent, built from src/claim-prompt.txt.
// Without JavaScript the links simply go to the GitHub issue.

const { esc, day, plural } = require('./common');

function taskTitle(t) {
  return esc(t.title.replace(/^\[Task\]\s*/i, ''));
}

function taskLink(t) {
  return `<a href="${esc(t.url)}" data-task="${t.number}">#${t.number} ${taskTitle(t)}</a>`;
}

/** Everything src/claim.js needs, as JSON that is safe inside <script>. */
function claimData(model) {
  const { board, config, site } = model;
  const tasks = {};
  for (const t of board.tasks) {
    tasks[t.number] = { number: t.number, title: t.title.replace(/^\[Task\]\s*/i, ''), url: t.url, state: t.state, size: t.size, points: t.points, holder: t.holder, expires: t.expires, pr: t.pr };
  }
  const data = { repo: site.repo, leaseHours: config.lease.hours, prompt: model.claimPrompt, tasks };
  return JSON.stringify(data).replace(/</g, '\\u003c'); // so no </script> in the data can end the block early
}

function table(caption, head, rows) {
  return `    <table class="specs">
      <caption>${caption}</caption>
      <thead>
        <tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr>
      </thead>
      <tbody>
${rows.map((r) => `        <tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n')}
      </tbody>
    </table>`;
}

function renderBounties(model) {
  const { board, config, site } = model;
  const repoUrl = `https://github.com/${site.repo}`;
  const docsUrl = `${repoUrl}/blob/main/docs/KOS-TASK-BOARD.md`;
  const L = config.labels;
  const issuesUrl = (label) => `${repoUrl}/issues?q=${encodeURIComponent(`is:issue is:open label:${label}`)}`;
  const byState = (s) => board.tasks.filter((t) => t.state === s).sort((a, b) => a.number - b.number);
  const ready = byState('ready');
  const leased = byState('leased');
  const submitted = byState('submitted');
  const triage = byState('triage');
  const pts = config.points.bySize;

  const readySection = ready.length
    ? table(
        'Tasks you can claim now',
        ['Task', 'Size', 'Points'],
        ready.map((t) => [taskLink(t), esc(t.size || '–'), String(t.points)]),
      )
    : `    <p>No tasks are open right now. Check back soon, or <a href="${repoUrl}/issues/new/choose">submit one</a>.</p>`;

  const sections = [];
  if (leased.length) {
    sections.push(`    <h2 id="in-progress">In progress</h2>
${table('Tasks someone has claimed', ['Task', 'Claimed by', 'Lease expires'], leased.map((t) => [taskLink(t), t.holder ? `<a href="https://github.com/${esc(t.holder)}">@${esc(t.holder)}</a>` : '–', esc(t.expires ? `${t.expires.replace('T', ' ').slice(0, 16)} UTC` : '–')]))}`);
  }
  if (submitted.length) {
    sections.push(`    <h2 id="in-review">In review</h2>
${table('Tasks with a pull request under review', ['Task', 'Solver', 'Pull request'], submitted.map((t) => [taskLink(t), t.holder ? `<a href="https://github.com/${esc(t.holder)}">@${esc(t.holder)}</a>` : '–', t.pr ? `<a href="${repoUrl}/pull/${t.pr}">#${t.pr}</a>` : '–']))}`);
  }
  if (triage.length) {
    sections.push(`    <h2 id="triage">Waiting for triage</h2>
    <p>Submitted tasks a maintainer has not checked yet. They cannot be claimed until they are marked ready.</p>
    <ul>
${triage.map((t) => `      <li>${taskLink(t)}</li>`).join('\n')}
    </ul>`);
  }
  if (board.completions.length) {
    sections.push(`    <h2 id="done">Recently completed</h2>
${table('The most recent accepted tasks', ['Task', 'Solved by', 'Points', 'Merged'], board.completions.slice(0, 15).map((c) => [`<a href="${esc(c.url)}">#${c.task} ${esc(c.title.replace(/^\[Task\]\s*/i, ''))}</a>`, `<a href="https://github.com/${esc(c.solver)}">@${esc(c.solver)}</a>`, String(c.points), esc(day(c.mergedAt))]))}`);
  }

  return `<div class="layout">

  <aside class="sidebar">
    <div class="panel">
      <h3>Board status</h3>
      <ul>
        <li><a href="${issuesUrl(L.ready)}">${plural(board.status.ready, 'task')} open to claim</a></li>
        <li>${board.status.leased} in progress</li>
        <li>${board.status.submitted} in review</li>
        <li>${board.accepted} completed</li>
      </ul>
    </div>

    <div class="panel">
      <h3>Points</h3>
      <ul>
        <li>Small task: ${pts.S}</li>
        <li>Medium task: ${pts.M}</li>
        <li>Large task: ${pts.L}</li>
        <li>Approving reviewer: +${Math.round(config.points.reviewerShare * 100)}% of the task</li>
      </ul>
    </div>

    <div class="panel">
      <h3>Get involved</h3>
      <ul>
        <li><a href="${docsUrl}">How the board works</a></li>
        <li><a href="${repoUrl}/issues?q=${encodeURIComponent(`is:issue label:${L.task}`)}">Every task on GitHub</a></li>
        <li><a href="leaderboard.html">Leaderboard</a></li>
      </ul>
    </div>
  </aside>

  <main class="main" id="main">
    <h1>Accessibility Bounty Board</h1>
    <p class="lede">
      This website is being brought up to WCAG 2.1 AA, the standard adopted by
      the ADA Title II web rule, one small, tested task at a time. Claim a task,
      fix it with or without a coding agent, and earn points when it merges.
    </p>

    <h2 id="how">How it works</h2>
    <ol>
      <li><strong>Pick a task</strong> from the list below. Clicking it gives you a
        prompt to paste into your coding agent: the agent claims the task by
        commenting <code>/claim</code> on its GitHub issue, follows the board&rsquo;s
        rules, and stops for your review. The task is yours for
        ${config.lease.hours} hours. One task per person at a time.</li>
      <li><strong>Fix it</strong> in your fork. <code>npm test</code> runs the same
        checks the board uses; each task names the tests that must go from
        failing to passing.</li>
      <li><strong>Open a pull request</strong> with <code>KOS-Task: #N</code> in the
        description and the template filled in. An automated gate checks the tests
        and your claim, and a maintainer reviews every line.</li>
      <li><strong>Get credit.</strong> When the pull request merges, the task&rsquo;s
        points go to you, and a share goes to each approving reviewer, on the
        <a href="leaderboard.html">leaderboard</a>.</li>
    </ol>
    <p>
      Need more time? Comment <code>/extend</code> once. Can&rsquo;t finish? Comment
      <code>/release</code> so someone else can. Full rules:
      <a href="${docsUrl}">the task-board guide</a>.
    </p>

    <h2 id="open">Open to claim</h2>
${readySection}

${sections.join('\n\n')}

    <p class="source-note">Board data as of ${esc(board.generated.replace('T', ' ').slice(0, 16))} UTC.
    The live state is always on <a href="${repoUrl}/issues?q=${encodeURIComponent(`is:issue label:${L.task}`)}">GitHub</a>.</p>

    <dialog id="claim-dialog" class="claim-dialog" aria-labelledby="claim-title">
      <div class="claim-titlebar">
        <h2 id="claim-title">Claim a task</h2>
        <button type="button" class="claim-close" aria-label="Close">&times;</button>
      </div>
      <div class="claim-body">
        <p class="claim-meta" id="claim-meta"></p>
        <label for="claim-prompt">Paste this prompt into your coding agent (Claude Code, Codex, Cursor, &hellip;):</label>
        <textarea id="claim-prompt" readonly rows="14" spellcheck="false"></textarea>
        <div class="claim-actions">
          <button type="button" class="claim-button" id="claim-copy" autofocus>Copy prompt</button>
          <a class="claim-button" id="claim-issue">Open issue on GitHub</a>
        </div>
        <p class="claim-status" id="claim-status" role="status"></p>
      </div>
    </dialog>
    <script type="application/json" id="claim-data">${claimData(model)}</script>
  </main>
</div>`;
}

module.exports = { renderBounties };
