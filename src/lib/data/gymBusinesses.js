// src/lib/data/gymBusinesses.js
//
// Client helpers for the Gym Business ecosystem (migration 135).
//
// Verification flow:
//   1. Owner submits via submitVerification()
//   2. Admin approves via /admin (calls approve_gym_verification RPC)
//   3. Approved gym appears in get_gyms_in_bbox + can be joined by code
//
// User flow:
//   • joinByCode(code) — type or scan a Flexyn Code → adds to "My Gyms"
//   • listMyGyms(userId) — read the user's joined gyms
//   • getGymsInBbox({minLat,...}) — map query
//   • getGymLeaderboard(gymId, mode) — local gym leaderboard
//
// All RPCs fail closed (return null / [] / { ok: false }) on pre-135
// hosts so the UI degrades gracefully.

import { supabase } from '@/api/supabaseClient';
import { setHomeGym, resolveHomeGymId } from './homeGym';

// ── Verification (owner side) ──────────────────────────────────────
export async function submitVerification(payload) {
  if (!payload?.business_name) return { ok: false, error: 'NAME_REQUIRED' };
  const { data, error } = await supabase.rpc('submit_gym_verification', {
    p_business_name:   payload.business_name,
    p_street_address:  payload.street_address || null,
    p_city:            payload.city           || null,
    p_state_code:      payload.state_code     || null,
    p_postal_code:     payload.postal_code    || null,
    p_country_code:    payload.country_code   || 'US',
    p_phone:           payload.phone          || null,
    p_website_url:     payload.website_url    || null,
    p_proof_url:       payload.proof_url      || null,
    p_latitude:        payload.latitude       ?? null,
    p_longitude:       payload.longitude      ?? null,
  });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') {
      return { ok: false, error: 'PIPELINE_MISSING' };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data };
}

