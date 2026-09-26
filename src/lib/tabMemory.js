// src/lib/tabMemory.js
//
// Each bottom-bar tab remembers where you were (navigation redesign,
// phase 1). Leave Progress on Records, check Hub, tap Progress again: you
// are back on Records at the same scroll position, not on Trends at the
// top. Tapping the tab you are ALREADY on still returns it to its root;
// that is how iOS, Instagram and Strava tab bars behave, and Layout
// already handled it.
//
// Only view params are remembered, never one-shot action params. Pages
// open sheets from params like ?openLogMeal=1 or ?compose=1; remembering
// one of those would reopen the sheet every time you came back to the tab.
// The view params are the ones useUrlState writes.
//
// Module state, not storage: this is "where was I a moment ago", scoped
// to the running app. A cold start should open each tab at its root.

export const VIEW_PARAMS = ['tab', 'feed', 'history', 'nutrients'];

const lastUrl = new Map();
const lastScroll = new Map();

export function rememberTabLocation(pathname, search) {
  const src = new URLSearchParams(search || '');
  const kept = new URLSearchParams();
  for (const key of VIEW_PARAMS) {
    const v = src.get(key);
    if (v != null) kept.set(key, v);
  }
  const qs = kept.toString();
  lastUrl.set(pathname, qs ? `${pathname}?${qs}` : pathname);
}

export function tabHref(path) {
  return lastUrl.get(path) || path;
}

export function saveTabScroll(path, y) {
  if (typeof y === 'number' && y >= 0) lastScroll.set(path, y);
}

// Content loads after the page mounts, so the document is often too short
// to reach the saved position on the first frame. Retry each frame until it
// fits or ~1.5s passes, then give up where it is rather than jumping late.
export function restoreTabScroll(path, { maxMs = 1500 } = {}) {
  if (typeof window === 'undefined') return;
  const y = lastScroll.get(path) || 0;
  if (y <= 0) { window.scrollTo(0, 0); return; }
  const start = Date.now();
  const tick = () => {
    const reachable = document.documentElement.scrollHeight - window.innerHeight;
    if (reachable >= y || Date.now() - start > maxMs) {
      window.scrollTo(0, Math.min(y, Math.max(reachable, 0)));
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// After a long time away every tab opens at its root again, the same as a
// cold start. Layout calls this from onLongResume (lib/appResume).
export function forgetTabs() {
  lastUrl.clear();
  lastScroll.clear();
}

// Tests only.
export function _resetTabMemory() {
  lastUrl.clear();
  lastScroll.clear();
}
