// src/lib/data/nemesis.js
// Nemesis System — auto-assigned rival slightly above the user's level.

import { supabase } from '@/api/supabaseClient';
import { selectProfiles } from '@/lib/data/users';

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
  // email is included so the Nemesis card can deep-link to the
  // person's Hub profile (?profile=<email>) — screenshot feedback
  // asked for the avatar / @handle area to be tappable to navigate.
  const { data, error } = await selectProfiles((from) => from
    .select('id, username, avatar_url, current_level, total_xp, total_volume_lbs, workout_streak')
    .eq('id', nemesisId)
    .single());
  return error ? null : data;
}

/**
 * Assign (or re-assign) a nemesis for the current user.
 * Queries for someone 10–20% higher XP, active in last 14 days,
 * not opted out, not already followed.
 */
export async function assignNemesis({ sendNotification = false } = {}) {
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
  // We intentionally omit a last_active_at filter — that column doesn't
  // exist on user_profiles yet. XP range is sufficient to narrow the pool.
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

  // Self-targeted in-app notification + push fanout. Migration 081 exposes
  // notify_nemesis_assigned_for(p_nemesis_id) which:
  //   • Renders title + body in the recipient's preferred_language
  //     across all 15 supported languages
  //   • Looks up the nemesis's username server-side (no client trust)
  //   • Inserts a row into public.notifications — the AFTER INSERT
  //     trigger from migrations 034/080 then fans out a Web Push via
  //     send-push automatically
  //
  // Pre-081 host fallback: if the RPC isn't deployed (42883 / 42P01)
  // we fall back to the previous client-side English INSERT so the
  // bell tray still gets a row. Push fanout still works in either
  // path — the trigger fires on any notifications INSERT.
  if (sendNotification) {
    try {
      const { error: rpcErr } = await supabase.rpc('notify_nemesis_assigned_for', {
        p_nemesis_id: chosen.id,
      });
      if (rpcErr && (rpcErr.code === '42883' || rpcErr.code === '42P01')) {
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
      } else if (rpcErr) {
        console.warn('[nemesis] notify_nemesis_assigned_for failed:', rpcErr);
      }
    } catch (e) {
      console.warn('[nemesis] notification dispatch threw:', e?.message || e);
    }
  }

  return data;
}

/**
 * Get this week's comparison stats for user vs their nemesis.
 * Returns { user, nemesis } each with { volume, sessions, xp }.
 */
export async function getWeeklyComparison(userId, nemesisId) {
  if (!userId || !nemesisId) return null;

  // ISO week (Monday start) — must match the league system's
  // startOfWeek(..., { weekStartsOn: 1 }) anchor in
  // src/lib/data/leagues.js. The previous Sunday-anchored math was
  // out of sync with leagues by 1 day, so on Mondays the nemesis
  // page showed stats from a different window than the league
  // standings the user was actually competing in. A user could
  // overtake their nemesis per leagues' Monday-Sunday window while
  // the nemesis page still showed them as behind for the old
  // Sunday-Saturday window.
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
  // XP comparison — includes the nemesis (cross-user) so it goes
  // through the public_profiles view.
  const { data: profiles } = await selectProfiles((from) => from
    .select('id, total_xp')
    .in('id', [userId, nemesisId]));

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

  // Order matters: status must flip to 'overthrown' BEFORE the
  // notification RPC fires, because the RPC checks the row's status
  // server-side and no-ops if it's still 'active' (defensive guard
  // against the celebration push landing prematurely).
  await supabase
    .from('nemesis_assignments')
    .update({ status: 'overthrown', overthrown_at: new Date().toISOString() })
    .eq('id', assignmentId);

  // Atomic increment of the user's overthrow_count. Mig 159 hardened
  // the RPC to require p_assignment_id (closing a self-attestation
  // grinding exploit where the client could call it in a loop). Pass
  // the assignment row id so the server-side check (assignment owned
  // by caller + status='overthrown' + not-yet-counted) passes. The
  // p_user_id param is now server-ignored but kept in the call for
  // backward compatibility with mig 112's signature. Mig 160's
  // fallback also accepts a NULL p_assignment_id and resolves the
  // user's most-recent-uncounted overthrow itself, so an in-flight
  // client deploy gap doesn't break overthrow counting.
  await supabase.rpc('increment_overthrow_count', {
    p_user_id: user.id,
    p_assignment_id: assignmentId,
  }).catch((e) => {
    if (e?.code !== '42883' && e?.code !== '42P01') {
      console.warn('[nemesis] increment_overthrow_count failed:', e?.message || e);
    }
  });

  // Self-targeted celebration push. Mig 111 RPC renders the title +
  // body in the user's preferred_language (15 supported) and looks
  // up the dethroned user's name server-side. Falls back to the
  // generic "your rival" when the dethroned username is missing.
  // The 034 trigger handles push fanout; the in-app row lands in
  // the bell tray either way. Fire-and-forget — the overthrow itself
  // is the canonical event, this is decoration.
  try {
    const { error: rpcErr } = await supabase.rpc('notify_nemesis_overthrown_for', {
      p_assignment_id: assignmentId,
    });
    if (rpcErr && (rpcErr.code === '42883' || rpcErr.code === '42P01')) {
      // Pre-111 host (RPC not deployed). Skip silently — the overthrow
      // itself still succeeded, only the celebration push is missing.
      console.warn('[nemesis] notify_nemesis_overthrown_for unavailable:', rpcErr.code);
    } else if (rpcErr) {
      console.warn('[nemesis] notify_nemesis_overthrown_for failed:', rpcErr);
    }
  } catch (e) {
    // Non-critical; in-app celebration still fires from the caller.
    console.warn('[nemesis] overthrow notification failed:', e?.message || e);
  }

  return assignNemesis({ sendNotification: true });
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
