// src/lib/data/hubLiveSessions.js
// Live workout session management.
// Session discovery is server-backed (hub_live_sessions table).
// Real-time exercise updates use Supabase Realtime channels
// (`live-session-${id}`) so viewers see instant progress without polling.

import { supabase } from '@/api/supabaseClient';

// A row is only LIVE if it also started recently.
//
// `is_active` alone cannot be trusted, because only the client ever clears it
// and the client is not always there to do so: closing the tab, killing the
// PWA, a crash, or losing the network on the train all leave `is_active = true`
// with nobody left to end the session. Nothing on the server expires it.
//
// The result was a card reading "LIVE NOW" on every user's feed forever. The
// host could not even see it to end it — HubFeed filters the viewer's own
// session out of the rail, so the one person able to act on it is the one
// person who never sees it.
//
// Four hours is past any plausible workout and short enough that a stuck row
// clears the same day. This is the load-bearing half of the fix: the
// broadcaster now ends its session on the way out, but a client that was
// force-quit never runs any code at all, so the read has to be self-defending.
const LIVE_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const liveSince = () => new Date(Date.now() - LIVE_MAX_AGE_MS).toISOString();

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
    .gt('started_at', liveSince())
    .order('started_at', { ascending: false })
    .limit(20);
  return data || [];
};

/**
 * Returns the caller's own active session if one exists, else null.
 *
 * Same freshness rule as the rail, plus an explicit newest-first limit: a host
 * who was force-quit twice has more than one `is_active` row, and the bare
 * `.maybeSingle()` this used to end in throws PGRST116 on multiple rows rather
 * than returning either of them.
 *
 * No production caller today — the resume-your-session surface it was written
 * for does not exist yet. Kept in step with `listActiveSessions` so it does not
 * become a second, staler definition of "live" the day something calls it.
 */
export const getMyActiveSession = async (hostEmail) => {
  if (!hostEmail) return null;
  const { data } = await supabase
    .from('hub_live_sessions')
    .select('*')
    .eq('host_email', hostEmail)
    .eq('is_active', true)
    .gt('started_at', liveSince())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
};

/** Increment viewer_count by 1 (best-effort, no throw). */
export const joinSession = async (sessionId) => {
  await supabase.rpc('increment_live_viewers', { p_session_id: sessionId }).catch(() => {});
};
