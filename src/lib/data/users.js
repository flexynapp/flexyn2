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
  // Any OTHER coded error is a real failure, not a missing view — surface it.
  //
  // This line is the fix for a silent, whole-session data outage. PostgREST
  // reports a missing COLUMN as 42703 with the message
  //   `column public_profiles.display_name does not exist`
  // which contains both the view name and "does not exist", so the substring
  // probe below classified it as a missing VIEW. selectProfiles() then cached
  // `_viewVerdict = false` at module scope and re-ran every cross-user read
  // against user_profiles — whose only SELECT policy is `auth.uid() = id`.
  // That returns 200 with just the caller's own row, so nothing throws and
  // nothing logs: for the rest of the session the feed simply stops resolving
  // anyone else's flair, search returns nobody, and crew rosters empty out.
  //
  // The substring probe is kept for the case it was written for — a genuinely
  // absent view during a deploy window, where PostgREST may answer before the
  // schema cache has a code to give — but it is now reachable only when the
  // error carries no code at all.
  if (code) return false;
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
  'id, username, display_name, avatar_url, equipped_title_id, equipped_frame_id, signature_trophy';

/**
 * List all (public) profiles, through the view (see selectProfiles).
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

// Ids per request. Each uuid is 36 characters in the query string, so a
// follower list of a few thousand in one `.in()` would pass the URL limits
// PostgREST's proxies enforce.
const IDS_PER_REQUEST = 100;

/**
 * Profiles for exactly these ids, through the view. For a list of people
 * the caller already knows (followers, following), rather than fetching
 * everyone with list() and filtering: that downloads every profile in the
 * app to show a handful, and past list()'s 1000-row limit it silently drops
 * anyone who falls outside it.
 * @param {string[]} ids
 * @param {string} columns
 */
export async function listByIds(ids, columns = '*') {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const rows = [];
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) {
    const chunk = unique.slice(i, i + IDS_PER_REQUEST);
    const { data, error } = await selectProfiles((from) =>
      from.select(columns).in('id', chunk)
    );
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}
