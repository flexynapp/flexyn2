// src/lib/data/duels.js
// Workout Duels: challenge, accept, and read results the server scores.

import { supabase } from '@/api/supabaseClient';
import { selectProfiles } from '@/lib/data/users';
import { findOrCreateConversation, sendMessage } from '@/lib/data/hubMessages';
import { reportError } from '@/lib/reportError';

// ── Social helpers ────────────────────────────────────────────────────────────

/**
 * Returns opponents the user has dueled, sorted by duel frequency (most first).
 * Each entry: { id, username, avatar_url, current_level, count, wins, losses }
 */
export async function getFrequentOpponents(userId, limit = 8) {
  if (!userId) return [];
  const { data: duels } = await supabase
    .from('duels')
    .select('challenger_id, opponent_id, winner_id, status')
    .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!duels?.length) return [];

  const stats = {};
  for (const d of duels) {
    const opId = d.challenger_id === userId ? d.opponent_id : d.challenger_id;
    if (!opId || opId === userId) continue;
    if (!stats[opId]) stats[opId] = { count: 0, wins: 0, losses: 0 };
    stats[opId].count++;
    if (d.status === 'completed') {
      if (d.winner_id === userId) stats[opId].wins++;
      else if (d.winner_id) stats[opId].losses++;
    }
  }

  const sorted = Object.entries(stats)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit);
  if (!sorted.length) return [];

  const ids = sorted.map(([id]) => id);
  const { data: profiles } = await selectProfiles((from) => from
    .select('id, username, avatar_url, current_level')
    .in('id', ids));

  return sorted
    .map(([id, s]) => ({ id, ...s, ...(profiles?.find(p => p.id === id) || {}) }))
    .filter(p => p.username);
}

/**
 * Get the head-to-head record between two users.
 * Returns { myWins, theirWins, total }
 */
export async function getHeadToHead(userId, opponentId) {
  if (!userId || !opponentId) return { myWins: 0, theirWins: 0, total: 0 };
  const { data } = await supabase
    .from('duels')
    .select('winner_id, status')
    .or(
      `and(challenger_id.eq.${userId},opponent_id.eq.${opponentId}),` +
      `and(challenger_id.eq.${opponentId},opponent_id.eq.${userId})`
    )
    .eq('status', 'completed');

  const myWins    = (data ?? []).filter(d => d.winner_id === userId).length;
  const theirWins = (data ?? []).filter(d => d.winner_id === opponentId).length;
  return { myWins, theirWins, total: (data ?? []).length };
}

/**
 * People the caller can challenge. A query of two or more characters searches
 * usernames and display names; anything shorter lists the people they follow.
 * Server-side (duel_opponent_candidates) so it can leave out guests, blocked
 * users and anyone hidden from search, none of which the client can see.
 */
export async function searchDuelOpponents(query = '') {
  const { data, error } = await supabase.rpc('duel_opponent_candidates', { p_query: query || null });
  if (error) throw error;
  return data ?? [];
}

/**
 * Send a structured [DUEL_INVITE_V1] DM to the opponent.
 * Renders as an accept/decline card in HubChat.
 * Fire-and-forget — failure is non-critical.
 *
 * @param {string} duelId       - the created duel row ID
 * @param {string} opponentId   - opponent's user_profiles.id
 * @param {string} type         - 'open' | 'mirror' | 'exercise'
 * @param {number} windowHours  - duel window in hours
 */
export async function sendDuelDM(duelId, opponentId, type = 'open', windowHours = 24) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Fetch challenger's own profile (username, avatar, email)
    const { data: myProfile } = await supabase
      .from('user_profiles')
      .select('username, avatar_url, email')
      .eq('id', user.id)
      .single();

    if (!myProfile?.email) return;

    // Pass the opponent by id — findOrCreateConversation resolves it to an
    // email server-side (resolve_profile_email), so we never read the
    // opponent's email off the public_profiles view here.
    const conv = await findOrCreateConversation(myProfile.email, opponentId);
    if (!conv?.id) return;

    const payload = JSON.stringify({
      duelId,
      challengerUsername: myProfile.username || 'Someone',
      challengerAvatar:   myProfile.avatar_url || null,
      type,
      windowHours,
    });

    await sendMessage({
      conversationId: conv.id,
      senderEmail:    myProfile.email,
      recipientId:    opponentId,
      body:           `[DUEL_INVITE_V1]${payload}`,
    });
  } catch (err) {
    // Non-critical to the duel itself (the duel row was already
    // created before this function fires). But the OPPONENT never
    // sees the challenge if the DM lookup or send fails — they get
    // no signal a duel exists. Was silent; now surface to Sentry so
    // we catch the failure pattern instead of users reporting "I
    // never saw the duel."
    reportError(err, {
      feature: 'duels.sendDuelDM',
      level: 'warning',
      duelId,
      opponentId,
    });
  }
}

// ── Errors ────────────────────────────────────────────────────────────────────

