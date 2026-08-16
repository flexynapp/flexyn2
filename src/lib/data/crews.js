// src/lib/data/crews.js
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { selectProfiles } from '@/lib/data/users';
import { db } from '@/api/db';
import { compressImage } from '@/lib/imageCompress';
import { containsProfanity } from '@/lib/profanityFilter';
import { reportError } from '@/lib/reportError';

// Display value of one XP-fuel claim. The AUTHORITATIVE number is the
// constant inside claim_crew_xp_fuel (migration 298) — this is only what
// the banner promises before you tap, and the claim response is what the
// toast reports. It said 500 while the RPC granted whatever the client
// asked for, up to 1000.
export const CREW_XP_FUEL_AMOUNT = 25;

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
  // One RPC, one transaction (migration 357). The old path inserted the
  // crews row and the founder's membership as two client statements with a
  // compensating DELETE if the second failed — and a compensating delete
  // can fail too, leaving a crew with no members, which is unreachable and
  // unremovable. It also required a client INSERT policy on crew_members,
  // and that policy checked only `user_id = auth.uid()`: any signed-in user
  // could insert themselves into any crew by id, as 'leader'. 357 revokes
  // the INSERT, so this RPC is the only founder door.
  const { data: viaRpc, error: rpcErr } = await supabase.rpc('create_crew_atomic', {
    p_name: name,
  });

  if (!rpcErr) return viaRpc;

  if (/already_in_crew/i.test(rpcErr.message || '') || rpcErr.code === '23505') {
    throw Object.assign(
      new Error('You\'re already in a Crew. Leave it first to start another.'),
      { code: 'ALREADY_IN_CREW' },
    );
  }
  // Anything but "RPC not deployed here yet" is a real failure. The
  // fallback below exists only for the window between this deploying to
  // Netlify and the SQL being run, and it stops working — correctly — the
  // moment 357 lands.
  if (rpcErr.code !== '42883' && rpcErr.code !== '42P01') throw rpcErr;

  const { data: crew, error } = await supabase
    .from('crews')
    .insert({ name, created_by: user.id })
    .select()
    .single();
  if (error || !crew) throw error || new Error('Failed to create crew');

  const { error: memberErr } = await supabase.from('crew_members').insert({
    crew_id: crew.id,
    user_id: user.id,
    is_admin: true,
  });

  if (memberErr) {
    await supabase.from('crews').delete().eq('id', crew.id);
    if (/already_in_crew/i.test(memberErr.message || '') || memberErr.code === '23505') {
      throw Object.assign(
        new Error('You\'re already in a Crew. Leave it first to start another.'),
        { code: 'ALREADY_IN_CREW' },
      );
    }
    throw memberErr;
  }

  return crew;
}

// Crew columns the app reads on the crews list. The progression half
// (crew_level, crew_xp, trophies, the war record) arrives with migration
// 248; the base half predates it. They're split so a host that hasn't run
// 248 yet degrades to the base set instead of erroring the whole Crews tab
// during the window between the Netlify deploy and the SQL being applied.
const CREW_BASE_COLS = 'id, name, created_at, max_capacity, tag, avatar_url';
const CREW_PROG_COLS = 'crew_level, crew_xp, trophies, wars_won, wars_lost, wars_drawn';

export async function getMyCrews(userId) {
  if (!userId) return [];

  const run = (crewCols) => supabase
    .from('crew_members')
    .select(`crew_id, is_admin, joined_at, crews(${crewCols})`)
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });

  // safeSelect can't help here: it strips from a flat column list and this
  // read nests an embedded resource, so the retry is written out explicitly.
  let { data, error } = await run(`${CREW_BASE_COLS}, ${CREW_PROG_COLS}`);
  if (error) {
    ({ data, error } = await run(CREW_BASE_COLS));
  }
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

