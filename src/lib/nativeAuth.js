// src/lib/nativeAuth.js
//
// Sign-in inside the iOS / Android app. NOTHING here runs on the web: every
// entry point is reached only behind `isNative()`, and the web keeps the
// full-page redirect it has always used (db.auth.signInWithProvider).
//
// ── Why OAuth cannot simply run in the web view ─────────────────────
//
// Google refuses OAuth inside an embedded web view ("disallowed_useragent",
// Error 403), and Apple's review guidelines expect the system sheet. So on
// native the provider page opens in the SYSTEM browser — SFSafariViewController
// on iOS, a Custom Tab on Android — via @capacitor/browser, and GoTrue
// redirects back to a custom-scheme deep link:
//
//   app.flexyn://auth-callback?code=<pkce code>
//
// The OS hands that URL to the app, @capacitor/app fires `appUrlOpen`, and
// we trade the code for a session with `exchangeCodeForSession`. That is the
// PKCE flow, which is why supabaseClient.js switches `flowType` to 'pkce' on
// native ONLY: PKCE keeps the code verifier in this app's storage, so an
// intercepted deep link is useless to anyone else. The web stays on the
// implicit flow, because switching it would break a magic link opened in a
// different browser from the one that asked for it.
//
// ── Sign in with Apple ──────────────────────────────────────────────
//
// On iOS the native sheet (ASAuthorizationController) is used rather than
// the web flow. The plugin is a few lines of Swift that live IN the app
// target (ios/App/App/FlexynBridgeViewController.swift), not an npm
// dependency: the community plugin pins Capacitor 7 in its Swift package and
// cannot resolve against Capacitor 8. It returns Apple's identity token,
// which goes to `signInWithIdToken`. The nonce is the standard replay guard:
// Apple is given SHA-256(raw), Supabase is given raw, and GoTrue checks that
// the token's nonce claim is the hash of what it was given.
//
// On Android and the web, Apple is the ordinary OAuth redirect.
//
// ── Supabase configuration this depends on (see docs/native-app.md) ──
//
//   • app.flexyn://auth-callback listed under Auth → URL Configuration →
//     Redirect URLs. Without it GoTrue ignores redirectTo and sends the user
//     to the Site URL — the Netlify web app, in the system browser — and the
//     app never hears back.
//   • The Apple provider enabled, with the iOS bundle id (app.flexyn) among
//     its client ids so a native identity token is accepted.

import { registerPlugin } from '@capacitor/core';
import { supabase } from '@/api/supabaseClient';
import { isNativeIos, NATIVE_AUTH_CALLBACK } from '@/lib/native';

/** The in-app Swift plugin. See ios/App/App/FlexynBridgeViewController.swift. */
export const FlexynAppleSignIn = registerPlugin('FlexynAppleSignIn');

// Codes already traded, so a URL delivered twice (cold start delivers it via
// getLaunchUrl AND appUrlOpen on some OS versions) is exchanged once. A code
// is single-use at GoTrue, so a second exchange would fail and surface an
// error toast over a sign-in that actually worked.
const handledCodes = new Set();

/** Test seam. */
export function _resetHandledCodesForTest() {
  handledCodes.clear();
}

/**
 * Parse a deep link. Returns null for anything that is not our auth
 * callback, so other deep links (future: gym check-in, duel invites) pass
 * through untouched.
 *
 * @param {string} url
 * @returns {null | { code?: string, accessToken?: string, refreshToken?: string,
 *   error?: string, errorDescription?: string }}
 */
export function parseAuthCallback(url) {
  if (typeof url !== 'string' || !url.startsWith(NATIVE_AUTH_CALLBACK)) return null;
  // The character after the prefix must end the path, or
  // app.flexyn://auth-callbackish would match.
  const next = url.charAt(NATIVE_AUTH_CALLBACK.length);
  if (next && !['?', '#', '/'].includes(next)) return null;

  const params = new URLSearchParams();
  const hashAt = url.indexOf('#');
  const queryAt = url.indexOf('?');
  if (queryAt !== -1) {
    const end = hashAt !== -1 && hashAt > queryAt ? hashAt : url.length;
    new URLSearchParams(url.slice(queryAt + 1, end)).forEach((v, k) => params.set(k, v));
  }
  // Implicit-flow tokens and some GoTrue errors arrive in the fragment.
  if (hashAt !== -1) {
    new URLSearchParams(url.slice(hashAt + 1)).forEach((v, k) => params.set(k, v));
  }

  const out = {};
  if (params.get('code')) out.code = params.get('code');
  if (params.get('access_token')) out.accessToken = params.get('access_token');
  if (params.get('refresh_token')) out.refreshToken = params.get('refresh_token');
  if (params.get('error')) out.error = params.get('error');
  if (params.get('error_description')) out.errorDescription = params.get('error_description');
  return out;
}

