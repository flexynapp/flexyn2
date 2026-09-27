// src/lib/analytics.js
//
// Product analytics: which features people use, so launch marketing money
// goes where retention actually comes from. Sentry answers "what broke";
// nothing answered "did the person who signed up yesterday log a workout".
//
// OFF unless VITE_POSTHOG_KEY is set at build time. With no key every export
// is a no-op, so tests, local dev and any build without the key send nothing.
//
// No SDK on purpose. posthog-js is ~50 KB and brings autocapture, session
// recording and cookies we do not want in a health app. PostHog's capture
// endpoint takes one JSON POST, which is all this file does.
//
// What is sent, and nothing else:
//   • an event name from EVENTS below
//   • the Supabase user id (a random UUID) once signed in, else a random
//     per-device id. Never an email, a username or a name.
//   • the page as a ROUTE TEMPLATE (/duel-invite/:token, not the token)
//   • a few small properties per event (e.g. which share card). Callers pass
//     labels, never health numbers: no weights, calories, cycle data or text.
//   • on app_opened only, where the visit came from: a ?ref= channel tag
//     (e.g. "reddit"), utm_source / utm_medium / utm_campaign, and the
//     referring SITE's hostname. Never the referring URL's path or query,
//     and never a referral code (that becomes the label "referral").
//
// The user can turn it off in Settings > Privacy (per device), and a browser
// sending Do Not Track or Global Privacy Control is treated as opted out.
// The privacy policy (src/pages/Legal.jsx) names PostHog as a processor.

