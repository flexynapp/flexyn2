// src/api/dbClient.js
// ─────────────────────────────────────────────────────────────────────────────
// Supabase compatibility shim.
// Exports `db` with the same surface area the rest of the app uses:
//   db.entities.X  → .filter / .list / .get / .create / .update / .delete
//   db.auth        → .me / .updateMe / .logout / .redirectToLogin
//   db.functions   → .invoke
// Nothing outside this file needs to change for the migration.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabaseClient';
import { getProfile, setProfile, patchProfile, clearProfile } from './profileCache';
import { unsubscribePushOnLogout } from '@/lib/pushCleanup';
import { selectProfiles } from '@/lib/data/users';
import { accountEmail } from '@/lib/guestIdentity';
import { isNative, NATIVE_AUTH_CALLBACK } from '@/lib/native';

/* ── Entity name → Postgres table name ─────────────────────────────────── */
const TABLE = {
  WorkoutLog:       'workout_logs',
  CardioLog:        'cardio_logs',
  Goal:             'goals',
  Regimen:          'regimens',
  NutritionLog:     'nutrition_logs',
  BodyMetric:       'body_metrics',
  // `Achievement` is gone — migration 341 dropped `public.achievements`.
  // Earned badges live in `user_trophies`, read through
  // `src/lib/data/trophies.js`. Don't re-add an entity here for it: that
  // table has no client INSERT policy on purpose (mig 189), so the
  // generic entity factory's create/update would only ever 42501.
  ExerciseForm:     'exercise_forms',
  WorkoutTemplate:  'workout_templates',
  FoodItem:         'food_items',
  HubPost:          'hub_posts',
  HubFollow:        'hub_follows',
  HubComment:       'hub_comments',
  HubCommentLike:   'hub_comment_likes',
  HubReaction:      'hub_reactions',
  HubConversation:  'hub_conversations',
  HubMessage:       'hub_messages',
  User:             'user_profiles',
};

/* ── Sort string parser: "-created_date" → { column, ascending } ─────── */
function parseSort(sort) {
  if (!sort) return null;
  const desc = sort.startsWith('-');
  return { column: desc ? sort.slice(1) : sort, ascending: !desc };
}

/* Columns that scope a read to one person (see filter() below). */
const OWNER_KEYS = ['user_id', 'created_by'];

/* ── Build a reusable entity accessor ───────────────────────────────────── */
// Writes send exactly what the caller built. A column the table lacks is an
// error, not something to drop and retry: the old strip-and-retry turned a
// missing migration into data that saved "successfully" and was never stored,
// which is how onboarding's training_equipment and session_minutes went
// missing for weeks. Migrations now ship through the pipeline, so the schema
// no longer lags the client and a 42703 / PGRST204 here is a real bug.

