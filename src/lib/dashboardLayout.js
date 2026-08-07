// src/lib/dashboardLayout.js
//
// Cross-device persistence for the "Customize home" layout.
//
// Background: Flexyn had two dashboard customization systems and only one
// synced. DashboardWidgets wrote through to user_profiles.dashboard_widgets;
// Dashboard.jsx's own edit mode — hidden sections, widget order, per-section
// layout — wrote only to localStorage, so reinstalling the PWA, switching
// phone, or an iOS storage eviction silently wiped the layout.
//
// This module owns the DB half. localStorage stays exactly as it was and
// remains the fast path for first paint; the blob in user_profiles is the
// authoritative copy that follows the user. Same shape as the pattern in
// DashboardWidgets.jsx, deliberately — two dashboards persisting state two
// different ways is what caused this in the first place.

import { db } from '@/api/db';

export const HIDDEN_KEY  = (uid) => `flexyn.dashHiddenSections.${uid || 'anon'}`;
export const ORDER_KEY   = (uid) => `flexyn.dashWidgetOrder.${uid || 'anon'}`;
export const LAYOUTS_KEY = (uid) => `flexyn.dashSectionLayouts.${uid || 'anon'}`;
// Which defaults version the local mirror has been caught up to. Kept beside
// the other three so a device that is offline through a deploy still knows,
// on its next cold start, that it hasn't run the migration yet.
export const DEFAULTS_VERSION_KEY = (uid) => `flexyn.dashLayoutDefaultsVersion.${uid || 'anon'}`;

const LAYOUT_VERSION = 1;

/**
 * Reconcile a saved widget order against the current defaults.
 *
 * Keeps the user's ordering for sections that still exist, drops ids we no
 * longer render, and places any NEW section at the index it holds in
 * `defaults` — not at the end.
 *
 * The append-at-the-end version was fine while every new section was a tail
 * addition, and wrong the first time one wasn't: 'stats' belongs directly
 * under the hero, so appending it would have put the page's most-glanced
 * numbers at the very bottom for every user who had ever touched edit mode,
 * and left them to work out that dragging fixes it.
 *
 * @param {string[]} saved
 * @param {string[]} defaults
 * @returns {string[]}
 */
export function mergeWidgetOrder(saved, defaults) {
  if (!Array.isArray(saved) || !Array.isArray(defaults)) return [...(defaults || [])];
  const result = saved.filter((id, i) => defaults.includes(id) && saved.indexOf(id) === i);
  defaults.forEach((id, defaultIndex) => {
    if (result.includes(id)) return;
    result.splice(Math.min(defaultIndex, result.length), 0, id);
  });
  return result;
}

/* ══════════════════════════════════════════════════════════════════
   Layout DEFAULTS migrations

   mergeWidgetOrder protects a customized order, which is right — nobody
   wants their arrangement rewritten by a deploy. But it also means a new
   default PAIRING can never reach anyone who has opened edit mode once:
   pairing requires two ids to be adjacent AND both 'half', and their saved
   order says otherwise forever. Shipping "streak now sits beside Daily
   Quests" was therefore invisible to exactly the users most likely to care.

   So: a version, and a list of the smallest possible steps to get from one
   version to the next. Not a reset — a reset would throw away the order,
   the hidden sections and the pairings a user chose on purpose. Each step
   touches only the ids it names.

   Rules a step must follow:
     · Never un-hide a section. If someone hid Daily Quests, pairing the
       streak with it is not a reason to bring it back.
     · Never add or drop ids — mergeWidgetOrder owns membership.
     · Be idempotent. Steps run once per user, but a half-applied sync or a
       second device must not compound them.

   `dv` is stored separately from `v` on purpose: `v` versions the blob's
   SHAPE, this versions the DEFAULTS a user has been caught up to. Bumping
   one must not imply the other.
   ══════════════════════════════════════════════════════════════════ */

export const LAYOUT_DEFAULTS_VERSION = 2;

/**
 * Move `first` to sit immediately before `second` and mark both 'half', so
 * the row builder pairs them. No-op if either is hidden or absent.
 */
function pairAdjacent(layout, first, second) {
  const hidden = new Set(layout.hiddenSections || []);
  if (hidden.has(first) || hidden.has(second)) return { layout, changed: false };

  const order = [...(layout.widgetOrder || [])];
  const iFirst = order.indexOf(first);
  const iSecond = order.indexOf(second);
  if (iFirst === -1 || iSecond === -1) return { layout, changed: false };

  const already = iSecond === iFirst + 1;
  const layouts = { ...(layout.sectionLayouts || {}) };
  const halved = layouts[first] === 'half' && layouts[second] === 'half';
  if (already && halved) return { layout, changed: false };

  if (!already) {
    order.splice(iFirst, 1);
    order.splice(order.indexOf(second), 0, first);
  }
  layouts[first] = 'half';
  layouts[second] = 'half';
  return {
    layout: { ...layout, widgetOrder: order, sectionLayouts: layouts },
    changed: true,
  };
}

const LAYOUT_MIGRATIONS = [
  {
    to: 2,
    name: 'pair-streak-with-quests',
    apply: (layout) => pairAdjacent(layout, 'streak', 'challenges'),
  },
];

/**
 * Bring a saved layout up to LAYOUT_DEFAULTS_VERSION.
 *
 * @param {{hiddenSections: string[], widgetOrder: string[], sectionLayouts: object}} layout
 * @param {number} fromVersion — 0 for a layout saved before versioning
 * @returns {{layout: object, version: number, applied: string[]}}
 */
