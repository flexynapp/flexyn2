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
// We share ErrorBoundary's one-shot sessionStorage guard so the two
// mechanisms can never reload-loop each other on a genuine (non-stale) bug.

const CHUNK_RELOAD_FLAG = 'flexyn.chunkReloadAttemptedAt';

function isChunkMessage(msg) {
  const m = String(msg || '').toLowerCase();
  return (
    m.includes('dynamically imported module') ||
    m.includes('failed to fetch dynamically imported module') ||
    m.includes('loading chunk') ||
    m.includes('loading css chunk') ||
    m.includes('importing a module script failed')
  );
}

// One hard reload per ~minute, max. If the failure repeats inside that
// window the cause isn't stale cache — let it surface normally rather
// than trap the user in a reload loop.
function reloadOnce() {
  // A chunk fetch that failed because the device is OFFLINE is not a
  // stale deploy — reloading would drop in-memory state (e.g. an
  // in-progress workout) for nothing, since the reload would hit the
  // same dead network. Let the SW-cached shell / Suspense handle it.
  try { if (typeof navigator !== 'undefined' && navigator.onLine === false) return; } catch { /* ignore */ }
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_FLAG) || '0');
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
  } catch { /* private mode / quota — proceed without the guard */ }
  try { window.location.reload(); } catch { /* ignore */ }
}

let installed = false;
export function installStaleDeployGuard() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Vite's dedicated stale-preload signal — the most reliable one.
  window.addEventListener('vite:preloadError', (event) => {
    // Prevent Vite's default (rethrow) so we own the recovery.
    try { event.preventDefault?.(); } catch { /* ignore */ }
    reloadOnce();
  });

  // Async import() rejections that never reach a React boundary.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    if (isChunkMessage(reason?.message || reason)) reloadOnce();
  });
}
