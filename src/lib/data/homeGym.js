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
// Three entry points, because a gym may exist in our database, in
// OpenStreetMap, or nowhere at all:
//   setHomeGym(gymId)         — an existing gym_businesses row
//   setHomeGymFromOsm(osmGym) — an OpenStreetMap gym nobody has picked
//                               before; the RPC promotes it to a
//                               persistent source='community' row first,
//                               deduped on (osm_type, osm_id) so every
//                               later picker shares the same row and
//                               therefore the same leaderboard.
//   setHomeGymCustom(gym)     — a gym OSM has never heard of, typed by
//                               the person who trains there (mig 299).
//                               DORMANT: no UI calls it — see its own
//                               doc comment for why it was retired and
//                               why it was kept.
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
 * DORMANT since 2026-08-06 — nothing in the UI calls this.
 *
 * The "My gym isn't listed — Add It" path was removed from the picker
 * once the OSM cache (mig 300) started serving street data fast enough
 * that gyms reliably appear in the list or on the map. Typing one by
 * hand became the rare exception rather than the fallback, and an
 * always-visible text box invites duplicates of gyms that already exist.
 *
 * Kept, not deleted, and migration 299 stays deployed: the case that
 * motivated it is still real — a Planet Fitness three miles from a beta
 * tester appears in no tag on any of the 1,905 named objects within five
 * miles of him. If unmapped gyms turn out to be common, this is the
 * ready-made route back, verified end to end against production.
 *
 * Create a community gym from a typed name and the caller's own
 * location (migration 299). Needed because setHomeGymFromOsm keys on
 * (osm_type, osm_id), so every other route requires the gym to already
 * exist in OSM.
 *
 * The RPC reuses an existing gym of the same name within ~500 m rather
 * than creating a second one, so two people at the same gym still share
 * one row and therefore one leaderboard.
 *
 * @param {{name: string, lat: number, lng: number, city?: string, state?: string}} gym
 * @returns {Promise<{ok, gymId?, created?, error?}>}
 */
export async function setHomeGymCustom(gym) {
  const name = (gym?.name || '').trim();
  if (name.length < 2) return { ok: false, error: 'NAME_REQUIRED' };
  if (!Number.isFinite(gym?.lat) || !Number.isFinite(gym?.lng)) {
    return { ok: false, error: 'BAD_COORDS' };
  }

  const { data, error } = await supabase.rpc('set_home_gym_custom', {
    p_name: name,
    p_lat: gym.lat,
    p_lng: gym.lng,
    p_city: gym.city ?? null,
    p_state: gym.state ?? null,
  });

  if (error) {
    reportError(error, { feature: 'home-gym.set-custom' });
    // 23514 is mig 158's profanity trigger. Its own code so the caller
    // can say something more useful than "try again" about a name that
    // will never be accepted.
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
