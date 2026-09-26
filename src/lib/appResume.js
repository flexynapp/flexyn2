// src/lib/appResume.js
//
// "Coming back to the app" has two shapes, and both should land on each
// page's default view rather than wherever the last session left off.
// Kegan relaunched after a while away and Hub was still on Crews, when he
// expected the Global feed.
//
// 1. A fresh launch. iOS and Android can restore the last URL on a cold
//    start, so /hub?feed=crews comes back with the page. sessionStorage is
//    empty on a new launch but survives a refresh, which is the one case
//    that should keep your place. initAppResume() tells them apart.
// 2. A long resume. A PWA that sat in the background is often never
//    reloaded at all; the page just becomes visible again. After
//    LONG_AWAY_MS hidden, onLongResume listeners fire so pages can reset.
//
// Anything shorter (checking a message between sets) keeps your place.

export const LONG_AWAY_MS = 30 * 60 * 1000;
const SESSION_KEY = 'flexyn.appSession';

let launchUrl;

// Call once at boot, before React mounts. On a fresh launch it records the
// URL the app opened on; on a refresh it records nothing.
export function initAppResume() {
  if (launchUrl !== undefined || typeof window === 'undefined') return;
  launchUrl = null;
  try {
    if (window.sessionStorage.getItem(SESSION_KEY) == null) {
      launchUrl = window.location.pathname + window.location.search;
    }
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // Storage blocked: keep today's behaviour.
  }
}

// True only while the app is still on the URL a fresh launch opened. The
// first move anywhere else ends it for good, so a later in-app link to the
// same view (Search, a Crew War card) is always honoured.
export function isRestoredLaunchUrl(location) {
  if (!launchUrl) return false;
  if (location.pathname + location.search === launchUrl) return true;
  launchUrl = null;
  return false;
}

const listeners = new Set();
let hiddenAt = null;
let wired = false;

function wire() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt == null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (away >= LONG_AWAY_MS) listeners.forEach((fn) => fn());
  });
}

export function onLongResume(fn) {
  wire();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Tests only.
export function _resetAppResume() {
  launchUrl = undefined;
  hiddenAt = null;
  listeners.clear();
}
