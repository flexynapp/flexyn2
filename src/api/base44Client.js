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
     *  without every caller needing to set them manually. */
    async create(data) {
      const { data: { session } } = await supabase.auth.getSession();
      const authUser = session?.user;
      const enriched = {
        ...(authUser?.email ? { created_by: authUser.email } : {}),
        ...(authUser?.id    ? { user_id:    authUser.id    } : {}),
        ...data, // caller values win if explicitly provided
      };
      const { data: row, error } = await supabase.from(table).insert(enriched).select().single();
      if (error) throw error;
      return row;
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

  /** Patch the user profile and refresh the cache. */
  async updateMe(data) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data: row, error } = await supabase
      .from('user_profiles')
      .upsert(
        { id: user.id, email: user.email, ...data, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      .select()
      .single();
    if (error) throw error;
    _profile = { id: user.id, email: user.email, ...row };
    return _profile;
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

async function _invokeXp({ xp_gained = 0 } = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !xp_gained) return null;
    const { error } = await supabase.rpc('increment_user_xp', {
      p_user_id: user.id,
      p_xp: Math.round(xp_gained),
    });
    if (error) console.warn('[XP] rpc failed:', error.message);
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
    supabase.from('hub_posts').delete().eq('author_email', email),
    supabase.from('hub_follows').delete().or(`follower_email.eq.${email},followee_email.eq.${email}`),
  ]);
  await supabase.from('user_profiles').update({
    username: `deleted_${user.id.slice(0, 8)}`,
    bio: '', avatar_url: null, total_xp: 0,
    achievements_unlocked_count: 0, total_volume_lbs: 0, total_distance_meters: 0,
    account_reset_at: new Date().toISOString(),
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

/* ── Integrations stub — prevents TypeError crashes on legacy Base44 calls ── */
// Components that used base44.integrations.Core.InvokeLLM / GenerateImage /
// UploadFile will catch the thrown error and show a graceful UI error state
// instead of crashing the whole page.
const _notConfigured = (name) => async () => {
  throw new Error(`[Flexyn] ${name} is not configured. Implement via Supabase Edge Functions.`);
};

const integrations = {
  Core: {
    InvokeLLM:     _notConfigured('InvokeLLM'),
    GenerateImage: _notConfigured('GenerateImage'),
    UploadFile:    _notConfigured('UploadFile'),
    SendEmail:     _notConfigured('SendEmail'),
  },
};

/* ── Public export — same shape as the old base44 object ─────────────────── */
export const base44 = { entities, auth, functions, storage: {}, integrations };
