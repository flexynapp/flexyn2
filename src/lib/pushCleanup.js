// src/lib/pushCleanup.js
//
// Unsubscribe this device from Web Push AND delete the corresponding
// row in public.push_subscriptions. Called before sign-out so the next
// user on this device doesn't inherit the previous user's pushes.
//
// MUST be called BEFORE supabase.auth.signOut() — the row deletion
// uses RLS scoped to the currently-authenticated user (policy
// "push: delete own" from migration 033). After sign-out, auth.uid()
// resolves to NULL and the delete becomes a no-op, orphaning the row.
//
// Returns silently on any failure — push cleanup must never block
// the sign-out flow.

import { supabase } from '@/api/supabaseClient';

export async function unsubscribePushOnLogout() {
  try {
    if (typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;

    const endpoint = sub.endpoint;

    // 1. Tell the browser's push service to stop delivering. This is
    //    best-effort — Safari and some private browsing modes will throw.
    try { await sub.unsubscribe(); } catch { /* ignored */ }

    // 2. Delete the corresponding server row. RLS limits this to the
    //    caller's own subscription, and the WHERE clause on endpoint
    //    keeps multi-device users from accidentally deleting their
    //    other devices.
    try {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);
    } catch { /* network or RLS failure — leave the row for next subscribe */ }
  } catch {
    // Top-level catch so a misbehaving SW or push API never blocks
    // sign-out. The caller still proceeds.
  }
}
