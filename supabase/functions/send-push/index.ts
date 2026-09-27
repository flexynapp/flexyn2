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
//   6. Set the shared-secret used by the DB trigger in migration 034 so
//      pg_net callers can authenticate without a Supabase JWT:
//
//        supabase secrets set SEND_PUSH_TRIGGER_SECRET="<random-256-bit-hex>"
//
//      Then mirror it onto the database so the trigger can read it:
//
//        ALTER DATABASE postgres SET app.send_push_url     =
//          'https://<project-ref>.functions.supabase.co/send-push';
//        ALTER DATABASE postgres SET app.send_push_secret  = '<same value>';
//
//      Generate the secret with: `openssl rand -hex 32`. Anyone with
//      this secret can fan out pushes to any user, so treat it like a
//      service-role key — never expose it to clients.
//
// ── AUTH ─────────────────────────────────────────────────────────────────────
//
// Callers MUST pass ONE of:
//
//   • `Authorization: Bearer <SUPABASE_ANON_KEY or service_role JWT>` — the
//     default Supabase function-invoke header. Used for client-initiated
//     test sends and admin tooling.
//
//   • `X-Send-Push-Secret: <SEND_PUSH_TRIGGER_SECRET>` — used by the DB
//     trigger (migration 034) which calls pg_net.http_post and cannot
//     mint Supabase JWTs.
//
// Requests missing both fail with 401. Without this, anyone on the
// public internet could fan out arbitrary push notifications to any
// user_id they could enumerate.
//
// ── INVOCATION ───────────────────────────────────────────────────────────────
//
// Request body (JSON) — SINGLE:
//   {
//     user_id: "<uuid>",          // recipient — REQUIRED
//     title:   "...",
//     body:    "...",
//     icon:    "...",             // optional URL
//     url:     "/dashboard",      // optional deep link
//     tag:     "..."              // optional dedup tag
//   }
//
// or BATCH (migration 222's statement-level trigger — one HTTP call per
// INSERT statement instead of one per row):
//   {
//     notifications: [ { user_id, title, body, icon, url, tag }, ... ]
//   }
//
// Batch mode is restricted to cross-user-authorized callers (trigger
// secret / service_role) — a user JWT gets 403 even if every item
// targets themselves; the single shape covers that case. Batches are
// capped at MAX_BATCH items; the DB trigger chunks to 200 per call.
//
// The function fans out one push request per subscription row owned by
// each target user (one subscription lookup for the whole batch).
// 410 Gone responses cause the subscription to be deleted (the user
// uninstalled the app or revoked permission).

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

// Shared secret used by the DB trigger in migration 034. When unset,
// trigger-style auth is disabled and only Bearer JWT auth is accepted —
// this keeps the function deployable for client-only testing without
// silently allowing anonymous fan-out.
const SEND_PUSH_TRIGGER_SECRET = Deno.env.get('SEND_PUSH_TRIGGER_SECRET') || '';

// Constant-time string compare. We don't want timing differences to
// leak the length or contents of the shared secret to a remote attacker
// who controls request timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Guard against an empty VAPID key pair. Without this, setVapidDetails
// accepts the empty strings, then every sendNotification call later
// throws a cryptic error from the web-push library. A clear 503 at
// the entry point makes a misconfigured deploy obvious from logs.
const VAPID_OK = VAPID_PUBLIC_KEY.length > 0 && VAPID_PRIVATE_KEY.length > 0;
if (VAPID_OK) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.error('[send-push] VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set — push delivery disabled.');
}

interface PushPayload {
  user_id: string;
  title?: string;
  body?: string;
  icon?: string;
  url?: string;
  tag?: string;
}

interface BatchPayload {
  notifications: PushPayload[];
}

// Upper bound on batch items per request. The DB trigger chunks at 200;
// this is a hard cap against a malformed/hostile oversized body.
const MAX_BATCH = 500;

