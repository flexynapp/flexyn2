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
import { getProfile } from '@/api/profileCache';

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

export const LAYOUT_DEFAULTS_VERSION = 6;

/**
 * Sections the Today screen (navigation redesign, phase 3) no longer shows
 * by default. Each still exists and can be restored from edit mode; they
 * moved out of the default view because each has a home elsewhere: weekly
 * numbers, goals and recap in You › Progress, quick actions in the + sheet,
 * league and friends in Social › Compete, the chest in You › Rewards.
 */
// What v5 hid, frozen: a migration step must keep meaning what it meant when
// it shipped, so later additions go in their own step below.
const V5_RETIRED_SECTIONS = [
  'stats', 'actions', 'chest', 'league', 'friends', 'progress',
  'journal', 'discover', 'motivation', 'customize',
];

// 'streak' is the LOGIN streak pill. Today shows one streak, the training
// streak in the hero; the login streak lives on You (Kegan, 27 Sep).
const V6_RETIRED_SECTIONS = ['streak'];

export const TODAY_RETIRED_SECTIONS = [...V5_RETIRED_SECTIONS, ...V6_RETIRED_SECTIONS];

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

/**
 * Add the named sections to the hidden set. Idempotent; ids already hidden
 * are left alone. Hiding never loses a choice: the order and layout are
 * untouched, so restoring a section puts it back exactly where it was.
 */
function hideSections(layout, ids) {
  const hidden = new Set(layout.hiddenSections || []);
  const missing = ids.filter(id => !hidden.has(id));
  if (missing.length === 0) return { layout, changed: false };
  missing.forEach(id => hidden.add(id));
  return { layout: { ...layout, hiddenSections: Array.from(hidden) }, changed: true };
}

/**
 * Drop the named sections out of any pairing by marking them 'full'.
 *
 * The order is left exactly as the user has it: pairing needs two adjacent
 * ids that are BOTH 'half', so removing the half is the whole job, and a
 * lone 'half' degrades to full width in dashboardRows anyway.
 */
function unpairSections(layout, ...ids) {
  const layouts = { ...(layout.sectionLayouts || {}) };
  const halves = ids.filter(id => layouts[id] === 'half');
  if (halves.length === 0) return { layout, changed: false };
  halves.forEach(id => { layouts[id] = 'full'; });
  return { layout: { ...layout, sectionLayouts: layouts }, changed: true };
}

const LAYOUT_MIGRATIONS = [
  {
    to: 2,
    name: 'pair-streak-with-quests',
    apply: (layout) => pairAdjacent(layout, 'streak', 'challenges'),
  },
  // v2 shipped broken and this repairs it. Two faults stamped layouts as
  // migrated without migrating them:
  //   · Dashboard read widgetOrder from React state in a branch where the
  //     localStorage loader's setState had not landed, so the step compared
  //     against defaults (already paired), reported "nothing to do", and the
  //     saved order was restored over the top afterwards.
  //   · The sync effect called packLayout() without a defaultsVersion, and
  //     packLayout defaults it to the CURRENT version — so the server copy
  //     claimed v2 for a layout that had never been touched. That stamp then
  //     out-ranked the local one on every later load.
  // Re-running the same pairing is safe precisely because steps are required
  // to be idempotent: anyone already paired gets changed:false and no write.
  {
    to: 3,
    name: 'pair-streak-with-quests-repair',
    apply: (layout) => pairAdjacent(layout, 'streak', 'challenges'),
  },
  // ...and v4 takes it back out. Measured on a real phone, the pair hands
  // the quests card a ~171px column: every quest title wraps to two lines
  // and three rows read as three cards stacked inside a card. Quests are
  // three lines of text and want the width; the streak's calendar is a grid
  // that was fine full-width before v2. Undoing the pairing is the fix, not
  // a third pass at the row.
  //
  // Running from 0 therefore pairs and then unpairs, which looks silly and
  // is the correct cost of the rule above: dv=3 is already stamped on real
  // devices, and that stamp is the only thing that tells them they need
  // this step. Rewriting v2/v3 in place would reach nobody.
  //
  // Someone who paired these two themselves after v3 gets unpaired here.
  // Unavoidable — the layout records the pairing, not who chose it — and
  // symmetric with v2 having forced it on everyone in the first place.
  {
    to: 4,
    name: 'unpair-streak-and-quests',
    apply: (layout) => unpairSections(layout, 'streak', 'challenges'),
  },
  // v5 is the Today screen: one next action and a few glances instead of
  // fifteen sections. It HIDES rather than removes, so everything stays one
  // tap away in edit mode, and it runs once, so a section someone restores
  // afterwards stays restored. It is the one step that hides something the
  // user may have wanted, which the rules above do not forbid (they forbid
  // un-hiding); the redesign was approved on 2026-09-24 on exactly this.
  {
    to: 5,
    name: 'today-screen',
    apply: (layout) => hideSections(layout, V5_RETIRED_SECTIONS),
  },
  // v6: one streak on Today. Two flames a few rows apart ("3 day streak"
  // for opening the app, the hero's count for training) read as the same
  // number disagreeing with itself. The login pill moves to You; hidden,
  // not removed, so edit mode can still restore it here.
  {
    to: 6,
    name: 'one-streak-on-today',
    apply: (layout) => hideSections(layout, V6_RETIRED_SECTIONS),
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
let pendingSync = null; // { uid, layout }

// The timer and the pending write are module-level, so a write queued by one
// account must never land on another. updateMe writes whoever is signed in
// NOW, so the write is dropped when the cached profile belongs to someone
// else (an account switch inside the delay).
function sendLayout({ uid, layout }) {
  const current = getProfile()?.id;
  if (current && current !== uid) return;
  db.auth.updateMe({ dashboard_layout: layout }).catch(() => { /* best-effort */ });
}

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
  pendingSync = { uid, layout };
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const p = pendingSync;
    pendingSync = null;
    if (p) sendLayout(p);
  }, delay);
}

/**
 * Send any pending sync immediately — call on unmount.
 *
 * This used to CANCEL the pending write, so a reorder or hide followed by
 * leaving Dashboard within the 600ms debounce was never saved to the
 * account: it survived in localStorage on that device and was missing on
 * every other one (2026-09-27 audit, item 19).
 */
export function flushLayoutSync() {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  const p = pendingSync;
  pendingSync = null;
  if (p) sendLayout(p);
}
