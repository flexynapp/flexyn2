// src/lib/data/gymRival.js
// Gym Rival System — auto-assigned rival around the user's level.
//
// DB names (see migration 221): table public.gym_rival_assignments,
// column rival_id, RPCs notify_gym_rival_*. Two things are intentionally
// still named nemesis_* and MUST stay that way here to match the schema:
//   • user_profiles.nemesis_opt_out (kept — the public_profiles view
//     exposes it; renaming would force a view recreation)
//   • notification type strings 'nemesis_assigned' / 'nemesis_overthrown'
//     (kept — category-mapped + on historical rows; users only see text)

import { supabase } from '@/api/supabaseClient';
import { selectProfiles } from '@/lib/data/users';

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Get the user's current match — the latest row where they're either side
 * (initiator or rival) that is pending / active / recently void. The
 * caller decides how to treat a 'void' (a void from a past week means the
 * user is free to roll again; see weekStart checks in the UI).
 */
export async function getMyGymRival() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('gym_rival_assignments')
    .select('*')
    .or(`user_id.eq.${user.id},rival_id.eq.${user.id}`)
    .in('status', ['pending', 'active', 'void'])
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return error ? null : data;
}

/**
 * Roll a new weekly match server-side. Excludes users inactive >7 days or
 * already matched, creates a PENDING row (both sides must confirm), and
 * notifies the rival. Returns the new row, or null if no rival is
 * available right now.
 */