/** Read this user's own pending/approved/rejected verification submissions. */
export async function listMyVerifications(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('gym_verification_queue')
    .select('id, business_name, city, state_code, status, rejection_reason, created_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

// ── Admin: list pending + approve/reject ───────────────────────────
// Both paths route through SECURITY DEFINER RPCs gated on is_app_admin
// (mig 148). Previously listPending used a direct SELECT that the
// "read own" RLS policy clamped to zero rows (admins saw an empty
// queue); reject used a direct UPDATE with no UPDATE policy/grant
// (button did nothing). Both are server-gated now.
export async function listPendingVerifications() {
  const { data, error } = await supabase.rpc('list_pending_gym_verifications', { p_limit: 200 });
  if (error) {
    // Fail closed: if the migration hasn't deployed yet, return [] so
    // the admin queue UI shows "no pending" rather than crashing.
    return [];
  }
  return data || [];
}

export async function approveVerification(verificationId) {
  const { data, error } = await supabase.rpc('approve_gym_verification', {
    p_verif_id: verificationId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, gymId: data };
}

export async function rejectVerification(verificationId, reason) {
  const { error } = await supabase.rpc('reject_gym_verification', {
    p_id: verificationId,
    p_reason: reason || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── User side: join + list ─────────────────────────────────────────
export async function joinByCode(code) {
  const cleaned = String(code || '').trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
  if (cleaned.length !== 8) return { ok: false, error: 'INVALID_CODE' };
  const { data, error } = await supabase.rpc('join_gym_by_code', { p_code: cleaned });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') {
      return { ok: false, error: 'PIPELINE_MISSING' };
    }
    return { ok: false, error: error.message };
  }
  return data || { ok: false, error: 'EMPTY' };
}

/**
 * Leave a gym, clearing the home-gym pointer first when it is this one.
 *
 * The clear is not optional and it belongs HERE rather than at the call
 * sites. homeGym.js states the invariant its two set_home_gym RPCs exist
 * to hold — "a home gym you aren't a member of is a home gym whose own
 * leaderboard throws 42501 at you" — and both of them do the join and the
 * profile write in one server-side transaction so it can't be half
 * applied. Leaving is the other direction of the same invariant, and it
 * was breaking it: a bare DELETE on gym_members left home_gym_id pointing
 * at a gym the user no longer belongs to.
 *
 * The failure was invisible, which is why it survived. gym_businesses is
 * read-all, so getHomeGym still resolved and MyGym's "that gym is no
 * longer listed" branch never fired — the gym card rendered normally.
 * Only get_gym_consistency_leaderboard and get_gym_community_progress
 * are members-only, and both callers deliberately swallow 42501 as "the
 * expected membership gate, not a defect" and skip reportError. So the
 * page showed the gym you had just left with a blank leaderboard and no
 * community bar, forever, and nothing reached Sentry.
 *
 * GymJoinSheet's cancel() has always called setHomeGym(null) before
 * leaveGym; GymHub's Leave button never did. Putting it in the shared
 * function is what stops the next call site getting it wrong too.
 */
export async function leaveGym(gymId) {
  if (!gymId) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false };

  // Never trust AuthContext's copy — resolveHomeGymId is the documented
  // reader (context → profile cache → one query). Best-effort: failing to
  // resolve must not block the leave the user actually asked for.
  try {
    if (await resolveHomeGymId(null) === gymId) await setHomeGym(null);
  } catch { /* leave anyway — a stale pointer beats a stuck button */ }

  const { error } = await supabase
    .from('gym_members')
    .delete()
    .eq('gym_id', gymId)
    .eq('user_id', user.id);
  return { ok: !error };
}

/**
 * Resolve a Flexyn Code to the gym it belongs to, WITHOUT joining and
 * without an account.
 *
 * This is the signed-out half of a signage scan. `join_gym_by_code` and
 * `check_in_to_gym` both require auth, so a stranger who scans the poster
 * on a gym wall used to hit a bare sign-in prompt that never named the gym
 * they were standing in.
 *
 * Goes through get_gym_id_by_code (mig 325) rather than reading the table.
 * The blanket anon SELECT policy is gone — it exposed every gym's join
 * code, street address, phone and coordinates to anyone holding the anon
 * key, which ships in the bundle. The RPC returns identity only.
 *
 * @returns {Promise<{id: string, name: string}|null>} null on a bad code,
 *          an unknown code, an inactive gym, or a failed lookup.
 */
export async function getGymByCode(code) {
  const cleaned = String(code || '').trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
  if (cleaned.length !== 8) return null;
  const { data, error } = await supabase.rpc('get_gym_id_by_code', { p_code: cleaned });
  if (error) return null;
  return (Array.isArray(data) ? data[0] : data) || null;
}

/**
 * The public card for one gym: what a signed-out visitor may see.
 *
 * Name, city, photos and member count — never the join code, the
 * coordinates or the contact details. Backs both this app's /p/gym/:id
 * and, once it is live, the same path on the marketing site.
 *
 * @returns {Promise<object|null>} null when the gym is unknown, inactive
 *          or the lookup failed; callers that must tell those apart
 *          should check `error` themselves.
 */
export async function getGymPublicCard(gymId) {
  if (!gymId) return null;
  const { data, error } = await supabase.rpc('get_gym_public_card', { p_gym_id: gymId });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || null;
}

/** "My Gyms" dashboard query — joined gyms with full gym row inline. */
export async function listMyGyms(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('gym_members')
    .select(`
      joined_at,
      gym:gym_businesses!gym_id (
        id, name, logo_url, cover_url, city, state_code, member_count,
        latitude, longitude, flexyn_code
      )
    `)
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });
  if (error) return [];
  return (data || []).map(r => ({ ...r.gym, joined_at: r.joined_at })).filter(g => g.id);
}

// ── Map / discovery ────────────────────────────────────────────────
export async function getGymsInBbox({ minLat, maxLat, minLng, maxLng, limit = 500 }) {
  if ([minLat, maxLat, minLng, maxLng].some(v => !Number.isFinite(v))) return [];
  const { data, error } = await supabase.rpc('get_gyms_in_bbox', {
    p_min_lat: minLat, p_max_lat: maxLat,
    p_min_lng: minLng, p_max_lng: maxLng,
    p_limit:   limit,
  });
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

/**
 * What a NON-member may see about a gym (migration 301).
 *
 * Shape without identity: how busy the floor is, never who is on it.
 * The old answer was a flat "join to unlock", which asks someone to
 * commit to a gym before telling them whether anyone trains there.
 *
 * `meets_threshold` false means the gym has fewer than five members and
 * everything except the count is withheld — not because names are
 * missing but because at that size an individual's attendance is
 * derivable from the aggregate by anyone who can see the roster, and
 * members still can. Render the count and say so; don't tease.
 *
 * @returns {Promise<{memberCount, meetsThreshold, activeMembers, sessionCount, activeDays, shape}|null>}
 */
export async function getGymPublicPreview(gymId) {
  if (!gymId) return null;
  const { data, error } = await supabase.rpc('get_gym_public_preview', {
    p_gym_id: gymId,
  });
  // 42883 is a pre-301 host: no preview to show, and not worth an error.
  if (error) return null;
  return {
    memberCount:    Number(data?.member_count) || 0,
    meetsThreshold: !!data?.meets_threshold,
    activeMembers:  Number(data?.active_members) || 0,
    sessionCount:   Number(data?.session_count) || 0,
    activeDays:     Number(data?.active_days) || 0,
    shape:          Array.isArray(data?.streak_shape) ? data.streak_shape : [],
  };
}

/** Full gym detail by id — for the Gym Hub page header. */
export async function getGym(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('gym_businesses')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return null;
  return data;
}

// ── Leaderboard / events / feed ────────────────────────────────────
export async function getLeaderboard(gymId, { mode = 'volume', limit = 50 } = {}) {
  if (!gymId) return [];
  // Consistency mode ranks by active days this week — a separate RPC
  // (mig 150) since it aggregates workout_logs, not profile stats.
  if (mode === 'consistency') {
    const { data, error } = await supabase.rpc('get_gym_consistency_leaderboard', {
      p_gym_id: gymId, p_limit: limit,
    });
    if (error) return [];
    return Array.isArray(data) ? data : [];
  }
  const { data, error } = await supabase.rpc('get_gym_leaderboard', {
    p_gym_id: gymId, p_mode: mode, p_limit: limit,
  });
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

/**
 * List events for a gym. Defaults to "upcoming" (starts_at >= now - 4h
 * so an in-progress event still shows). Pass `scope: 'past'` for the
 * archived view, `scope: 'all'` for owner moderation.
 */
export async function listEvents(gymId, { scope = 'upcoming' } = {}) {
  if (!gymId) return [];
  let q = supabase.from('gym_events').select('*').eq('gym_id', gymId);
  const ascending = scope !== 'past';
  if (scope === 'upcoming') {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    q = q.gte('starts_at', cutoff);
  } else if (scope === 'past') {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    q = q.lt('starts_at', cutoff);
  }
  q = q.order('starts_at', { ascending });
  const { data, error } = await q;
  if (error) return [];
  return data || [];
}

export async function createEvent(gymId, payload) {
  if (!gymId) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false };
  // Reject obviously-bad timestamps (empty string passes truthy checks
  // upstream; a stale "0000-..." paste lands an event the UI will then
  // render as Invalid Date).
  const startsAt = payload.starts_at ? new Date(payload.starts_at) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime()) || startsAt.getUTCFullYear() < 2020) {
    return { ok: false, error: 'INVALID_START' };
  }
  const { error } = await supabase.from('gym_events').insert({
    gym_id:     gymId,
    created_by: user.id,
    title:      payload.title,
    body:       payload.body        || null,
    // Send a full ISO string with offset so a "datetime-local" value
    // (no TZ) gets serialized as the user's local instant, not UTC.
    starts_at:  startsAt.toISOString(),
    ends_at:    payload.ends_at ? new Date(payload.ends_at).toISOString() : null,
    location_note: payload.location_note || null,
  });
  return { ok: !error, error: error?.message };
}

