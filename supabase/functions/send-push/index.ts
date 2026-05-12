// supabase/functions/send-push/index.ts
//
// Web Push delivery Edge Function. Reads pending notifications (or
// directly-passed payloads) and sends Web Push messages to every
// subscription belonging to the target user.
//
// ── SETUP (one-time, before deploying) ───────────────────────────────────────
//
//   1. Generate a VAPID key pair on your dev machine:
//
//        npx web-push generate-vapid-keys
//
//      This prints { publicKey, privateKey }. Treat the private key like
//      a secret — anyone with it can send pushes to your users.
//
//   2. Add the PUBLIC key to your client build env:
//
//        # .env (vite reads VITE_* vars at build time)
//        VITE_VAPID_PUBLIC_KEY=B...your-public-key...
//
//      Without this, `usePushSubscription.js` reports isSupported=false and
//      the Settings toggle is hidden.
//
//   3. Store the PRIVATE key + your contact email as Supabase function
//      secrets so this Edge Function can read them at runtime:
//
//        supabase secrets set VAPID_PUBLIC_KEY="B..."
//        supabase secrets set VAPID_PRIVATE_KEY="..."
//        supabase secrets set VAPID_SUBJECT="mailto:ops@yourdomain.com"
//
//   4. Deploy the function:
//
//        supabase functions deploy send-push
//
//   5. Trigger sends from your application — e.g. from the
//      `create_notification_for` RPC's caller code, or via a DB trigger
//      that POSTs to this function whenever a new row is inserted into
//      the notifications table.
//
// ── INVOCATION ───────────────────────────────────────────────────────────────
//
// Request body (JSON):
//   {
//     user_id: "<uuid>",          // recipient — REQUIRED
//     title:   "...",
//     body:    "...",
//     icon:    "...",             // optional URL
//     url:     "/dashboard",      // optional deep link
//     tag:     "..."              // optional dedup tag
//   }
//
// The function fans out one push request per subscription row owned by
// user_id. 410 Gone responses cause the subscription to be deleted
// (the user uninstalled the app or revoked permission).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

// Service-role client — needed to read all push_subscriptions for any
// user. Never expose the service role key to clients.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')  || '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT')     || 'mailto:noreply@flexyn.app';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

interface PushPayload {
  user_id: string;
  title?: string;
  body?: string;
  icon?: string;
  url?: string;
  tag?: string;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: PushPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!payload.user_id) {
    return new Response(JSON.stringify({ error: 'user_id_required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Look up all of this user's active push subscriptions.
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh_key, auth_key')
    .eq('user_id', payload.user_id);
  if (error) {
    console.error('[send-push] subscription lookup failed:', error);
    return new Response(JSON.stringify({ error: 'lookup_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!subs || subs.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no_subscriptions' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = JSON.stringify({
    title: payload.title || 'Flexyn',
    body:  payload.body  || '',
    icon:  payload.icon  || '/icon-192.png',
    url:   payload.url   || '/',
    tag:   payload.tag,
  });

  const expired: string[] = []; // subscription IDs that returned 410 Gone
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
        },
        body
      );
      sent += 1;
    } catch (err: any) {
      // 410 Gone — subscription expired. Clean it up.
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        expired.push(sub.id);
      } else {
        console.warn('[send-push] delivery failed:', err?.statusCode, err?.message);
      }
    }
  }

  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expired);
  }

  return new Response(JSON.stringify({ ok: true, sent, removed: expired.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
