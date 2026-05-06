// src/api/base44Client.js
// ─────────────────────────────────────────────────────────────────────────────
// Supabase compatibility shim.
// Exports `base44` with the same surface area the rest of the app uses:
//   base44.entities.X  → .filter / .list / .get / .create / .update / .delete
//   base44.auth        → .me / .updateMe / .logout / .redirectToLogin
//   base44.functions   → .invoke
// Nothing outside this file needs to change for the migration.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabaseClient';

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
function makeEntity(entityName) {
  const table = TABLE[entityName];
  if (!table) throw new Error(`[Supabase shim] Unknown entity: "${entityName}"`);

  return {
    /** filter(conditions, sort, limit) — conditions is a plain equality map */
    async filter(conditions = {}, sort, limit = 1000) {
      let q = supabase.from(table).select('*');
      Object.entries(conditions).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        Array.isArray(v) ? (q = q.in(k, v)) : (q = q.eq(k, v));
      });
      const s = parseSort(sort);
      if (s) q = q.order(s.column, { ascending: s.ascending });
      q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },

    /** list(sort, limit) — equivalent to filter({}, ...) */
    async list(sort, limit = 1000) {
      let q = supabase.from(table).select('*');
      const s = parseSort(sort);
      if (s) q = q.order(s.column, { ascending: s.ascending });
      q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },

    /** get(id) — fetch single record by primary key */
    async get(id) {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
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
      const { data: { session } } = await supabase.auth.getSession();
      const authUser = session?.user;
      const enriched = {
        ...(authUser?.email ? { created_by: authUser.email } : {}),
        ...(authUser?.id    ? { user_id:    authUser.id    } : {}),
        ...data, // caller values win if explicitly provided
      };

      let payload = { ...enriched };
      for (let attempt = 0; attempt < 15; attempt++) {
        const { data: row, error } = await supabase.from(table).insert(payload).select().single();
        if (!error) return row;

        // PostgreSQL undefined_column — strip the bad column and retry
        if (error.code === '42703') {
          const match = error.message?.match(/column "([^"]+)"/);
          if (match?.[1] && match[1] in payload) {
            console.warn(`[Supabase] column "${match[1]}" not in ${table} yet — skipping (run migration 004)`);
            delete payload[match[1]];
            continue;
          }
        }

        throw error; // any other error is real — propagate immediately
      }
      throw new Error(`[Supabase] insert into ${table} failed after stripping unknown columns`);
    },

    /** update(id, data) — patch and return the updated row */
    async update(id, data) {
      const { data: row, error } = await supabase.from(table).update(data).eq('id', id).select().single();
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
let _profile = null;

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
  _profile = { id: user.id, email: user.email, ...(profile ?? {}) };
  return _profile;
}

function _clearProfile() { _profile = null; }

// Clear cache on sign-out
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') _clearProfile();
});