/** Delete an event the caller created (or owns the gym for). */
export async function deleteEvent(eventId) {
  if (!eventId) return { ok: false };
  const { error } = await supabase.from('gym_events').delete().eq('id', eventId);
  return { ok: !error, error: error?.message };
}

// author_email is not readable by the app (20260930234100): posts and
// comments are matched to people by author_id, and the email is filled
// server side from the author's profile.
const FEED_POST_COLUMNS = 'id, gym_id, author_id, body, media_url, like_count, comment_count, reaction_count, created_at, edited_at, is_pinned, pinned_at';
const FEED_COMMENT_COLUMNS = 'id, author_id, body, created_at, parent_id';

export async function listFeedPosts(gymId, limit = 30) {
  if (!gymId) return [];
  // Embed the author's user_profiles row so the UI can show
  // @username instead of the email local-part. Previously the
  // GymFeedTab fell back to the email local-part which leaked
  // the email username portion (a corporate user signing up as
  // "j.smith.cfo@acme.com" had their work email handle posted on
  // every gym feed). (Audit 12 #42 + #43.)
  const { data, error } = await supabase
    .from('gym_feed_posts')
    .select(`
      ${FEED_POST_COLUMNS},
      author:public_profiles ( username, avatar_url )
    `)
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    // PostgREST embed failure (older schema cache or RLS): fall back
    // to the plain select so the feed still renders.
    const { data: fallback } = await supabase
      .from('gym_feed_posts')
      .select(FEED_POST_COLUMNS)
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return fallback || [];
  }
  return (data || []).map(r => ({
    ...r,
    author_username: r.author?.username || null,
    author_avatar_url: r.author?.avatar_url || null,
  }));
}