function makeEntity(entityName) {
  const table = TABLE[entityName];
  if (!table) throw new Error(`[Supabase shim] Unknown entity: "${entityName}"`);

  // Privacy (June 2026 audit): the User entity is read-only in practice
  // (only .list() is called anywhere) and every caller is a CROSS-USER
  // surface (leaderboards, search, PYMK, author resolution). Those reads
  // go through the `public_profiles` view via selectProfiles(), which
  // falls back to user_profiles while the view migration is pending.
  // Writes (create/update/delete below) intentionally stay on the base
  // table — but note own-profile writes flow through db.auth.updateMe,
  // not this entity.
  const readQuery = (build) =>
    table === 'user_profiles'
      ? selectProfiles(build)
      : build(supabase.from(table));

  return {
    /** filter(conditions, sort, limit) — conditions is a plain equality map */
    async filter(conditions = {}, sort, limit = 1000) {
      // An owner key that arrives empty means "no user yet", never "anyone".
      // The loop below skips nullish conditions, so without this a query for
      // the signed-in user's rows would run unfiltered while auth loads and
      // return every row the table's policies let the caller read.
      for (const key of OWNER_KEYS) {
        if (key in conditions && (conditions[key] === undefined || conditions[key] === null || conditions[key] === '')) {
          return [];
        }
      }
      const { data, error } = await readQuery((from) => {
        let q = from.select('*');
        Object.entries(conditions).forEach(([k, v]) => {
          if (v === undefined || v === null) return;
          Array.isArray(v) ? (q = q.in(k, v)) : (q = q.eq(k, v));
        });
        const s = parseSort(sort);
        if (s) q = q.order(s.column, { ascending: s.ascending });
        return q.limit(limit);
      });
      if (error) throw error;
      return data ?? [];
    },

    /** list(sort, limit) — equivalent to filter({}, ...) */
    async list(sort, limit = 1000) {
      const { data, error } = await readQuery((from) => {
        let q = from.select('*');
        const s = parseSort(sort);
        if (s) q = q.order(s.column, { ascending: s.ascending });
        return q.limit(limit);
      });
      if (error) throw error;
      return data ?? [];
    },

    /** get(id) — fetch single record by primary key */
    async get(id) {
      const { data, error } = await readQuery((from) =>
        from.select('*').eq('id', id).maybeSingle()
      );
      if (error) throw error;
      return data;
    },

    /** create(data) — insert and return the new row.
     *  Auto-injects created_by (email) and user_id (uuid) so RLS passes
     *  without every caller needing to set them manually. A column the
     *  table lacks throws; see the note above makeEntity. */
    async create(data) {
      // Read local session first (no network). Caller-provided values
      // for OTHER fields are honored, but `created_by` and `user_id`
      // are FORCED to the authenticated user — letting the caller pass
      // a different email/id was a privacy hole on any table that
      // doesn't have a WITH CHECK column-level RLS guard. (Audit 17 #T1.)
      //
      // If a caller really needs to write a different created_by
      // (e.g. an admin tool), they must go through a SECURITY DEFINER
      // RPC, not the entity wrapper.
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      const authUser = session?.user ?? null;
      // Guest / anonymous users have authUser.email = null. Most
      // tables in this app have `created_by text not null`, so a
      // null email would 23502 every write the moment a guest tries
      // to log anything. Synthesize the same placeholder the
      // handle_new_user trigger writes to user_profiles.email
      // (migration 172) so the value is consistent across the
      // identity layer.
      const effectiveEmail = accountEmail(authUser);
      const enriched = {
        ...data, // caller values for non-identity fields
        ...(effectiveEmail   ? { created_by: effectiveEmail } : {}),
        ...(authUser?.id     ? { user_id:    authUser.id    } : {}),
      };

      const { data: row, error } = await supabase.from(table).insert(enriched).select().single();
      if (error) throw error;
      return row;
    },

    /** update(id, data) — patch and return the updated row. */
    async update(id, data) {
      const { data: row, error } = await supabase.from(table).update({ ...data }).eq('id', id).select().single();
      if (error) throw error;
      return row;
    },

    /** delete(id) — remove the row */
    async delete(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
      return true;
    },
  };
}

/* ── Lazy entity proxy — creates accessor on first access ────────────── */
const _entityCache = {};
const entities = new Proxy(_entityCache, {
  get(cache, name) {
    if (typeof name !== 'string') return undefined;
    if (!cache[name]) cache[name] = makeEntity(name);
    return cache[name];
  },
});

/* ── Profile cache — avoids N+1 DB calls across components ─────────────── */
// State lives in @/api/profileCache so data modules can patch it without
// importing this file and its onAuthStateChange listener below. See that
// module's header for what is and isn't safe to patch.

async function _loadProfile() {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    throw Object.assign(new Error('Not authenticated'), { status: 401 });
  }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  return setProfile({ id: user.id, email: user.email, ...(profile ?? {}) });
}

function _clearProfile() { clearProfile(); }

// Clear cache on sign-out
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') _clearProfile();
});

