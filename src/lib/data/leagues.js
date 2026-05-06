// src/lib/data/leagues.js
//
// Weekly League data layer. Lazy lifecycle:
//
//   • On any XP-earning action, recordWeeklyXp(user, amount) is called.
//   • That function ensures the user is in a league for the current week
//     (creates a new league with capacity if none has room), then adds the
//     XP to their member row.
//   • On read (getMyLeague), if the active league's week_end has passed and
//     it isn't yet resolved, we run the rollover: rank members, promote
//     top N, demote bottom N, award rewards, set is_resolved=true, and the
//     user is auto-placed into a new league for the new week on next action.
//
// All times use the user's local week (Monday → Sunday). UTC week would be
// fine in theory, but UX-wise users expect "this week" to mean their week.

import { supabase } from '@/api/supabaseClient';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import {
  TIERS,
  MAX_LEAGUE_SIZE,
  getTier,
  resolveStanding,
} from '@/lib/leagueTiers';

/** ISO week boundaries: Mon 00:00:00 → Sun 23:59:59 in the local timezone. */
function currentWeekRange() {
  const now = new Date();
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  const sunday = endOfWeek(now, { weekStartsOn: 1 });
  return { start: monday, end: sunday };
}

const fmtDate = (d) => format(d, 'yyyy-MM-dd');

/**
 * Find a league with capacity for the user's tier and current week, or create
 * a new one. Returns the league row.
 */