/**
 * How many lifters are on a crew.
 *
 * `crews` has no member_count column — every count in this app is derived,
 * because a denormalised counter is only ever as correct as every increment
 * before it (see the gym_businesses.member_count drift in CLAUDE.md). A head
 * count sends no rows over the wire, so this is cheaper than getCrewMembers
 * for callers that only want the number.
 *
 * Returns null rather than 0 on failure: 0 is a claim about the crew, and a
 * caller that cannot tell the two apart renders "0 lifters" at a crew that
 * has members.
 */
export async function getCrewMemberCount(crewId) {
  if (!crewId) return null;
  const { count, error } = await supabase
    .from('crew_members')
    .select('id', { count: 'exact', head: true })
    .eq('crew_id', crewId);
  return error ? null : (count ?? null);
}

export async function getCrewMembers(crewId) {
  if (!crewId) return [];
  const { data, error } = await supabase
    .from('crew_members')
    // `role` joined the select once migration 250's sync trigger made it
    // reliable — before that it drifted from is_admin depending on which
    // call site last wrote, so every consumer fell back to the boolean and
    // moderators rendered as plain members.
    .select('id, user_id, is_admin, role, joined_at')
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
    // Migration 250 added `status`, which distinguishes what actually
    // happened: 'joined', 'already_member', 'requested' (a private crew
    // queued you for approval) or 'pending' (you'd already asked). Older
    // hosts return only { success, already_member }, so default it.
    return {
      ...data,
      status: data?.status ?? (data?.already_member ? 'already_member' : 'joined'),
    };
  }

  // Distinct error codes:
  //   23514 = crew_full (RAISE EXCEPTION with that code in the RPC)
  //   22023 = crew not found
  //   42501 = unauthenticated, or banned (250)
  //   42883 / 42P01 = RPC not yet deployed → legacy fallback
  if (/already_in_crew/i.test(error.message || '') || error.code === '23505') {
    throw Object.assign(
      new Error('You\'re already in a Crew. Leave it first to join another.'),
      { code: 'ALREADY_IN_CREW' },
    );
  }
  if (/banned_from_crew/i.test(error.message || '')) {
    throw Object.assign(new Error('You can\'t rejoin this Crew.'), { code: 'BANNED' });
  }
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

/**
 * Leave the crew you're in (migration 252).
 *
 * Refusals come back as reasons rather than throws, because each one is a
 * normal situation with a different thing to do about it:
 *
 *   promote_first — you're the only leader and there are other members. A
 *                   crew with nobody who can approve, ban or enter a war is
 *                   worse than one you're still in.
 *   active_war    — you're the last member, and leaving would delete the
 *                   crew. crew_wars cascades on both crew columns, so that
 *                   would delete the war out from under your opponent.
 *   not_a_member  — nothing to leave.
 *
 * On success, `crew_deleted` is true when you were the last one out.
 */