/* ── Auth shim ───────────────────────────────────────────────────────────── */
const auth = {
  /** Returns the merged auth+profile object; cached per session. */
  async me() {
    const cached = getProfile();
    if (cached) return cached;
    return _loadProfile();
  },

  /** Merge a patch into the in-memory profile cache. For callers that write
   *  a specific column via a raw supabase update rather than updateMe (e.g.
   *  calorieCycling.saveMine) — keeps me() and the react-query
   *  ['userProfile'] result in sync without a refetch, so the change is
   *  visible immediately instead of only after a full reload. No-op until
   *  the profile has been loaded once. */
  patchCache(patch) {
    return patchProfile(patch);
  },

  /** Patch the user profile and refresh the cache. */
  async updateMe(data) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    // Guest / anonymous users have user.email = '' (empty). Writing that
    // raw into the payload is a double bug: user_profiles.email is UNIQUE
    // (user_profiles_email_key), so the FIRST guest's updateMe clobbers the
    // canonical `guest_<uid>@flexyn.guest` that handle_new_user (mig 172)
    // wrote — and EVERY subsequent guest then collides on '' with 23505.
    // The whole upsert then throws with 23505, silently breaking onboarding
    // completion, nutrition setup, theme, and every other profile write for
    // the 2nd+ guest. Synthesize the same uid-derived placeholder create()
    // uses so the value is unique per guest AND matches created_by on their
    // rows (so their workout/history reads resolve). Real users keep their
    // own email (unchanged behavior).
    const effectiveEmail = accountEmail(user);
    const payload = { id: user.id, email: effectiveEmail, ...data, updated_at: new Date().toISOString() };

    // One write, no retry. This used to strip any column the table lacked
    // and, when it could not tell which, fall back to saving only the
    // onboarding flags, so a whole payload could vanish while the caller
    // saw success. A missing column now throws like any other error.
    const { data: row, error } = await supabase
      .from('user_profiles')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return setProfile({ id: user.id, email: user.email, ...row });
  },

  /** Kick off Google OAuth — kept as the default for legacy call sites. */
  redirectToLogin(redirectTo) {
    return this.signInWithProvider('google', redirectTo);
  },

  /**
   * OAuth sign-in via any supported provider. Currently supported by
   * the Supabase project: 'google' | 'apple'. Add a new provider here
   * AND in the Supabase dashboard before exposing a button for it.
   */
  signInWithProvider(provider, redirectTo) {
    // Native app: the provider page opens in the system browser and comes
    // back on the app.flexyn:// deep link (Apple on iOS uses the native
    // sheet). An OAuth page inside the web view is refused by Google, and
    // window.location.origin there is capacitor://localhost, which no
    // provider can redirect to. Dynamic import keeps it off the web path.
    if (isNative()) {
      return import('@/lib/nativeAuth').then((m) => m.nativeSignIn(provider));
    }
    const target = redirectTo
      ? `${window.location.origin}${redirectTo.startsWith('/') ? redirectTo : '/' + redirectTo}`
      : window.location.origin;
    return supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: target },
    });
  },

  /**
   * Email magic-link sign-in. Supabase emails the user a one-tap link that
   * signs them in directly — no password needed. The auth provider must be
   * enabled in the Supabase dashboard.
   *
   * Sent in two phases so the caller can tell the user WHICH of the two
   * things just happened. A single `shouldCreateUser: true` call is silently
   * both a sign-up and a sign-in; mechanically that's right — the link signs
   * an existing user into their existing account — but someone who enters
   * the address they already have an account with gets a screen that reads
   * as "new account created", with nothing anywhere saying otherwise. So we
   * ask first: `shouldCreateUser: false` sends the link when the account
   * exists and refuses when it doesn't, and only then do we send the
   * creating variant.
   *
   * Exactly one email goes out on either path — the refusal doesn't send —
   * so this costs nothing against the project's email rate limit.
   *
   * Note this makes the UI able to say whether an address has an account,
   * which is a user-enumeration signal. GoTrue answers that question to
   * anyone who asks it directly, rate-limited, whatever our UI does; if we
   * ever decide to stop confirming it, the fix is on the auth provider, not
   * here.
   *
   * Resolves to `{ ok: true, isNewAccount }` — `isNewAccount` true means
   * this call created the account.
   */
  async signInWithMagicLink(email, redirectTo) {
    if (!email || typeof email !== 'string') {
      throw new Error('email required');
    }
    // Native app: the emailed link must reopen the APP (deep link), not the
    // web view's capacitor://localhost origin, which a mail client cannot
    // open. The PKCE verifier for it lives in the app's own storage, so the
    // link signs in when tapped on the same phone.
    const target = isNative()
      ? NATIVE_AUTH_CALLBACK
      : redirectTo
        ? `${window.location.origin}${redirectTo.startsWith('/') ? redirectTo : '/' + redirectTo}`
        : window.location.origin;
    const clean = email.trim().toLowerCase();

    // Phase 1 — send only if the account already exists.
    const { error: probeError } = await supabase.auth.signInWithOtp({
      email: clean,
      options: { emailRedirectTo: target, shouldCreateUser: false },
    });
    if (!probeError) return { ok: true, isNewAccount: false };

    // GoTrue's "there's no account here" is a 422 `otp_disabled` carrying
    // "Signups not allowed for otp" — verified against this project on
    // 2026-08-05. The message is matched as well as the code because the
    // code field is newer than some deployed GoTrue versions. Anything
    // else — rate limit, malformed address, network — is a real failure
    // and stays the caller's problem.
    const noAccount = probeError.code === 'otp_disabled'
      || (probeError.status === 422 && /signups?\s+not\s+allowed/i.test(probeError.message || ''));
    if (!noAccount) throw probeError;

    // Phase 2 — no account, so create one and send the link.
    const { error } = await supabase.auth.signInWithOtp({
      email: clean,
      options: { emailRedirectTo: target, shouldCreateUser: true },
    });
    if (error) throw error;
    return { ok: true, isNewAccount: true };
  },

  /**
   * Anonymous / guest sign-in for beta testers who can't (or don't
   * want to) deal with email magic-link / OAuth friction. Creates a
   * real auth.users row with email = NULL; migration 172's
   * handle_new_user trigger writes a placeholder
   * `guest_<uuid>@flexyn.guest` to user_profiles.email so the rest
   * of the app's email-keyed identity model keeps working.
   *
   * Requires Supabase Dashboard → Authentication → Providers →
   * Email → "Enable anonymous sign-ins" turned ON. Without it,
   * Supabase returns a 422 which we surface as a recognizable
   * 'anonymous_disabled' reason so the caller can show a useful
   * error message.
   */
  async signInAsGuest() {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      const msg = (error.message || '').toLowerCase();
      const code = error.code || error.status;
      if (msg.includes('anonymous') && (msg.includes('disabled') || msg.includes('not allowed'))) {
        return { ok: false, reason: 'anonymous_disabled' };
      }
      if (code === 422) {
        return { ok: false, reason: 'anonymous_disabled' };
      }
      return { ok: false, reason: error.message || 'sign_in_failed' };
    }
    return { ok: true, user: data?.user ?? null };
  },

  /**
   * Sign out and optionally redirect.
   *
   * Privacy: drop this device's push subscription BEFORE signOut so
   * the next user on the same device doesn't inherit pushes (security
   * audit, migration 042 doc). See src/lib/pushCleanup.js. Cleanup is
   * fire-and-forget — failures never block sign-out.
   */
  async logout(redirectUrl) {
    _clearProfile();
    await unsubscribePushOnLogout();
    try { await supabase.auth.signOut(); }
    finally {
      // Pass `null` to suppress the auto-redirect — used by ProfileMenu
      // sign-out so the caller can wipe localStorage AFTER signOut has
      // had a chance to read the session, but BEFORE the page reloads.
      // Otherwise the redirect raced the localStorage clear and
      // per-device-scoped UX flags persisted across users. (Audit 14 #3.)
      if (redirectUrl !== null) {
        window.location.href = redirectUrl ?? '/';
      }
    }
  },

  /** Returns true if there is an active session. */
  async isAuthenticated() {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session;
  },
};

