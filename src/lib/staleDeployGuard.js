// src/lib/staleDeployGuard.js
//
// After a deploy, a tab still holding a stale index.html can request JS
// chunks whose hashed filenames no longer exist on the server (or fetch a
// stale cached chunk that doesn't match the fresh HTML). React render-time
// failures are already handled by ErrorBoundary (isChunkLoadError +
// one-shot reload). This covers the two paths React never sees:
//
//   • `vite:preloadError` — Vite fires this on window when a
//     <link rel="modulepreload"> or a dynamic import()'s module fetch
//     fails. It happens outside any Suspense/ErrorBoundary, so without a
//     handler the affected region just dies silently (e.g. a card whose
//     chrome rendered but whose body never mounted).
//   • `unhandledrejection` from an async import() in an event handler or
//     effect — rejects after render, so no boundary catches it.
//
// Both self-heal with a single hard reload to fetch the current entry.
// ErrorBoundary uses the same isChunkLoadError / reloadOnce exported here,
// so the two mechanisms share one guard and can never reload-loop each
// other on a genuine (non-stale) bug.
//
// NEVER call preventDefault() on `vite:preloadError`. It looks like "we own
// the recovery", but Vite's contract is that a prevented event makes the
// import() RESOLVE — with undefined. React.lazy then reads
// `undefined.default` and throws "undefined is not an object (evaluating
// 'X._result.default')", which no chunk-error check recognises. That is
// exactly what tapping a daily quest did on a stale installed PWA
// (2026-09-30): the QuestsSheet chunk was gone, the guard swallowed the
// fetch error, and the Today page crashed whenever the one-minute reload
// window had already been used. Left alone, the import rejects with the
// real error, which the boundary and the unhandledrejection path below
// both know how to handle.

const CHUNK_RELOAD_FLAG = 'flexyn.chunkReloadAttemptedAt';

function isChunkMessage(msg) {
  const m = String(msg || '').toLowerCase();
  return (
    m.includes('dynamically imported module') ||
    m.includes('failed to fetch dynamically imported module') ||
    m.includes('loading chunk') ||
    m.includes('loading css chunk') ||
    m.includes('importing a module script failed') ||
    // Vite's own error when a lazy chunk's stylesheet 404s.
    m.includes('unable to preload css')
  );
}

export function isChunkLoadError(error) {
  if (!error) return false;
  return isChunkMessage(error.message || error);
}

// Set once this page has asked for a reload. Everything after that is a
// page that is about to go away, so callers can render nothing rather than
// flash an error at someone for the half second before it does.
let reloadPending = false;

// One hard reload per ~minute, max. If the failure repeats inside that
// window the cause isn't stale cache — let it surface normally rather
// than trap the user in a reload loop. Returns true when a reload is
// under way (started now, or already by an earlier caller on this page).
export function reloadOnce() {
  if (reloadPending) return true;
  // A chunk fetch that failed because the device is OFFLINE is not a
  // stale deploy — reloading would drop in-memory state (e.g. an
  // in-progress workout) for nothing, since the reload would hit the
  // same dead network. Let the SW-cached shell / Suspense handle it.
  try { if (typeof navigator !== 'undefined' && navigator.onLine === false) return false; } catch { /* ignore */ }
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_FLAG) || '0');
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
  } catch { /* private mode / quota — proceed without the guard */ }
  try {
    if (typeof window === 'undefined') return false;
    window.location.reload();
    reloadPending = true;
    return true;
  } catch { return false; }
}

// Test seam: a real page never un-requests a reload.
export function __resetReloadPendingForTests() { reloadPending = false; }

let installed = false;
export function installStaleDeployGuard() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Vite's dedicated stale-preload signal — the most reliable one.
  // Deliberately NOT preventDefault — see the head of this file.
  window.addEventListener('vite:preloadError', () => {
    reloadOnce();
  });

  // Async import() rejections that never reach a React boundary.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    if (isChunkMessage(reason?.message || reason)) reloadOnce();
  });
}
