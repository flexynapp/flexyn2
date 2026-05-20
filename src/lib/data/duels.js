// src/lib/data/duels.js
// Workout Duels — challenge, accept, submit results, score.

import { supabase } from '@/api/supabaseClient';

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