/* ── Functions shim (replaces Base44 server functions) ───────────────────── */
const functions = {
  async invoke(name, payload = {}) {
    switch (name) {
      case 'updateUserXpAndAchievements': return _invokeXp(payload);
      case 'deleteAccountData':           return _invokeDeleteAccount();
      case 'cleanupAfterReset':           return null;
      default:
        console.warn(`[Supabase shim] Unknown function: "${name}"`);
        return null;
    }
  },
};

// XP milestone achievements are now granted SERVER-SIDE by the
// grant_xp_milestone_achievements RPC (migration 189) — the thresholds,
// names, and bonus XP live in that migration. Keep any client display copy
// in sync with it.

// Sessions are scored by the SERVER from the saved row (migration
// 20260927203000). The client passes the log id and gets back what was
// actually credited; it never names an amount for a session again.
const SESSION_XP_RPC = {
  workout_completed: 'grant_workout_xp',
  cardio_completed:  'grant_cardio_xp',
};

async function _invokeXp({ xp_gained = 0, action_type, log_id } = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // 1. Grant XP through grant_action_xp (migration 198): it enforces a
    //    per-action daily cap (anti-farm for the fixed grants) and then
    //    delegates to the global-capped increment_user_xp. Passing
    //    action_type is what makes the per-action cap possible — the raw
    //    increment_user_xp RPC is no longer client-callable.
    //
    //    The zero check moved INTO this step. The guard above used to read
    //    `if (!user || !xp_gained) return null`, which abandoned the whole
    //    function — including step 2. All three cardio surfaces call this
    //    with xp_gained 0 for the sole purpose of running the milestone
    //    check below (their own comments say so), so finishing a run has
    //    never granted an achievement. It failed silently because returning
    //    early is not an error: the reportError wrappers on those three call
    //    sites had nothing to catch.
    let credited = null;
    if (SESSION_XP_RPC[action_type] && log_id) {
      const { data, error } = await supabase.rpc(SESSION_XP_RPC[action_type], { p_log_id: log_id });
      if (error) console.warn('[XP] session rpc failed:', error.message);
      else credited = data || null;
    } else if (xp_gained && !SESSION_XP_RPC[action_type]) {
      //    grant_action_xp awards 0 for an action_type it does not
      //    recognise, so a missing one is a silent no-grant, not a failure.
      //    This used to send 'other', which is not an accepted value — any
      //    caller that forgot action_type quietly banked nothing while the
      //    RPC reported success. Refuse loudly rather than pay zero.
      if (!action_type) {
        console.error(`[XP] grant skipped: ${xp_gained} XP with no action_type`);
      } else {
        const { error } = await supabase.rpc('grant_action_xp', {
          p_action_type: action_type,
          p_xp: Math.round(xp_gained),
        });
        if (error) console.warn('[XP] rpc failed:', error.message);
      }
    }

    // 2. Grant any crossed XP-milestone achievements SERVER-SIDE. The
    //    grant_xp_milestone_achievements RPC (migration 189) reads the
    //    caller's now-updated total_xp, atomically inserts newly-crossed
    //    milestones, grants their bonus XP through the capped
    //    increment_user_xp, self-heals achievements_unlocked_count, and
    //    returns the newly-unlocked list + authoritative count. Moving this
    //    off the client makes it forge-proof — mig 189 also drops the client
    //    INSERT policy on `achievements`, so the only way a row is created is
    //    through this (and the trophy/capsule) SECURITY DEFINER RPC.
    let newlyUnlocked = [];
    let unlockedCount = 0;
    try {
      const { data: result, error: grantErr } = await supabase.rpc('grant_xp_milestone_achievements');
      if (grantErr) {
        console.warn('[XP] milestone grant rpc failed:', grantErr.message);
      } else {
        newlyUnlocked = result?.new_achievements || [];
        unlockedCount = result?.unlocked_count || 0;
      }
    } catch (achErr) {
      console.warn('[XP] milestone grant rpc threw:', achErr);
    }

    // 3. Only when a NEW milestone unlocked this call, check whether any
    //    milestone capsule rewards are owed. Idempotent server-side via
    //    user_profiles.milestone_capsules_awarded.
    if (newlyUnlocked.length > 0 && unlockedCount > 0) {
      try {
        const { grantForAchievementMilestone } = await import('@/lib/data/capsules');
        await grantForAchievementMilestone(user.id, user.email, unlockedCount);
      } catch (err) {
        console.warn('[XP] milestone capsule check failed:', err);
      }
    }

    _clearProfile();
    return {
      ok: true,
      xp_awarded:     Number(credited?.xp_awarded) || 0,
      comeback_xp:    Number(credited?.comeback_xp) || 0,
      check_in_bonus: !!credited?.check_in_bonus,
    };
  } catch (err) {
    console.warn('[XP] failed silently:', err);
    return null;
  }
}

