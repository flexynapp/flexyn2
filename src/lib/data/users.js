// src/lib/data/users.js
// Cross-user profile reads.
//
// Privacy hardening (June 2026 audit): cross-user reads go through the
// `public_profiles` VIEW — a whitelisted subset of user_profiles columns
// (same column names, includes id + email since email is the app's join
// key) readable by anon + authenticated. The base table's public SELECT
// policy is being dropped, so reading user_profiles for OTHER users will
// stop returning rows. Own-profile reads/writes (db.auth.me / updateMe /
// AuthContext) stay on user_profiles and are NOT affected.
//
// Deploy-window resilience: the frontend can go live before the view's
// migration is applied in prod. selectProfiles() probes `public_profiles`
// first and, if the view doesn't exist yet (42P01 / PGRST205 / "not
// found" mentioning public_profiles), retries the identical query against
// `user_profiles` — caching the verdict in a module flag so the fallback
// probe happens at most once per session.
//
// Leaderboard migration note (unchanged): the long-term target is a
// server-side `getLeaderboard(metric, scope, region, limit)` RPC that
// returns pre-sorted top-N. For now list() fetches all rows and callers
// sort client-side — fine up to ~5,000 users.
import { supabase } from '@/api/supabaseClient';

const PROFILES_VIEW = 'public_profiles';
const BASE_TABLE = 'user_profiles';

// null = unprobed; true = view exists; false = view missing, use base table.
let _viewVerdict = null;

/** Test-only escape hatch — reset the cached probe verdict. */
export function __resetProfilesSourceForTests() {
  _viewVerdict = null;
}

function _isMissingViewError(error) {
  if (!error) return false;
  const code = error.code || '';
  // 42P01: Postgres "relation does not exist".
  // PGRST205: PostgREST "table/view not found in schema cache".
  if (code === '42P01' || code === 'PGRST205') return true;
  const haystack = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  return haystack.includes(PROFILES_VIEW)
    && /(does not exist|not exist|not found|could not find)/i.test(haystack);
}

/**
 * Run a cross-user profile read against `public_profiles`, falling back
 * to `user_profiles` while the view migration is pending in prod.
 *
 * @param {(from: import('@supabase/supabase-js').PostgrestQueryBuilder) => PromiseLike<{data:any, error:any}>} build
 *   Builder that receives `supabase.from(<source>)` and returns the
 *   chain's terminal promise (`{ data, error }` — .single()/.maybeSingle()
 *   shapes included). The builder MUST be re-runnable: it is invoked a
 *   second time against the base table when the view is missing.
 * @returns {Promise<{data:any, error:any}>} whatever the chain returns.
 */
export async function selectProfiles(build) {
  if (_viewVerdict === false) {
    return build(supabase.from(BASE_TABLE));
  }
  const result = await build(supabase.from(PROFILES_VIEW));
  if (!result?.error) {
    _viewVerdict = true;
    return result;
  }
  if (_viewVerdict !== true && _isMissingViewError(result.error)) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[users] public_profiles view missing — falling back to user_profiles for this session');
    }
    _viewVerdict = false;
    return build(supabase.from(BASE_TABLE));
  }
  return result;
}

// Lean column set for author/flair resolution (useAuthors, which runs on every
// Hub feed load). The resolver + @mention autocomplete only read these 7 fields
// — selecting them instead of `*` avoids pulling all 32 profile columns (incl.
// the trophy_case JSONB) for every user on the hottest read path. Scales with
// the user count.
export const AUTHOR_COLUMNS =
  'id, username, avatar_url, equipped_title_id, equipped_frame_id, signature_trophy';

/**
 * List all (public) profiles. Mirrors the old db.entities.User.list().
 * @param {number} limit
 * @param {string} columns  PostgREST column list; defaults to '*'. Pass a lean
 *   subset (e.g. AUTHOR_COLUMNS) on hot paths that only need a few fields.
 */
export async function list(limit = 1000, columns = '*') {
  const { data, error } = await selectProfiles((from) =>
    from.select(columns).limit(limit)
  );
  if (error) throw error;
  return data ?? [];
}