export async function leaveCrew(crewId) {
  if (!crewId) return { ok: false, reason: 'missing' };

  const { data, error } = await supabase.rpc('leave_crew', { p_crew_id: crewId });

  if (error) {
    if (error.code === '42883' || error.code === '42P01') {
      return { ok: false, reason: 'not_deployed' };
    }
    console.warn('[crews] leave_crew failed:', error);
    return { ok: false, reason: 'db_error' };
  }

  if (data?.ok !== true) return { ok: false, reason: data?.reason ?? 'db_error' };
  return { ok: true, crewDeleted: data?.crew_deleted === true };
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
  // Use the SECURITY DEFINER RPC, not a direct UPDATE. A client UPDATE on
  // ANOTHER user's regimen row cannot succeed: the "owner full access"
  // policy scopes writes to `created_by = auth.email()`, so PostgREST
  // matches zero rows and returns 200 with an empty array. There is no
  // error for the `.catch()` to catch — the write just silently does not
  // happen, exactly like the storage `remove()` case in CLAUDE.md.
  //
  // PROVEN against production 2026-08-12, as keganbergeron@gmail.com
  // against a regimen owned by sjoudrie@gmail.com, inside a probe that
  // restored the value afterwards:
  //     direct cross-user UPDATE -> 0 rows matched, no error, 0 -> 0
  //     increment_copy_count()   -> 0 -> 1
  //
  // This is why `copy_count` is 0 on 33 of 33 rows while TWO clones exist:
  // both came through this function (identified by the
  // `original_author_username` fingerprint it writes), and both counter
  // bumps were dropped on the floor.
  //
  // The comment this replaces was itself the fix for a 2026-05-25 audit
  // finding — but that pass corrected the COLUMN NAME (`clone_count` ->
  // `copy_count`) and left the mechanism broken, so the badge kept
  // reading 0 for a different reason than before. `regimens.js`
  // two files away has always called the RPC.
  if (user.email !== source.created_by) {
    const { error: bumpError } = await supabase.rpc('increment_copy_count', {
      p_table: 'regimens',
      p_id:    source.id,
    });
    // Still non-fatal — the clone itself succeeded and is the thing the
    // user asked for. But it is reported now rather than swallowed, so
    // the next time this breaks it is visible in Sentry instead of
    // surfacing three months later as a column of zeros.
    if (bumpError) {
      reportError(bumpError, {
        feature: 'crews.equip-regimen.copy-count',
        level: 'warning',
        userEmail: user?.email,
      });
    }
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

// How many fuel drops one member may post to one crew in a day.
//
// This is a SPAM guard, not an economy guard, and the distinction matters.
// The economy is already closed on the claim side: migration 298 caps
// `crew_xp_fuel` at 100 XP/day per claimer, so the total XP a crew can absorb
// is members × 100 no matter how many banners get posted. What an uncapped
// button would buy is a chat full of banners, which is a moderation problem.
//
// It is also only a CLIENT guard. `crew_messages_insert` (mig 048) is
// `sender_id = auth.uid() AND is_crew_member(crew_id)` and does not constrain
// message_type, so a crafted request can still post fuel past this. That is
// acceptable precisely because the claim cap means doing so wins nothing —
// but if fuel ever starts paying the SENDER, this has to move server-side.
export const XP_FUEL_SENDS_PER_DAY = 3;

/**
 * How many more fuel drops this member may post to this crew today.
 *
 * Returns the cap on any read failure rather than 0 — a blip should not
 * silently disable the button and leave the user tapping a dead control.
 * The worst case is one extra banner, which the claim cap already neuters.
 */
export async function xpFuelSendsLeftToday(crewId, senderId) {
  if (!crewId || !senderId) return 0;
  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { count, error } = await supabase
      .from('crew_messages')
      .select('id', { count: 'exact', head: true })
      .eq('crew_id', crewId)
      .eq('sender_id', senderId)
      .eq('message_type', 'xp_fuel')
      .gte('created_at', since.toISOString());
    if (error) return XP_FUEL_SENDS_PER_DAY;
    return Math.max(0, XP_FUEL_SENDS_PER_DAY - (count ?? 0));
  } catch {
    return XP_FUEL_SENDS_PER_DAY;
  }
}

/**
 * Post an XP-fuel banner to crew chat for other members to claim.
 *
 * This had ZERO callers from May 2026 until Aug 2026 — the claim half was
 * fully built (CrewMessageItem renders the banner, claim_crew_xp_fuel grants
 * the XP atomically, migration 298 hardened the pricing) against a send half
 * that no screen ever invoked. So the feature existed end to end in the code
 * and could not be started by a user. CrewChat's composer now calls it.
 *
 * The `xp` in the body is DISPLAY ONLY and the server ignores it — mig 298
 * prices a claim from a SQL constant precisely because this JSON is written
 * by the sender's browser. Don't reintroduce it as an argument.
 */
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
 * @returns {{claimed: boolean, xp?: number, reason?: string}}
 *   `xp` is what the SERVER credited, which is not always the advertised
 *   amount — the daily crew-fuel cap (migration 298) can credit less, or
 *   nothing. `reason` is 'own_fuel' | 'already_claimed' | 'not_crew_member'
 *   | 'not_fuel_message' | 'message_not_found' | 'unavailable'.
 */
export async function claimXpFuel(messageId, userId) {
  // p_xp is sent as null on purpose. Migration 298 ignores it outright —
  // the server prices a fuel claim — and on a pre-298 host null makes the
  // old COALESCE(p_xp, 25) fall to its own default rather than letting
  // this browser name its own XP figure. It was previously the caller's
  // argument, so "claim 1000" was one devtools edit away.
  const { data, error } = await supabase.rpc('claim_crew_xp_fuel', {
    p_message_id: messageId,
    p_xp:         null,
  });
  if (!error) {
    // { ok, xp_amount, capped } or { ok:false, error:'already_claimed' | … }
    if (data?.ok === true) return { claimed: true, xp: Number(data.xp_amount) || 0 };
    if (data?.ok === false) return { claimed: false, reason: data.error || 'unavailable' };
  }
  // Legacy fallback path. `42883`/`42P01` mean the RPC isn't deployed yet.
  if (error && (error.code === '42883' || error.code === '42P01')) {
    const { error: insErr } = await supabase
      .from('crew_xp_claims')
      .insert({ message_id: messageId, user_id: userId });
    if (insErr && insErr.code !== '23505') throw insErr;
    return { claimed: !insErr, xp: 0, reason: insErr ? 'already_claimed' : undefined };
  }
  if (error) throw error;
  return { claimed: false, reason: 'unavailable' };
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

/**
 * Hand the crew to another member.
 *
 * Not a role change, which is why it is not in setMemberRole's vocabulary:
 * it promotes the target and steps the caller down in one transaction, so
 * the crew is never briefly leaderless and never briefly has two leaders
 * that nobody meant. Migration 359 does both writes server-side; 357's
 * guard trigger would refuse the demotion on its own, which is exactly why
 * this cannot be two client calls.
 *
 * Throws with a `code` the caller can branch on: 42501 not the leader,
 * 22023 target is not in the crew (or is you).
 */
export async function transferLeadership(crewId, toUserId) {
  const { data, error } = await supabase.rpc('transfer_crew_leadership', {
    p_crew_id: crewId,
    p_to_user: toUserId,
  });
  if (error) throw error;
  return { ok: true, newLeader: data?.new_leader ?? toUserId };
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
 * Reads `user_trophies`. It used to read the retired `public.achievements`
 * table, which holds ONE row in all of production, so this panel was
 * empty for every crew — the previous fix here corrected the column names
 * but left the source table behind, and an empty leaderboard is
 * indistinguishable from a crew that has achieved nothing.
 *
 * One query for the whole crew rather than one per member: the trophy
 * table's read policy is `USING (true)` for authenticated users, so an
 * `IN (…)` over the member ids is a single round trip, where the old
 * per-member fan-out was O(members).
 *
 * Returns: Array<{ achievementId, userId, profile, unlockedAt }>
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

  // Row presence IS the unlock — there is no `unlocked` flag to filter on,
  // and reaching for one is what emptied this panel's predecessor.
  const { data: rows, error } = await safeSelect({
    columns: ['user_id', 'trophy_id', 'earned_at'],
    build: (cols) => supabase
      .from('user_trophies')
      .select(cols)
      .in('user_id', userIds),
  });
  if (error) return [];

  // Reduce to earliest-per-trophy.
  const earliest = {};
  for (const r of (rows || [])) {
    const profile = profileMap[r.user_id];
    if (!profile || !r.trophy_id || !r.earned_at) continue;
    const prev = earliest[r.trophy_id];
    if (!prev || r.earned_at < prev.unlockedAt) {
      earliest[r.trophy_id] = {
        achievementId: r.trophy_id,
        userId:        r.user_id,
        profile,
        unlockedAt:    r.earned_at,
      };
    }
  }

  // Sort by unlockedAt DESC so the most-recently-claimed bragging
  // rights rise to the top — that's the most engagement-worthy view.
  return Object.values(earliest)
    .sort((a, b) => (b.unlockedAt > a.unlockedAt ? 1 : -1));
}