/* ── Auth shim ───────────────────────────────────────────────────────────── */
const auth = {
  /** Returns the merged auth+profile object; cached per session. */
  async me() {
    if (_profile) return _profile;
    return _loadProfile();
  },

  /** Patch the user profile and refresh the cache.
   *  Resilient retry: strips unknown columns (42703) and retries, same as create().
   *  This ensures username and onboarding flags always land even when some
   *  migration-002+ columns haven't been applied yet. */
  async updateMe(data) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    let payload = { id: user.id, email: user.email, ...data, updated_at: new Date().toISOString() };
    for (let attempt = 0; attempt < 15; attempt++) {
      const { data: row, error } = await supabase
        .from('user_profiles')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();
      if (!error) {
        _profile = { id: user.id, email: user.email, ...row };
        return _profile;
      }
      if (error.code === '42703') {
        const match = error.message?.match(/column "([^"]+)"/);
        if (match?.[1] && match[1] in payload) {
          console.warn(`[Supabase] column "${match[1]}" not in user_profiles yet — skipping (run migration 002)`);
          delete payload[match[1]];
          continue;
        }
      }
      throw error;
    }
    throw new Error('[Supabase] updateMe failed after stripping unknown columns');
  },

  /** Kick off Google OAuth. */
  redirectToLogin(redirectTo) {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo
          ? `${window.location.origin}${redirectTo.startsWith('/') ? redirectTo : '/' + redirectTo}`
          : window.location.origin,
      },
    });
  },

  /** Sign out and optionally redirect. */
  logout(redirectUrl) {
    _clearProfile();
    supabase.auth.signOut().then(() => {
      window.location.href = redirectUrl ?? '/';
    });
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

// XP milestone achievements — inserted client-side since Base44's server
// function no longer runs. Each entry: { id, name, description, xp_awarded, threshold }
const XP_ACHIEVEMENTS = [
  { id: 'xp_250',    name: 'First Steps',      description: 'Earned your first 250 XP',   xp_awarded: 10,  threshold: 250   },
  { id: 'xp_1000',   name: 'Getting Serious',  description: 'Earned 1,000 XP total',      xp_awarded: 25,  threshold: 1000  },
  { id: 'xp_5000',   name: 'Dedicated',        description: 'Earned 5,000 XP total',      xp_awarded: 50,  threshold: 5000  },
  { id: 'xp_10000',  name: 'Elite Athlete',    description: 'Earned 10,000 XP total',     xp_awarded: 100, threshold: 10000 },
  { id: 'xp_25000',  name: 'Legend',           description: 'Earned 25,000 XP total',     xp_awarded: 200, threshold: 25000 },
];

async function _invokeXp({ xp_gained = 0, action_type } = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !xp_gained) return null;

    // 1. Increment XP (RPC also updates current_level after migration 006)
    const { error } = await supabase.rpc('increment_user_xp', {
      p_user_id: user.id,
      p_xp: Math.round(xp_gained),
    });
    if (error) console.warn('[XP] rpc failed:', error.message);

    // 2. Read back new total_xp to check achievement milestones
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('total_xp, achievements_unlocked_count')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      const newTotal = profile.total_xp || 0;
      const prevTotal = newTotal - Math.round(xp_gained);

      // 3. Check each milestone — insert if crossed in this grant
      for (const ach of XP_ACHIEVEMENTS) {
        if (prevTotal < ach.threshold && newTotal >= ach.threshold) {
          const { data: existing } = await supabase
            .from('achievements')
            .select('id')
            .eq('created_by', user.email)
            .eq('achievement_id', ach.id)
            .maybeSingle();
          if (!existing) {
            await supabase.from('achievements').insert({
              created_by: user.email,
              user_id: user.id,
              achievement_id: ach.id,
              name: ach.name,
              description: ach.description,
              xp_awarded: ach.xp_awarded,
              unlocked_at: new Date().toISOString(),
            }).catch(() => {});
            // Bonus XP for achievement itself (capped to avoid recursion)
            if (ach.xp_awarded > 0) {
              await supabase.rpc('increment_user_xp', {
                p_user_id: user.id,
                p_xp: ach.xp_awarded,
              }).catch(() => {});
            }
            // Increment the counter on the profile
            await supabase
              .from('user_profiles')
              .update({ achievements_unlocked_count: (profile.achievements_unlocked_count || 0) + 1 })
              .eq('id', user.id)
              .catch(() => {});
          }
        }
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
  if (!user) return;
  const email = user.email;
  const tables = [
    'workout_logs', 'cardio_logs', 'goals', 'regimens', 'nutrition_logs',
    'body_metrics', 'achievements', 'workout_templates',
    'hub_posts', 'hub_follows', 'hub_comments', 'hub_comment_likes',
    'hub_reactions', 'hub_messages',
  ];
  await Promise.allSettled([
    ...tables.map(t => supabase.from(t).delete().eq('created_by', email)),
    ...tables.map(t => supabase.from(t).delete().eq('user_id', user.id)),
    supabase.from('hub_posts').delete().eq('author_email', email),
    supabase.from('hub_follows').delete().or(`follower_email.eq.${email},followee_email.eq.${email}`),
    supabase.from('hub_conversations').delete().contains('participant_emails', [email]),
  ]);
  await supabase.from('user_profiles').update({
    // Clear username and onboarding flags so the user re-onboards and picks a new username.
    // Hub posts already created keep the author_name snapshot so attribution isn't lost.
    username:               null,
    bio:                    '',
    avatar_url:             null,
    total_xp:               0,
    achievements_unlocked_count: 0,
    total_volume_lbs:       0,
    total_distance_meters:  0,
    onboarding_complete:    false,
    onboarding_completed:   false,
    account_reset_at:       new Date().toISOString(),
  }).eq('id', user.id);
  _clearProfile();
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

  const ext  = (file.name || 'file').split('.').pop() || 'jpg';
  const path = `${user.id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return { file_url: publicUrl };
}

const integrations = {
  Core: {
    InvokeLLM:     _notConfigured('InvokeLLM'),
    GenerateImage: _notConfigured('GenerateImage'),
    UploadFile:    _uploadFile,
    SendEmail:     _notConfigured('SendEmail'),
  },
};

/* ── Public export — same shape as the old base44 object ─────────────────── */
export const base44 = { entities, auth, functions, storage: {}, integrations };