const KEY  = import.meta.env.VITE_POSTHOG_KEY || '';
const HOST = (import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');

const DEVICE_ID_KEY = 'flexyn.analytics.deviceId';
const OPT_OUT_KEY   = 'flexyn.analytics.optOut';

/** Every event this app sends. A name not listed here is dropped. */
export const EVENTS = Object.freeze({
  APP_OPENED:           'app_opened',
  SIGNED_UP:            'signed_up',
  SIGNED_IN:            'signed_in',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  WORKOUT_LOGGED:       'workout_logged',
  CARDIO_LOGGED:        'cardio_logged',
  MEAL_LOGGED:          'meal_logged',
  WATER_LOGGED:         'water_logged',
  GOAL_CREATED:         'goal_created',
  POST_CREATED:         'post_created',
  COACH_MESSAGE:        'coach_message',
  SHARED:               'shared',
  DUEL_INVITE_CREATED:  'duel_invite_created',
  DUEL_INVITE_ACCEPTED: 'duel_invite_accepted',
  REFERRAL_CLAIMED:     'referral_claimed',
  ONBOARDING_STEP:      'onboarding_step',
  PUSH_ENABLED:         'push_enabled',
  // The stat strip and the one next step that replaced the page carousels.
  // Each carries { page, id } only: which page and which tile or feature.
  GLANCE_TILE_OPENED:   'glance_tile_opened',
  NEXT_STEP_SHOWN:      'next_step_shown',
  NEXT_STEP_OPENED:     'next_step_opened',
  NEXT_STEP_DISMISSED:  'next_step_dismissed',
});
const KNOWN = new Set(Object.values(EVENTS));

/** True when this build was made with a PostHog key. Settings hides its
 *  toggle otherwise, since there would be nothing to turn off. */
export const ANALYTICS_CONFIGURED = Boolean(KEY);

let _userId = null;

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function browserSaysNo() {
  if (typeof navigator === 'undefined') return false;
  return navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
}

/** True when this build has a key and this device has not opted out. */
export function isAnalyticsEnabled() {
  if (!KEY) return false;
  if (browserSaysNo()) return false;
  return storage()?.getItem(OPT_OUT_KEY) !== '1';
}

/** Settings toggle reads this. True = the user turned analytics off here. */
export function isAnalyticsOptedOut() {
  return browserSaysNo() || storage()?.getItem(OPT_OUT_KEY) === '1';
}

export function setAnalyticsOptOut(optOut) {
  try {
    if (optOut) storage()?.setItem(OPT_OUT_KEY, '1');
    else storage()?.removeItem(OPT_OUT_KEY);
  } catch { /* private mode: the choice lasts for this session only */ }
}

function deviceId() {
  const s = storage();
  try {
    let id = s?.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      s?.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

/**
 * The page as a route template. Query strings and hashes are dropped
 * entirely (they carry auth tokens and, on /hub?profile=, an email), and the
 * path segments that are identifiers are replaced by their parameter name.
 */
export function routeTemplate(pathname = '') {
  const p = String(pathname || '/').split(/[?#]/)[0] || '/';
  if (/^\/@[^/]+/.test(p)) return '/@:username';
  return p
    .replace(/^\/duel-invite\/[^/]+/, '/duel-invite/:token')
    .replace(/^\/checkin\/[^/]+/, '/checkin/:code')
    .replace(/^\/p\/gym\/[^/]+/, '/p/gym/:id')
    .replace(/^\/gym\/[^/]+/, '/gym/:id')
    // Any remaining UUID or long opaque segment is an identifier too.
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:id');
}

const TAG_RE = /^[a-z0-9][a-z0-9_.-]{0,39}$/i;
// Same shape as isReferralCodeShape in src/lib/data/referrals.js (not
// imported: this module must stay free of the supabase client).
const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

/**
 * Where this visit came from, as short labels. Pure: pass the page's
 * search string, the document.referrer and this site's own hostname.
 *
 * - ?ref= is shared with friend referral codes (src/lib/data/referrals.js).
 *   A code-shaped value is reported as "referral", never as the code.
 * - Tags that aren't plain slugs are dropped, not cleaned.
 * - The referrer is reduced to its hostname, and dropped when it is this
 *   site (an in-app reload is not an acquisition channel).
 */
export function acquisitionProps(search = '', referrer = '', ownHost = '') {
  const out = {};
  let params;
  try { params = new URLSearchParams(search || ''); } catch { params = new URLSearchParams(); }
  const ref = (params.get('ref') || '').trim();
  if (ref) {
    if (REFERRAL_CODE_RE.test(ref.toUpperCase())) out.ref = 'referral';
    else if (TAG_RE.test(ref)) out.ref = ref.toLowerCase();
  }
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const v = (params.get(k) || '').trim();
    if (v && TAG_RE.test(v)) out[k] = v.toLowerCase();
  }
  try {
    const host = referrer ? new URL(referrer).hostname.replace(/^www\./, '') : '';
    const own = String(ownHost || '').replace(/^www\./, '');
    if (host && host !== own && TAG_RE.test(host)) out.referrer_domain = host.toLowerCase();
  } catch { /* not a URL */ }
  return out;
}

/** acquisitionProps for the page this script is running on. Read it before
 *  anything rewrites the URL (the referral capture strips ?ref=). */
export function currentAcquisition() {
  if (typeof window === 'undefined' || !window.location) return {};
  return acquisitionProps(
    window.location.search,
    typeof document !== 'undefined' ? document.referrer : '',
    window.location.hostname,
  );
}

/** Only short labels, numbers and booleans survive. */
export function cleanProps(props = {}) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'string' && v.length <= 40 && !v.includes('@')) out[k] = v;
  }
  return out;
}

function send(event, distinctId, properties) {
  const body = JSON.stringify({
    api_key: KEY,
    event,
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
    properties: {
      ...properties,
      $lib: 'flexyn-web',
      $current_url: typeof window !== 'undefined' ? routeTemplate(window.location.pathname) : undefined,
      $process_person_profile: Boolean(_userId),
    },
  });
  try {
    // keepalive lets an event fired right before navigation still land.
    fetch(`${HOST}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => { /* analytics must never surface an error */ });
  } catch { /* same */ }
}

/**
 * Record one event. Safe to call from anywhere, any number of times: it
 * never throws, never awaits, and does nothing when analytics is off.
 */
export function track(event, props) {
  if (!KNOWN.has(event) || !isAnalyticsEnabled()) return;
  send(event, _userId || deviceId(), cleanProps(props));
}

/**
 * Tie this device's events to the signed-in account. Called from
 * AuthContext on sign-in. The first identify on a device also links the
 * anonymous pre-signup events (the landing page, the invite) to the account.
 */
export function identify(userId, { isGuest = false } = {}) {
  if (!userId) return;
  const first = _userId !== userId;
  _userId = userId;
  if (!first || !isAnalyticsEnabled()) return;
  send('$identify', userId, { $anon_distinct_id: deviceId(), $set: { is_guest: Boolean(isGuest) } });
}

/** Sign-out: later events on this device are anonymous again. */
export function resetAnalytics() {
  _userId = null;
}
