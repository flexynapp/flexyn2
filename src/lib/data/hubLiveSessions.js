// src/lib/data/hubLiveSessions.js
// Live workout session management.
// Session discovery is server-backed (hub_live_sessions table).
// Real-time exercise updates use Supabase Realtime channels
// (`live-session-${id}`) so viewers see instant progress without polling.

import { supabase } from '@/api/supabaseClient';

/** Create a new live session and return its id. */
export const startSession = async (hostEmail, title) => {
  const { data, error } = await supabase
    .from('hub_live_sessions')
    .insert({ host_email: hostEmail, title: title || 'Live Workout' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
};

/** Mark a session as ended. */
export const endSession = async (sessionId) => {
  const { error } = await supabase
    .from('hub_live_sessions')
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) throw error;
};

/**
 * Broadcast current exercise state (also persisted to DB so late-joining
 * viewers see the latest state without waiting for the next broadcast).
 */
export const updateActivity = async (sessionId, { currentExercise, currentSet, currentReps }) => {
  await supabase
    .from('hub_live_sessions')
    .update({
      current_exercise: currentExercise || null,
      current_set:      currentSet      || null,
      current_reps:     currentReps     || null,
    })
    .eq('id', sessionId);
};

/** List all currently active sessions (for the LiveSessionCard rail in feeds). */
export const listActiveSessions = async () => {
  const { data } = await supabase
    .from('hub_live_sessions')
    .select('*')
    .eq('is_active', true)
    .order('started_at', { ascending: false })
    .limit(20);
  return data || [];
};

/** Returns the caller's own active session if one exists, else null. */
export const getMyActiveSession = async (hostEmail) => {
  if (!hostEmail) return null;
  const { data } = await supabase
    .from('hub_live_sessions')
    .select('*')
    .eq('host_email', hostEmail)
    .eq('is_active', true)
    .maybeSingle();
  return data;
};

/** Increment viewer_count by 1 (best-effort, no throw). */
export const joinSession = async (sessionId) => {
  await supabase.rpc('increment_live_viewers', { p_session_id: sessionId }).catch(() => {});
};