async function _invokeDeleteAccount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // THROW instead of silent return. The caller (ProfileMenu.handleDeleteAccount)
    // treats a `result.success === false` shape as the only failure
    // signal — an undefined return looked like success, so a user with
    // a stale session saw "Account deleted" while nothing was deleted.
    // Wave 54 (Settings audit) caught this.
    const err = new Error('Not authenticated — sign in and try again.');
    err.code = 'NO_SESSION';
    throw err;
  }

  // Deletion is a SERVER action and cannot be done from here.
  //
  // This function used to be a ~250-line client-side cascade over a
  // hand-maintained array of table names, ending in an auth.updateMe() that
  // nulled profile columns and stamped account_reset_at. Three things were
  // wrong with that, and none of them were fixable in the client:
  //
  //   1. It never deleted auth.users, because a client cannot. The identity
  //      survived, so a magic link to the same address re-entered the
  //      "deleted" account. What shipped was a reset wearing a deletion's UI.
  //   2. The hand-maintained list had drifted by 54 user-owned tables —
  //      journal_entries, weekly_debriefs, status_notes, meal_plans and
  //      others were never touched. That drift is structural: nothing fails
  //      when a new migration forgets to update the array.
  //   3. Uploaded blobs (avatars, progress photos) were never removed.
  //
  // The replacement is the `delete-account` Edge Function, which runs under
  // the service role and derives what to purge from the schema itself rather
  // than from a list. See supabase/functions/delete-account/index.ts and
  // migration 284 for the ordering, which is not arbitrary.
  //
  // There is deliberately NO fallback to the old cascade. Falling back would
  // mean telling someone their account was deleted when it was reset — which
  // is the exact defect being fixed, and worse than an honest failure.
  const { data, error } = await supabase.functions.invoke('delete-account', {
    body: {},
  });

  if (error) {
    // A 404 here means the function has not been deployed yet. Say so
    // plainly rather than letting it read as a transient network blip.
    const err = new Error(
      'Account deletion is temporarily unavailable. Nothing was changed — '
      + 'please contact support so we can complete it for you.'
    );
    err.cause = error;
    err.code = 'DELETE_FN_UNAVAILABLE';
    throw err;
  }

  if (data && data.ok === false) {
    const err = new Error(data.message || 'Delete failed');
    err.code = data.error;
    throw err;
  }

  // The purge reports per-target failures without aborting — a table that
  // could not be swept must not stop the identity being deleted. Surface it
  // as a partial so the user is told rather than reassured.
  const purgeErrors = data?.report?.purge?.errors || [];
  const storageError = data?.report?.storage?.error;
  if (purgeErrors.length > 0 || storageError) {
    _clearProfile();
    const err = new Error(
      `Account deleted, but ${purgeErrors.length + (storageError ? 1 : 0)} item(s) `
      + 'could not be fully removed'
    );
    err.partial = true;
    err.failures = [
      ...purgeErrors.map(e => ({ table: e.target, error: e.error, code: e.code })),
      ...(storageError ? [{ table: 'storage.uploads', error: storageError }] : []),
    ];
    throw err;
  }

  _clearProfile();
  return { success: true };
}


