// src/lib/data/crews.js
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { selectProfiles } from '@/lib/data/users';
import { db } from '@/api/db';
import { compressImage } from '@/lib/imageCompress';
import { containsProfanity } from '@/lib/profanityFilter';

const CREW_XP_FUEL_AMOUNT = 500;

// ── Crews ─────────────────────────────────────────────────────────────────────

export async function createCrew(user, name) {
  // Profanity gate on crew name. Mirrors the existing username +
  // hub-post checks. Server can't re-enforce yet (no trigger), so
  // this is client-side defense — but server-side check could be a
  // follow-up in a future migration.
  if (typeof name === 'string' && containsProfanity(name)) {
    throw Object.assign(new Error('Profanity detected in crew name'),
      { code: 'PROFANITY', field: 'name' });
  }
  const { data: crew, error } = await supabase
    .from('crews')
    .insert({ name, created_by: user.id })
    .select()
    .single();
  if (error || !crew) throw error || new Error('Failed to create crew');

  await supabase.from('crew_members').insert({
    crew_id: crew.id,
    user_id: user.id,
    is_admin: true,
  });

  return crew;
}

export async function getMyCrews(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('crew_members')
    .select('crew_id, is_admin, joined_at, crews(id, name, created_at, max_capacity)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });
  if (error) return [];
  return (data ?? []).map(row => ({
    ...row.crews,
    is_admin:  row.is_admin,
    joined_at: row.joined_at,
  }));
}

/**
 * Returns up to N popular non-full crews the caller is not yet a member
 * of. Backs the Hub Crews "Suggested" rail. Server-side ordering is
 * member count DESC, then created_at ASC.
 *
 * Returns [] on pre-090 host (RPC missing) so the rail gracefully
 * hides instead of erroring.
 */
export async function getSuggestedCrews(limit = 5) {
  const { data, error } = await supabase.rpc('get_suggested_crews', { p_limit: limit });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') return [];
    return [];
  }
  return Array.isArray(data) ? data : [];
}

export async function getCrew(crewId) {
  if (!crewId) return null;
  const { data, error } = await supabase
    .from('crews')
    .select('*')
    .eq('id', crewId)
    .single();
  return error ? null : data;
}

// ── Members ───────────────────────────────────────────────────────────────────

export async function getCrewMembers(crewId) {
  if (!crewId) return [];
  const { data, error } = await supabase
    .from('crew_members')
    .select('id, user_id, is_admin, joined_at')
    .eq('crew_id', crewId)
    .order('is_admin', { ascending: false })
    .order('joined_at',  { ascending: true });
  if (error || !data) return [];

  // Enrich each member row with their profile (email, username,
  // avatar_url). Without this, CrewMemberDots fell back to '?' for
  // every member because the bare crew_members row only has user_id.
  // Two reds question-marks were the visible symptom on the My Crews
  // card. We do this client-side because the relational embed
  // (crew_members → user_profiles) requires a FK Supabase doesn't
  // always expose, and the user list per crew is bounded at 16.
  const userIds = data.map(m => m.user_id).filter(Boolean);
  if (userIds.length === 0) return data;
  const { data: profiles } = await selectProfiles((from) => from
    .select('id, username, avatar_url')
    .in('id', userIds));
  const byId = new Map((profiles ?? []).map(p => [p.id, p]));
  return data.map(m => {
    const p = byId.get(m.user_id);
    return p
      ? { ...m, username: p.username, avatar_url: p.avatar_url }
      : m;
  });
}

