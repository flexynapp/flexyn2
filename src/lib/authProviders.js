// src/lib/authProviders.js
//
// Which OAuth providers this Supabase project ACTUALLY has enabled.
//
// The sign-in screen used to hardcode Google and Apple. Apple has never been
// enabled on the project, and supabase-js does not validate the provider —
// signInWithOAuth sets `window.location.href` to /auth/v1/authorize, so
// tapping the button navigated the user OUT of the app onto a raw JSON page:
//
//   {"code":400,"error_code":"validation_failed",
//    "msg":"Unsupported provider: provider is not enabled"}
//
// with no way back but the browser's back button, on the first screen a new
// user sees. The try/catch around the call could not help and never could:
// the page leaves before the promise settles, so the catch, the spinner reset
// and the error toast were all unreachable code.
//
// db.js already carried the rule this broke — "add a new provider here AND in
// the Supabase dashboard before exposing a button for it". A comment cannot
// enforce itself, so the screen now asks the project what it supports instead
// of being told at build time.
//
// FAILS CLOSED, deliberately. If the probe cannot answer, no OAuth button
// renders. Magic link and guest are always on this screen (email and
// anonymous_users are enabled), so a failed probe degrades to a sign-in path
// that WORKS. Failing open would restore a button that dead-ends, which is
// the bug this module exists to prevent.

/**
 * Providers this app has a button for. A provider absent from here is never
 * rendered even if the project enables it — adding the button is a design
 * decision, and this list is where it is made.
 */
export const RENDERABLE_PROVIDERS = ['google', 'apple'];

const CACHE_KEY = 'flexyn.authProviders.v1';

/**
 * Last confirmed provider list, so a returning user does not watch the
 * buttons pop in on every load. Returns null when there is nothing cached
 * or storage is unavailable (private mode throws on read).
 */
export function cachedProviders() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((p) => RENDERABLE_PROVIDERS.includes(p));
  } catch {
    return null;
  }
}

/**
 * Ask GoTrue which providers are on. Unauthenticated, anon-key only.
 *
 * @returns {Promise<string[]>} the subset of RENDERABLE_PROVIDERS enabled on
 *   the project, in RENDERABLE_PROVIDERS order.
 * @throws when the endpoint cannot be reached or answers non-2xx — callers
 *   keep whatever they already had rather than widening the button set.
 */
export async function fetchEnabledProviders() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return [];

  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  if (!res.ok) throw new Error(`auth settings ${res.status}`);
  const json = await res.json();

  // `external` is a flat map of provider → boolean. Compared to `true` rather
  // than coerced: a missing key must read as OFF, and `undefined` is falsy but
  // so is a provider the API stops reporting, and those mean the same thing
  // here — do not show the button.
  const external = (json && json.external) || {};
  const enabled = RENDERABLE_PROVIDERS.filter((p) => external[p] === true);

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(enabled));
  } catch {
    /* private mode — the probe still works, it just re-runs next load */
  }
  return enabled;
}
