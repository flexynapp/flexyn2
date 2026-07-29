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

const LAYOUT_VERSION = 1;

/**
 * Pack the three pieces of edit-mode state into the blob stored in
 * user_profiles.dashboard_layout.
 *
 * @param {{hiddenSections: Set<string>|string[], widgetOrder: string[], sectionLayouts: object}} state
 */
export function packLayout({ hiddenSections, widgetOrder, sectionLayouts }) {
  return {
    v: LAYOUT_VERSION,
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
  return { hiddenSections: hidden, widgetOrder: order, sectionLayouts: layouts };
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
  } catch { /* Safari private mode / quota */ }
}

/** Clear the local mirror — used by the edit-mode Reset action. */
export function clearLayoutLocal(uid) {
  try {
    localStorage.removeItem(HIDDEN_KEY(uid));
    localStorage.removeItem(ORDER_KEY(uid));
    localStorage.removeItem(LAYOUTS_KEY(uid));
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
