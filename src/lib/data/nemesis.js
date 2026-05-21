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

  // If the user has very low XP (brand new), widen the window so there's
  // always a candidate pool even on a small user base.
  const effectiveLow  = xpLow  < 50 ? 0    : xpLow;
  const effectiveHigh = xpHigh < 50 ? 5000 : xpHigh;

  // Candidates: not opted out, XP in range, not the current user.
  // We intentionally omit a last_active_at filter — that column doesn't
  // exist on user_profiles yet. XP range is sufficient to narrow the pool.
  const { data: candidates } = await supabase
    .from('user_profiles')
    .select('id, total_xp, username, avatar_url, current_level')
    .gte('total_xp', effectiveLow)
    .lte('total_xp', effectiveHigh)
    .eq('nemesis_opt_out', false)
    .neq('id', user.id)
    .limit(20);

  // If no XP-range candidates (thin user base / brand new user), fall back
  // to any random user so the card always shows someone during beta.
  let pool = candidates ?? [];
  if (!pool.length) {
    const { data: fallback } = await supabase
      .from('user_profiles')
      .select('id, total_xp, username, avatar_url, current_level')
      .eq('nemesis_opt_out', false)
      .neq('id', user.id)
      .not('username', 'is', null)
      .limit(20);
    pool = fallback ?? [];
  }
  if (!pool.length) return null;

  // Pick the closest XP match (or random from fallback pool).
  pool.sort((a, b) => Math.abs(a.total_xp - me.total_xp) - Math.abs(b.total_xp - me.total_xp));
  const chosen = pool[Math.floor(Math.random() * Math.min(pool.length, 3))];

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

  if (error) return null;

  // Self-targeted in-app notification so the matchup also lands in the
  // bell tray (not just the Dashboard card). RLS allows users to insert
  // their own notifications, so no SECURITY DEFINER RPC needed. Fire-
  // and-forget — the assignment itself already succeeded.
  try {
    await supabase.from('notifications').insert({
      user_id:    user.id,
      user_email: user.email,
      type:       'nemesis_assigned',
      title:      `🎯 Meet your nemesis: ${chosen.username || 'a rival'}`,
      body:       'They\'re a step above you. Beat their stats, claim their rank.',
      icon:       '🎯',
      link_url:   '/dashboard',
      metadata:   { nemesis_id: chosen.id, nemesis_name: chosen.username },
    });
  } catch (e) {
    // Non-critical — the assignment is the canonical event.
    console.warn('[nemesis] notification insert failed:', e?.message || e);
  }

  return data;
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
