// src/lib/data/crews.js
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
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
  return error ? [] : (data ?? []);
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
  await Promise.allSettled(
    members.map(m =>
      supabase.rpc('create_notification_for', {
        p_user_id:  m.user_id,
        p_type:     'crew_roll_call',
        p_title:    `@everyone — ${senderName} posted a Roll Call`,
        p_body:     question,
        p_icon:     '📣',
        p_link_url: '/hub',
        p_metadata: { crew_id: crewId },
      }).catch(() => {}),
    ),
  );
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

  // Increment clone_count on the original — but ONLY if the cloner is NOT the creator.
  // This prevents creators from inflating their own adoption count.
  if (user.email !== source.created_by) {
    await supabase
      .from('regimens')
      .update({ clone_count: (source.clone_count ?? 0) + 1 })
      .eq('id', source.id)
      .catch(() => {}); // non-fatal
  }

  return copy;
}

/**
 * Fetch the clone_count for a single regimen (used by RegimenMessage UI).
 */
export async function getRegimenCloneCount(regimenId) {
  if (!regimenId) return 0;
  try {
    const { data, error } = await supabase
      .from('regimens')
      .select('clone_count')
      .eq('id', regimenId)
      .single();
    if (error) return 0;
    return data?.clone_count ?? 0;
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

export async function claimXpFuel(messageId, userId) {
  const { error } = await supabase
    .from('crew_xp_claims')
    .insert({ message_id: messageId, user_id: userId });
  // 23505 = unique violation = already claimed
  if (error && error.code !== '23505') throw error;
  return !error;
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
  const results = await Promise.all(
    myCrews.map(async (crew) => {
      const stories = await getCrewStories(crew.id);
      return { crew, stories };
    })
  );
  return results.filter(r => r.stories.length > 0);
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
  const q = (query || '').trim().toLowerCase();
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

  // 2. Get user profiles to resolve emails
  const userIds = members.map(m => m.user_id);
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, email, username, avatar_url')
    .in('id', userIds);
  const profileMap = {};
  for (const p of (profiles ?? [])) profileMap[p.id] = p;

  // 3. Fetch last 7 days of workouts for each member (Base44)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const memberStats = await Promise.all(
    members.map(async (m) => {
      const profile = profileMap[m.user_id];
      if (!profile?.email) return { userId: m.user_id, profile, volume: 0, bestPr: null };

      let logs = [];
      try {
        logs = await db.entities.WorkoutLog
          .filter({ created_by: profile.email }, '-date', 20)
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
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, email, username, avatar_url')
    .in('id', userIds);
  const profileMap = {};
  for (const p of (profiles ?? [])) profileMap[p.id] = p;

  // Pull every unlocked achievement for every member in parallel.
  const perMember = await Promise.all(members.map(async (m) => {
    const profile = profileMap[m.user_id];
    if (!profile?.email) return [];
    try {
      const all = await db.entities.Achievement
        .filter({ created_by: profile.email })
        .catch(() => []);
      return (all || [])
        .filter(a => a?.unlocked && a?.unlocked_date)
        .map(a => ({
          achievementId: a.achievement_id,
          userId:        m.user_id,
          profile,
          unlockedAt:    a.unlocked_date,
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
