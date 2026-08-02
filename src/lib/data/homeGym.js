// src/lib/data/homeGym.js
//
// "My Gym" — the single gym a user declares as theirs (migration 275).
//
// Distinct from `gym_members`, which is the many-gyms junction behind the
// "My Gyms" list. Setting a home gym ALSO joins that gym, because the
// leaderboard RPCs are gated on membership (mig 158's
// is_gym_member_or_owner) — a home gym you aren't a member of is a home
// gym whose own leaderboard throws 42501 at you. Both RPCs below do the
// join and the profile write in one server-side transaction so that
// invariant can't be half-applied.
//
// Two entry points because a gym may or may not exist in our database
// yet:
//   setHomeGym(gymId)         — an existing gym_businesses row
//   setHomeGymFromOsm(osmGym) — an OpenStreetMap gym nobody has picked
//                               before; the RPC promotes it to a
//                               persistent source='community' row first,
//                               deduped on (osm_type, osm_id) so every
//                               later picker shares the same row and
//                               therefore the same leaderboard.
//
// Profile-cache rule (CLAUDE.md): these are RPCs that change
// user_profiles, so the module-level cache in profileCache.js does NOT
// see the write and db.auth.me() would keep handing back a stale row.
// Every success path calls patchProfile({ home_gym_id }). Importing
// `@/api/profileCache` rather than `@/api/db` is deliberate — db.js
// registers an onAuthStateChange listener at module scope that breaks
// any test stubbing the supabase client.

import { supabase } from '@/api/supabaseClient';
import { patchProfile, getProfile } from '@/api/profileCache';
import { reportError } from '@/lib/reportError';

/**
 * Adopt an existing gym_businesses row as the caller's home gym.
 * Pass null to clear it ("I don't train anywhere in particular").
 *
 * @returns {Promise<{ok: boolean, gymId?: string|null, error?: string}>}
 */
export async function setHomeGym(gymId) {
  const { data, error } = await supabase.rpc('set_home_gym', {
    p_gym_id: gymId ?? null,
  });

  if (error) {
    reportError(error, { feature: 'home-gym.set' });
    return { ok: false, error: error.code || 'RPC_FAILED' };
  }
  if (!data?.ok) return { ok: false, error: data?.error || 'UNKNOWN' };

  patchProfile({ home_gym_id: data.gym_id ?? null });
  return { ok: true, gymId: data.gym_id ?? null };
}

/**
 * Promote an OpenStreetMap gym into a community gym (or reuse the row if
 * someone already promoted it), then adopt it as the caller's home gym.
 *
 * `osmGym` is a row from GymMap's fetchOsmGyms: { osmId, osmType, name,
 * lat, lon }. osmType defaults to 'node' because the Overpass query in
 * GymMap emits `out center`, which flattens ways to a centre point and
 * historically left the type off the mapped object.
 *
 * @returns {Promise<{ok, gymId?, created?, error?}>}
 */
export async function setHomeGymFromOsm(osmGym) {
  if (!osmGym?.osmId) return { ok: false, error: 'BAD_OSM_ID' };

  const { data, error } = await supabase.rpc('set_home_gym_from_osm', {
    p_osm_type: osmGym.osmType || 'node',
    p_osm_id: Number(osmGym.osmId),
    p_name: osmGym.name || '',
    p_lat: osmGym.lat,
    p_lng: osmGym.lon,
    p_city: osmGym.city ?? null,
    p_state: osmGym.state ?? null,
  });

  if (error) {
    reportError(error, { feature: 'home-gym.set-from-osm' });
    // 23514 is the mig 158 profanity trigger rejecting the OSM name.
    // Surfacing it as its own code lets the caller say something more
    // useful than "try again" for a gym it will never be able to add.
    if (error.code === '23514') return { ok: false, error: 'NAME_REJECTED' };
    return { ok: false, error: error.code || 'RPC_FAILED' };
  }
  if (!data?.ok) return { ok: false, error: data?.error || 'UNKNOWN' };

  patchProfile({ home_gym_id: data.gym_id });
  return { ok: true, gymId: data.gym_id, created: !!data.created };
}

/**
 * Resolve the caller's home gym id without trusting AuthContext.
 *
 * AuthContext snapshots the profile at sign-in and after checkUserAuth().
 * Onboarding attaches the home gym AFTER its checkUserAuth() call, and a
 * pick made on another device never touches this tab's context at all —
 * so `user.home_gym_id` is legitimately stale in both cases, and reading
 * only that shows "you haven't picked a gym yet" to someone who just
 * picked one.
 *
 * Cheapest-first: the passed-in context value, then the module profile
 * cache (which patchProfile keeps current), then one query.
 */
export async function resolveHomeGymId(contextValue) {
  if (contextValue) return contextValue;

  const cached = getProfile();
  if (cached?.home_gym_id) return cached.home_gym_id;

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('home_gym_id')
    .eq('id', uid)
    .maybeSingle();
  if (error) {
    reportError(error, { feature: 'home-gym.resolve-id' });
    return null;
  }
  return data?.home_gym_id ?? null;
}

/**
 * Full gym row for the caller's home gym, or null when they haven't
 * picked one. Takes the id from the profile the caller already has, so
 * this is a single round-trip.
 */
export async function getHomeGym(homeGymId) {
  if (!homeGymId) return null;
  const { data, error } = await supabase
    .from('gym_businesses')
    .select('id, name, logo_url, cover_url, city, state_code, latitude, longitude, member_count, source, flexyn_code, owner_id')
    .eq('id', homeGymId)
    .maybeSingle();
  if (error) {
    reportError(error, { feature: 'home-gym.get' });
    return null;
  }
  return data;
}

/**
 * The number the gym moves together — rolling 7-day totals across every
 * member. Members-only (mig 275 gates it), so a non-member gets 42501
 * and we return nulls rather than throwing into a render.
 */
export async function getCommunityProgress(gymId) {
  if (!gymId) return null;
  const { data, error } = await supabase.rpc('get_gym_community_progress', {
    p_gym_id: gymId,
  });
  if (error) {
    // 42501 is the expected membership gate, not a defect — don't page
    // Sentry for it.
    if (error.code !== '42501') {
      reportError(error, { feature: 'home-gym.community-progress' });
    }
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    memberCount: Number(row.member_count) || 0,
    activeMembers: Number(row.active_members) || 0,
    workoutCount: Number(row.workout_count) || 0,
    totalVolume: Number(row.total_volume) || 0,
    activeDays: Number(row.active_days) || 0,
  };
}

/**
 * Consistency ranking for the gym — distinct active days in the last 7.
 * Reuses the mig 150 / 158 RPC rather than adding a fourth leaderboard
 * shape; ranking by days-shown-up is what keeps a beginner on the board
 * next to a powerlifter.
 */
export async function getGymConsistencyBoard(gymId, limit = 50) {
  if (!gymId) return [];
  const { data, error } = await supabase.rpc('get_gym_consistency_leaderboard', {
    p_gym_id: gymId,
    p_limit: limit,
  });
  if (error) {
    if (error.code !== '42501') {
      reportError(error, { feature: 'home-gym.leaderboard' });
    }
    return [];
  }
  return Array.isArray(data) ? data : [];
}
