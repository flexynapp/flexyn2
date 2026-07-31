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

/* ── Entity name → Postgres table name ─────────────────────────────────── */
const TABLE = {
  WorkoutLog:       'workout_logs',
  CardioLog:        'cardio_logs',
  Goal:             'goals',
  Regimen:          'regimens',
  NutritionLog:     'nutrition_logs',
  BodyMetric:       'body_metrics',
  Achievement:      'achievements',
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

/* ── Build a reusable entity accessor ───────────────────────────────────── */
// Per-table cache of columns the running DB schema doesn't have. The
// write-path strip-and-retry (create/update below) drops any column that
// 42703s / PGRST204s and records it here, so later writes to the same table
// strip those columns UP FRONT instead of paying one failed round-trip per
// unknown column every time. This matters for nutrition_logs: a full
// nutrient+vitamin payload carries ~15 columns the table doesn't have
// (the _g/_mg aliases, sugar, cholesterol, 8 vitamins), which used to blow
// past the retry budget and fail the whole insert. Session-scoped — cleared
// on reload, which is also when a freshly-applied migration takes effect.
const _missingCols = new Map();
const _rememberMissingCol = (table, col) => {
  let set = _missingCols.get(table);
  if (!set) { set = new Set(); _missingCols.set(table, set); }
  set.add(col);
};
const _stripKnownMissing = (table, payload) => {
  const set = _missingCols.get(table);
  if (set) for (const col of set) delete payload[col];
  return payload;
};

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
     *  without every caller needing to set them manually.
     *
     *  Resilient retry: if Postgres returns error 42703 (undefined_column)
     *  the unknown column is stripped from the payload and the insert is
     *  retried automatically. This lets the app work even when migration 004
     *  hasn't been applied yet — the extra fields are silently dropped rather
     *  than crashing the entire feature. */
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
      const effectiveEmail = authUser?.email
        || (authUser?.id ? `guest_${authUser.id}@flexyn.guest` : null);
      const enriched = {
        ...data, // caller values for non-identity fields
        ...(effectiveEmail   ? { created_by: effectiveEmail } : {}),
        ...(authUser?.id     ? { user_id:    authUser.id    } : {}),
      };

      // Drop columns already known to be missing on this table (from an
      // earlier write this session) before the first attempt, so a rich
      // payload doesn't re-discover all of them one failed insert at a time.
      let payload = _stripKnownMissing(table, { ...enriched });
      // Cap is generous enough to strip every unknown column in the widest
      // payload (nutrition_logs micros → ~15) plus headroom, so a schema that
      // lags the client never fails the whole write.
      for (let attempt = 0; attempt < 48; attempt++) {
        const { data: row, error } = await supabase.from(table).insert(payload).select().single();
        if (!error) return row;

        // PostgreSQL 23505 unique_violation on an idempotency key —
        // a prior attempt of THIS save intent already landed. Fetch
        // and return the existing row so the caller treats it as a
        // successful save (mig 142, audit C-2). Tagged via
        // `__duplicate = true` on the returned object so the caller
        // can skip side-effects (XP/volume re-credit).
        if (error.code === '23505' && payload.idempotency_key && payload.user_id) {
          const isIdempotencyConflict = /idempotency/i.test(error.message || '')
            || error.constraint === 'workout_logs_idempotency_idx';
          if (isIdempotencyConflict) {
            const { data: existing, error: fetchErr } = await supabase
              .from(table)
              .select('*')
              .eq('user_id', payload.user_id)
              .eq('idempotency_key', payload.idempotency_key)
              .maybeSingle();
            if (!fetchErr && existing) {
              existing.__duplicate = true;
              return existing;
            }
          }
        }

        // PostgreSQL 42703 undefined_column — strip and retry
        if (error.code === '42703') {
          const match = error.message?.match(/column "([^"]+)"/);
          if (match?.[1] && match[1] in payload) {
            console.warn(`[Supabase] column "${match[1]}" not in ${table} yet — skipping (run migration 004)`);
            _rememberMissingCol(table, match[1]);
            delete payload[match[1]];
            continue;
          }
        }

        // PostgREST PGRST204 schema-cache miss — same fix, different error shape.
        // Happens when a column exists in the JS payload but not in PostgREST's
        // cached schema (e.g. migration 006 not yet applied).
        if (error.code === 'PGRST204') {
          const match = error.message?.match(/the '([^']+)' column/);
          if (match?.[1] && match[1] in payload) {
            console.warn(`[Supabase] PGRST204: column "${match[1]}" not in PostgREST schema cache for ${table} — skipping`);
            _rememberMissingCol(table, match[1]);
            delete payload[match[1]];
            continue;
          }
        }

        throw error; // any other error is real — propagate immediately
      }
      throw new Error(`[Supabase] insert into ${table} failed after stripping unknown columns`);
    },

    /** update(id, data) — patch and return the updated row.
     *
     * Mirrors create()'s strip-and-retry so unknown columns get
     * dropped silently when the running schema lags the client (e.g.
     * is_public_free landed in mig 143 — pre-143 hosts would 42703
     * here without this loop). */
    async update(id, data) {
      let payload = _stripKnownMissing(table, { ...data });
      for (let attempt = 0; attempt < 48; attempt++) {
        const { data: row, error } = await supabase.from(table).update(payload).eq('id', id).select().single();
        if (!error) return row;
        if (error.code === '42703') {
          const match = error.message?.match(/column "([^"]+)"/);
          if (match?.[1] && match[1] in payload) {
            console.warn(`[Supabase] update column "${match[1]}" not in ${table} yet — skipping`);
            _rememberMissingCol(table, match[1]);
            delete payload[match[1]];
            continue;
          }
        }
        if (error.code === 'PGRST204') {
          const match = error.message?.match(/the '([^']+)' column/);
          if (match?.[1] && match[1] in payload) {
            console.warn(`[Supabase] PGRST204: update column "${match[1]}" not in PostgREST schema cache for ${table} — skipping`);
            _rememberMissingCol(table, match[1]);
            delete payload[match[1]];
            continue;
          }
        }
        throw error;
      }
      throw new Error(`[Supabase] update on ${table} failed after stripping unknown columns`);
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

  /** Patch the user profile and refresh the cache.
   *  Resilient retry: strips unknown columns (42703) and retries, same as create().
   *  This ensures username and onboarding flags always land even when some
   *  migration-002+ columns haven't been applied yet. */
  async updateMe(data) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    // Guest / anonymous users have user.email = '' (empty). Writing that
    // raw into the payload is a double bug: user_profiles.email is UNIQUE
    // (user_profiles_email_key), so the FIRST guest's updateMe clobbers the
    // canonical `guest_<uid>@flexyn.guest` that handle_new_user (mig 172)
    // wrote — and EVERY subsequent guest then collides on '' with 23505.
    // 23505 isn't 42703/PGRST204, so the strip-and-retry loop below can't
    // recover it and the whole upsert throws — silently breaking onboarding
    // completion, nutrition setup, theme, and every other profile write for
    // the 2nd+ guest. Synthesize the same uid-derived placeholder create()
    // uses so the value is unique per guest AND matches created_by on their
    // rows (so their workout/history reads resolve). Real users keep their
    // own email (unchanged behavior).
    const effectiveEmail = user.email
      || (user.id ? `guest_${user.id}@flexyn.guest` : null);
    let payload = { id: user.id, email: effectiveEmail, ...data, updated_at: new Date().toISOString() };

    // Columns that are always safe — never strip these even in nuclear mode.
    const CORE_KEYS = new Set(['id', 'email', 'updated_at', 'username',
      'onboarding_complete', 'onboarding_completed', 'onboarding_completed_at']);

    // Helper: extract the offending column name from various PostgREST /
    // Postgres error message formats.
    const extractCol = (msg = '') => {
      const m =
        msg.match(/the '([^']+)' column/) ||   // PGRST204 standard
        msg.match(/column '([^']+)'/)        ||  // PGRST204 alt
        msg.match(/column "([^"]+)"/)        ||  // 42703 postgres
        msg.match(/"([^"]+)" column/)        ||  // reversed form
        msg.match(/'([^']+)' of relation/);      // another PostgREST variant
      return m?.[1] ?? null;
    };

    // 20 attempts so we can strip several one-off newer columns without
    // exhausting the retry budget. Onboarding sends a wide payload.
    for (let attempt = 0; attempt < 20; attempt++) {
      const { data: row, error } = await supabase
        .from('user_profiles')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();
      if (!error) {
        return setProfile({ id: user.id, email: user.email, ...row });
      }

      // PostgreSQL 42703 undefined_column — strip and retry
      if (error.code === '42703') {
        const col = extractCol(error.message);
        if (col && col in payload && !CORE_KEYS.has(col)) {
          console.warn(`[Supabase] 42703: column "${col}" not in user_profiles — skipping`);
          delete payload[col];
          continue;
        }
      }

      // PostgREST PGRST204 schema-cache miss — same fix, different shape.
      if (error.code === 'PGRST204') {
        const col = extractCol(error.message);
        if (col && col in payload && !CORE_KEYS.has(col)) {
          console.warn(`[Supabase] PGRST204: column "${col}" not in PostgREST schema cache — skipping`);
          delete payload[col];
          continue;
        }
        // Column name not extractable from message — nuclear: strip everything
        // non-core and retry once. Prevents a bad PGRST204 from hard-blocking.
        const stripped = Object.fromEntries(
          Object.entries(payload).filter(([k]) => CORE_KEYS.has(k))
        );
        console.warn('[Supabase] PGRST204: could not extract column — nuclear strip, retrying with core fields only');
        const { data: row2, error: err2 } = await supabase
          .from('user_profiles')
          .upsert(stripped, { onConflict: 'id' })
          .select()
          .single();
        if (!err2) {
          return setProfile({ id: user.id, email: user.email, ...row2 });
        }
        throw err2;
      }

      throw error;
    }

    // Last resort: send only the absolute minimum fields needed to mark
    // onboarding complete. Prevents users from being permanently stuck
    // on the onboarding screen due to schema drift on non-essential cols.
    console.warn('[Supabase] updateMe: 20-attempt budget exhausted — nuclear fallback with core fields only');
    const nuclear = { id: user.id, email: user.email, updated_at: new Date().toISOString() };
    for (const k of CORE_KEYS) { if (k in payload) nuclear[k] = payload[k]; }
    const { data: finalRow, error: finalErr } = await supabase
      .from('user_profiles')
      .upsert(nuclear, { onConflict: 'id' })
      .select()
      .single();
    if (!finalErr) {
      return setProfile({ id: user.id, email: user.email, ...finalRow });
    }
    throw finalErr;
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
    const target = redirectTo
      ? `${window.location.origin}${redirectTo.startsWith('/') ? redirectTo : '/' + redirectTo}`
      : window.location.origin;
    return supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: target },
    });
  },

  /**
   * Email magic-link sign-in. Supabase emails the user a one-tap link
   * that signs them in directly — no password needed. shouldCreateUser
   * is true so the same flow handles both signup and login. The auth
   * provider must be enabled in the Supabase dashboard.
   */
  async signInWithMagicLink(email, redirectTo) {
    if (!email || typeof email !== 'string') {
      throw new Error('email required');
    }
    const target = redirectTo
      ? `${window.location.origin}${redirectTo.startsWith('/') ? redirectTo : '/' + redirectTo}`
      : window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: target, shouldCreateUser: true },
    });
    if (error) throw error;
    return { ok: true };
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
      case 'usdaBarcodeLookup':           return _invokeBarcodeLookup(payload);
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

