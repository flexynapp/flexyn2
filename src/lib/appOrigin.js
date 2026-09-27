// src/lib/appOrigin.js
//
// The origin you are allowed to bake into something PERMANENT.
//
// `window.location.origin` is right for a share sheet — whatever host the
// user is on is the host their friend should get. It is wrong for a QR
// that gets printed, laminated and screwed to a gym wall: generate the
// signage from a dev server and the poster points at http://localhost:5173
// forever, and nobody finds out until a member scans it and gets nothing.
// A Netlify deploy preview is the same failure with a slower fuse, since
// the host stops resolving when the branch is deleted.
//
// So: use the live origin when it is one a stranger's phone can reach, and
// fall back to the configured public origin when it isn't.
//
// ── Which host, and why it is not flexyn.app yet ────────────────────
//
// flexyn.app IS the real domain, but as of 2026-08-09 it serves a
// marketing landing page for the upcoming site (download links,
// description, reviews) and 404s on every app path. Measured:
//
//   https://flexyn.app/                          200  (landing page)
//   https://flexyn.app/checkin/ABCD2345          404
//   https://flexyn.app/gym/<uuid>                404
//   https://flexyn.netlify.app/checkin/ABCD2345  200  (the app)
//
// A poster is permanent, so the default stays on the host that answers.
//
// TO SWITCH, no code change needed — set VITE_PUBLIC_ORIGIN in the Netlify
// dashboard (Site configuration → Environment variables), the same way
// VITE_SUPABASE_URL is set, and redeploy. Before you do, these three paths
// must resolve to the app on flexyn.app, because the signage QR walks all
// three:
//
//   /checkin/:code   the QR's own target — checks a member in
//   /gym/:id         where a signed-in scan lands
//   /p/gym/:id       where a scan with no account lands
//
// Posters printed before the switch keep pointing at the old host, so
// leave flexyn.netlify.app resolving (or redirect it) rather than
// retiring it.

import { isNative } from '@/lib/native';

const FALLBACK_ORIGIN = 'https://flexyn.netlify.app';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/** True for hosts that only resolve on this machine or for a short while. */
export function isEphemeralHost(hostname) {
  if (!hostname) return true;
  if (LOCAL_HOSTS.has(hostname)) return true;
  if (hostname.endsWith('.local')) return true;
  // Netlify branch/deploy previews: deploy-preview-12--flexyn.netlify.app
  if (hostname.includes('--') && hostname.endsWith('.netlify.app')) return true;
  return false;
}

/**
 * Pure resolver, so the rules are testable without standing up a window.
 *
 * @param {{hostname?: string, origin?: string, configured?: string}} input
 * @returns {string} an https origin with no trailing slash
 */
export function resolveOrigin({ hostname, origin, configured } = {}) {
  // A configured public origin is a deliberate deployment decision and wins
  // over whatever host this happens to be served from. Ignored unless it is
  // a plausible https origin — a typo here would be baked into print.
  const clean = String(configured || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[^\s/]+$/.test(clean)) return clean;

  if (!origin || isEphemeralHost(hostname)) return FALLBACK_ORIGIN;
  return String(origin).replace(/\/+$/, '');
}

/**
 * The origin to embed in a durable link (printed QR, signage PDF).
 * @returns {string} e.g. "https://flexyn.netlify.app" — never a trailing slash
 */
export function canonicalOrigin() {
  const configured = import.meta.env?.VITE_PUBLIC_ORIGIN;
  if (typeof window === 'undefined' || !window.location) {
    return resolveOrigin({ configured });
  }
  const { hostname, origin } = window.location;
  return resolveOrigin({ hostname, origin, configured });
}

/** The URL a gym's signage QR encodes. Scanning it opens that gym in Flexyn. */
export function gymCheckinUrl(flexynCode) {
  return `${canonicalOrigin()}/checkin/${flexynCode}`;
}

/**
 * The marketing site, when it is ready to receive traffic from the app.
 *
 * flexyn.app is the front door — what the app is, the App Store and Play
 * links, reviews. Someone who scans a gym poster without an account wants
 * that page, not the app's own read-only gym view: they cannot use
 * anything the app would show them until they install it.
 *
 * Returns null until VITE_MARKETING_ORIGIN is set, because as of
 * 2026-08-09 flexyn.app 404s on /p/gym/:id — handing a scanner a 404 is
 * worse than the app page they get today. Set it in Netlify once that
 * route exists, and the handoff turns on with no release.
 *
 * @returns {string|null} an https origin with no trailing slash, or null
 */
export function marketingOrigin() {
  const clean = String(import.meta.env?.VITE_MARKETING_ORIGIN || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+$/.test(clean) ? clean : null;
}

/**
 * Where to send someone who has no account and wants to know what this
 * gym is. The marketing site when it can take them, this app's own public
 * gym page otherwise.
 *
 * @param {string} gymId
 * @returns {string} absolute URL, or an app-relative path
 */
export function publicGymUrl(gymId) {
  const marketing = marketingOrigin();
  return marketing ? `${marketing}/p/gym/${gymId}` : `/p/gym/${gymId}`;
}

/**
 * The origin for a link someone ELSE will open: a share sheet, a referral
 * link, a profile QR.
 *
 * In a browser this is exactly `window.location.origin`, as it always was:
 * whatever host the user is on is the host their friend should get. In the
 * native app it is not — the web view's origin is capacitor://localhost (iOS)
 * or https://localhost (Android), which resolves only on the sender's own
 * phone — so the app shares the public origin instead, by the same rules as
 * a printed QR (canonicalOrigin above).
 *
 * @returns {string} an origin with no trailing slash, or '' with no window
 */
export function shareOrigin() {
  if (typeof window === 'undefined' || !window.location) return '';
  return isNative() ? canonicalOrigin() : window.location.origin;
}

/**
 * The address printed on a share-card image. The image is permanent (it
 * lives on in someone's Stories, camera roll or group chat), so it takes
 * the durable origin, like a printed QR, and drops the scheme to read as
 * an address rather than a link.
 *
 * @returns {string} e.g. "flexyn.netlify.app"
 */
export function shareCardHost() {
  return canonicalOrigin().replace(/^https?:\/\//, '');
}

/**
 * The link attached to a share sheet next to a card image, tagged with
 * ?ref= so analytics can tell which card brought a visitor in
 * (acquisitionProps in src/lib/analytics.js). The tag must not look like a
 * referral code, which ?ref= also carries: keep it a slug with an
 * underscore, e.g. "share_pr".
 *
 * @param {string} tag
 * @returns {string}
 */
export function shareCardLink(tag) {
  return `${canonicalOrigin()}/?ref=${encodeURIComponent(tag)}`;
}
