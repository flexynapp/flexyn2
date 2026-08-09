// src/lib/appOrigin.js
//
// The origin you are allowed to bake into something PERMANENT.
//
// `window.location.origin` is right for a share sheet — whatever host the
// user is on is the host their friend should get. It is wrong for a QR
// that gets printed, laminated and screwed to a gym wall: generate the
// signage from a dev server and the poster points at http://localhost:5173
// forever, and nobody finds out until a member scans it and gets nothing.
// Same for a Netlify deploy preview, which stops resolving the moment the
// branch is deleted.
//
// So: use the live origin when it is one a stranger's phone can reach, and
// fall back to production when it isn't.
//
// PRODUCTION_ORIGIN is the one place to change if Flexyn moves to a custom
// domain. It matches the og:url in index.html; note that a printed poster
// generated before such a move keeps pointing at the old host, so a domain
// change means reprinting signage (or a redirect at the old host).

const PRODUCTION_ORIGIN = 'https://flexyn.netlify.app';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/** True for hosts that only resolve on this machine or for a short while. */
function isEphemeral(hostname) {
  if (!hostname) return true;
  if (LOCAL_HOSTS.has(hostname)) return true;
  if (hostname.endsWith('.local')) return true;
  // Netlify branch/deploy previews: deploy-preview-12--flexyn.netlify.app
  if (hostname.includes('--') && hostname.endsWith('.netlify.app')) return true;
  return false;
}

/**
 * The origin to embed in a durable link (printed QR, signage PDF).
 * @returns {string} e.g. "https://flexyn.netlify.app" — never a trailing slash
 */
export function canonicalOrigin() {
  if (typeof window === 'undefined' || !window.location) return PRODUCTION_ORIGIN;
  const { hostname, origin } = window.location;
  if (!origin || isEphemeral(hostname)) return PRODUCTION_ORIGIN;
  return origin;
}

/** The URL a gym's signage QR encodes. Scanning it opens that gym in Flexyn. */
export function gymCheckinUrl(flexynCode) {
  return `${canonicalOrigin()}/checkin/${flexynCode}`;
}