export async function postToFeed(gymId, body, mediaUrl = null) {
  if (!gymId || !body?.trim()) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false };
  const { data, error } = await supabase.from('gym_feed_posts').insert({
    gym_id:       gymId,
    author_id:    user.id,
    author_email: user.email,
    body:         body.trim(),
    media_url:    mediaUrl,
  }).select('id').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

export async function deleteFeedPost(postId) {
  if (!postId) return { ok: false };
  const { error } = await supabase.from('gym_feed_posts').delete().eq('id', postId);
  return { ok: !error };
}

// ── Feed reactions (mig 138 + atomic RPC mig 141) ──────────────────
/**
 * Toggle a single emoji reaction on a feed post for the current user.
 * Uses the mig-141 atomic RPC so rapid double-taps can't produce
 * duplicate inserts or ghost-state drift.
 */
export async function toggleFeedReaction(postId, emoji) {
  if (!postId || !emoji) return { ok: false };
  const { data, error } = await supabase.rpc('toggle_gym_feed_reaction', {
    p_post_id: postId,
    p_emoji:   emoji,
  });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') {
      return { ok: false, error: 'PIPELINE_MISSING' };
    }
    return { ok: false, error: error.message };
  }
  return data || { ok: false };
}

/** Per-emoji counts + the current user's set of reacted emojis. */
export async function listReactionsForPosts(postIds, userId) {
  if (!Array.isArray(postIds) || postIds.length === 0) return {};
  const { data, error } = await supabase
    .from('gym_feed_post_reactions')
    .select('post_id, user_id, emoji')
    .in('post_id', postIds);
  if (error) return {};
  const out = {};
  for (const id of postIds) out[id] = { counts: {}, mine: new Set() };
  for (const r of data || []) {
    const slot = out[r.post_id];
    if (!slot) continue;
    slot.counts[r.emoji] = (slot.counts[r.emoji] || 0) + 1;
    if (userId && r.user_id === userId) slot.mine.add(r.emoji);
  }
  return out;
}

// ── Feed comments (mig 138) ────────────────────────────────────────
export async function listFeedComments(postId) {
  if (!postId) return [];
  // Same email-leak guard as listFeedPosts — embed the author profile so
  // the UI can show @username instead of the email local-part. Same
  // public_profiles-not-user_profiles reasoning as listGymMembers above.
  const { data, error } = await supabase
    .from('gym_feed_comments')
    .select(`
      ${FEED_COMMENT_COLUMNS},
      author:public_profiles ( username, avatar_url )
    `)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) {
    const { data: fallback } = await supabase
      .from('gym_feed_comments')
      .select(FEED_COMMENT_COLUMNS)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    return fallback || [];
  }
  return (data || []).map(c => ({
    ...c,
    author_username:   c.author?.username   || null,
    author_avatar_url: c.author?.avatar_url || null,
  }));
}

export async function postFeedComment(postId, body, parentId = null) {
  if (!postId || !body?.trim()) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false };
  const { error } = await supabase.from('gym_feed_comments').insert({
    post_id:      postId,
    parent_id:    parentId,
    author_id:    user.id,
    author_email: user.email,
    body:         body.trim().slice(0, 1000),
  });
  return { ok: !error, error: error?.message };
}

export async function deleteFeedComment(commentId) {
  if (!commentId) return { ok: false };
  const { error } = await supabase.from('gym_feed_comments').delete().eq('id', commentId);
  return { ok: !error };
}