export function applyLayoutMigrations(layout, fromVersion = 0) {
  const from = Number.isFinite(fromVersion) ? fromVersion : 0;
  if (!layout || from >= LAYOUT_DEFAULTS_VERSION) {
    return { layout, version: Math.max(from, LAYOUT_DEFAULTS_VERSION), applied: [] };
  }
  let next = layout;
  const applied = [];
  for (const step of LAYOUT_MIGRATIONS) {
    if (step.to <= from) continue;
    const res = step.apply(next);
    next = res.layout;
    // Record only steps that changed something, so the caller can skip a
    // pointless write — but advance the version either way (below), or a
    // user whose layout the step declined to touch would be re-tried on
    // every single load.
    if (res.changed) applied.push(step.name);
  }
  return { layout: next, version: LAYOUT_DEFAULTS_VERSION, applied };
}

/**
 * Pack the edit-mode state into the blob stored in
 * user_profiles.dashboard_layout.
 *
 * @param {{hiddenSections: Set<string>|string[], widgetOrder: string[], sectionLayouts: object, defaultsVersion?: number}} state
 */
export function packLayout({ hiddenSections, widgetOrder, sectionLayouts, defaultsVersion }) {
  return {
    v: LAYOUT_VERSION,
    dv: Number.isFinite(defaultsVersion) ? defaultsVersion : LAYOUT_DEFAULTS_VERSION,
    hiddenSections: Array.from(hiddenSections || []),
    widgetOrder: Array.isArray(widgetOrder) ? widgetOrder : [],
    sectionLayouts: sectionLayouts && typeof sectionLayouts === 'object' ? sectionLayouts : {},
  };
}

/**
 * Read a stored blob back into usable state. Returns null when there's
 * nothing usable, which the caller must treat as "never customized" — not
 * as "customized to empty". Those differ: a user who hid every section has
 * an explicit empty-ish layout that must survive onto their next device.
 */
export function unpackLayout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const hidden = Array.isArray(raw.hiddenSections) ? raw.hiddenSections.filter(x => typeof x === 'string') : [];
  const order = Array.isArray(raw.widgetOrder) ? raw.widgetOrder.filter(x => typeof x === 'string') : [];
  const layouts = raw.sectionLayouts && typeof raw.sectionLayouts === 'object' && !Array.isArray(raw.sectionLayouts)
    ? raw.sectionLayouts
    : {};
  // dv absent = saved before defaults-versioning existed, i.e. version 0.
  // Distinct from "already current": a blob written today carries dv, so
  // defaulting to LAYOUT_DEFAULTS_VERSION here would skip every migration
  // for exactly the users who need them.
  const dv = Number.isFinite(raw.dv) ? raw.dv : 0;
  return { hiddenSections: hidden, widgetOrder: order, sectionLayouts: layouts, defaultsVersion: dv };
}

/**
 * Mirror a layout into the same localStorage keys Dashboard.jsx already
 * reads on mount, so the next cold start paints the synced layout before
 * the profile query resolves.
 */
export function writeLayoutToLocal(uid, layout) {
  if (!layout) return;
  try {
    localStorage.setItem(HIDDEN_KEY(uid),  JSON.stringify(layout.hiddenSections));
    localStorage.setItem(ORDER_KEY(uid),   JSON.stringify(layout.widgetOrder));
    localStorage.setItem(LAYOUTS_KEY(uid), JSON.stringify(layout.sectionLayouts));
    localStorage.setItem(
      DEFAULTS_VERSION_KEY(uid),
      String(Number.isFinite(layout.defaultsVersion) ? layout.defaultsVersion : LAYOUT_DEFAULTS_VERSION),
    );
  } catch { /* Safari private mode / quota */ }
}

/** Read the defaults version the local mirror is caught up to. 0 = never. */
export function readLocalDefaultsVersion(uid) {
  try {
    const raw = localStorage.getItem(DEFAULTS_VERSION_KEY(uid));
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}

/** Clear the local mirror — used by the edit-mode Reset action. */
export function clearLayoutLocal(uid) {
  try {
    localStorage.removeItem(HIDDEN_KEY(uid));
    localStorage.removeItem(ORDER_KEY(uid));
    localStorage.removeItem(LAYOUTS_KEY(uid));
    // Reset lands on the current defaults by definition, so the migration
    // must not run again afterwards and shuffle what Reset just set.
    localStorage.setItem(DEFAULTS_VERSION_KEY(uid), String(LAYOUT_DEFAULTS_VERSION));
  } catch { /* ignore */ }
}

// Debounced write-through. Edit mode produces bursts — a drag fires on
// every hover-cross, and hiding three sections is three state updates — so
// collapse them into one round trip rather than one per keystroke-equivalent.
let syncTimer = null;

/**
 * Persist a layout to user_profiles.dashboard_layout.
 *
 * Best-effort by design: updateMe carries the strip-and-retry safety net,
 * so on a host without migration 260 the column is stripped and the write
 * degrades to a no-op while localStorage keeps working exactly as before.
 * The frontend deploys ahead of migrations here, so that window is real.
 *
 * @param {string} uid
 * @param {object} layout  result of packLayout()
 * @param {number} [delay=600]
 */
export function queueLayoutSync(uid, layout, delay = 600) {
  if (!uid) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    db.auth.updateMe({ dashboard_layout: layout }).catch(() => { /* best-effort */ });
  }, delay);
}

/** Flush any pending sync immediately — call on unmount. */
export function flushLayoutSync() {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
}
