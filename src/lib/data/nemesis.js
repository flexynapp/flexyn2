// src/lib/data/nemesis.js
// Nemesis System — auto-assigned rival slightly above the user's level.

import { supabase } from '@/api/supabaseClient';

// ── Queries ───────────────────────────────────────────────────────────────────

/** Get the current user's active nemesis assignment */
export async function getMyNemesis() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('nemesis_assignments')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  return error ? null : data;
}

/** Get a nemesis's public profile (username, avatar, total_xp, current_level) */
export async function getNemesisProfile(nemesisId) {
  if (!nemesisId) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, username, avatar_url, current_level, total_xp, total_volume_lbs, workout_streak')
    .eq('id', nemesisId)
    .single();
  return error ? null : data;
}

/**
 * Assign (or re-assign) a nemesis for the current user.
 * Queries for someone 10–20% higher XP, active in last 14 days,
 * not opted out, not already followed.
 */
export async function assignNemesis() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Get the current user's XP
  const { data: me } = await supabase
    .from('user_profiles')
    .select('total_xp, current_level')
    .eq('id', user.id)
    .single();

  if (!me) return null;

  const xpLow  = Math.floor(me.total_xp * 1.10);
  const xpHigh = Math.floor(me.total_xp * 1.20);
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Candidates: active, not opted out, XP in range
  const { data: candidates } = await supabase
    .from('user_profiles')
    .select('id, total_xp')
    .gte('total_xp', xpLow)
    .lte('total_xp', xpHigh)
    .eq('nemesis_opt_out', false)
    .neq('id', user.id)
    .gt('last_active_at', cutoff)   // needs last_active_at on user_profiles
    .limit(20);

  if (!candidates?.length) return null;

  // Exclude already-followed users
  const { data: follows } = await supabase
    .from('hub_follows')
    .select('followed_id')
    .eq('follower_id', user.id);

  const followedIds = new Set((follows ?? []).map(f => f.followed_id));
  const pool = candidates.filter(c => !followedIds.has(c.id));

  if (!pool.length) return null;

  // Pick the closest XP match
  pool.sort((a, b) => Math.abs(a.total_xp - me.total_xp) - Math.abs(b.total_xp - me.total_xp));
  const chosen = pool[0];

  // Archive the old active nemesis (if any)
  await supabase
    .from('nemesis_assignments')
    .update({ status: 'reassigned' })
    .eq('user_id', user.id)
    .eq('status', 'active');

  // Insert the new one
  const { data, error } = await supabase
    .from('nemesis_assignments')
    .insert({
      user_id:    user.id,
      nemesis_id: chosen.id,
      status:     'active',
    })
    .select()
    .single();

  return error ? null : data;
}

/**
 * Get this week's comparison stats for user vs their nemesis.
 * Returns { user, nemesis } each with { volume, sessions, xp }.
 */
export async function getWeeklyComparison(userId, nemesisId) {
  if (!userId || !nemesisId) return null;

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
  weekStart.setHours(0, 0, 0, 0);
  const since = weekStart.toISOString();

  const fetchStats = async (uid) => {
    const { data: logs } = await supabase
      .from('workout_logs')
      .select('exercises, created_at')
      .eq('user_id', uid)
      .gte('created_at', since);

    const sessions = (logs ?? []).length;
    let volume = 0;
    for (const log of logs ?? []) {
      for (const ex of log.exercises || []) {
        for (const s of ex.sets || []) {
          volume += (Number(s.weight) || 0) * (Number(s.reps) || 0);
        }
      }
    }
    return { sessions, volume };
  };

  const [userStats, nemesisStats] = await Promise.all([
    fetchStats(userId),
    fetchStats(nemesisId),
  ]);

  return { user: userStats, nemesis: nemesisStats };
}

/**
 * Check if the user has overtaken their nemesis this week.
 * Wins on 2 of 3: volume, sessions, XP.
 * Returns true if overthrow should trigger.
 */
export async function checkOverthrow(userId, nemesisId) {
  const comparison = await getWeeklyComparison(userId, nemesisId);
  if (!comparison) return false;

  const { user, nemesis } = comparison;
  let wins = 0;
  if (user.volume   > nemesis.volume)   wins++;
  if (user.sessions > nemesis.sessions) wins++;
  // XP comparison via user_profiles
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, total_xp')
    .in('id', [userId, nemesisId]);

  const userXp    = profiles?.find(p => p.id === userId)?.total_xp    || 0;
  const nemesisXp = profiles?.find(p => p.id === nemesisId)?.total_xp || 0;
  if (userXp > nemesisXp) wins++;

  return wins >= 2;
}

/**
 * Perform an overthrow: archive current nemesis, bump overthrow_count,
 * and assign a new (higher-tier) nemesis.
 */
export async function performOverthrow(assignmentId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('nemesis_assignments')
    .update({ status: 'overthrown', overthrown_at: new Date().toISOString() })
    .eq('id', assignmentId);

  await supabase
    .from('user_profiles')
    .update({ overthrow_count: supabase.rpc('coalesce_increment', { row_id: user.id, col: 'overthrow_count' }) })
    .eq('id', user.id);

  // Simpler: raw increment
  await supabase.rpc('increment_overthrow_count', { p_user_id: user.id }).catch(() => {
    // fallback if RPC not deployed yet — no-op
  });

  return assignNemesis();
}

/** Update opt-out preference */
export async function setNemesisOptOut(optOut) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('user_profiles')
    .update({ nemesis_opt_out: optOut })
    .eq('id', user.id);
}
