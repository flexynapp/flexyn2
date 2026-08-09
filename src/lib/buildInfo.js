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

/**
 * Put `diagnosticString()` on the clipboard. Returns the outcome rather than
 * toasting, so each surface can word its own message.
 *
 * @returns {Promise<'ok'|'unavailable'|'blocked'>}
 *
 * The missing-API branch is explicit and load-bearing. Writing this as
 * `navigator.clipboard?.writeText(...)` resolves to `Promise<undefined>` when
 * the API is absent — insecure-context HTTP, or an older browser — so the
 * caller reports "Copied!" over an empty clipboard, which is worse than
 * failing, because the user then pastes stale content into a bug report and
 * nobody can tell. (Audit 14 #30.)
 *
 * NOTE: `SettingsPanel.jsx` still carries its own inline copy of this logic.
 * It was mid-edit in another session when this was extracted, and staging it
 * would have committed that unrelated work-in-progress. Fold it in when the
 * file is free — two copies of a clipboard-detection quirk is exactly the
 * shape of thing that drifts.
 */
export async function copyDiagnostics() {
  if (!globalThis.navigator?.clipboard?.writeText) return 'unavailable';
  try {
    await globalThis.navigator.clipboard.writeText(diagnosticString());
    return 'ok';
  } catch {
    return 'blocked';
  }
}