// ── Pin / unpin (owner-only) ───────────────────────────────────────
export async function togglePinPost(postId) {
  if (!postId) return { ok: false };
  const { data, error } = await supabase.rpc('toggle_pin_gym_post', { p_post_id: postId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, pinned: !!data };
}

// ── Image upload helper for feed post media ────────────────────────
/**
 * Upload an image to the avatars bucket under
 * `gym/<gymId>/feed/<userId>-<ts>.<ext>` and return the public URL.
 * Reuses the same bucket as the gym logo/cover uploads (mig 135's
 * Storage RLS already gates on auth.uid()).
 */
// ── Event RSVPs (mig 139) ──────────────────────────────────────────
/**
 * Set my RSVP for an event. Pass null to clear.
 * Status: 'going' | 'maybe' | 'cant'.
 */
export async function setEventRsvp(eventId, status) {
  if (!eventId) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false };
  if (!status) {
    const { error } = await supabase
      .from('gym_event_rsvps')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', user.id);
    return { ok: !error };
  }
  // Upsert by (event_id, user_id) — unique constraint handles the
  // "already RSVP'd, switching status" case via ON CONFLICT.
  const { error } = await supabase
    .from('gym_event_rsvps')
    .upsert({ event_id: eventId, user_id: user.id, status },
            { onConflict: 'event_id,user_id' });
  return { ok: !error, error: error?.message };
}

/** Bulk-fetch every RSVP for the given event ids. */
export async function listEventRsvps(eventIds) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) return {};
  const { data, error } = await supabase.rpc('get_gym_event_rsvps_bulk', {
    p_event_ids: eventIds,
  });
  if (error) return {};
  const out = {};
  for (const id of eventIds) out[id] = { going: 0, maybe: 0, cant: 0, byUser: {} };
  for (const r of data || []) {
    const slot = out[r.event_id];
    if (!slot) continue;
    slot[r.status] = (slot[r.status] || 0) + 1;
    slot.byUser[r.user_id] = r.status;
  }
  return out;
}

// ── Member directory (mig 135) ──────────────────────────────────────
/**
 * Full member list for the directory modal. Caps at 200 — past that we'd
 * want pagination, but a practical gym member count rarely exceeds a
 * couple hundred.
 *
 * Embeds `public_profiles`, not `user_profiles`. RLS on user_profiles
 * permits reading only your own row, so embedding it hands back
 * `profile: null` for every other member and the roster renders blank.
 * public_profiles is the SECURITY DEFINER view built for cross-user reads.
 * The embed also depends on the FK added in migration 283 — the only FK on
 * gym_members.user_id before that pointed at auth.users, which PostgREST
 * will not traverse, so this 400'd with PGRST200 on every call.
 */
export async function listGymMembers(gymId) {
  if (!gymId) return [];
  const { data, error } = await supabase
    .from('gym_members')
    .select(`
      joined_at,
      user_id,
      profile:public_profiles (
        username, avatar_url, workout_streak
      )
    `)
    .eq('gym_id', gymId)
    .order('joined_at', { ascending: false })
    .limit(200);
  if (error) return [];
  return (data || []).map(r => ({
    user_id:    r.user_id,
    joined_at:  r.joined_at,
    username:   r.profile?.username || null,
    avatar_url: r.profile?.avatar_url || null,
    // total_xp was selected here and mapped for months without a single
    // reader — MemberDirectoryModal renders handle, avatar, streak and
    // joined date, and nothing else. It is one of the columns
    // public_profiles gates behind full_view, so it was a privacy-scoped
    // field fetched for every member of every gym and dropped on the
    // floor. Don't add it back without a render site.
    workout_streak: r.profile?.workout_streak || 0,
  }));
}

// Extension → pinned MIME. Same rule as src/api/db.js and GymEdit.jsx:
// derive contentType from the extension, never from client-supplied
// file.type, so `evil.svg` can't land in the PUBLIC bucket as
// image/svg+xml and run script on the storage origin.
const FEED_IMAGE_MIMES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', heic: 'image/heic',
};

export async function uploadFeedImage(gymId, file) {
  if (!gymId || !file) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const contentType = FEED_IMAGE_MIMES[ext];
  if (!contentType) {
    console.warn('[gymBusinesses] feed image type not supported:', ext || '(none)');
    return null;
  }
  // Bucket is `uploads` — there has never been an `avatars` bucket, so
  // this path 404'd on every post. The uid must also be the FIRST segment:
  // the bucket's INSERT policy is `foldername(name)[1] = auth.uid()`, so
  // the old `gym/<gymId>/feed/...` would fail RLS even on the right bucket.
  const path = `${user.id}/gym/${gymId}/feed/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('uploads')
    .upload(path, file, { upsert: false, contentType });
  if (error) {
    console.warn('[gymBusinesses] feed image upload failed:', error);
    return null;
  }
  const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(path);
  return publicUrl;
}