async function closeBrowser() {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch {
    // Android Custom Tabs cannot be closed programmatically and some
    // versions reject; the deep link has already brought the app forward.
  }
}

/**
 * Finish a sign-in from a deep link.
 *
 * @param {string} url
 * @returns {Promise<{handled: boolean, ok?: boolean, error?: string}>}
 *   handled=false means the URL was not an auth callback at all.
 */
export async function completeAuthFromUrl(url) {
  const parsed = parseAuthCallback(url);
  if (!parsed) return { handled: false };

  await closeBrowser();

  if (parsed.error) {
    return { handled: true, ok: false, error: parsed.errorDescription || parsed.error };
  }

  if (parsed.code) {
    if (handledCodes.has(parsed.code)) return { handled: true, ok: true };
    handledCodes.add(parsed.code);
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (error) return { handled: true, ok: false, error: error.message || 'exchange_failed' };
    return { handled: true, ok: true };
  }

  if (parsed.accessToken && parsed.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    });
    if (error) return { handled: true, ok: false, error: error.message || 'set_session_failed' };
    return { handled: true, ok: true };
  }

  return { handled: true, ok: false, error: 'missing_code' };
}

/**
 * Listen for auth deep links for the life of the app. Call once, on native
 * only. Also drains the URL the app was COLD-started with: if the OS killed
 * the app while the user was in the browser, the callback is the launch URL
 * and no appUrlOpen event will ever fire for it.
 *
 * @param {{ onError?: (message: string) => void }} [opts]
 * @returns {() => void} cleanup
 */
export function initNativeAuthListener({ onError } = {}) {
  let handle = null;
  let cancelled = false;

  const run = async (url) => {
    try {
      const res = await completeAuthFromUrl(url);
      if (res.handled && !res.ok) onError?.(res.error);
    } catch (err) {
      onError?.(err?.message || 'callback_failed');
    }
  };

  (async () => {
    try {
      const { App } = await import('@capacitor/app');
      if (cancelled) return;
      handle = await App.addListener('appUrlOpen', (event) => { run(event?.url); });
      if (cancelled) { handle?.remove?.(); return; }
      const launch = await App.getLaunchUrl();
      if (!cancelled && launch?.url) run(launch.url);
    } catch (err) {
      onError?.(err?.message || 'listener_failed');
    }
  })();

  return () => {
    cancelled = true;
    try { handle?.remove?.(); } catch { /* tolerate */ }
  };
}

/**
 * OAuth through the system browser. Resolves once the browser is OPEN, not
 * when sign-in finishes — completion arrives on the deep link.
 *
 * @param {'google'|'apple'} provider
 */
export async function startNativeOAuth(provider) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: NATIVE_AUTH_CALLBACK, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('oauth_url_missing');
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url });
  return { status: 'browser_opened' };
}

/**
 * Link a provider to the CURRENT account (a guest upgrading) through the
 * system browser. Same PKCE round trip as startNativeOAuth, so the deep link
 * listener completes it; the difference is that the identity lands on the
 * signed-in guest instead of starting a new account.
 *
 * @param {'google'|'apple'} provider
 */
export async function startNativeLink(provider) {
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: NATIVE_AUTH_CALLBACK, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('oauth_url_missing');
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url });
  return { status: 'browser_opened' };
}

/** 32 random bytes, hex. The RAW nonce: it goes to Supabase, never to Apple. */
export function randomNonce(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lower-case hex SHA-256, which is the form Apple expects the nonce in. */
export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Native Sign in with Apple (iOS only).
 *
 * @returns {Promise<{status: 'signed_in'} | {status: 'cancelled'}>}
 */
export async function signInWithAppleNative() {
  const rawNonce = randomNonce();
  const hashedNonce = await sha256Hex(rawNonce);

  let res;
  try {
    res = await FlexynAppleSignIn.authorize({ nonce: hashedNonce });
  } catch (err) {
    // Dismissing the sheet is a choice, not a failure: no error toast.
    if (err?.code === 'CANCELED') return { status: 'cancelled' };
    throw err;
  }
  if (!res?.identityToken) throw new Error('apple_token_missing');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: res.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;

  // Apple hands over the name ONCE, on the first authorisation, and it is
  // not inside the identity token, so GoTrue never sees it. Keep it on the
  // auth user's metadata so it is not lost; best-effort, because the sign-in
  // itself has already succeeded.
  const fullName = [res.givenName, res.familyName].filter(Boolean).join(' ').trim();
  if (fullName) {
    try {
      await supabase.auth.updateUser({
        data: { full_name: fullName, given_name: res.givenName || null, family_name: res.familyName || null },
      });
    } catch { /* non-fatal */ }
  }
  return { status: 'signed_in' };
}

/**
 * The native sign-in entry point for a provider button.
 *
 * @param {'google'|'apple'} provider
 */
export function nativeSignIn(provider) {
  if (provider === 'apple' && isNativeIos()) return signInWithAppleNative();
  return startNativeOAuth(provider);
}
