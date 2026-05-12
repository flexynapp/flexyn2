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

// Plugin injects the precache file list here.
precacheAndRoute(self.__WB_MANIFEST);

// Drop old precaches when the SW updates (auto-update mode = activate on
// new content-hashed manifest).
cleanupOutdatedCaches();

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
    payload = { title: 'Flexyn', body: event.data.text() };
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
    // can route the user to the right page.
    data: { url: payload.url || '/' },
    // Make the notification require user interaction (won't auto-dismiss
    // before the user notices it). Good for important nudges; relax
    // per-notification if needed.
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ──────────────────────────────────────────────────────
// When the user taps the notification, focus an existing app tab if one
// exists; otherwise open a new tab. Either way navigate to the URL we
// stamped on the notification.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

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
