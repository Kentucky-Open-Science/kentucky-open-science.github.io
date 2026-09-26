'use strict';
// Shared, dependency-free helpers for the KOS task board.
// Everything here is pure (no network) so it can be unit-tested with `node --test`.

const fs = require('node:fs');
const path = require('node:path');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Hidden state markers in issue bodies
//   <!-- kos:lease {"holder":"octocat","claimed":"...","expires":"...","extensions":0,"warned":false} -->
//   <!-- kos:accepted {"pr":12,"mergedBy":"...","mergedAt":"...","size":"M","points":25,"reviewers":[]} -->
// ---------------------------------------------------------------------------

function markerRegex(kind) {
  return new RegExp(`\\n?<!--\\s*kos:${kind}\\s+(\\{[\\s\\S]*?\\})\\s*-->`);
}

/** Read a marker of the given kind from an issue body. Returns null if absent or unparsable. */
function readMarker(body, kind) {
  const m = (body || '').match(markerRegex(kind));
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** Return a new body with the marker replaced (or appended, or removed when obj is null). */
function writeMarker(body, kind, obj) {
  const re = markerRegex(kind);
  const text = obj ? `\n<!-- kos:${kind} ${JSON.stringify(obj)} -->` : '';
  const current = body || '';
  if (re.test(current)) return current.replace(re, text);
  if (!obj) return current;
  return current.replace(/\s*$/, '') + '\n' + text;
}

// ---------------------------------------------------------------------------
// Issue-form body parsing. GitHub renders issue forms as markdown with a
// "### Field label" heading per field. We index sections by heading text.
// ---------------------------------------------------------------------------

/** @returns {Record<string, string>} map of lower-cased heading -> section text */
function parseSections(body) {
  const sections = {};
  const lines = (body || '').replace(/\r\n/g, '\n').split('\n');
  let current = null;
  for (const line of lines) {
    const h = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (h) {
      current = h[1].trim().toLowerCase();
      sections[current] = '';
      continue;
    }
    if (current !== null) sections[current] += line + '\n';
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k].trim();
  return sections;
}

/** Find a section by any of several heading names (case-insensitive). */
function section(sections, ...names) {
  for (const n of names) {
    const key = n.toLowerCase();
    if (key in sections) return sections[key];
  }
  return '';
}

/**
 * Parse a list of test IDs from free text: one per line, optionally bulleted or
 * back-ticked; ignores blank lines, the issue-form placeholder "_No response_",
 * and fenced code markers. Returns [] for empty input. A lone "*" means
 * "everything else" and is returned as ["*"].
 */
function parseTestIds(text) {
  const ids = [];
  for (const raw of (text || '').split('\n')) {
    let line = raw.trim();
    if (!line || line === '_No response_' || line.startsWith('```')) continue;
    line = line.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').replace(/`/g, '').trim();
    if (!line) continue;
    // Allow a trailing comment after two spaces or " — "
    line = line.split(/\s{2,}|\s[—#]\s/)[0].trim();
    if (line === '*' || /^all other tests/i.test(line)) {
      ids.push('*');
      continue;
    }
    if (/^[A-Za-z0-9_./:-]+$/.test(line)) ids.push(line);
  }
  return [...new Set(ids)];
}

// ---------------------------------------------------------------------------
// Labels, state, sizes, points
// ---------------------------------------------------------------------------

function labelNames(labels) {
  return (labels || []).map((l) => (typeof l === 'string' ? l : l.name));
}

/** @returns {'triage'|'ready'|'leased'|'submitted'|'accepted'|null} */
function stateOf(labels, config = CONFIG) {
  const names = labelNames(labels);
  for (const state of ['accepted', 'submitted', 'leased', 'ready', 'triage']) {
    if (names.includes(config.labels[state])) return state;
  }
  return null;
}

function isTask(labels, config = CONFIG) {
  return labelNames(labels).includes(config.labels.task);
}

/** @returns {'S'|'M'|'L'|null} */
function sizeOf(labels, config = CONFIG) {
  const names = labelNames(labels);
  for (const [size, label] of Object.entries(config.labels.sizes)) {
    if (names.includes(label)) return size;
  }
  return null;
}

function pointsFor(size, config = CONFIG) {
  return (size && config.points.bySize[size]) || config.points.default;
}

// ---------------------------------------------------------------------------
// Lease math
// ---------------------------------------------------------------------------

function addHours(iso, hours) {
  return new Date(new Date(iso).getTime() + hours * 3600 * 1000).toISOString();
}

function newLease(holder, now, config = CONFIG) {
  const claimed = new Date(now).toISOString();
  return { holder, claimed, expires: addHours(claimed, config.lease.hours), extensions: 0, warned: false };
}

function hoursLeft(lease, now) {
  return (new Date(lease.expires).getTime() - new Date(now).getTime()) / 3600000;
}

function isExpired(lease, now) {
  return hoursLeft(lease, now) <= 0;
}

/** Human-readable UTC timestamp, e.g. "2026-09-28 15:00 UTC". */
function fmt(iso) {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

// ---------------------------------------------------------------------------
// Slash commands in comments and task references in PR bodies
// ---------------------------------------------------------------------------

/** First slash-command in a comment: "/claim", "/release", "/extend", "/status". */
function parseCommand(commentBody) {
  const m = (commentBody || '').match(/^\s*\/(claim|release|extend|status)\b/im);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Task number referenced by a PR body: prefers an explicit "KOS-Task: #N" line,
 * otherwise the first "Closes/Fixes/Resolves #N".
 */
function parseTaskRef(prBody) {
  const body = prBody || '';
  const explicit = body.match(/KOS-Task:\s*#?(\d+)/i);
  if (explicit) return Number(explicit[1]);
  const closes = body.match(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/i);
  return closes ? Number(closes[1]) : null;
}

/**
 * Provenance fields from the PR template. Returns { model, harness, usage,
 * attestations: {label: bool}, missing: [...] }.
 */
function parseProvenance(prBody) {
  const body = (prBody || '').replace(/\r\n/g, '\n');
  const field = (name) => {
    const m = body.match(new RegExp(`^\\s*[-*]?\\s*\\*{0,2}${name}\\*{0,2}\\s*:\\s*(.*)$`, 'im'));
    const v = m ? m[1].trim() : '';
    return /^(<!--.*-->)?$/.test(v) ? '' : v;
  };
  const attestations = {};
  for (const m of body.matchAll(/^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/gm)) {
    attestations[m[2]] = m[1].toLowerCase() === 'x';
  }
  const model = field('Model\\(s\\)') || field('Model');
  const harness = field('Harness');
  const usage = field('Approx\\. usage') || field('Usage');
  const missing = [];
  if (!model) missing.push('Model(s)');
  if (!harness) missing.push('Harness');
  const unchecked = Object.entries(attestations).filter(([, v]) => !v).map(([k]) => k);
  return { model, harness, usage, attestations, missing, unchecked };
}

module.exports = {
  CONFIG,
  readMarker,
  writeMarker,
  parseSections,
  section,
  parseTestIds,
  labelNames,
  stateOf,
  isTask,
  sizeOf,
  pointsFor,
  addHours,
  newLease,
  hoursLeft,
  isExpired,
  fmt,
  parseCommand,
  parseTaskRef,
  parseProvenance,
};
