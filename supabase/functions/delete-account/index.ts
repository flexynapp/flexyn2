// supabase/functions/delete-account/index.ts
//
// Real account deletion. The client cannot do this — deleting `auth.users`
// needs the service role — which is why the previous implementation was a
// reset wearing a deletion's UI.
//
// ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
//
// `_invokeDeleteAccount` (src/api/db.js) deleted rows from a hand-maintained
// list of tables, then set profile columns to NULL and stamped
// `account_reset_at`. It never touched `auth.users`, so the identity survived
// and a magic link to the same address re-entered the "deleted" account. The
// hand list had also drifted by 54 user-owned tables. Apple 5.1.1(v) requires
// real deletion; GDPR Art. 17 requires erasure; this app stores weight, body
// photos, injuries, mood, sleep and cycle logs.
//
// ── ORDER MATTERS ────────────────────────────────────────────────────────────
//
// Measured against production, 104 foreign keys into auth.users are ON DELETE
// CASCADE — so deleting the auth user erases the overwhelming majority of the
// data correctly and for free, including a dozen tables the old hand list had
// never heard of. But four constraints are NO ACTION or RESTRICT and will
// abort the delete with 23503, and several tables key the user by email with
// no foreign key at all, so nothing cascades to them.
//
// Hence the sequence below, which must not be reordered:
//
//   1. admin_purge_user_data()  — clear the four blockers, delete the PII that
//                                 ON DELETE SET NULL would otherwise preserve,
//                                 sweep email-keyed tables discovered from
//                                 information_schema (mig 284).
//   2. storage.remove('<uid>/') — blobs are not rows and cascade to nothing.
//   3. auth.admin.deleteUser()  — the identity, plus the 104-table cascade.
//
// Storage goes before the auth delete on purpose. If step 3 succeeded first
// and step 2 then failed, the owning uid would be gone and the objects would
// be unreachable orphans — `_uploadFile` writes `<auth.uid()>/<ts>.<ext>`, so
// the uid prefix is the only handle we have on them.
//
// ── AUTH ─────────────────────────────────────────────────────────────────────
//
// The caller must present their own user JWT. The uid is taken from that
// token via getUser() and NEVER from the request body — a body-supplied id on
// a service-role function is an "delete any account" endpoint. This is the
// same mistake mig 108 shipped as a privacy leak by trusting a client-passed
// email, and the reason mig 284 revokes EXECUTE from `authenticated`.
//
// verify_jwt is left ON for this function (unlike send-push and
// generateWeeklyDebriefs, which authenticate with their own shared secrets):
// there is no cron path here, every legitimate caller is a signed-in user in
// a browser, so the gateway check is a free extra layer.
//
// ── DEPLOY ───────────────────────────────────────────────────────────────────
//
//   supabase functions deploy delete-account
//
// No secrets to set — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
// by the platform. Run migration 284 first, or every call returns
// purge_failed with 42883 (function does not exist).

// @ts-ignore — Deno runtime
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY') || '';

const UPLOAD_BUCKET = 'uploads';
// Storage list() caps a page; loop until a short page comes back. A user with
// a long history of progress photos can exceed one page.
const PAGE = 100;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Every object under `<uid>/`, paged. Returns full paths ready for remove().
 * A failure here is reported, never thrown — losing a blob must not stop the
 * identity from being deleted.
 */
async function listUserObjects(uid: string): Promise<{ paths: string[]; error: string | null }> {
  const paths: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await admin.storage
      .from(UPLOAD_BUCKET)
      .list(uid, { limit: PAGE, offset });

    if (error) return { paths, error: error.message };
    if (!data || data.length === 0) break;

    for (const obj of data) {
      // list() returns folder placeholders with a null id; skip those rather
      // than handing Storage a path that removes nothing.
      if (obj.id === null) continue;
      paths.push(`${uid}/${obj.name}`);
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return { paths, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'function_not_configured' }, 500);
  }

  // ── Identify the caller from their own token ──────────────────────────────
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);

  // A separate client bound to the caller's token. Deliberately NOT the
  // service-role client: passing a user token to a service-role client does
  // not scope it, and getUser() there would validate the wrong thing.
  const asUser = createClient(SUPABASE_URL, ANON_KEY || SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await asUser.auth.getUser();
  const user = userData?.user;
  if (userError || !user?.id) {
    return json({ error: 'unauthorized' }, 401);
  }

  const uid = user.id;

  // The email has to come from user_profiles when auth.users has none, and
  // that is not an edge case — it is every guest account.
  //
  // `signInAnonymously` creates an auth.users row with a NULL email, while
  // migration 172's trigger writes a synthetic
  // `guest_<uid>@flexyn.guest` into user_profiles.email. Every email-keyed
  // row the account goes on to create is keyed on THAT address. Reading
  // only `user.email` therefore handed mig 284 an empty string, its
  // `IF v_email <> ''` guard short-circuited, and the entire email sweep
  // was skipped for the one class of account most likely to be deleted —
  // guests exist because beta testers hit OAuth and SMTP walls.
  //
  // Caught by an end-to-end delete test on a seeded throwaway account: the
  // identity, the cascade and storage were all correct, and a
  // hub_saved_posts row keyed on the guest address was still sitting there
  // afterwards with `swept: {}` in the report.
  //
  // This read must stay BEFORE the purge and the auth delete — user_profiles
  // cascades away with the identity in step 3.
  let email = user.email || '';
  if (!email) {
    const { data: profile } = await admin
      .from('user_profiles')
      .select('email')
      .eq('id', uid)
      .maybeSingle();
    email = profile?.email || '';
  }

  const report: Record<string, unknown> = { uid_prefix: uid.slice(0, 8) };

  // ── 1. Rows that will not cascade ─────────────────────────────────────────
  const { data: purge, error: purgeError } = await admin
    .rpc('admin_purge_user_data', { p_user_id: uid, p_email: email });

  if (purgeError) {
    // Nothing has been destroyed yet, so failing here is safe and recoverable.
    // Stop rather than deleting the identity and orphaning everything else.
    return json({
      error: 'purge_failed',
      message: purgeError.message,
      code: purgeError.code,
    }, 500);
  }
  report.purge = purge;

  // ── 2. Storage, before the identity goes ──────────────────────────────────
  const { paths, error: listError } = await listUserObjects(uid);
  if (listError) {
    report.storage = { listed: paths.length, error: listError };
  } else if (paths.length > 0) {
    const { error: removeError } = await admin.storage.from(UPLOAD_BUCKET).remove(paths);
    // remove() returns 200 with an empty array when a SELECT policy hides the
    // targets — mig 273 restored that policy for exactly this reason. Under
    // the service role it does not apply, but the failure mode is worth
    // knowing about if this ever moves to a scoped key.
    report.storage = removeError
      ? { removed: 0, attempted: paths.length, error: removeError.message }
      : { removed: paths.length };
  } else {
    report.storage = { removed: 0 };
  }

  // ── 3. The identity, and the 104-table cascade behind it ──────────────────
  const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
  if (deleteError) {
    return json({
      error: 'auth_delete_failed',
      message: deleteError.message,
      report,
    }, 500);
  }

  report.auth_user_deleted = true;
  return json({ ok: true, report });
});
