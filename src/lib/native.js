// src/lib/native.js
//
// Which shell is this bundle running in: a browser tab / installed PWA, or
// the Capacitor app from the App Store or Google Play.
//
// The SAME dist/ ships to both. Netlify serves it to browsers, and
// `npx cap sync` copies it into ios/App/App/public and
// android/app/src/main/assets/public. So every difference between the two is
// a runtime branch on these helpers, and the rule for every branch is the
// same: THE WEB PATH IS THE DEFAULT AND MUST NOT CHANGE. A helper that cannot
// tell (no Capacitor bridge, a test environment, anything thrown) answers
// "web".
//
// Why a module and not `Capacitor.isNativePlatform()` at each call site:
// @capacitor/core's web implementation is tiny, but tests stub it, and a
// single seam means one mock covers the app. It also keeps the answer
// synchronous, which matters: the Supabase client is created at import time
// and has to know its auth flow before the first line of React runs.
//
// What differs on native, and where it is handled:
//   • No service worker. WKWebView serves the bundle from capacitor://, which
//     cannot register one, and the app updates through the store rather than
//     a waiting worker. AppUpdatePrompt returns before importing the
//     registration module.
//   • No Web Push and no "install this app" prompts. usePushSubscription
//     reports unsupported; PWAInstallPrompt and IosInstallBanner stay quiet.
//     Native push (APNs / FCM) is a separate, later piece of work.
//   • OAuth leaves the web view for the system browser and comes back on a
//     deep link. See nativeAuth.js.

import { Capacitor } from '@capacitor/core';

/** The custom URL scheme the native app registers. Matches appId. */
export const NATIVE_URL_SCHEME = 'app.flexyn';

/**
 * Where OAuth and magic-link flows return to inside the native app.
 * Registered in ios/App/App/Info.plist (CFBundleURLTypes) and
 * android/app/src/main/AndroidManifest.xml (intent-filter), and it must also
 * be listed in Supabase Auth → URL Configuration → Redirect URLs or GoTrue
 * refuses to redirect to it.
 */
export const NATIVE_AUTH_CALLBACK = `${NATIVE_URL_SCHEME}://auth-callback`;

/** True inside the iOS or Android app, false in any browser. */
export function isNative() {
  try {
    return Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** 'ios' | 'android' | 'web'. Anything unexpected reads as 'web'. */
export function platform() {
  try {
    const p = Capacitor?.getPlatform?.();
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch {
    return 'web';
  }
}

/** True only in the iOS app. Native Sign in with Apple is iOS-only. */
export function isNativeIos() {
  return isNative() && platform() === 'ios';
}