function encodeItemBody(item: PushPayload): string {
  return JSON.stringify({
    title: item.title || 'Flexyn',
    body:  item.body  || '',
    icon:  item.icon  || '/icon-192.png',
    url:   item.url   || '/',
    tag:   item.tag,
  });
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── AUTH ─────────────────────────────────────────────────────────────
  // Three caller classes, in increasing trust:
  //   • the shared trigger secret in X-Send-Push-Secret — the DB trigger
  //     (migration 034) fanning out to ANY user. Cross-user allowed.
  //   • a service_role Bearer JWT — admin tooling. Cross-user allowed.
  //   • a normal user Bearer JWT — may ONLY push to THEMSELVES.
  //
  // SECURITY (2026-06 audit, blocker C21): previously any present Bearer
  // was accepted and payload.user_id was never bound to the caller, so
  // anyone holding the public anon key (it ships in the client bundle)
  // could fan out arbitrary phishing pushes to any enumerable user_id.
  // We now verify the user token and require user_id === the caller's own
  // id unless the caller proved service_role / the trigger secret. The
  // explicit checks also matter because local `functions serve` does not
  // enforce verify_jwt.
  const triggerSecret = req.headers.get('x-send-push-secret') || '';
  const authHeader    = req.headers.get('authorization')      || '';
  const bearerMatch   = authHeader.match(/^Bearer\s+(\S+)/i);
  const bearerToken   = bearerMatch ? bearerMatch[1] : '';
  const hasTrigger    = SEND_PUSH_TRIGGER_SECRET.length > 0
                      && triggerSecret.length > 0
                      && safeEqual(triggerSecret, SEND_PUSH_TRIGGER_SECRET);

  // A service_role bearer, constant-time compared against the env key, may
  // target anyone. Nothing else about a token can grant that.
  const isServiceRoleToken = bearerToken.length > 0
                      && SERVICE_ROLE_KEY.length > 0
                      && safeEqual(bearerToken, SERVICE_ROLE_KEY);

  // For a normal user token, resolve the caller's verified identity now.
  let callerUserId: string | null = null;
  let canSendToAnyUser = hasTrigger || isServiceRoleToken;
  // SECURITY (2026-09-27 audit): a Bearer whose unverified payload said
  // role=service_role used to unlock cross-user sends here. verify_jwt is
  // off for this function, so nothing checked that token's signature and a
  // hand-made one reached every user. The only cross-user doors are now the
  // trigger secret and the exact service key above; every other Bearer must
  // verify through getUser() and may only push to its own user.
  if (!canSendToAnyUser && bearerToken) {
    const { data: { user }, error: userErr } = await supabase.auth.getUser(bearerToken);
    if (!userErr && user) callerUserId = user.id;
  }

  if (!canSendToAnyUser && !callerUserId) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // If VAPID isn't configured, fail loud with 503 instead of letting
  // each sendNotification throw deep in the loop with a cryptic
  // message. Operators see this in function logs immediately.
  if (!VAPID_OK) {
    return new Response(JSON.stringify({ error: 'vapid_not_configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: PushPayload | BatchPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── BATCH MODE ──────────────────────────────────────────────────────
  // { notifications: [...] } — one subscription lookup + one expired-sub
  // cleanup for the whole batch, instead of one function invocation per
  // notification row. Cross-user by nature, so only the DB trigger
  // secret / service_role may use it.
  if (Array.isArray((payload as BatchPayload).notifications)) {
    if (!canSendToAnyUser) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const items = (payload as BatchPayload).notifications
      .filter((n) => n && typeof n.user_id === 'string' && n.user_id.length > 0)
      .slice(0, MAX_BATCH);
    if (items.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'empty_batch' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userIds = [...new Set(items.map((n) => n.user_id))];
    const { data: batchSubs, error: batchErr } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh_key, auth_key')
      .in('user_id', userIds);
    if (batchErr) {
      console.error('[send-push] batch subscription lookup failed:', batchErr);
      return new Response(JSON.stringify({ error: 'lookup_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    type SubRow = { id: string; user_id: string; endpoint: string; p256dh_key: string; auth_key: string };
    const subsByUser = new Map<string, SubRow[]>();
    for (const sub of batchSubs ?? []) {
      const list = subsByUser.get(sub.user_id);
      if (list) list.push(sub);
      else subsByUser.set(sub.user_id, [sub]);
    }

    const expiredIds: string[] = [];
    let sentCount = 0;
    for (const item of items) {
      const targets = subsByUser.get(item.user_id);
      if (!targets || targets.length === 0) continue;
      const itemBody = encodeItemBody(item);
      for (const sub of targets) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
            itemBody
          );
          sentCount += 1;
        } catch (err: any) {
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            expiredIds.push(sub.id);
          } else {
            console.warn('[send-push] batch delivery failed:', err?.statusCode, err?.message);
          }
        }
      }
    }

    if (expiredIds.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', [...new Set(expiredIds)]);
    }

    return new Response(
      JSON.stringify({ ok: true, sent: sentCount, removed: new Set(expiredIds).size, batch: items.length }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── SINGLE MODE (legacy shape) ──────────────────────────────────────
  const single = payload as PushPayload;

  if (!single.user_id) {
    return new Response(JSON.stringify({ error: 'user_id_required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Bind the target to the caller unless they proved cross-user authority.
  if (!canSendToAnyUser && single.user_id !== callerUserId) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── TARGET BINDING ──────────────────────────────────────────────────
  // A Bearer-authenticated caller may only push to THEMSELVES. Without
  // this check, any holder of the public anon key (it ships in the JS
  // bundle and is a valid JWT) could fan out attacker-controlled


  // Look up all of this user's active push subscriptions.
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh_key, auth_key')
    .eq('user_id', single.user_id);
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

  const body = encodeItemBody(single);

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