async function _invokeXp({ xp_gained = 0, action_type } = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !xp_gained) return null;

    // 1. Grant XP through grant_action_xp (migration 198): it enforces a
    //    per-action daily cap (anti-farm for the fixed grants) and then
    //    delegates to the global-capped increment_user_xp. Passing
    //    action_type is what makes the per-action cap possible — the raw
    //    increment_user_xp RPC is no longer client-callable.
    const { error } = await supabase.rpc('grant_action_xp', {
      p_action_type: action_type || 'other',
      p_xp: Math.round(xp_gained),
    });
    if (error) console.warn('[XP] rpc failed:', error.message);

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
    return { ok: true };
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
  const email = user.email;

  // 1. Regimens — use the tombstone-aware purge so public templates that
  //    other users have copied don't leave dangling original_template_id
  //    references in the clones. Private/uncopied regimens are deleted.
  try {
    const { purgeForUser: purgeRegimens } = await import('@/lib/data/regimens');
    await purgeRegimens(email);
  } catch (err) {
    console.warn('[delete] regimen purge failed:', err);
  }

  // 2. All other user-owned rows. EVERY new table added since this
  //    function was first written MUST be added here too — the audit
  //    found multiple tables (loot, marketplace, leagues, notifications,
  //    sticker reactions, reports, daily quests) that were silently
  //    leaving orphan rows containing user-identifying data.
  //
  // Tables are split into two groups:
  //   - `tables_with_created_by`: rows owned via created_by (email) AND user_id
  //   - `tables_with_user_id_only`: rows owned via user_id only (newer tables)
  // We delete both filter variants where applicable so we don't miss rows
  // that were inserted before the column-sync triggers were in place.
  const tables_with_created_by = [
    'workout_logs', 'cardio_logs', 'goals', 'nutrition_logs',
    'body_metrics', 'achievements', 'workout_templates',
    'hub_posts', 'hub_comments', 'hub_comment_likes', 'hub_reactions',
    'hub_messages',
  ];
  // user_id-owned tables across every migration up to 141. ADD ANY
  // NEW USER-OWNED TABLE HERE WHEN ITS MIGRATION LANDS — see
  // _audit_schema_drift.sql for a query that lists user_id columns
  // present in the schema.
  const tables_with_user_id_only = [
    'user_inventory',           // loot owned
    'user_capsules',            // earned capsules
    'league_members',           // league standings
    'notifications',            // inbox
    'post_sticker_reactions',   // sticker reactions on posts
    'user_daily_quests',        // daily quest history
    // ── Wellness / tracking (mig 095, 096, 128)
    // NOTE: hydration_logs, recovery_scores, fitness_assessments,
    // body_metrics_measurements DO NOT exist as separate tables.
    // - fitness_assessment is a JSONB column on user_profiles (mig 129)
    // - mig 133 added body-measurement COLUMNS to body_metrics
    // - hydration and recovery never shipped as tables
    // The user_profiles row is cleared below via auth.updateMe, so the
    // JSONB column's data is wiped there. body_metrics rows are cleared
    // by the `tables_with_created_by` block above.
    'sleep_logs',
    'mood_logs',
    'cycle_logs',
    // ── Crews & competition (mig 130, 132)
    'crew_message_reactions',
    'monthly_league_members',
    // ── Injuries (mig 052) — was already covered via user_id; explicit here
    'injury_logs',
    // ── Gym ecosystem (mig 135, 138, 139)
    'gym_members',
    'gym_event_rsvps',
    'gym_feed_post_reactions',
    // ── Push subscriptions (mig 033)
    'push_subscriptions',
    // ── Trainer tier (mig 143) — buyer's purchase receipts. Listings
    // (trainer_id) are handled in pii_tables below.
    'trainer_purchases',
    // ── Corporate wellness (mig 146) — the user's org memberships.
    // Owned organizations (owner_id) are handled in pii_tables.
    'organization_members',
  ];

  // PII-bearing tables where the user is the author/creator/owner.
  // Each row contains identifying data (email, phone, address, body).
  // We delete by user_id AND by the email-bearing column.
  //
  // IMPORTANT: every entry here MUST use the actual column names from
  // the table's CREATE TABLE migration. The previous bug — surfaced as
  // "Deletion incomplete (user_mutes.user_id, user_blocks.user_id…)" —
  // was caused by adding user_mutes/user_blocks to the user_id list
  // when their actual columns are muter_id / blocker_id. Future
  // additions: grep the migration for `CREATE TABLE` and use the
  // literal column name, not what the convention "should be."
  const pii_tables = [
    // [table, idCol, emailCol]
    ['gym_feed_posts',    'author_id',  'author_email'],
    ['gym_feed_comments', 'author_id',  'author_email'],
    ['gym_events',        'created_by', null],
    ['gym_verification_queue', 'owner_id', null],
    ['gym_businesses',    'owner_id',   null],
    // Trainer tier (mig 143) — the user's own listings as a creator.
    ['trainer_listings',  'trainer_id', null],
    // Corporate wellness (mig 146) — organizations the user owns.
    ['organizations',     'owner_id',   null],
    // Mutes (mig 107) — column is `muter_id`, not user_id. Also clears
    // the muter_email-keyed lookup for parity with the email side of
    // other PII tables.
    ['user_mutes',        'muter_id',   'muter_email'],
    // Blocks (mig 106) — column is `blocker_id`, not user_id.
    ['user_blocks',       'blocker_id', 'blocker_email'],
  ];

  // Run all deletes; collect any per-row failures. We previously used
  // Promise.allSettled and ignored failures wholesale; that masked
  // partial deletions (audit B-2/B-5). Now we report any non-empty
  // failure list back to the caller.
  const ops = [
    ...tables_with_created_by.map(t => ({ name: t + '.created_by', p: supabase.from(t).delete().eq('created_by', email) })),
    ...tables_with_created_by.map(t => ({ name: t + '.user_id',    p: supabase.from(t).delete().eq('user_id', user.id) })),
    ...tables_with_user_id_only.map(t => ({ name: t + '.user_id',  p: supabase.from(t).delete().eq('user_id', user.id) })),
    ...pii_tables.flatMap(([t, idCol, emailCol]) => {
      const ops = [{ name: `${t}.${idCol}`, p: supabase.from(t).delete().eq(idCol, user.id) }];
      if (emailCol) ops.push({ name: `${t}.${emailCol}`, p: supabase.from(t).delete().eq(emailCol, email) });
      return ops;
    }),
    { name: 'marketplace_listings.seller_user_id', p: supabase.from('marketplace_listings').delete().eq('seller_user_id', user.id) },
    { name: 'marketplace_listings.seller_email',   p: supabase.from('marketplace_listings').delete().eq('seller_email', email) },
    { name: 'hub_reports.reporter_user_id',        p: supabase.from('hub_reports').delete().eq('reporter_user_id', user.id) },
    { name: 'hub_reports.reporter_email',          p: supabase.from('hub_reports').delete().eq('reporter_email', email) },
    { name: 'hub_posts.author_email',              p: supabase.from('hub_posts').delete().eq('author_email', email) },
    { name: 'hub_follows.both',                    p: supabase.from('hub_follows').delete().or(`follower_email.eq.${email},followee_email.eq.${email}`) },
    { name: 'hub_conversations.participant_emails', p: supabase.from('hub_conversations').delete().contains('participant_emails', [email]) },
  ];

  const results = await Promise.allSettled(ops.map(o => o.p));
  const failures = [];
  // Codes we tolerate as "environment skew" rather than real deletion
  // failures. The user's data isn't at these tables anyway, so the
  // delete is functionally a no-op — but we don't want to scare them
  // with "Deletion incomplete" for what is essentially a stale config.
  //   42P01    — relation does not exist (table missing on this host)
  //   42703    — column does not exist (code/schema mismatch, e.g. the
  //              user_mutes.user_id bug that surfaced before this audit)
  //   PGRST204 — column not found in PostgREST schema cache
  //   PGRST205 — table not in PostgREST cache
  // Everything else (RLS reject 42501, FK violation 23503, network) is
  // a real failure that the user must know about.
  const SCHEMA_SKEW_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      failures.push({ table: ops[i].name, error: r.reason?.message || String(r.reason) });
    } else if (r.value?.error) {
      const code = r.value.error.code;
      if (SCHEMA_SKEW_CODES.has(code)) {
        // Loud warning so devs catch the mismatch in development, but
        // don't surface to the user.
        console.warn(`[deleteAccount] schema skew on ${ops[i].name} (${code}): ${r.value.error.message}`);
      } else {
        failures.push({ table: ops[i].name, error: r.value.error.message, code });
      }
    }
  });

  // 3. Reset every cumulative / denormalized field on the user_profiles row
  //    AND clear every onboarding-collected field so a fresh start is truly
  //    fresh. Username goes to null to release the handle (it's nullable
  //    in the schema; the App.jsx re-onboarding gate handles null too).
  //
  // Privileged columns (XP / coins / streaks / leaderboard totals /
  // league tier — everything the mig 142/173 trigger rejects from direct
  // client writes with 42501) are zeroed via the reset_my_profile_stats
  // RPC. On pre-173 hosts the RPC is missing (42883) — there the trigger
  // doesn't exist either, so we fall back to carrying those fields in
  // the updateMe payload like before.
  let privilegedStatsHandled = false;
  try {
    const { error: resetErr } = await supabase.rpc('reset_my_profile_stats');
    if (!resetErr) {
      privilegedStatsHandled = true;
    } else if (resetErr.code !== '42883' && resetErr.code !== '42P01') {
      // 173+ host but the reset genuinely failed — report it like any
      // other partial-deletion failure. Don't retry via updateMe: the
      // trigger would reject those fields with 42501 anyway.
      failures.push({ table: 'user_profiles.reset_my_profile_stats', error: resetErr.message, code: resetErr.code });
      privilegedStatsHandled = true;
    }
  } catch (err) {
    failures.push({ table: 'user_profiles.reset_my_profile_stats', error: err?.message || String(err) });
    privilegedStatsHandled = true;
  }

  // Use auth.updateMe (NOT direct supabase.update) so the column-stripping
  // retry handles fields that might not exist on the schema yet — older
  // environments missing some of the newer columns (e.g. loot_theme_id
  // pre-021, milestone_capsules_awarded pre-022) won't block the reset.
  await auth.updateMe({
    // Identity
    username:               null,
    bio:                    '',
    avatar_url:             null,
    // Open cumulative counters (not in the 142/173 privileged blocklist)
    achievements_unlocked_count: 0,
    // Privileged counters — pre-173 hosts only (see above)
    ...(privilegedStatsHandled ? {} : {
      total_xp:               0,
      flex_coins:             0,
      milestone_capsules_awarded:  0,
      total_volume_lbs:       0,
      total_distance_meters:  0,
      login_streak:           0,
      workout_streak:         0,
      longest_workout_streak: 0,
      league_tier:            'bronze',
    }),
    // Equipped cosmetics (loot — clear so the next account starts blank)
    loot_theme_id:          null,
    equipped_title_id:      null,
    equipped_frame_id:      null,
    preferred_theme:        null,
    // Onboarding profile fields
    gender:                 null,
    birthday:               null,
    age:                    null,
    height_inches:          null,
    height_cm:              null,
    height_unit:            null,
    weight_lbs:             null,
    weight_kg:              null,
    weight_unit:            null,
    fitness_level:          null,
    fitness_goals:          null,
    fitness_goals_arr:      null,
    training_days:          null,
    preferred_workout_time: null,
    country_code:           null,
    state_code:             null,
    // Onboarding gate
    onboarding_complete:    false,
    onboarding_completed:   false,
    onboarding_completed_at: null,
    // Defensive reset timestamp — filterAfterReset uses this to hide
    // any row that survived the cascade (RLS denial, network error, etc.)
    // from rendering on the post-reset account.
    account_reset_at:       new Date().toISOString(),
  });

  _clearProfile();

  if (failures.length > 0) {
    const err = new Error(`Partial deletion — ${failures.length} table(s) failed`);
    err.failures = failures;
    err.partial = true;
    throw err;
  }
  return { success: true };
}

