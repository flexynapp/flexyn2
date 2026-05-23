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
export async function listPendingVerifications() {
  const { data, error } = await supabase
    .from('gym_verification_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) return [];
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
  const { error } = await supabase
    .from('gym_verification_queue')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason || null,
    })
    .eq('id', verificationId);
  return { ok: !error };
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

export async function leaveGym(gymId) {
  if (!gymId) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false };
  const { error } = await supabase
    .from('gym_members')
    .delete()
    .eq('gym_id', gymId)
    .eq('user_id', user.id);
  return { ok: !error };
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
  const { data, error } = await supabase.rpc('get_gym_leaderboard', {
    p_gym_id: gymId, p_mode: mode, p_limit: limit,
  });
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

export async function listEvents(gymId) {
  if (!gymId) return [];
  const { data, error } = await supabase
    .from('gym_events')
    .select('*')
    .eq('gym_id', gymId)
    .order('starts_at', { ascending: true });
  if (error) return [];
  return data || [];
}

export async function createEvent(gymId, payload) {
  if (!gymId) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false };
  const { error } = await supabase.from('gym_events').insert({
    gym_id:     gymId,
    created_by: user.id,
    title:      payload.title,
    body:       payload.body        || null,
    starts_at:  payload.starts_at,
    ends_at:    payload.ends_at     || null,
    location_note: payload.location_note || null,
  });
  return { ok: !error, error: error?.message };
}

export async function listFeedPosts(gymId, limit = 30) {
  if (!gymId) return [];
  const { data, error } = await supabase
    .from('gym_feed_posts')
    .select('*')
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
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

// ── Feed reactions (mig 138) ───────────────────────────────────────
/** Toggle a single emoji reaction on a feed post for the current user. */
export async function toggleFeedReaction(postId, emoji) {
  if (!postId || !emoji) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false };
  // Try-delete first; if nothing was deleted, insert. Two round-trips
  // is fine for a tap-driven action.
  const { data: existing } = await supabase
    .from('gym_feed_post_reactions')
    .select('id')
    .eq('post_id', postId)
    .eq('user_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await supabase
      .from('gym_feed_post_reactions')
      .delete()
      .eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, removed: true };
  }
  const { error } = await supabase
    .from('gym_feed_post_reactions')
    .insert({ post_id: postId, user_id: user.id, emoji });
  if (error) return { ok: false, error: error.message };
  return { ok: true, added: true };
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
  const { data, error } = await supabase
    .from('gym_feed_comments')
    .select('id, author_id, author_email, body, created_at, parent_id')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
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
export async function uploadFeedImage(gymId, file) {
  if (!gymId || !file) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `gym/${gymId}/feed/${user.id}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });
  if (error) return null;
  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
  return publicUrl;
}