export async function rollGymRival() {
  const { data, error } = await supabase.rpc('gym_rival_roll');
  if (error) throw error;
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

/** Confirm the caller's participation in a pending match. */
export async function confirmGymRival(assignmentId) {
  const { data, error } = await supabase.rpc('gym_rival_confirm', { p_assignment_id: assignmentId });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

/**
 * Lazily void a stale (AFK) match: if 48h have passed since acceptance and
 * either party logged no workout, the server voids it. Safe to call on
 * every menu open; a no-op when nothing is due.
 */
export async function voidStaleGymRival(assignmentId) {
  const { data, error } = await supabase.rpc('gym_rival_void_stale', { p_assignment_id: assignmentId });
  if (error) return null;
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

/** Get a rival's public profile (username, avatar, total_xp, current_level) */
export async function getRivalProfile(rivalId) {
  if (!rivalId) return null;
  // email is included so the card can deep-link to the person's Hub
  // profile (?profile=<id>) — the avatar / @handle area is tappable.
  const { data, error } = await selectProfiles((from) => from
    .select('id, username, avatar_url, current_level, total_xp, total_volume_lbs, workout_streak')
    .eq('id', rivalId)
    .single());
  return error ? null : data;
}

/**
 * Assign (or re-assign) a gym rival for the current user.
 * Queries for someone 10–20% higher XP, not opted out, not the user.
 */
export async function assignGymRival({ sendNotification = false } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Get the current user's XP
  const { data: me } = await supabase
    .from('user_profiles')
    .select('total_xp, current_level')
    .eq('id', user.id)
    .single();

  if (!me) return null;

  // Coalesce: a brand-new profile row can have total_xp = null before the
  // XP backfill, which would make every bound/sort below NaN and silently
  // kill the primary XP-proximity match (falling through to random).
  const myXp = Number(me.total_xp) || 0;
  const xpLow  = Math.floor(myXp * 1.10);
  const xpHigh = Math.floor(myXp * 1.20);

  // If the user has very low XP (brand new), widen the window so there's
  // always a candidate pool even on a small user base.
  const effectiveLow  = xpLow  < 50 ? 0    : xpLow;
  const effectiveHigh = xpHigh < 50 ? 5000 : xpHigh;

  // Candidates: not opted out, XP in range, not the current user.
  const { data: candidates } = await selectProfiles((from) => from
    .select('id, total_xp, username, avatar_url, current_level')
    .gte('total_xp', effectiveLow)
    .lte('total_xp', effectiveHigh)
    .eq('nemesis_opt_out', false)
    .neq('id', user.id)
    .limit(20));

  // If no XP-range candidates (thin user base / brand new user), fall back
  // to any random user so the card always shows someone during beta.
  let pool = candidates ?? [];
  if (!pool.length) {
    const { data: fallback } = await selectProfiles((from) => from
      .select('id, total_xp, username, avatar_url, current_level')
      .eq('nemesis_opt_out', false)
      .neq('id', user.id)
      .not('username', 'is', null)
      .limit(20));
    pool = fallback ?? [];
  }
  if (!pool.length) return null;

  // Pick the closest XP match (or random from fallback pool).
  pool.sort((a, b) => Math.abs((Number(a.total_xp) || 0) - myXp) - Math.abs((Number(b.total_xp) || 0) - myXp));
  const chosen = pool[Math.floor(Math.random() * Math.min(pool.length, 3))];

  // Archive the old active rival (if any)
  await supabase
    .from('gym_rival_assignments')
    .update({ status: 'reassigned' })
    .eq('user_id', user.id)
    .eq('status', 'active');

  // Insert the new one
  const { data, error } = await supabase
    .from('gym_rival_assignments')
    .insert({
      user_id:  user.id,
      rival_id: chosen.id,
      status:   'active',
    })
    .select()
    .single();

  if (error) return null;

  // Self-targeted in-app notification + push fanout via the server RPC
  // (renders in the recipient's language, looks up the rival's username
  // server-side). Falls back to a client-side English INSERT if the RPC
  // isn't deployed. Push fanout fires on any notifications INSERT.
  if (sendNotification) {
    try {
      const { error: rpcErr } = await supabase.rpc('notify_gym_rival_assigned_for', {
        p_rival_id: chosen.id,
      });
      if (rpcErr && (rpcErr.code === '42883' || rpcErr.code === '42P01')) {
        await supabase.from('notifications').insert({
          user_id:    user.id,
          user_email: user.email,
          type:       'nemesis_assigned',
          title:      `🎯 Meet your Gym Rival: ${chosen.username || 'a rival'}`,
          body:       'They\'re around your level. Out-train them this week to win.',
          icon:       '🎯',
          link_url:   '/dashboard',
          metadata:   { rival_id: chosen.id, rival_name: chosen.username },
        });
      } else if (rpcErr) {
        console.warn('[gymRival] notify_gym_rival_assigned_for failed:', rpcErr);
      }
    } catch (e) {
      console.warn('[gymRival] notification dispatch threw:', e?.message || e);
    }
  }

  return data;
}

/**
 * Get this week's comparison stats for user vs their rival.
 * Returns { user, rival } each with { volume, sessions }.
 */
export async function getWeeklyComparison(userId, rivalId) {
  if (!userId || !rivalId) return null;

  // ISO week (Monday start) — matches the league system's
  // startOfWeek(..., { weekStartsOn: 1 }) anchor in leagues.js.
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + diffToMonday);
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

  const [userStats, rivalStats] = await Promise.all([
    fetchStats(userId),
    fetchStats(rivalId),
  ]);

  return { user: userStats, rival: rivalStats };
}

// ── Net rating (weekly competition score) ──────────────────────────────────────
//
// Combines the three tracked dimensions into one comparable number so the
// two rivals can be ranked. Weights are chosen so a typical week's volume,
// workout count, and distance land in the same order of magnitude:
//   • volume (lbs lifted)  → ÷100      (e.g. 20,000 lbs → 200 pts)
//   • workouts (sessions)  → ×100      (e.g. 4 workouts → 400 pts)
//   • distance (km)        → ×20       (e.g. 15 km      → 300 pts)
// Higher net rating wins the week.
export function computeNetRating({ volume = 0, sessions = 0, distanceMeters = 0 } = {}) {
  const volumePts   = volume / 100;
  const sessionsPts = sessions * 100;
  const distancePts = (distanceMeters / 1000) * 20;
  return Math.round(volumePts + sessionsPts + distancePts);
}

/**
 * Full weekly stats for user vs rival: volume + sessions (workout_logs)
 * and distance (cardio_logs), plus each side's computed net rating.
 * Returns { user, rival } each { volume, sessions, distanceMeters, netRating }.
 *
 * NOTE: reads the rival's logs client-side (same pattern as
 * getWeeklyComparison). The authoritative weekly settlement in Phase 3
 * runs server-side (SECURITY DEFINER) so it isn't subject to per-row RLS.
 */
export async function getWeeklyRivalStats(userId, rivalId) {
  if (!userId || !rivalId) return null;

  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);
  const since = weekStart.toISOString();
  const sinceDate = since.slice(0, 10); // cardio_logs.date is a DATE

  const fetchStats = async (uid) => {
    const [{ data: logs }, { data: cardio }] = await Promise.all([
      supabase.from('workout_logs')
        .select('exercises, created_at')
        .eq('user_id', uid)
        .gte('created_at', since),
      supabase.from('cardio_logs')
        .select('distance_meters, date')
        .eq('user_id', uid)
        .gte('date', sinceDate),
    ]);

    const sessions = (logs ?? []).length;
    let volume = 0;
    for (const log of logs ?? []) {
      for (const ex of log.exercises || []) {
        for (const s of ex.sets || []) {
          volume += (Number(s.weight) || 0) * (Number(s.reps) || 0);
        }
      }
    }
    let distanceMeters = 0;
    for (const c of cardio ?? []) distanceMeters += Number(c.distance_meters) || 0;

    const stat = { volume, sessions, distanceMeters };
    return { ...stat, netRating: computeNetRating(stat) };
  };

  const [user, rival] = await Promise.all([fetchStats(userId), fetchStats(rivalId)]);
  return { user, rival };
}

/** Ms until the current ISO week (Mon-start) ends. */
export function msUntilWeekEnd(now = new Date()) {
  const day = now.getDay(); // 0=Sun..6=Sat
  const daysToSunEnd = day === 0 ? 0 : 7 - day;
  const end = new Date(now);
  end.setDate(now.getDate() + daysToSunEnd);
  end.setHours(23, 59, 59, 999);
  return end.getTime() - now.getTime();
}

/** Start of the ISO week (Monday 00:00) containing `date`. */
export function weekStartOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Ms until the NEXT ISO week starts (next Monday 00:00) — the reset point. */
export function msUntilNextWeekStart(now = new Date()) {
  const next = weekStartOf(now);
  next.setDate(next.getDate() + 7);
  return next.getTime() - now.getTime();
}

/** True if `date` falls in the same ISO week as now (i.e. still current). */
export function isThisWeek(date, now = new Date()) {
  if (!date) return false;
  return weekStartOf(date).getTime() === weekStartOf(now).getTime();
}

// ── Weekly-win reward scaling ───────────────────────────────────────────────────
//
// Base prize for winning the week, scaled up when you beat a HIGHER-level
// rival: +15% per level the rival is above you (never below the base).
export const GYM_RIVAL_REWARD_BASE = { xp: 5000, coins: 500, capsules: 5 };

export function computeRivalReward(userLevel = 1, rivalLevel = 1) {
  const levelGap = Math.max(0, (Number(rivalLevel) || 1) - (Number(userLevel) || 1));
  const mult = 1 + 0.15 * levelGap;
  return {
    multiplier: mult,
    levelGap,
    xp:       Math.round(GYM_RIVAL_REWARD_BASE.xp * mult),
    coins:    Math.round(GYM_RIVAL_REWARD_BASE.coins * mult),
    capsules: Math.round(GYM_RIVAL_REWARD_BASE.capsules * mult),
  };
}

/**
 * Check if the user has overtaken their rival this week.
 * Wins on 2 of 3: volume, sessions, XP. Returns true if so.
 */
export async function checkOverthrow(userId, rivalId) {
  const comparison = await getWeeklyComparison(userId, rivalId);
  if (!comparison) return false;

  const { user, rival } = comparison;
  let wins = 0;
  if (user.volume   > rival.volume)   wins++;
  if (user.sessions > rival.sessions) wins++;
  // XP comparison — cross-user so it goes through the public_profiles view.
  const { data: profiles } = await selectProfiles((from) => from
    .select('id, total_xp')
    .in('id', [userId, rivalId]));

  const userXp  = profiles?.find(p => p.id === userId)?.total_xp  || 0;
  const rivalXp = profiles?.find(p => p.id === rivalId)?.total_xp || 0;
  if (userXp > rivalXp) wins++;

  return wins >= 2;
}

/**
 * Perform an overthrow: archive current rival, bump overthrow_count,
 * and assign a new (higher-tier) rival.
 */
export async function performOverthrow(assignmentId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Order matters: status must flip to 'overthrown' BEFORE the
  // notification RPC fires (the RPC checks the row's status server-side).
  await supabase
    .from('gym_rival_assignments')
    .update({ status: 'overthrown', overthrown_at: new Date().toISOString() })
    .eq('id', assignmentId);

  // Atomic increment of the user's overthrow_count (server-side guards
  // against grinding). Pass the assignment id so the ownership + status
  // checks pass.
  await supabase.rpc('increment_overthrow_count', {
    p_user_id: user.id,
    p_assignment_id: assignmentId,
  }).catch((e) => {
    if (e?.code !== '42883' && e?.code !== '42P01') {
      console.warn('[gymRival] increment_overthrow_count failed:', e?.message || e);
    }
  });

  // Self-targeted celebration push (renders in the user's language,
  // looks up the dethroned user's name server-side). Fire-and-forget.
  try {
    const { error: rpcErr } = await supabase.rpc('notify_gym_rival_overthrown_for', {
      p_assignment_id: assignmentId,
    });
    if (rpcErr && (rpcErr.code === '42883' || rpcErr.code === '42P01')) {
      console.warn('[gymRival] notify_gym_rival_overthrown_for unavailable:', rpcErr.code);
    } else if (rpcErr) {
      console.warn('[gymRival] notify_gym_rival_overthrown_for failed:', rpcErr);
    }
  } catch (e) {
    console.warn('[gymRival] overthrow notification failed:', e?.message || e);
  }

  return assignGymRival({ sendNotification: true });
}

/** Update opt-out preference */
export async function setGymRivalOptOut(optOut) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('user_profiles')
    .update({ nemesis_opt_out: optOut })
    .eq('id', user.id);
}
