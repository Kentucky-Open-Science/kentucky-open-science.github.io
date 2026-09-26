// Project search for projects.html. Loads search-index.json (built by
// tools/build.js) and filters as you type. Without JavaScript the page still
// shows the full catalog.
(function () {
  'use strict';

  var form = document.getElementById('project-search');
  if (!form) return;
  var input = form.querySelector('input[name="q"]');
  var archivedBox = form.querySelector('input[name="archived"]');
  var forksBox = form.querySelector('input[name="forks"]');
  var status = document.getElementById('search-status');
  var results = document.getElementById('search-results');
  var catalog = document.getElementById('catalog');
  var index = null;
  var timer = null;

  // ?q= comes from this form or from the small search boxes on other pages.
  // Only this form sends "filters", so only then do missing checkboxes mean "off".
  var params = new URLSearchParams(window.location.search);
  if (params.has('q')) input.value = params.get('q');
  if (params.has('filters')) {
    archivedBox.checked = params.has('archived');
    forksBox.checked = params.has('forks');
  }

  function lower(s) {
    return String(s || '').toLowerCase();
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function tokenize(q) {
    return lower(q)
      .split(/[^a-z0-9\u00c0-\uffff]+/)
      .filter(Boolean);
  }

  function prepare(p) {
    return {
      p: p,
      name: lower(p.name),
      topics: p.topics.map(lower),
      language: lower(p.language),
      area: lower(p.area),
      description: lower(p.description + ' ' + p.summary),
      text: lower(p.text),
    };
  }

  // Each token must match somewhere (AND); matches at the start of a word only,
  // so "ct" finds "chest CT" but not "project".
  function score(e, res) {
    var total = 0;
    for (var i = 0; i < res.length; i++) {
      var re = res[i];
      var s = 0;
      if (e.name === re.token) s += 30;
      else if (re.word.test(e.name)) s += 12;
      if (e.topics.indexOf(re.token) >= 0) s += 10;
      else if (e.topics.some(function (t) { return re.word.test(t); })) s += 6;
      if (e.language === re.token) s += 5;
      if (re.word.test(e.area)) s += 3;
      if (re.word.test(e.description)) s += 4;
      if (re.word.test(e.text)) s += 1;
      if (!s) return 0;
      total += s;
    }
    return total + (e.p.archived ? 0 : 0.5);
  }

  function snippet(e, res) {
    var source = e.p.description || e.p.summary;
    var hay = e.description;
    var at = -1;
    for (var i = 0; i < res.length && at < 0; i++) {
      var m = res[i].word.exec(hay);
      if (m) at = m.index;
    }
    if (at < 0 && e.p.text) {
      source = e.p.text;
      hay = e.text;
      for (var j = 0; j < res.length && at < 0; j++) {
        var m2 = res[j].word.exec(hay);
        if (m2) at = m2.index;
      }
      if (at < 0) return source.slice(0, 160);
      var start = Math.max(0, at - 70);
      return (start ? '… ' : '') + source.slice(start, at + 110).replace(/\s+/g, ' ') + ' …';
    }
    return source.length > 220 ? source.slice(0, 220) + ' …' : source;
  }

  /** Append text to el, wrapping query matches in <mark>. */
  function highlight(el, text, res) {
    if (!res.length) {
      el.textContent = text;
      return;
    }
    var re = new RegExp('(' + res.map(function (r) { return escapeRe(r.token); }).join('|') + ')', 'ig');
    var last = 0;
    text.replace(re, function (match, _g, offset) {
      el.appendChild(document.createTextNode(text.slice(last, offset)));
      var mark = document.createElement('mark');
      mark.textContent = match;
      el.appendChild(mark);
      last = offset + match.length;
      return match;
    });
    el.appendChild(document.createTextNode(text.slice(last)));
  }

  function allowed(p) {
    return (archivedBox.checked || !p.archived) && (forksBox.checked || !p.fork);
  }

  function filterCatalog() {
    var items = catalog.querySelectorAll('.project-item');
    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      li.hidden = !allowed({ archived: li.getAttribute('data-archived') === 'true', fork: li.getAttribute('data-fork') === 'true' });
    }
    var areas = catalog.querySelectorAll('section.area');
    for (var j = 0; j < areas.length; j++) {
      areas[j].hidden = !areas[j].querySelector('.project-item:not([hidden])');
    }
  }

  function renderResults(q, list, res) {
    results.textContent = '';
    list.forEach(function (x) {
      var p = x.e.p;
      var li = document.createElement('li');
      li.className = 'project-item';
      var a = document.createElement('a');
      a.href = p.href;
      a.className = 'project-name';
      a.textContent = p.name;
      li.appendChild(a);
      var meta = document.createElement('span');
      meta.className = 'project-meta';
      meta.textContent = [p.area, p.language, '★ ' + p.stars, 'updated ' + p.pushed].filter(Boolean).join(' · ');
      li.appendChild(document.createTextNode(' '));
      li.appendChild(meta);
      if (p.archived || p.fork) {
        var flag = document.createElement('span');
        flag.className = 'flag ' + (p.archived ? 'flag-archived' : 'flag-fork');
        flag.textContent = p.archived ? 'Archived' : 'Fork';
        li.appendChild(document.createTextNode(' '));
        li.appendChild(flag);
      }
      var text = snippet(x.e, res);
      if (text) {
        var para = document.createElement('p');
        para.className = 'project-desc';
        highlight(para, text, res);
        li.appendChild(para);
      }
      results.appendChild(li);
    });
    var n = list.length;
    status.textContent = n === 0
      ? 'No projects match “' + q + '”. Try fewer or shorter words.'
      : n + (n === 1 ? ' project matches' : ' projects match') + ' “' + q + '”.';
  }

  function update() {
    var q = input.value.trim();
    var url = new URL(window.location.href);
    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');
    url.searchParams.delete('filters');
    url.searchParams.delete('archived');
    url.searchParams.delete('forks');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);

    if (!q) {
      results.hidden = true;
      results.textContent = '';
      catalog.hidden = false;
      status.textContent = '';
      filterCatalog();
      return;
    }
    if (!index) {
      status.textContent = 'Loading the search index…';
      return;
    }
    var res = tokenize(q).map(function (t) {
      return { token: t, word: new RegExp('(^|[^a-z0-9\u00c0-\uffff])' + escapeRe(t)) };
    });
    var list = index
      .filter(function (e) { return allowed(e.p); })
      .map(function (e) { return { e: e, s: score(e, res) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s || a.e.name.localeCompare(b.e.name); });
    catalog.hidden = true;
    results.hidden = false;
    renderResults(q, list, res);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 150);
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    clearTimeout(timer);
    update();
  });
  input.addEventListener('input', schedule);
  archivedBox.addEventListener('change', update);
  forksBox.addEventListener('change', update);

  fetch('search-index.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      index = data.projects.map(prepare);
      update();
    })
    .catch(function () {
      status.textContent = 'Search is unavailable right now; browse the full list below.';
    });

  update();
})();