// Server error codes → the sentence a person reads. Every write goes through
// a SECURITY DEFINER RPC now (migration 20260927161000_duels_lockdown), and
// its RAISE messages are codes, so a raw `err.message` in a toast would read
// "workout_outside_duel_window".
const DUEL_ERRORS = {
  guest_account:              ['duels.error.guest', 'Connect an account to duel. Guest accounts cannot compete.'],
  opponent_unavailable:       ['duels.error.unavailable', 'You cannot challenge this person.'],
  duel_already_open:          ['duels.error.alreadyOpen', 'You already have a duel with this person.'],
  too_many_duels:             ['duels.error.tooMany', 'You have sent 10 challenges today. Try again tomorrow.'],
  mirror_needs_workout:       ['duels.error.mirrorNeedsWorkout', 'Log a workout first. A Mirror duel copies your last session.'],
  duel_not_pending:           ['duels.error.notPending', 'This duel has already been answered.'],
  duel_expired:               ['duels.error.expired', 'This duel has expired.'],
  duel_not_active:            ['duels.error.notActive', 'This duel has not been accepted yet.'],
  result_already_submitted:   ['duels.error.alreadySubmitted', 'You already submitted a workout for this duel.'],
  workout_outside_duel_window:['duels.error.outsideWindow', 'Log a workout after the duel started, then submit it.'],
  implausible_workout_log:    ['duels.error.implausible', 'That workout cannot be used for a duel.'],
  opponent_no_session:        ['duels.error.noSession', 'They have no workout to beat yet.'],
};

export function duelErrorCode(err) {
  const msg = String(err?.message || '');
  return Object.keys(DUEL_ERRORS).find((code) => msg.includes(code)) || null;
}

export function duelErrorMessage(err, tFallback) {
  const code = duelErrorCode(err);
  if (code) return tFallback(...DUEL_ERRORS[code]);
  return tFallback('duels.error.generic', 'Something went wrong. Try again.');
}

// ── Writes ────────────────────────────────────────────────────────────────────
// Clients can only READ the duels table. Each write below is one RPC that
// derives the caller from auth.uid(); the server also sends the push.

/**
 * Challenge someone. Only 'open' and 'mirror' are playable: an Exercise duel
 * never had an exercise to compete on. A Mirror duel copies the challenger's
 * latest workout server-side.
 */
export async function createDuel({ opponentId, type = 'open', windowHours = 24 }) {
  if (!opponentId) throw new Error('opponent_required');
  const { data, error } = await supabase.rpc('create_duel', {
    p_opponent_id:  opponentId,
    p_type:         type,
    p_window_hours: windowHours,
  });
  if (error) throw error;
  return data;
}

/** Fetch the current user's duels, newest first, with both usernames. */
export async function listMyDuels() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('duels')
    .select('*')
    .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data?.length) return data ?? [];

  // Collect unique user IDs to look up
  const ids = [...new Set(data.flatMap(d => [d.challenger_id, d.opponent_id]).filter(Boolean))];
  const { data: profiles } = await selectProfiles((from) => from
    .select('id, username, avatar_url')
    .in('id', ids));

  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));

  return data.map(d => ({
    ...d,
    challenger_username: profileMap[d.challenger_id]?.username ?? null,
    opponent_username:   profileMap[d.opponent_id]?.username   ?? null,
    challenger_avatar:   profileMap[d.challenger_id]?.avatar_url ?? null,
    opponent_avatar:     profileMap[d.opponent_id]?.avatar_url   ?? null,
  }));
}

/** Get a single duel by id */
export async function getDuel(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('duels')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return error ? null : data;
}

/** Opponent accepts. The duel's window starts now, not when it was sent. */
export async function acceptDuel(id) {
  const { data, error } = await supabase.rpc('respond_to_duel', { p_duel_id: id, p_accept: true });
  if (error) throw error;
  return data;
}

/** Opponent declines a pending duel. */
export async function declineDuel(id) {
  const { data, error } = await supabase.rpc('respond_to_duel', { p_duel_id: id, p_accept: false });
  if (error) throw error;
  return data;
}

/** Challenger withdraws a duel nobody has answered yet. */
export async function cancelDuel(id) {
  const { data, error } = await supabase.rpc('cancel_duel', { p_duel_id: id });
  if (error) throw error;
  return data;
}

/**
 * Take on someone's latest workout. Starts at once, no acceptance: their side
 * is that session, and your best workout in the window has to beat it. The
 * server refuses a private profile you do not follow and anyone with no
 * session to copy (opponent_no_session).
 */
export async function createSessionDuel({ opponentId, windowHours = 48 }) {
  if (!opponentId) throw new Error('opponent_required');
  const { data, error } = await supabase.rpc('create_session_duel', {
    p_opponent_id:  opponentId,
    p_window_hours: windowHours,
  });
  if (error) throw error;
  return data;
}

// There is no submit call any more: a trigger on workout_logs scores each
// side from its best session in the window (20260927184500).

/** The live duel (if any) for the current user, shown as a workout banner. */
export async function getActiveDuel() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const nowISO = new Date().toISOString();
  const { data, error } = await supabase
    .from('duels')
    .select('*')
    .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .in('status', ['pending', 'active'])
    .gt('expires_at', nowISO)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return error ? null : data;
}