async function _invokeBarcodeLookup({ barcode } = {}) {
  if (!barcode) return null;
  try {
    const res = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(barcode)}&api_key=DEMO_KEY&pageSize=1`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const food = json?.foods?.[0];
    if (!food) return null;
    const n = (id) => food.foodNutrients?.find(x => x.nutrientId === id)?.value ?? 0;
    return {
      name: food.description,
      brand: food.brandOwner ?? food.brandName ?? '',
      serving_label: food.servingSize ? `${food.servingSize}${food.servingSizeUnit ?? 'g'}` : '100g',
      nutrition: { calories: n(1008), protein: n(1003), carbs: n(1005), fat: n(1004), fiber: n(1079), sodium: n(1093) },
    };
  } catch (err) {
    console.warn('[Barcode] lookup failed:', err);
    return null;
  }
}

/* ── Integrations — file upload via Supabase Storage ────────────────────── */
// Requires a public Supabase Storage bucket named "uploads".
// To create it, run migration 008_storage_bucket.sql in the SQL Editor.

const _notConfigured = (name) => async () => {
  throw new Error(`[Flexyn] ${name} is not configured.`);
};

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
    InvokeLLM:     _notConfigured('InvokeLLM'),
    GenerateImage: _notConfigured('GenerateImage'),
    UploadFile:    _uploadFile,
    SendEmail:     _notConfigured('SendEmail'),
  },
};

/* ── Public export — same shape as the old db object ─────────────────── */
export const db = { entities, auth, functions, storage: {}, integrations };
