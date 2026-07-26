// supabase/functions/storage-gc/index.ts
//
// Storage garbage collector. Drains public.storage_cleanup_queue by
// removing the queued objects through the real Storage API, which is the
// only supported way to reclaim the underlying S3 blob.
//
// WHY THIS EXISTS
//
// SQL can delete a `storage.objects` row, which makes the file vanish
// from the bucket listing — but Supabase never reclaims the S3 object,
// and the delete is a one-way door: the Storage API finds objects
// through their metadata row, so once that row is gone the blob is
// unreachable through any supported path forever.
//
// So migrations 233/234 no longer touch storage.objects. They enqueue,
// and this function removes for real.
//
// ── SETUP (one-time, before deploying) ───────────────────────────────────────
//
//   1. Generate a shared secret:
//
//        openssl rand -hex 32
//
//   2. Give it to the function:
//
//        supabase secrets set STORAGE_GC_SECRET="<that value>"
//
//   3. Deploy:
//
//        supabase functions deploy storage-gc
//
//   4. Mirror the secret + URL onto the database so the 5-minute cron in
//      migration 236 can authenticate (SQL Editor):
//
//        ALTER DATABASE postgres SET app.storage_gc_url =
//          'https://<project-ref>.functions.supabase.co/storage-gc';
//        ALTER DATABASE postgres SET app.storage_gc_secret = '<same value>';
//        SELECT pg_reload_conf();
//
//      Until this is done, kick_storage_gc() short-circuits and the queue
//      simply accumulates — nothing breaks, and the backlog drains on the
//      first tick after the settings land.
//
// ── AUTH ─────────────────────────────────────────────────────────────────────
//
// Callers MUST pass ONE of:
//
//   • `X-Storage-GC-Secret: <STORAGE_GC_SECRET>` — used by the pg_cron
//     job, which calls pg_net.http_post and cannot mint Supabase JWTs.
//   • `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — for manual
//     runs and admin tooling.
//
// Requests with neither get 401. This function deletes files, so an open
// endpoint would be a destructive-action surface.
//
// ── SAFETY ───────────────────────────────────────────────────────────────────
//
// It never chooses what to delete. claim_storage_cleanup() does, and it
// withholds any object still referenced by a live row (DM attachments,
// stories, feed posts, avatars). This function only removes exactly what
// it is handed, and reports each batch back as done or failed.
//
// Idempotent: removing an object that is already gone is success as far
// as the Storage API is concerned, so a re-run of a partially-completed
// batch settles cleanly.

// @ts-ignore — Deno runtime
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const STORAGE_GC_SECRET  = Deno.env.get('STORAGE_GC_SECRET') || '';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT     = 500;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function authorized(req: Request): boolean {
  const secret = req.headers.get('x-storage-gc-secret') || '';
  if (STORAGE_GC_SECRET && secret === STORAGE_GC_SECRET) return true;
  const auth = req.headers.get('authorization') || '';
  if (SERVICE_ROLE_KEY && auth === `Bearer ${SERVICE_ROLE_KEY}`) return true;
  return false;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'function_not_configured' }, 500);
  }

  let limit = DEFAULT_LIMIT;
  try {
    const body = await req.json();
    const asked = Number(body?.limit);
    if (Number.isFinite(asked) && asked >= 1) {
      limit = Math.min(Math.floor(asked), MAX_LIMIT);
    }
  } catch {
    // No body / unparseable — the default limit is fine.
  }

  const { data: batch, error: claimError } = await supabase
    .rpc('claim_storage_cleanup', { p_limit: limit });

  if (claimError) {
    return json({ error: 'claim_failed', detail: claimError.message }, 500);
  }
  const rows = Array.isArray(batch) ? batch : [];
  if (rows.length === 0) return json({ claimed: 0, removed: 0, failed: 0 });

  // Group by bucket — remove() is per-bucket and takes a path array.
  const byBucket = new Map<string, { ids: string[]; names: string[] }>();
  for (const row of rows) {
    const bucket = row?.bucket_id || 'uploads';
    const name   = row?.object_name;
    if (!name) continue;
    if (!byBucket.has(bucket)) byBucket.set(bucket, { ids: [], names: [] });
    const slot = byBucket.get(bucket)!;
    slot.ids.push(row.id);
    slot.names.push(name);
  }

  let removed = 0;
  let failed  = 0;

  for (const [bucket, slot] of byBucket) {
    const { error: removeError } = await supabase
      .storage.from(bucket).remove(slot.names);

    if (removeError) {
      failed += slot.ids.length;
      // Record the attempt so a permanently broken object stops being
      // retried after 5 failures instead of spinning every 5 minutes.
      await supabase.rpc('fail_storage_cleanup', {
        p_ids:   slot.ids,
        p_error: removeError.message || 'remove failed',
      });
      continue;
    }

    const { error: completeError } = await supabase
      .rpc('complete_storage_cleanup', { p_ids: slot.ids });

    if (completeError) {
      // The blobs ARE gone; we just couldn't record it. Leaving the rows
      // unprocessed is the safe direction — the next tick re-removes
      // already-absent objects, which the Storage API treats as success.
      failed += slot.ids.length;
      continue;
    }
    removed += slot.ids.length;
  }

  return json({ claimed: rows.length, removed, failed });
});
