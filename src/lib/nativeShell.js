// src/lib/nativeShell.js
//
// Native chrome for the Capacitor app: the status bar's text colour and the
// launch splash. A no-op in every browser, and the plugins are dynamically
// imported so the web bundle's startup path does not carry them.
//
// Safe areas need nothing here. index.html already sets
// `viewport-fit=cover`, the app pads with env(safe-area-inset-*) through
// Layout and `.safe-page`, and both platforms feed those values:
//   • iOS: capacitor.config.json sets ios.contentInset 'never', so the web
//     view runs under the status bar and home indicator exactly as an
//     installed PWA does, and WKWebView reports the insets to CSS.
//   • Android: Capacitor 8's SystemBars handling ('css', with a 'cover'
//     hint) makes the web view edge to edge and reports the real insets.
// If a screen looks jammed into the status bar in the app, the bug is the
// same one CLAUDE.md describes for the PWA (an edge-positioned surface
// outside Layout without `.safe-page`), not something to patch here.

import { isNative } from '@/lib/native';

/**
 * Status bar text follows the app theme. ThemeContext toggles `dark` on
 * <html>; watching that class keeps this module out of ThemeContext.
 * Style.Dark means LIGHT text, for a dark background.
 */
async function syncStatusBar() {
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  const root = document.documentElement;
  const apply = () => {
    const dark = root.classList.contains('dark');
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
  };
  apply();
  if (typeof MutationObserver === 'function') {
    new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['class'] });
  }
}

/**
 * The launch splash is held (SplashScreen.launchAutoHide = false in
 * capacitor.config.json) until the web app has painted, so the user never
 * sees a blank web view between the native splash and the first frame.
 */
async function hideSplashAfterPaint() {
  const { SplashScreen } = await import('@capacitor/splash-screen');
  await new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') { resolve(); return; }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  await SplashScreen.hide();
}

/** Call once, after the first React render. Never throws. */
export function initNativeShell() {
  if (!isNative()) return;
  syncStatusBar().catch(() => {});
  hideSplashAfterPaint().catch(() => {
    // If the plugin failed, try once more so a stuck splash cannot hide
    // a working app.
    import('@capacitor/splash-screen')
      .then(({ SplashScreen }) => SplashScreen.hide())
      .catch(() => {});
  });
}