export async function joinCrew(crewId, userId) {
  // Atomic join via join_crew_atomic RPC (migration 075). The previous
  // client-side capacity probe + insert was a TOCTOU race: two parallel
  // joins both passed the cap check (count < max) and both inserted,
  // bypassing the 16-member cap. The RPC locks the crew row FOR UPDATE,
  // recounts under the lock, and inserts only if there's still room.
  //
  // Pre-075 fallback: if the RPC isn't deployed yet, fall back to the
  // legacy non-atomic path so the feature doesn't break on stale hosts.
  // The race is the documented bug we're closing; only pre-migration
  // deployments retain it.
  const { data, error } = await supabase.rpc('join_crew_atomic', { p_crew_id: crewId });
  if (!error) {
    return data; // { success, already_member, crew_id }
  }

  // Distinct error codes:
  //   23514 = crew_full (RAISE EXCEPTION with that code in the RPC)
  //   22023 = crew not found
  //   42501 = unauthenticated
  //   42883 / 42P01 = RPC not yet deployed → legacy fallback
  if (/crew_full/i.test(error.message || '') || error.code === '23514') {
    throw new Error('This Crew is full (max 16 members).');
  }
  if (error.code !== '42883' && error.code !== '42P01') {
    throw error;
  }

  // Legacy fallback (pre-075). The race is back, but the alternative
  // is breaking joins entirely on hosts that haven't applied 075 yet.
  const members = await getCrewMembers(crewId);
  const crew    = await getCrew(crewId);
  if (members.length >= (crew?.max_capacity ?? 16)) {
    throw new Error('This Crew is full (max 16 members).');
  }
  const { error: insertErr } = await supabase
    .from('crew_members')
    .insert({ crew_id: crewId, user_id: userId, is_admin: false });
  if (insertErr) throw insertErr;
  return { success: true, already_member: false, crew_id: crewId };
}