/* ── Integrations — file upload via Supabase Storage ────────────────────── */
// Requires a public Supabase Storage bucket named "uploads".
// To create it, run migration 008_storage_bucket.sql in the SQL Editor.

/**
 * Upload a File object to Supabase Storage and return its public URL.
 * Bucket: "uploads" (must exist and be public — see migration 008).
 * Path:   {user_id}/{timestamp}.{ext}
 */
async function _uploadFile({ file, bucket = 'uploads' }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Whitelist image extensions + pin contentType to the safe MIME
  // derived from the extension. Without this, an upload of `evil.svg`
  // with a <script> payload landed in a public bucket with
  // `contentType: 'image/svg+xml'` (via file.type passthrough); the
  // chat attachment renderer opens attachments via `window.open(url)`
  // → SVG runs script on the Supabase storage origin → phishing /
  // keylogger XSS. Same defect class as Wave 56 GymEdit. Wave 57
  // (Messages audit) flagged the DM path. We accept JPEG/PNG/WebP
  // and animated GIF (no script execution); SVG is explicitly
  // refused even though `accept="image/*"` would otherwise allow it.
  const SAFE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif'];
  const SAFE_MIMES = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
  };
  // Video uploads (HubComposer video posts) flow through this same
  // function. Same pinning rule as images: contentType derives from the
  // extension, never from client-supplied file.type. No script-execution
  // risk in these container formats; SVG remains refused.
  const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'm4v'];
  const VIDEO_MIMES = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4' };
  const VIDEO_MIME_TO_EXT = {
    'video/mp4': 'mp4', 'video/quicktime': 'mov',
    'video/webm': 'webm', 'video/x-m4v': 'm4v',
  };
  // 50 MB, because that is the ceiling the platform actually enforces:
  // Supabase's GLOBAL file size limit caps every bucket, and on the Free
  // plan it cannot exceed 50 MB (docs: storage/uploads/file-limits). The
  // uploads bucket is already set to exactly that. This used to say 100 MB
  // — double what could ever succeed — so an 80 MB clip passed the client
  // check and was then rejected by Storage with a generic failure.
  // If the project moves to Pro, raise the global limit, the bucket limit
  // and this constant together, and the user-facing copy with them.
  const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
  // Derive extension from filename first, then fall back to MIME type so
  // files with no extension (camera captures on some Android PWA contexts,
  // canvas-exported blobs, etc.) still upload instead of throwing.
  const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif' };
  const rawExt = (file.name || '').split('.').pop()?.toLowerCase() || '';
  const ext = (rawExt && SAFE_EXTS.includes(rawExt))
    ? rawExt
    : (MIME_TO_EXT[file.type?.toLowerCase()] || '');
  // Only consider the video branch when the file isn't a recognized image.
  const videoExt = ext
    ? ''
    : ((rawExt && VIDEO_EXTS.includes(rawExt))
        ? rawExt
        : (VIDEO_MIME_TO_EXT[file.type?.toLowerCase()] || ''));
  if (!ext && !videoExt) {
    const err = new Error('File type not supported — use JPG, PNG, WebP, GIF, or HEIC images, or MP4, MOV, WebM video.');
    err.code = 'UNSUPPORTED_FILE_TYPE';
    throw err;
  }
  if (videoExt && file.size > VIDEO_MAX_BYTES) {
    const err = new Error('Video is too large — max 50 MB.');
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }
  const path = `${user.id}/${Date.now()}.${ext || videoExt}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      // upsert:false — an upsert makes Storage check for an existing row,
      // which needs a SELECT policy on storage.objects. Migration 185 dropped
      // the uploads bucket's SELECT policy (anti-enumeration), so every
      // upsert upload started failing with a 403 RLS violation. The path is
      // unique (user id + ms timestamp), so a plain insert is correct.
      upsert: false,
      // Pin to the safe MIME derived from extension, NOT the
      // client-supplied file.type which a tampered client can lie about.
      //
      // The video branch was NOT actually doing this: `ext` is '' for a
      // video (it's held in videoExt), so this read SAFE_MIMES[''] →
      // undefined, and supabase-js fell back to the File's own .type —
      // exactly the client-supplied value the comment above says we don't
      // trust. VIDEO_MIMES was declared for this and never referenced.
      contentType: ext ? SAFE_MIMES[ext] : VIDEO_MIMES[videoExt],
    });

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  // Return the storage path alongside the public URL so callers can
  // clean up orphan blobs if a downstream DB write fails after upload
  // succeeded. Previously only file_url was returned — callers couldn't
  // call .remove([path]) because they didn't have the path, so every
  // failed-after-upload flow leaked a blob. stories.js works around
  // this by computing its own path; HubChat / HubComposer didn't.
  return { file_url: publicUrl, path, bucket };
}

const integrations = {
  Core: {
    UploadFile: _uploadFile,
  },
};

/* ── Public export — same shape as the old db object ─────────────────── */
export const db = { entities, auth, functions, storage: {}, integrations };
