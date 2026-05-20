// src/lib/discoveryPrefs.js
//
// Per-device dismissal storage for Dashboard discovery cards.
// Mirrors the PWAInstallPrompt cooldown pattern (timestamp in
// localStorage) — keeps state browser-local so we don't need a
// migration or per-user DB column.
//
// Why per-device, not per-user:
//   - Discovery cards are an onboarding affordance. If the user
//     dismissed "Try AI Coach" on their phone, re-showing it on the
//     desktop a week later is fine — they got value from seeing it
//     somewhere new.
//   - Avoids a DB migration; works pre-onboarding for anonymous users.
//   - Identical pattern to PWAInstallPrompt at the cost of mild
//     duplication if a user uses 3 devices (rare).
//
// Storage shape: a single JSON object under one key, so we can list
// all dismissed cards at once and clear them together if needed.

const STORAGE_KEY = 'fn-discovery-dismissed-v1';

// In-memory cache so repeated reads in one render don't all hit
// localStorage (which is synchronous and counted against the main thread).
let _cache = null;

function _read() {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _cache = raw ? JSON.parse(raw) : {};
  } catch {
    // SecurityError (cookies blocked), QuotaExceededError, JSON parse
    // failure on corrupted data — treat as "nothing dismissed".
    _cache = {};
  }
  if (!_cache || typeof _cache !== 'object') _cache = {};
  return _cache;
}

function _write(next) {
  _cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private-mode / quota — silently degrade. The in-memory cache
    // still works for the rest of the session.
  }
}

/**
 * Returns true if the card was dismissed and the cooldown (if any)
 * hasn't elapsed.
 *
 * @param {string} cardId - Stable identifier (e.g. 'starterPlan', 'coachIntro').
 * @param {number} [cooldownMs] - Optional. If set, the card un-dismisses
 *   after this many ms have passed. Omit for permanent dismissal.
 */
export function isDismissed(cardId, cooldownMs) {
  if (!cardId) return false;
  const dismissedAt = _read()[cardId];
  if (typeof dismissedAt !== 'number' || !Number.isFinite(dismissedAt)) return false;
  if (cooldownMs == null) return true;
  return (Date.now() - dismissedAt) < cooldownMs;
}

/**
 * Record dismissal of a card. Idempotent — calling twice doesn't break anything.
 */
export function dismiss(cardId) {
  if (!cardId) return;
  const next = { ..._read(), [cardId]: Date.now() };
  _write(next);
}

/**
 * Undo a dismissal. Useful for tests or "show me again" affordances.
 */
export function undismiss(cardId) {
  if (!cardId) return;
  const next = { ..._read() };
  delete next[cardId];
  _write(next);
}

/**
 * Wipe all discovery-card dismissals. Called from clearFirstLaunch on
 * account reset / logout to keep the next account's discovery flow
 * pristine.
 */
export function clearAllDismissals() {
  _cache = {};
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// Card IDs — keep them as exported constants so call sites don't drift
// on typos. Adding a new card? Add the ID here and the consumers stay
// type-checkable by grep.
export const DISCOVERY_CARDS = Object.freeze({
  STARTER_PLAN: 'starterPlan',   // "Your starter plan is ready"
  FORM_COACH:   'formCoachIntro',// "Try Form Coach"
  AI_COACH:     'coachIntro',    // "Meet your AI Coach"
  PUSH_OPTIN:   'pushOptIn',     // "Want a daily nudge to train?" — pre-prompt
});

// 30 days in milliseconds. Used as a cooldown so the push-opt-in
// pre-prompt can come back later if the user dismissed it but didn't
// outright refuse — habits change and a returning user might want
// reminders after a month.
export const COOLDOWN_30_DAYS = 30 * 24 * 60 * 60 * 1000;
