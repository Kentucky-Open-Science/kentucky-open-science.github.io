'use strict';
// leaderboard.html: points for completed tasks. Data comes from data/board.json.

const { esc, day } = require('./common');

function renderLeaderboard(model) {
  const { board, config, site } = model;
  const repoUrl = `https://github.com/${site.repo}`;
  const docsUrl = `${repoUrl}/blob/main/docs/KOS-TASK-BOARD.md`;
  const boardUrl = `${repoUrl}/issues?q=${encodeURIComponent(`is:issue is:open label:${config.labels.ready}`)}`;

  const rows = board.leaderboard.length
    ? board.leaderboard
        .map(
          (p) => `        <tr>
          <td>${p.rank}</td>
          <td><a href="https://github.com/${esc(p.login)}">@${esc(p.login)}</a></td>
          <td>${p.points}</td>
          <td>${p.tasks}</td>
          <td>${p.reviews}</td>
          <td>${esc(day(p.last))}</td>
        </tr>`,
        )
        .join('\n')
    : `        <tr><td colspan="6">No completed tasks yet. Be the first: claim one from the <a href="bounties.html">bounty board</a>.</td></tr>`;

  const recent = board.completions
    .slice(0, 25)
    .map(
      (c) => `        <tr>
          <td><a href="${esc(c.url)}">#${c.task}</a> ${esc(c.title)}</td>
          <td><a href="https://github.com/${esc(c.solver)}">@${esc(c.solver)}</a></td>
          <td>${esc(c.size || '–')}</td>
          <td>${c.points}</td>
          <td>${esc(day(c.mergedAt))}</td>
          <td><a href="${esc(c.prUrl)}">PR #${c.pr}</a></td>
        </tr>`,
    )
    .join('\n');

  const recentTable = board.completions.length
    ? `
    <h2 id="recent">Recent completions</h2>
    <section class="table-scroll" tabindex="0" aria-labelledby="recent">
    <table class="specs">
      <caption>Most recent accepted tasks</caption>
      <thead>
        <tr><th scope="col">Task</th><th scope="col">Solver</th><th scope="col">Size</th><th scope="col">Points</th><th scope="col">Merged</th><th scope="col">Pull request</th></tr>
      </thead>
      <tbody>
${recent}
      </tbody>
    </table>
    </section>`
    : '';

  return `<div class="layout">

  <aside class="sidebar">
    <div class="panel">
      <h3>Board status</h3>
      <ul>
        <li><a href="${boardUrl}">${board.status.ready} task${board.status.ready === 1 ? '' : 's'} open to claim</a></li>
        <li>${board.status.leased} leased</li>
        <li>${board.status.submitted} in review</li>
        <li>${board.accepted} accepted</li>
      </ul>
    </div>
    <div class="panel">
      <h3>How points work</h3>
      <ul>
        <li>Size S = ${config.points.bySize.S}, M = ${config.points.bySize.M}, L = ${config.points.bySize.L}</li>
        <li>Approving reviewers earn ${Math.round(config.points.reviewerShare * 100)}%</li>
        <li>One lease per person; expired leases earn nothing</li>
      </ul>
    </div>
    <div class="panel">
      <h3>Get involved</h3>
      <ul>
        <li><a href="bounties.html">Bounty board</a></li>
        <li><a href="${docsUrl}">How the board works</a></li>
      </ul>
    </div>
  </aside>

  <main class="main" id="main">
    <h1>Task Board Leaderboard</h1>
    <p class="lede">
      Volunteers donate the AI-agent hours they would otherwise lose at the end
      of the week to fix real public websites and research software. Every
      accepted task earns points; this page is the running tally.
    </p>

    <h2 id="standings">Standings</h2>
    <section class="table-scroll" tabindex="0" aria-labelledby="standings">
    <table class="specs">
      <caption>Contributors ranked by points</caption>
      <thead>
        <tr><th scope="col">Rank</th><th scope="col">Contributor</th><th scope="col">Points</th><th scope="col">Tasks</th><th scope="col">Reviews</th><th scope="col">Last credited</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
    </section>
${recentTable}

    <p class="lede">Updated ${esc(board.generated.replace('T', ' ').slice(0, 16))} UTC. Generated automatically from accepted tasks; see <a href="${docsUrl}">the task-board guide</a> for the rules.</p>
  </main>
</div>`;
}

module.exports = { renderLeaderboard };