export async function removeMember(crewId, userId) {
  const { error } = await supabase
    .from('crew_members')
    .delete()
    .eq('crew_id', crewId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function setAdmin(crewId, userId, isAdmin) {
  const { error } = await supabase
    .from('crew_members')
    .update({ is_admin: isAdmin })
    .eq('crew_id', crewId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function getCrewMessages(crewId, limit = 80) {
  if (!crewId) return [];
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('crew_messages')
    .select('*')
    .eq('crew_id', crewId)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('created_at', { ascending: true })
    .limit(limit);
  return error ? [] : (data ?? []);
}

export async function sendCrewMessage(crewId, senderId, type, content, extras = {}) {
  const { data, error } = await supabase
    .from('crew_messages')
    .insert({
      crew_id:      crewId,
      sender_id:    senderId,
      message_type: type,
      content:      content ?? null,
      media_url:    extras.media_url  ?? null,
      regimen_id:   extras.regimen_id ?? null,
      expires_at:   extras.expires_at ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Roll Call ─────────────────────────────────────────────────────────────────

export async function getRollCallResults(messageId) {
  if (!messageId) return { yes: 0, no: 0, votes: [] };
  const { data, error } = await supabase
    .from('roll_call_responses')
    .select('user_id, vote')
    .eq('message_id', messageId);
  if (error) return { yes: 0, no: 0, votes: [] };
  const votes = data ?? [];
  return {
    yes:   votes.filter(v => v.vote === 'yes').length,
    no:    votes.filter(v => v.vote === 'no').length,
    votes,
  };
}

export async function respondToRollCall(messageId, userId, vote) {
  const { data, error } = await supabase
    .from('roll_call_responses')
    .upsert(
      { message_id: messageId, user_id: userId, vote },
      { onConflict: 'message_id,user_id' },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function notifyCrewRollCall(crewId, question, senderName) {
  const members = await getCrewMembers(crewId);
  // Per-member RPC failures used to swallow with bare .catch(() => {})
  // — a regression in create_notification_for (e.g. migration missing
  // on a partial deploy) would result in silently delivered roll-
  // calls. Report the first failure with member count context so
  // observability catches an outage even though we still tolerate
  // individual rows failing.
  const results = await Promise.allSettled(
    members.map(m =>
      supabase.rpc('create_notification_for', {
        p_user_id:  m.user_id,
        p_type:     'crew_roll_call',
        p_title:    `@everyone — ${senderName} posted a Roll Call`,
        p_body:     question,
        p_icon:     '📣',
        p_link_url: '/hub',
        p_metadata: { crew_id: crewId },
      }),
    ),
  );
  const firstFailure = results.find(r => r.status === 'rejected' || r.value?.error);
  if (firstFailure) {
    const err = firstFailure.reason || firstFailure.value?.error;
    try {
      const { reportError } = await import('@/lib/reportError');
      reportError(err, {
        feature: 'crews.notifyRollCall',
        level: 'warning',
        crewId,
        memberCount: members.length,
        failedCount: results.filter(r => r.status === 'rejected' || r.value?.error).length,
      });
    } catch { /* reportError unavailable */ }
  }
}

// ── Regimen Equip ─────────────────────────────────────────────────────────────

export async function equipRegimen(regimenId, user) {
  const { data: source, error } = await supabase
    .from('regimens')
    .select('*')
    .eq('id', regimenId)
    .single();
  if (error || !source) throw new Error('Regimen not found');

  const { data: copy, error: copyError } = await supabase
    .from('regimens')
    .insert({
      created_by:              user.email,
      name:                    source.name,
      description:             source.description ?? null,
      exercises:               source.exercises ?? [],
      is_public:               false,
      original_template_id:    source.id,
      original_author_username:
        source.original_author_username || source.created_by?.split('@')[0],
    })
    .select()
    .single();
  if (copyError) throw copyError;

  // Increment copy_count on the original — but ONLY if the cloner is NOT the creator.
  // This prevents creators from inflating their own adoption count.
  //
  // NOTE: column is `copy_count` (added by mig 005, also incremented by the
  // server-side `increment_copy_count()` RPC in mig 042). The previous
  // `clone_count` reference here was a code-vs-schema drift bug surfaced
  // by the 2026-05-25 audit — the .catch swallowed the PGRST204 error so
  // the badge silently showed "0 clones" on every regimen.
  if (user.email !== source.created_by) {
    await supabase
      .from('regimens')
      .update({ copy_count: (source.copy_count ?? 0) + 1 })
      .eq('id', source.id)
      .catch(() => {}); // non-fatal
  }

  return copy;
}

/**
 * Fetch the copy_count for a single regimen (used by RegimenMessage UI).
 * The function name keeps "Clone" for caller compatibility — only the
 * DB column name changes.
 */
export async function getRegimenCloneCount(regimenId) {
  if (!regimenId) return 0;
  try {
    const { data, error } = await supabase
      .from('regimens')
      .select('copy_count')
      .eq('id', regimenId)
      .single();
    if (error) return 0;
    return data?.copy_count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Feature 19: Check if the user has already cloned this regimen template.
 * Returns true if a row with `original_template_id = regimenId` and
 * `created_by = userEmail` already exists in their library.
 */
export async function hasClonedRegimen(regimenId, userEmail) {
  if (!regimenId || !userEmail) return false;
  try {
    const { data, error } = await supabase
      .from('regimens')
      .select('id')
      .eq('original_template_id', regimenId)
      .eq('created_by', userEmail)
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── XP Fuel ───────────────────────────────────────────────────────────────────

export async function fireXpFuel(crewId, senderId, senderName) {
  return sendCrewMessage(
    crewId,
    senderId,
    'xp_fuel',
    JSON.stringify({ username: senderName, xp: CREW_XP_FUEL_AMOUNT }),
  );
}

/**
 * Claim an XP-fuel message. Routes through the atomic
 * claim_crew_xp_fuel RPC (mig 159) so the claim row + XP grant
 * happen in a single transaction. The previous implementation
 * inserted the claim row, then called increment_user_xp with
 * `.catch(() => {})` — if the XP RPC failed (network blip, missing
 * function, RLS), the user lost their one-shot claim with NO XP
 * awarded. Wave 57 (Crews audit) caught this.
 *
 * Backwards-compatible fallback: if the RPC doesn't exist
 * (legacy host running pre-mig-159), fall through to the old
 * insert-then-XP path. The userId param is the second positional
 * for source-compat but is ignored by the RPC (auth.uid()
 * server-side).
 *
 * @returns boolean - true if newly claimed, false if already claimed
 */
export async function claimXpFuel(messageId, userId, xpAmount = 25) {
  const { data, error } = await supabase.rpc('claim_crew_xp_fuel', {
    p_message_id: messageId,
    p_xp:         xpAmount,
  });
  if (!error) {
    // RPC returned { ok, xp_amount } or { ok:false, error:'already_claimed' }
    if (data?.ok === true) return true;
    if (data?.ok === false && data?.error === 'already_claimed') return false;
  }
  // Legacy fallback path. `42883`/`42P01` mean the RPC isn't deployed yet.
  if (error && (error.code === '42883' || error.code === '42P01')) {
    const { error: insErr } = await supabase
      .from('crew_xp_claims')
      .insert({ message_id: messageId, user_id: userId });
    if (insErr && insErr.code !== '23505') throw insErr;
    return !insErr;
  }
  if (error) throw error;
  return false;
}

export async function getUnclaimedXpFuels(crewId, userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: messages } = await supabase
    .from('crew_messages')
    .select('id, content, created_at')
    .eq('crew_id', crewId)
    .eq('message_type', 'xp_fuel')
    .gte('created_at', today.toISOString());
  if (!messages?.length) return [];

  const ids = messages.map(m => m.id);
  const { data: claimed } = await supabase
    .from('crew_xp_claims')
    .select('message_id')
    .eq('user_id', userId)
    .in('message_id', ids);
  const claimedSet = new Set((claimed ?? []).map(c => c.message_id));
  return messages.filter(m => !claimedSet.has(m.id));
}

// ── Crew Stories ──────────────────────────────────────────────────────────────

export async function getCrewStories(crewId) {
  if (!crewId) return [];
  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  // media_type (045) + overlay_style (046) may be missing in
  // mid-migration environments; safeSelect strips and retries so the
  // crew chat header doesn't crash on a partial deploy.
  const { data, error } = await safeSelect({
    columns: ['id', 'user_id', 'image_url', 'media_type', 'overlay_style', 'created_at'],
    build: (cols) => supabase
      .from('stories')
      .select(cols)
      .eq('crew_id', crewId)
      .gt('created_at', cutoff)
      .order('created_at', { ascending: false }),
  });
  return error ? [] : (data ?? []);
}

export async function postCrewStory(userId, userEmail, crewId, imageUrl, mediaType, overlayStyle) {
  const expiresAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('stories')
    .insert({
      user_id:       userId,
      user_email:    userEmail,
      crew_id:       crewId,
      image_url:     imageUrl,
      media_type:    mediaType,
      overlay_style: overlayStyle ?? null,
      expires_at:    expiresAt,
      privacy:       'crew',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getCrewStoriesFeed(userId) {
  const myCrews = await getMyCrews(userId);
  if (!myCrews.length) return [];
  // Promise.allSettled so a single crew's getCrewStories() rejecting
  // (transient 503, RLS edge, network blip) doesn't wipe ALL crew
  // story circles from the row. Previously the whole Promise.all
  // rejected and the user saw an empty feed across every crew until
  // the next refetch. Now the bad crew is silently skipped and the
  // rest render normally.
  const settled = await Promise.allSettled(
    myCrews.map(async (crew) => {
      const stories = await getCrewStories(crew.id);
      return { crew, stories };
    })
  );
  return settled
    .filter(s => s.status === 'fulfilled')
    .map(s => s.value)
    .filter(r => r.stories.length > 0);
}

// ── Image upload helper (reuses Base44 Core uploader) ─────────────────────────

export async function uploadCrewMedia(file) {
  const compressed = await compressImage(file);
  const result = await db.integrations.Core.UploadFile({ file: compressed });
  if (!result?.file_url) throw new Error('Upload failed');
  return result.file_url;
}

// ── Crew Discovery ────────────────────────────────────────────────────────────

/**
 * Search for public crews by name or tag. Returns up to 20 results.
 * Does NOT return crews the user already belongs to.
 */
export async function searchPublicCrews(query, userId) {
  // Strip PostgREST .or() control characters from the query before
  // interpolation. PostgREST parses commas as filter separators and
  // `(`/`)` as grouping — a user typing `foo,name.eq.<uuid>` would
  // inject extra ilike filters or produce a 400 from PostgREST.
  // Also strip `%` since we wrap with our own wildcards; literal `%`
  // in the input would turn into `%%foo%%` matching everything.
  // RLS still protects the data (is_public=true gate is preserved
  // server-side), so this isn't a privacy leak — but it's noisy and
  // a future schema change could promote it to one. Wave 57 (Crews
  // audit) flagged this as a low-severity nit; defense-in-depth fix.
  const rawQ = (query || '').trim().toLowerCase();
  const q = rawQ.replace(/[,()%*]/g, '').slice(0, 60);
  let builder = supabase
    .from('crews')
    .select('id, name, description, tag, max_capacity, created_at')
    .eq('is_public', true)
    .limit(20);

  if (q) {
    builder = builder.or(`name.ilike.%${q}%,tag.ilike.%${q}%,description.ilike.%${q}%`);
  } else {
    builder = builder.order('created_at', { ascending: false });
  }

  const { data, error } = await builder;
  if (error || !data) return [];

  // Filter out crews the user already belongs to
  if (!userId || !data.length) return data ?? [];
  const { data: mine } = await supabase
    .from('crew_members')
    .select('crew_id')
    .eq('user_id', userId);
  const myIds = new Set((mine ?? []).map(r => r.crew_id));
  return data.filter(c => !myIds.has(c.id));
}

/**
 * Update a crew's public profile (name, description, is_public, tag).
 * Only crew leaders can call this.
 */
export async function updateCrewProfile(crewId, updates) {
  const allowed = {};
  if (updates.name       !== undefined) allowed.name        = updates.name;
  if (updates.description!== undefined) allowed.description = updates.description;
  if (updates.is_public  !== undefined) allowed.is_public   = updates.is_public;
  if (updates.tag        !== undefined) allowed.tag         = updates.tag;
  if (updates.avatar_url !== undefined) allowed.avatar_url  = updates.avatar_url;
  const { error } = await supabase.from('crews').update(allowed).eq('id', crewId);
  if (error) throw error;
}

// ── Pinned Announcements ──────────────────────────────────────────────────────

/**
 * Pin or unpin a crew message (moderators + leaders only — enforced by RLS).
 */
export async function pinMessage(messageId, pinned) {
  const { error } = await supabase
    .from('crew_messages')
    .update({ is_pinned: pinned })
    .eq('id', messageId);
  if (error) throw error;
}

/**
 * Fetch the currently pinned announcement for a crew (latest pinned message).
 */
export async function getPinnedMessage(crewId) {
  if (!crewId) return null;
  const { data, error } = await supabase
    .from('crew_messages')
    .select('*')
    .eq('crew_id', crewId)
    .eq('is_pinned', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return error ? null : data;
}

// ── Crew Assigned Regimens ────────────────────────────────────────────────────

export async function getCrewAssignedRegimens(crewId) {
  if (!crewId) return [];
  const { data, error } = await supabase
    .from('crew_assigned_regimens')
    .select('id, crew_id, regimen_id, assigned_by, note, assigned_at, regimens(id, name, exercises, description)')
    .eq('crew_id', crewId)
    .order('assigned_at', { ascending: false });
  return error ? [] : (data ?? []);
}

export async function assignRegimenToCrew(crewId, regimenId, assignedBy, note) {
  const { data, error } = await supabase
    .from('crew_assigned_regimens')
    .upsert(
      { crew_id: crewId, regimen_id: regimenId, assigned_by: assignedBy, note: note ?? null },
      { onConflict: 'crew_id,regimen_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeAssignedRegimen(id) {
  const { error } = await supabase
    .from('crew_assigned_regimens')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ── Crew Roles ────────────────────────────────────────────────────────────────

/**
 * Set the role for a crew member. Leaders can promote to moderator or demote.
 * role: 'member' | 'moderator' | 'leader'
 */
export async function setMemberRole(crewId, userId, role) {
  const isAdmin = role === 'leader';
  const { error } = await supabase
    .from('crew_members')
    .update({ role, is_admin: isAdmin })
    .eq('crew_id', crewId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Crew Stats ────────────────────────────────────────────────────────────────

/**
 * Aggregate crew stats for the current week.
 * Returns: { totalVolumeLbs, topPerformer, bestPr }
 *
 * Since workout_logs live in Base44, we fetch per-member and aggregate
 * client-side. Capped at 16 members so this is O(16) API calls.
 */
export async function getCrewStats(crewId) {
  if (!crewId) return null;

  // 1. Get member user_ids
  const members = await getCrewMembers(crewId);
  if (!members.length) return { totalVolumeLbs: 0, topPerformer: null, bestPr: null, members: [] };

  // 2. Get user profiles (id-keyed) for display
  const userIds = members.map(m => m.user_id);
  const { data: profiles } = await selectProfiles((from) => from
    .select('id, username, avatar_url')
    .in('id', userIds));
  const profileMap = {};
  for (const p of (profiles ?? [])) profileMap[p.id] = p;

  // 3. Aggregate each member's last-7-days volume + best 1RM.
  //
  // Preferred path: the get_crew_weekly_stats RPC (migration 212). It runs
  // SECURITY DEFINER so it bypasses the per-row owner-only RLS on
  // workout_logs, but is gated on the caller's own crew_members membership
  // (auth.uid()) server-side, so it only ever exposes stats for a crew the
  // caller belongs to. This is what actually fixes the bug: reading each
  // OTHER member's WorkoutLog from the client returns nothing (RLS =
  // "auth.email()=created_by OR auth.uid()=user_id"), so the panel used to
  // show 0 volume / null PR for everyone except the viewer. The RPC also
  // collapses the old O(16) per-member round-trips into a single call.
  //
  // Fallback (pre-212 host, RPC missing): the legacy per-member client loop
  // below. On those hosts cross-member reads stay RLS-blocked, so non-viewer
  // members still read as 0/null — the documented limitation 212 removes.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let memberStats = null;
  const { data: rpcRows, error: rpcErr } = await supabase
    .rpc('get_crew_weekly_stats', { p_crew_id: crewId });
  if (!rpcErr && Array.isArray(rpcRows)) {
    const statByUser = {};
    for (const row of rpcRows) statByUser[row.user_id] = row;
    memberStats = members.map((m) => ({
      userId: m.user_id,
      profile: profileMap[m.user_id],
      volume: Number(statByUser[m.user_id]?.volume_lbs) || 0,
      // RPC best_pr shape matches the legacy path: {exercise, weight, reps, e1rm}
      bestPr: statByUser[m.user_id]?.best_pr ?? null,
    }));
  }

  if (!memberStats) {
    // Legacy per-member fallback. Filter by user_id (server-populated), not
    // created_by=email, so it rides the auth.uid()=user_id RLS branch and
    // doesn't depend on the email column the public_profiles view is being
    // drained of. Cross-member rows are RLS-blocked here → 0/null for
    // everyone but the viewer; that's the bug 212 closes.
    memberStats = await Promise.all(
      members.map(async (m) => {
        const profile = profileMap[m.user_id];
        if (!profile) return { userId: m.user_id, profile, volume: 0, bestPr: null };

        let logs = [];
        try {
          logs = await db.entities.WorkoutLog
            .filter({ user_id: m.user_id }, '-date', 20)
            .catch(() => []);
          // Filter to this week
          logs = (logs ?? []).filter(l => l.date >= weekAgo);
        } catch { logs = []; }

        let volume = 0;
        let bestPr = null;

        for (const log of logs) {
          for (const ex of (log.exercises ?? [])) {
            for (const set of (ex.sets ?? [])) {
              const w = Number(set.weight) || 0;
              const r = Number(set.reps)   || 0;
              volume += w * r;
              // Epley 1RM approximation
              const e1rm = r > 1 ? w * (1 + r / 30) : w;
              if (!bestPr || e1rm > bestPr.e1rm) {
                bestPr = { exercise: ex.name, weight: w, reps: r, e1rm };
              }
            }
          }
        }

        return { userId: m.user_id, profile, volume, bestPr };
      })
    );
  }

  // 4. Aggregate
  const totalVolumeLbs = memberStats.reduce((s, m) => s + m.volume, 0);
  const topPerformer = [...memberStats].sort((a, b) => b.volume - a.volume)[0] ?? null;

  // Best PR across the entire crew
  let bestPr = null;
  for (const ms of memberStats) {
    if (ms.bestPr && (!bestPr || ms.bestPr.e1rm > bestPr.e1rm)) {
      bestPr = { ...ms.bestPr, profile: ms.profile };
    }
  }

  return { totalVolumeLbs, topPerformer, bestPr, memberStats };
}

/**
 * First-to-achieve leaderboard for a crew. For each achievement that any
 * crew member has unlocked, returns the member who unlocked it earliest
 * along with the unlock date. Ordered by most-recent earliest-unlock so
 * the freshest "bragging rights" rise to the top.
 *
 * Achievement records live in Base44 (no Supabase mirror), so we fetch
 * per-member and aggregate client-side — same O(N) pattern as
 * `getCrewStats`. Capped at the crew's 16-member ceiling.
 *
 * Returns: Array<{ achievementId, member, profile, unlockedAt }>
 */
export async function getCrewFirstAchievers(crewId) {
  if (!crewId) return [];

  const members = await getCrewMembers(crewId);
  if (!members.length) return [];

  const userIds = members.map(m => m.user_id);
  const { data: profiles } = await selectProfiles((from) => from
    .select('id, username, avatar_url')
    .in('id', userIds));
  const profileMap = {};
  for (const p of (profiles ?? [])) profileMap[p.id] = p;

  // Pull every unlocked achievement for every member in parallel.
  const perMember = await Promise.all(members.map(async (m) => {
    const profile = profileMap[m.user_id];
    // Filter by user_id, not created_by=email. achievements.user_id is
    // reliably server-stamped (grant_xp_milestone_achievements writes
    // auth.uid()), RLS already permits the auth.uid()=user_id branch, and this
    // also catches guest members whose rows carry created_by='' (the old email
    // filter silently missed them — same defect the app already fixed in
    // leaderboardStats/AchievementsVault/ProfileBadgeShowcase). `profile` is
    // kept for the display fields on the returned rows.
    if (!m.user_id || !profile) return [];
    try {
      const all = await db.entities.Achievement
        .filter({ user_id: m.user_id })
        .catch(() => []);
      // The achievements table stores ONLY unlocked rows (row presence =
      // unlocked). Date column is `unlocked_at`. Previously filtered on
      // `a.unlocked && a.unlocked_date` — neither column exists — so
      // the crew first-achievers leaderboard has been silently empty
      // since launch. (Audit 17 #T2, also same defect class as the
      // AchievementsTab progress-bar fix from wave 2.)
      return (all || [])
        .filter(a => a?.achievement_id && a?.unlocked_at)
        .map(a => ({
          achievementId: a.achievement_id,
          userId:        m.user_id,
          profile,
          unlockedAt:    a.unlocked_at,
        }));
    } catch { return []; }
  }));

  // Reduce to earliest-per-achievement.
  const earliest = {};
  for (const arr of perMember) {
    for (const row of arr) {
      const prev = earliest[row.achievementId];
      if (!prev || row.unlockedAt < prev.unlockedAt) {
        earliest[row.achievementId] = row;
      }
    }
  }

  // Sort by unlockedAt DESC so the most-recently-claimed bragging
  // rights rise to the top — that's the most engagement-worthy view.
  return Object.values(earliest)
    .sort((a, b) => (b.unlockedAt > a.unlockedAt ? 1 : -1));
}
