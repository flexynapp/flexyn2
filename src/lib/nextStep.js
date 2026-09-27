// src/lib/nextStep.js
//
// "The next step": one moment from the user's own data, under a page's focal
// goal (hero option D). A PR set on Tuesday, a planned day that is today, a
// last session long enough ago to be worth repeating. Never a feature
// advert: the rotating carousels it replaces spent their slides on "Open
// recipes" and "See plans", which is the app talking about itself.
//
// Pure: no React, no `@/api/db`. The page builds the candidates from data it
// already fetched and says which are eligible; this module only decides which
// one, so the rules can be tested without a render.
//
// The rules, in order:
//   1. Only eligible candidates.
//   2. Skip anything the user waved away ("Not now") in the last 7 days.
//      Candidate ids carry the moment itself (`pr:Bench Press:2026-09-22`),
//      so dismissing one PR does not silence the next one.
//   3. Highest priority wins; ties keep the caller's order.
//
// The page picks once when it mounts and holds that pick for the visit. There
// is no timer and no rotation: a row that changes while you read it is the
// carousel problem again.

export const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function within(ts, now, windowMs) {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 && now - n < windowMs && now >= n;
}

/**
 * @param {object} args
 * @param {{id: string, eligible: boolean, priority: number}[]} args.candidates
 * @param {number} [args.now]         epoch ms
 * @param {Record<string, number>} [args.dismissed]  id → last "Not now", epoch ms
 * @returns {object|null} the chosen candidate (the same object passed in), or null
 */
export function pickNextStep({ candidates = [], now = Date.now(), dismissed = {} } = {}) {
  let pick = null;
  for (const c of candidates || []) {
    if (!c || !c.id || c.eligible !== true) continue;
    if (within(dismissed?.[c.id], now, DISMISS_WINDOW_MS)) continue;
    if (!pick || (Number(c.priority) || 0) > (Number(pick.priority) || 0)) pick = c;
  }
  return pick;
}

// ── Storage ────────────────────────────────────────────────────────────────
//
// Per-device, per-user, under the flexyn.<feature>.<userId> namespace. Every
// read and write is wrapped: a private window, blocked site data or a full
// quota must degrade to "nothing dismissed", never to a thrown render. Losing
// it only means a moment gets offered once more.

const DISMISSED_PREFIX = 'flexyn.nextStepDismissed.';

function store() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readMap(key) {
  try {
    const raw = store()?.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const uid = (userId) => userId || 'anon';

export function readNextStepDismissed(userId) {
  return readMap(DISMISSED_PREFIX + uid(userId));
}

export function markNextStepDismissed(userId, id, now = Date.now()) {
  if (!id) return;
  const key = DISMISSED_PREFIX + uid(userId);
  // Drop stamps past the window so the map stays a handful of entries.
  const next = {};
  for (const [k, v] of Object.entries(readMap(key))) {
    if (within(v, now, DISMISS_WINDOW_MS)) next[k] = v;
  }
  next[id] = now;
  try {
    store()?.setItem(key, JSON.stringify(next));
  } catch {
    /* quota or blocked storage: the stamp is lost, which is harmless */
  }
}
