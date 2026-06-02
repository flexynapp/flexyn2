// src/lib/push-sw.js
//
// Custom service worker. Two responsibilities:
//
//   1. App shell caching — handled by Workbox via the precache manifest
//      that vite-plugin-pwa injects into self.__WB_MANIFEST below.
//   2. Web Push delivery — handles `push` events from the browser and
//      `notificationclick` events when the user taps a notification.
//
// The push and click handlers are what the auto-generated Workbox SW
// can't provide — they're why we switched to `injectManifest` mode.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

// Plugin injects the precache file list here.
precacheAndRoute(self.__WB_MANIFEST);

// Drop old precaches when the SW updates (auto-update mode = activate on
// new content-hashed manifest).
cleanupOutdatedCaches();

// ── Navigation requests: NETWORK-FIRST, not cache-first ─────────────────
//
// The default precacheAndRoute strategy intercepts navigation requests
// (i.e. document loads — when the user types the URL or refreshes) and
// serves the precached index.html, falling back to the network only on
// cache miss. That means a returning user with an old SW gets served
// the OLD index.html forever — which references OLD content-hashed
// chunk filenames. When those filenames change in a new deploy (and
// they always do), the browser hits 404 on the chunks the old shell
// asked for, OR (worse) hits stale JS that crashes at top-level.
//
// Network-first inverts the priority for navigation: try the network
// first, fall back to the cached shell only if offline. Returning
// users get the FRESH index.html on every visit, which references the
// current chunk hashes. Online users always self-heal after a deploy.
//
// We keep the precache for asset (JS/CSS/icon) requests — those use
// content-hashed filenames so cache-first is correct and free of the
// stale-reference problem above.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: 'flexyn-html-shell',
      networkTimeoutSeconds: 4, // fall back to cache only if network is slow/offline
    })
  )
);

// ── Push event ──────────────────────────────────────────────────────────────
// Fires when a Web Push message arrives from the server. The payload is
// JSON we set ourselves in supabase/functions/send-push/index.ts.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Plain-text fallback — should rarely happen with our own sender.
    // text() itself can throw if data is opaque/binary; nest the
    // try/catch so a malformed push never aborts the SW.
    try {
      payload = { title: 'Flexyn', body: event.data.text() };
    } catch {
      payload = { title: 'Flexyn', body: '' };
    }
  }

  const title = payload.title || 'Flexyn';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    // tag lets new pushes REPLACE old ones with the same tag, instead
    // of stacking. Useful for "you have 3 new follows" → user only
    // sees the latest count, not 3 separate banners.
    tag: payload.tag,
    // Store the deep-link URL on the notification so the click handler
    // can route the user to the right page. Default to /dashboard
    // rather than / — root is the Splash page; signed-in users land
    // on the dashboard for free, so an empty url should match.
    data: { url: payload.url || '/dashboard' },
    // Make the notification require user interaction (won't auto-dismiss
    // before the user notices it). Good for important nudges; relax
    // per-notification if needed.
    requireInteraction: false,
  };

  // Wrap showNotification in a Promise so a synchronous throw is
  // caught + a rejection doesn't surface as an unhandled error in
  // the service worker (which Chrome logs to the user's DevTools).
  event.waitUntil(
    Promise.resolve()
      .then(() => self.registration.showNotification(title, options))
      .catch(() => { /* non-critical — the push silently dropping is
                         better than the SW aborting on a malformed row */ })
  );
});

// ── Notification click ──────────────────────────────────────────────────────
// When the user taps the notification, focus an existing app tab if one
// exists; otherwise open a new tab. Either way navigate to the URL we
// stamped on the notification.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Reuse an open app window if available — better UX than opening
      // a duplicate tab for every notification.
      for (const client of allClients) {
        if ('navigate' in client) {
          try {
            await client.navigate(targetUrl);
            return client.focus();
          } catch { /* navigation blocked, try next */ }
        }
      }
      // No open window — open one.
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })()
  );
});

// ── Skip-waiting / install lifecycle ────────────────────────────────────────
// Activate immediately when a new SW version is downloaded so push handlers
// stay current with the deployed code.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
