// Bounty board: clicking a task opens a dialog with a ready-to-paste prompt
// for the volunteer's coding agent (template: src/claim-prompt.txt, filled in
// by tools/build.js + this file). Without JavaScript, or in a browser without
// <dialog>, the task links go straight to the GitHub issue.
(function () {
  'use strict';

  var dialog = document.getElementById('claim-dialog');
  var dataEl = document.getElementById('claim-data');
  if (!dialog || !dataEl || typeof dialog.showModal !== 'function') return;

  var data = JSON.parse(dataEl.textContent);
  var titleEl = document.getElementById('claim-title');
  var metaEl = document.getElementById('claim-meta');
  var promptEl = document.getElementById('claim-prompt');
  var copyBtn = document.getElementById('claim-copy');
  var issueLink = document.getElementById('claim-issue');
  var statusEl = document.getElementById('claim-status');
  var closeBtn = dialog.querySelector('.claim-close');
  var opener = null;
  var resetTimer = null;

  var SIZES = { S: 'Small task', M: 'Medium task', L: 'Large task' };

  function slug(s) {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '');
  }

  function fill(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
    });
  }

  function when(iso) {
    return iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '';
  }

  function stateText(t) {
    if (t.state === 'ready') return 'open to claim';
    if (t.state === 'leased') return 'claimed' + (t.holder ? ' by @' + t.holder : '') + (t.expires ? ' until ' + when(t.expires) : '') + ': you can claim it if the lease runs out';
    if (t.state === 'submitted') return 'in review' + (t.pr ? ' (pull request #' + t.pr + ')' : '') + ': not claimable right now';
    if (t.state === 'triage') return 'waiting for a maintainer to check it: not claimable yet';
    return t.state;
  }

  function show(number, link) {
    var t = data.tasks[number];
    if (!t) return false;
    var vars = {
      number: t.number,
      title: t.title,
      url: t.url,
      repo: data.repo,
      size: t.size || '',
      points: t.points,
      leaseHours: data.leaseHours,
      branch: 'kos/' + t.number + '-' + slug(t.title),
    };
    titleEl.textContent = 'Task #' + t.number + ': ' + t.title;
    metaEl.textContent = (SIZES[t.size] || 'Task') + ' · ' + t.points + ' points · ' + stateText(t);
    promptEl.value = fill(data.prompt, vars);
    // Only ever link to an issue on GitHub (never, say, a javascript: URL).
    if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(t.url)) issueLink.href = t.url;
    else issueLink.removeAttribute('href');
    statusEl.textContent = '';
    copyBtn.textContent = 'Copy prompt';
    opener = link;
    dialog.showModal();
    promptEl.scrollTop = 0;
    return true;
  }

  function copied() {
    copyBtn.textContent = 'Copied!';
    statusEl.textContent = 'Prompt copied. Paste it into your coding agent.';
    clearTimeout(resetTimer);
    resetTimer = setTimeout(function () {
      copyBtn.textContent = 'Copy prompt';
    }, 2500);
  }

  function copyBySelection() {
    promptEl.focus();
    promptEl.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    if (ok) copied();
    else statusEl.textContent = 'The prompt is selected: press Ctrl+C (or Cmd+C on a Mac) to copy it.';
  }

  document.addEventListener('click', function (ev) {
    var link = ev.target.closest ? ev.target.closest('a[data-task]') : null;
    // Let modified clicks (new tab, new window) go to GitHub as usual.
    if (!link || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    if (show(link.getAttribute('data-task'), link)) ev.preventDefault();
  });

  copyBtn.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(promptEl.value).then(copied, copyBySelection);
    } else {
      copyBySelection();
    }
  });

  closeBtn.addEventListener('click', function () {
    dialog.close();
  });

  // A click on the backdrop (outside the window) closes the dialog.
  dialog.addEventListener('click', function (ev) {
    if (ev.target === dialog) dialog.close();
  });

  // Put focus back on the task link that opened the dialog. (Skip a stale close
  // event that arrives after the dialog was already reopened.)
  dialog.addEventListener('close', function () {
    if (dialog.open) return;
    if (opener) opener.focus();
    opener = null;
  });
})();
