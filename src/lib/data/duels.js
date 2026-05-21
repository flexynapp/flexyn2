// src/lib/data/duels.js
// Workout Duels — challenge, accept, submit results, score.

import { supabase } from '@/api/supabaseClient';
import { findOrCreateConversation, sendMessage } from '@/lib/data/hubMessages';

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
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, username, avatar_url, current_level')
    .in('id', ids);

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

    // Fetch opponent's email
    const { data: opProfile } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('id', opponentId)
      .single();

    if (!myProfile?.email || !opProfile?.email) return;

    const conv = await findOrCreateConversation(myProfile.email, opProfile.email);
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
      recipientEmail: opProfile.email,
      body:           `[DUEL_INVITE_V1]${payload}`,
    });
  } catch {
    // non-critical — duel was still created successfully
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Total volume (lbs) from a workout exercises array */
export function calcDuelVolume(exercises = []) {
  let v = 0;
  for (const ex of exercises) {
    for (const s of ex.sets || []) {
      v += (Number(s.weight) || 0) * (Number(s.reps) || 0);
    }
  }
  return v;
}

/** Mirror duel score: completion % (0-1) weighted with volume ratio */
export function scoreMirrorDuel(result, template) {
  const templateExercises = template?.exercises || [];
  const prescribed = templateExercises.reduce((a, ex) => a + (ex.sets?.length || 0), 0);
  if (!prescribed) return 0;
  const completed = (result?.sets_completed || 0);
  const completionPct = Math.min(completed / prescribed, 1);
  const prescribedVolume = calcDuelVolume(templateExercises);
  const volumeRatio = prescribedVolume > 0
    ? Math.min((result?.volume || 0) / prescribedVolume, 1.5)
    : 1;
  return Math.round((completionPct * 0.6 + (volumeRatio / 1.5) * 0.4) * 1000); // 0-1000
}

/** Determine winner from completed duel row */
export function resolveDuelWinner(duel) {
  const { type, challenger_result, opponent_result, challenger_id, opponent_id, session_template } = duel;
  if (!challenger_result || !opponent_result) return null;

  let cScore, oScore;
  if (type === 'mirror') {
    cScore = scoreMirrorDuel(challenger_result, session_template);
    oScore = scoreMirrorDuel(opponent_result, session_template);
  } else if (type === 'open') {
    cScore = challenger_result.volume || 0;
    oScore = opponent_result.volume || 0;
  } else {
    // exercise duel: reps at prescribed weight, or max weight
    cScore = challenger_result.reps || challenger_result.weight || 0;
    oScore = opponent_result.reps || opponent_result.weight || 0;
  }

  if (cScore === oScore) return null;            // tie
  return cScore > oScore ? challenger_id : opponent_id;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Create a new duel challenge.
 * @param {object} opts
 * @param {string} opts.opponentId
 * @param {'mirror'|'open'|'exercise'} opts.type
 * @param {object|null} opts.sessionTemplate   mirror duel exercise list
 * @param {string|null} opts.targetExerciseId  exercise duel focus
 * @param {number}      opts.windowHours       default 24
 */
export async function createDuel({ opponentId, type = 'open', sessionTemplate = null, targetExerciseId = null, windowHours = 24 }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const expiresAt = new Date(Date.now() + windowHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('duels')
    .insert({
      challenger_id:      user.id,
      opponent_id:        opponentId,
      type,
      status:             'pending',
      session_template:   sessionTemplate,
      target_exercise_id: targetExerciseId,
      window_hours:       windowHours,
      expires_at:         expiresAt,
    })
    .select()
    .single();

  if (error) throw error;

  // Fan out a notification to the opponent — server-side i18n via
  // notify_duel_invite_for (migration 065). The 034 trigger turns
  // this into a Web Push if the opponent has subscribed and hasn't
  // muted 'duels' in their notification_prefs. Pre-migration hosts
  // (RPC missing) silently no-op so duel creation still succeeds.
  try {
    await supabase.rpc('notify_duel_invite_for', {
      p_opponent_id: opponentId,
      p_duel_id:     data.id,
      p_duel_type:   type,
    });
  } catch (e) {
    // Non-fatal — the duel itself was created. Log but don't throw.
    if (e?.code !== '42883' && e?.code !== '42P01') {
      console.warn('[duels] notify_duel_invite_for failed:', e?.message || e);
    }
  }

  return data;
}

/** Fetch all duels (pending + active + recent completed) for the current user */
export async function listMyDuels() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('duels')
    .select('*')
    .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .in('status', ['pending', 'active', 'completed'])
    .order('created_at', { ascending: false })
    .limit(50);

  return error ? [] : (data ?? []);
}

/** Get a single duel by id */
export async function getDuel(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('duels')
    .select('*')
    .eq('id', id)
    .single();
  return error ? null : data;
}

/** Opponent accepts a duel */
export async function acceptDuel(id) {
  const { data, error } = await supabase
    .from('duels')
    .update({ status: 'active' })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Opponent declines a duel */
export async function declineDuel(id) {
  const { data, error } = await supabase
    .from('duels')
    .update({ status: 'declined' })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Submit a result for the current user on a duel.
 * Auto-resolves winner if both results are in.
 * @param {string} duelId
 * @param {object} result  { volume, sets_completed, sets_prescribed, reps, weight }
 * @param {object} duel    current duel row (to check other result)
 */
export async function submitDuelResult(duelId, result, duel) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const isChallenger = duel.challenger_id === user.id;
  const resultField  = isChallenger ? 'challenger_result' : 'opponent_result';
  const otherResult  = isChallenger ? duel.opponent_result : duel.challenger_result;

  const updates = { [resultField]: result };

  // If the other party already submitted, resolve the winner
  if (otherResult) {
    const updatedDuel = { ...duel, [resultField]: result };
    const winnerId = resolveDuelWinner(updatedDuel);
    updates.status    = 'completed';
    updates.winner_id = winnerId;
  }

  const { data, error } = await supabase
    .from('duels')
    .update(updates)
    .eq('id', duelId)
    .select()
    .single();

  if (error) throw error;

  // If this submission resolved the duel, notify the OTHER participant
  // with the result from THEIR perspective. We only notify the opposite
  // party — the submitter knows the outcome from their own UI without
  // a separate push. The RPC validates auth.uid() is one of the
  // participants and 034's trigger handles push fan-out.
  if (data?.status === 'completed') {
    try {
      const recipientId = isChallenger ? data.opponent_id : data.challenger_id;
      let outcome;
      if (data.winner_id == null)               outcome = 'tied';
      else if (data.winner_id === recipientId)  outcome = 'won';
      else                                      outcome = 'lost';

      await supabase.rpc('notify_duel_result_for', {
        p_recipient_id: recipientId,
        p_duel_id:      data.id,
        p_outcome:      outcome,
      });
    } catch (e) {
      if (e?.code !== '42883' && e?.code !== '42P01') {
        console.warn('[duels] notify_duel_result_for failed:', e?.message || e);
      }
    }
  }

  return data;
}

/** Get active duel (if any) for the current user — shown as workout banner */
export async function getActiveDuel() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('duels')
    .select('*')
    .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return error ? null : data;
}

/** Mark a completed duel result card as seen (no-op on pending) */
export async function dismissDuelResult(id) {
  const { error } = await supabase
    .from('duels')
    .update({ hub_posted: true })
    .eq('id', id)
    .in('status', ['completed']);
  if (error) console.warn('dismissDuelResult', error.message);
}
