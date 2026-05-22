// src/lib/buildInfo.js
//
// Build metadata injected at compile time by vite.config.js's `define`
// block. Surfaces in the About / Settings footer + (subtly) in
// developer-facing diagnostic UIs. The whole point is so a user with a
// device on a suspected-stale build can read the hash and confirm in 5
// seconds whether the issue is code-side or deploy-side. (We learned the
// hard way during round-4 that without this, diagnosing "the deploy
// looks wrong" is hours of detective work.)
//
// `__BUILD_HASH__` and `__BUILD_DATE__` are statically replaced at build
// time. In dev mode (`npm run dev`) the hash falls back to "dev" and the
// date is whenever the dev server booted.

/* eslint-disable no-undef */
export const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
export const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : new Date().toISOString();
/* eslint-enable no-undef */

/**
 * Human-readable, short build string for footer/about display.
 * Example: "b4dd418 · May 21, 2026"
 */
export function buildLabel() {
  if (BUILD_HASH === 'dev') return 'dev build';
  const d = new Date(BUILD_DATE);
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${BUILD_HASH} · ${month} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Long-form diagnostic string, copied to clipboard on tap. Useful for
 * support tickets — includes everything needed to triangulate a bug
 * report without asking the user follow-up questions.
 */
export function diagnosticString() {
  return [
    `build: ${BUILD_HASH}`,
    `built: ${BUILD_DATE}`,
    `ua: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `online: ${typeof navigator !== 'undefined' ? navigator.onLine : 'unknown'}`,
    `url: ${typeof window !== 'undefined' ? window.location.href : 'unknown'}`,
  ].join('\n');
}
