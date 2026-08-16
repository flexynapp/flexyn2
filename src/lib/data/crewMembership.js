// src/lib/data/crewMembership.js
//
// The membership door: join requests, bans, invites and inactivity
// (migration 250).
//
// Every function here is a thin wrapper over a SECURITY DEFINER RPC that
// re-derives the caller's authority from auth.uid(). None of them take a
// "who am I" argument, because a crew id plus a user id is not a capability
// — that was the mistake migration 108 shipped and 246-249 spent their
// length undoing. Passing p_crew_id tells the server WHICH crew, never that
// you're allowed to act on it.
//
// There is no write path to crew_bans, crew_join_requests or crew_invites
// from a client: all three tables have INSERT/UPDATE/DELETE revoked from
// `authenticated`, so these RPCs are the only door.

import { supabase } from '@/api/supabaseClient';

/** True when the RPC simply isn't deployed on this host yet. */
function notDeployed(error) {
  return error?.code === '42883' || error?.code === '42P01';
}

/**
 * Pending join requests for a crew, newest last, with display names.
 *
 * Returns [] for anyone who isn't a leader of the crew — the server decides
 * that, not the caller, so a non-leader gets an empty list rather than an
 * error to probe.
 */
export async function listJoinRequests(crewId) {
  if (!crewId) return [];
  const { data, error } = await supabase.rpc('list_crew_join_requests', {
    p_crew_id: crewId,
  });
  if (error) {
    if (!notDeployed(error)) console.warn('[crewMembership] listJoinRequests failed:', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Approve or reject a pending request (leader only, enforced server-side).
 *
 * Approving can still fail with crew_full — the seat may have gone between
 * the request and the decision, and the RPC re-checks capacity under a lock
 * rather than trusting what the leader's screen said.
 */
export async function decideJoinRequest(crewId, userId, approve) {
  if (!crewId || !userId) return { ok: false, reason: 'missing' };

  const { data, error } = await supabase.rpc('decide_crew_join_request', {
    p_crew_id: crewId,
    p_user_id: userId,
    p_approve: !!approve,
  });

  if (error) {
    if (/crew_full/i.test(error.message || '') || error.code === '23514') {
      return { ok: false, reason: 'crew_full' };
    }
    if (error.code === '42501') return { ok: false, reason: 'not_leader' };
    console.warn('[crewMembership] decideJoinRequest failed:', error);
    return { ok: false, reason: 'db_error' };
  }

  // The RPC has exactly one non-raising failure — {ok:false, reason:'already_in_crew'}
  // — and hardcoding ok:true swallowed it, so the reviewer saw "Approved, they're
  // in" while the request stayed pending and no member row was written. Every
  // other failure raises and is caught by the `error` branch above.
  if (data && data.ok === false) {
    return { ok: false, reason: data.reason ?? 'db_error', status: data.status ?? null, changed: false };
  }
  return { ok: true, status: data?.status ?? null, changed: data?.changed ?? false };
}

/**
 * Ban somebody from a crew. Removes their membership in the same
 * transaction, and clears any live invite or pending request — otherwise
 * "kick" was reversible by the person being kicked.
 *
 * Leaders can't be banned (demote first) and you can't ban yourself.
 */
export async function banMember(crewId, userId, reason) {
  if (!crewId || !userId) return { ok: false, reason: 'missing' };

  const { error } = await supabase.rpc('ban_crew_member', {
    p_crew_id: crewId,
    p_user_id: userId,
    p_reason:  reason ? String(reason).slice(0, 200) : null,
  });

  if (error) {
    if (/another leader/i.test(error.message || '')) return { ok: false, reason: 'target_is_leader' };
    if (/ban yourself/i.test(error.message || ''))   return { ok: false, reason: 'self' };
    if (error.code === '42501')                      return { ok: false, reason: 'not_leader' };
    console.warn('[crewMembership] banMember failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true };
}

/** Lift a ban (leader only). */
export async function unbanMember(crewId, userId) {
  if (!crewId || !userId) return { ok: false, removed: 0 };
  const { data, error } = await supabase.rpc('unban_crew_member', {
    p_crew_id: crewId,
    p_user_id: userId,
  });
  if (error) {
    console.warn('[crewMembership] unbanMember failed:', error);
    return { ok: false, removed: 0 };
  }
  return { ok: true, removed: data?.removed ?? 0 };
}

/**
 * Invite a named person, so the invite is bound to them rather than to
 * possession of a message body.
 *
 * The DM invite card carries a crew id in plaintext; before 250 that string
 * WAS the capability, because join_crew_atomic never checked is_public.
 * Now the row is what grants entry, and it expires in 14 days.
 */
export async function inviteToCrew(crewId, userId) {
  if (!crewId || !userId) return { ok: false, reason: 'missing' };

  const { error } = await supabase.rpc('invite_to_crew', {
    p_crew_id: crewId,
    p_user_id: userId,
  });

  if (error) {
    if (/banned/i.test(error.message || '')) return { ok: false, reason: 'banned' };
    if (error.code === '42501')              return { ok: false, reason: 'not_allowed' };
    if (notDeployed(error))                  return { ok: false, reason: 'not_deployed' };
    console.warn('[crewMembership] inviteToCrew failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true };
}

/**
 * Members with no logged session in `days` (default 21), oldest silence
 * first, so a leader can free a seat against the sixteen-member cap.
 *
 * Reported, never enforced. Nothing auto-removes anyone: in a fitness app,
 * silently ejecting somebody mid-injury is the wrong default, and the
 * leader has context this query doesn't. `last_seen` is null for a member
 * who has never logged a workout at all.
 */
export async function getInactiveMembers(crewId, days = 21) {
  if (!crewId) return [];
  const { data, error } = await supabase.rpc('get_crew_inactive_members', {
    p_crew_id: crewId,
    p_days:    days,
  });
  if (error) {
    if (!notDeployed(error)) console.warn('[crewMembership] getInactiveMembers failed:', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}
