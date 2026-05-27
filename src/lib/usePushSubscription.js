// src/lib/usePushSubscription.js
//
// React hook that manages the Web Push subscription lifecycle for the
// current user. Drives the opt-in toggle in Settings; downstream code
// (notifications.js → server-side send-push Edge Function) consumes
// the subscriptions saved here.
//
// Returns:
//   permission        'default' | 'granted' | 'denied'   (live browser state)
//   isSubscribed      bool — true when a subscription exists on THIS device
//   isSupported       bool — false on Safari < 16, Firefox without VAPID key, etc.
//   isLoading         bool — true while a subscribe/unsubscribe is in flight
//   subscribe()       async — request permission + create + persist subscription
//   unsubscribe()     async — revoke + delete the device subscription row
//
// VAPID public key comes from import.meta.env.VITE_VAPID_PUBLIC_KEY at
// build time. Without it the hook reports isSupported=false and the
// subscribe call no-ops — the Settings UI shows a "configure server"
// hint instead of a broken button.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';

const VAPID_PUBLIC_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_VAPID_PUBLIC_KEY) || '';

// Convert a url-safe base64 VAPID key into the Uint8Array the Push API
// expects. Standard helper — pulled from the MDN Push API docs.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

// Extract the (p256dh, auth) keys from a PushSubscription and base64-
// encode them in url-safe form (matches what the Web Push protocol
// expects on the server side).
function subscriptionKeys(subscription) {
  const json = subscription.toJSON();
  return {
    endpoint:   json.endpoint,
    p256dh_key: json.keys?.p256dh || '',
    auth_key:   json.keys?.auth || '',
  };
}

export function usePushSubscription() {
  const [permission, setPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Feature detection: Service Worker + Push API + a configured VAPID key.
  // Without the VAPID key the server can't sign push payloads, so we
  // refuse to even prompt for permission — better UX than asking and
  // then doing nothing useful with it.
  const isSupported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && typeof Notification !== 'undefined'
    && VAPID_PUBLIC_KEY.length > 0;

  // Check whether THIS device already has an active subscription so the
  // Settings toggle reflects reality (e.g. if the user installed the PWA
  // on this device a week ago and just came back).
  useEffect(() => {
    if (!isSupported) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setIsSubscribed(!!existing);
      } catch (err) {
        console.warn('[push] subscription check failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isSupported]);

  // Synchronous in-flight guard against rapid toggle taps. `isLoading`
  // state lags React renders — two fast taps both pass `!isLoading`,
  // both fire requestPermission + pushManager.subscribe + RPC, and the
  // second-resolving call can race the first's failure-branch
  // `subscription.unsubscribe()` and leave the browser sub revoked
  // while the server still has the second row. Wave 54 caught this.
  const subscribeInFlightRef = useRef(false);
  const unsubscribeInFlightRef = useRef(false);

  const subscribe = useCallback(async () => {
    if (!isSupported) return { ok: false, reason: 'unsupported' };
    if (subscribeInFlightRef.current) return { ok: false, reason: 'in_flight' };
    subscribeInFlightRef.current = true;
    setIsLoading(true);
    try {
      // 1. Ask the browser for permission. If the user already granted,
      //    this resolves immediately. If they previously denied, we can't
      //    re-prompt — they have to go into browser settings.
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        return { ok: false, reason: result }; // 'denied' or 'default' (dismissed)
      }

      // 2. Get the service worker registration. The PWA plugin (registered
      //    via main.jsx) makes this available once the SW activates.
      const reg = await navigator.serviceWorker.ready;

      // 3. Create OR re-fetch the subscription. The Push API gives back
      //    the same endpoint if you've already subscribed on this device,
      //    so this is idempotent on the client side too.
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true, // Web Push requires user-visible notifications
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // 4. Save to the server via the upsert RPC (idempotent — same
      //    endpoint refreshes the row instead of duplicating).
      const { endpoint, p256dh_key, auth_key } = subscriptionKeys(subscription);
      const { error } = await supabase.rpc('upsert_push_subscription', {
        p_endpoint:   endpoint,
        p_p256dh_key: p256dh_key,
        p_auth_key:   auth_key,
        p_user_agent: navigator.userAgent || null,
      });
      if (error) {
        // RPC failed — undo the browser-side subscription so we don't
        // leave a dangling local subscription with no server row.
        try { await subscription.unsubscribe(); } catch { /* ignore */ }
        console.warn('[push] upsert RPC failed:', error);
        return { ok: false, reason: 'server_error', error };
      }

      setIsSubscribed(true);
      return { ok: true };
    } catch (err) {
      console.warn('[push] subscribe failed:', err);
      return { ok: false, reason: 'error', error: err };
    } finally {
      setIsLoading(false);
      subscribeInFlightRef.current = false;
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return { ok: false, reason: 'unsupported' };
    if (unsubscribeInFlightRef.current) return { ok: false, reason: 'in_flight' };
    unsubscribeInFlightRef.current = true;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      // Capture the endpoint BEFORE unsubscribing so we can still
      // delete the matching server row even if subscription.unsubscribe
      // throws (PushManager state desync). Audit 14 #35.
      const endpoint = subscription ? subscriptionKeys(subscription).endpoint : null;

      if (subscription) {
        // Browser-side unsubscribe — tolerate failure. If the browser
        // refuses to revoke, we'd rather still delete the server row
        // (which is the canonical "is this device subscribed" record)
        // so the next push doesn't go to a stale endpoint.
        try { await subscription.unsubscribe(); }
        catch (e) { console.warn('[push] browser unsubscribe threw:', e); }
      }

      // ALWAYS attempt to delete the server row when we have an
      // endpoint. The UA-fallback path the previous code used was
      // unsafe: two devices with identical user_agent strings (very
      // common — two iPhones of the same model on the same iOS version)
      // would both match the .eq('user_agent', ...) filter and the
      // "purge this device" intent would collateral-delete the OTHER
      // device's subscription. Wave 54 (Notifications audit) caught
      // this. We accept the trade-off: a user who lost their browser
      // sub (cleared site data, switched browsers) gets stale server
      // rows until the 410-Gone cleanup catches them on the next
      // push attempt — a slow but correct cleanup, not a fast but
      // device-misidentifying one.
      if (endpoint) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
      }
      // else: server row stays until 410-Gone sweep; intentional.

      setIsSubscribed(false);
      return { ok: true };
    } catch (err) {
      console.warn('[push] unsubscribe failed:', err);
      return { ok: false, reason: 'error', error: err };
    } finally {
      unsubscribeInFlightRef.current = false;
      setIsLoading(false);
    }
  }, [isSupported]);

  return {
    permission,
    isSubscribed,
    isSupported,
    isLoading,
    subscribe,
    unsubscribe,
  };
}