async function _findOrCreateLeague(tier, weekStart, weekEnd) {
  // Try to grab the most recently-created open league at this tier+week with
  // room left.
  const { data: existing, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('tier', tier)
    .eq('week_start', fmtDate(weekStart))
    .eq('is_resolved', false)
    .lt('member_count', MAX_LEAGUE_SIZE)
    .order('created_at', { ascending: false })
    .limit(1);
  if (!error && existing && existing.length > 0) return existing[0];

  // Create one
  const { data: created, error: createErr } = await supabase
    .from('leagues')
    .insert({
      tier,
      week_start: fmtDate(weekStart),
      week_end:   fmtDate(weekEnd),
      member_count: 0,
      is_resolved:  false,
    })
    .select()
    .single();
  if (createErr) {
    console.warn('[leagues] failed to create league:', createErr);
    return null;
  }
  return created;
}

/**
 * Get (or create) the user's league for the current week. Returns:
 *   { league, member } — both rows. null if user is not authenticated.
 */
export async function ensureCurrentLeague(user) {
  if (!user?.id || !user?.email) return null;

  // Read the user's profile for their current tier
  const { data: profile, error: pErr } = await supabase
    .from('user_profiles')
    .select('league_tier')
    .eq('id', user.id)
    .maybeSingle();
  if (pErr) {
    console.warn('[leagues] failed to read profile:', pErr);
    return null;
  }
  const tier = profile?.league_tier || 'bronze';

  const { start, end } = currentWeekRange();

  // Is the user already in a league for this week?
  const { data: existingMembership } = await supabase
    .from('league_members')
    .select('*, leagues!inner(*)')
    .eq('user_id', user.id)
    .eq('leagues.week_start', fmtDate(start))
    .order('joined_at', { ascending: false })
    .limit(1);
  if (existingMembership && existingMembership.length > 0) {
    const member = existingMembership[0];
    const league = member.leagues;
    delete member.leagues;
    return { league, member };
  }

  // Find or create a league
  const league = await _findOrCreateLeague(tier, start, end);
  if (!league) return null;

  // Insert membership
  const { data: member, error: mErr } = await supabase
    .from('league_members')
    .insert({
      league_id:  league.id,
      user_id:    user.id,
      user_email: user.email,
      weekly_xp:  0,
    })
    .select()
    .single();
  if (mErr) {
    // Race: another tab inserted concurrently. Re-read.
    if (mErr.code === '23505') {
      const { data: refetch } = await supabase
        .from('league_members')
        .select('*')
        .eq('league_id', league.id)
        .eq('user_id', user.id)
        .maybeSingle();
      return refetch ? { league, member: refetch } : null;
    }
    console.warn('[leagues] insert membership failed:', mErr);
    return null;
  }

  // Bump member_count
  await supabase
    .from('leagues')
    .update({ member_count: (league.member_count || 0) + 1 })
    .eq('id', league.id);

  return { league, member };
}

/**
 * Add `amount` XP to the user's current-week league standing. No-ops if the
 * user can't be placed in a league (auth issue, etc).
 */
export async function recordWeeklyXp(user, amount) {
  if (!user?.id || !amount || amount <= 0) return;
  const ctx = await ensureCurrentLeague(user);
  if (!ctx) return;
  const newXp = (ctx.member.weekly_xp || 0) + amount;
  const { error } = await supabase
    .from('league_members')
    .update({ weekly_xp: newXp })
    .eq('id', ctx.member.id);
  if (error) console.warn('[leagues] recordWeeklyXp failed:', error);
}

/**
 * List all members of a league, ranked by weekly_xp desc.
 */
export async function listLeagueMembers(leagueId) {
  if (!leagueId) return [];
  const { data, error } = await supabase
    .from('league_members')
    .select('*')
    .eq('league_id', leagueId)
    .order('weekly_xp', { ascending: false });
  if (error) {
    console.warn('[leagues] listLeagueMembers failed:', error);
    return [];
  }
  return data ?? [];
}

/**
 * Get the user's current-week league with full member list, with the user's
 * row annotated. Returns:
 *   {
 *     league, member, members: [...], myRank, totalMembers,
 *     tier: TIERS[i],   // the tier config object for rendering
 *   }
 */
export async function getMyLeague(user) {
  const ctx = await ensureCurrentLeague(user);
  if (!ctx) return null;

  // If the league's week has ended and it's not resolved yet, resolve it now.
  // We then re-place the user into a new league for the current week.
  const weekEnd = new Date(ctx.league.week_end + 'T23:59:59');
  if (!ctx.league.is_resolved && weekEnd < new Date()) {
    await _resolveLeague(ctx.league.id);
    // Re-place into a fresh league
    return getMyLeague(user);
  }

  const members = await listLeagueMembers(ctx.league.id);
  const myRank = (members.findIndex(m => m.user_id === user.id) ?? -1) + 1;

  return {
    league: ctx.league,
    member: ctx.member,
    members,
    myRank: myRank > 0 ? myRank : null,
    totalMembers: members.length,
    tier: getTier(ctx.league.tier),
  };
}

/**
 * Resolve a finished league: rank members, apply promotions/demotions, award
 * rewards, mark as resolved. Idempotent — calling twice is harmless because
 * the second call sees is_resolved=true and bails.
 */
async function _resolveLeague(leagueId) {
  const { data: league } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .maybeSingle();
  if (!league || league.is_resolved) return;

  const members = await listLeagueMembers(leagueId);
  const total = members.length;

  // Apply rankings, then transitions in parallel
  await Promise.all(members.map(async (m, i) => {
    const rank = i + 1;
    const { outcome, newTier, coinsAwarded, capsuleAwarded } = resolveStanding(league.tier, rank, total);

    // Persist final rank on the membership row
    await supabase
      .from('league_members')
      .update({ rank })
      .eq('id', m.id);

    // Apply tier change + reward to the user's profile
    const updates = {};
    if (outcome === 'promote' || outcome === 'demote') {
      updates.league_tier = newTier;
    }

    if (coinsAwarded > 0) {
      // Read-modify-write — better than nothing without an RPC
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('flex_coins')
        .eq('id', m.user_id)
        .maybeSingle();
      updates.flex_coins = (prof?.flex_coins || 0) + coinsAwarded;
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('user_profiles').update(updates).eq('id', m.user_id);
    }

    if (capsuleAwarded) {
      await supabase.from('user_capsules').insert({
        user_id:     m.user_id,
        user_email:  m.user_email,
        capsule_type: capsuleAwarded,
      }).then(({ error }) => {
        if (error) console.warn('[leagues] capsule grant failed:', error);
      });
    }
  }));

  // Mark resolved
  await supabase
    .from('leagues')
    .update({ is_resolved: true })
    .eq('id', leagueId);
}

/**
 * The user's most recently-resolved league (last week). Used to show "you
 * promoted to Silver!" toasts on first open after rollover.
 */
export async function getLastResolvedLeague(user) {
  if (!user?.id) return null;
  const { data, error } = await supabase
    .from('league_members')
    .select('*, leagues!inner(*)')
    .eq('user_id', user.id)
    .eq('leagues.is_resolved', true)
    .order('joined_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const member = data[0];
  const league = member.leagues;
  delete member.leagues;
  return { league, member, tier: getTier(league.tier) };
}
