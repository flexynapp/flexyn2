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
import { notifyLeagueResolution } from './notifications';

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

  // Insert membership. Migration 027 added a trigger that maintains
  // leagues.member_count automatically — the client no longer bumps it
  // (the old read-modify-write let two concurrent joins both increment
  // off the same baseline, exceeding MAX_LEAGUE_SIZE).
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

  return { league, member };
}

/**
 * Add `amount` XP to the user's current-week league standing. No-ops if the
 * user can't be placed in a league (auth issue, etc).
 *
 * Uses the atomic increment_league_xp RPC (migration 027) so concurrent
 * XP-earning events on the same user don't lose updates via the previous
 * read-modify-write pattern. Falls back to the legacy non-atomic path
 * only when the RPC isn't available (pre-migration).
 */
export async function recordWeeklyXp(user, amount) {
  if (!user?.id || !amount || amount <= 0) return;
  const ctx = await ensureCurrentLeague(user);
  if (!ctx) return;

  try {
    const { error } = await supabase.rpc('increment_league_xp', {
      p_league_member_id: ctx.member.id,
      p_amount: amount,
    });
    if (!error) return;
    if (error.code === '42883' || error.code === '42P01') {
      // RPC missing — fall through.
      console.warn('[leagues] xp RPC missing, falling back');
    } else {
      console.warn('[leagues] xp RPC failed:', error);
      return;
    }
  } catch (err) {
    if (err?.code !== '42883' && err?.code !== '42P01') {
      console.warn('[leagues] xp RPC threw:', err);
      return;
    }
  }

  // Legacy fallback — non-atomic.
  const newXp = (ctx.member.weekly_xp || 0) + amount;
  const { error } = await supabase
    .from('league_members')
    .update({ weekly_xp: newXp })
    .eq('id', ctx.member.id);
  if (error) console.warn('[leagues] recordWeeklyXp fallback failed:', error);
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
  // Look up the user's rank. findIndex returns -1 when not found, so guard
  // explicitly and return null in that case (UI uses null to render an em-dash).
  const idx = members.findIndex(m => m.user_id === user.id);
  const myRank = idx >= 0 ? idx + 1 : null;

  return {
    league: ctx.league,
    member: ctx.member,
    members,
    myRank,
    totalMembers: members.length,
    tier: getTier(ctx.league.tier),
  };
}

/**
 * Resolve a finished league: rank members, apply promotions/demotions, award
 * rewards, mark as resolved.
 *
 * Idempotency: uses the claim_league_resolution RPC (migration 027) which
 * atomically flips is_resolved=true and returns the league row ONLY if
 * this caller is the first to claim it. Subsequent callers see null and
 * bail without double-awarding coins/capsules. Pre-migration fallback
 * uses the old read-check-then-write which has a small race window where
 * two clients could both pass the guard.
 */
async function _resolveLeague(leagueId) {
  let league = null;

  // Atomic claim — only the FIRST caller proceeds.
  try {
    const { data, error } = await supabase.rpc('claim_league_resolution', {
      p_league_id: leagueId,
    });
    if (!error) {
      if (!data) return; // someone else claimed it — bail
      league = data;
    } else if (error.code === '42883' || error.code === '42P01') {
      console.warn('[leagues] claim RPC missing, falling back to non-atomic guard');
    } else {
      console.warn('[leagues] claim RPC failed:', error);
      return;
    }
  } catch (err) {
    if (err?.code !== '42883' && err?.code !== '42P01') {
      console.warn('[leagues] claim RPC threw:', err);
      return;
    }
  }

  if (!league) {
    // Legacy fallback — small race window remains but better than nothing.
    const { data: row } = await supabase
      .from('leagues')
      .select('*')
      .eq('id', leagueId)
      .maybeSingle();
    if (!row || row.is_resolved) return;
    league = row;
  }

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

    // In-app notification — only for noteworthy outcomes (promote/demote, or
    // a coin-paying hold like top 3 in legend). Skip silent middle-of-pack
    // holds to avoid notification spam.
    const noteworthy = outcome === 'promote' || outcome === 'demote' || coinsAwarded > 0;
    if (noteworthy) {
      const fromTier = getTier(league.tier).label;
      const toTier   = getTier(newTier).label;
      await notifyLeagueResolution({
        user: { id: m.user_id, email: m.user_email },
        outcome,
        fromTier,
        toTier,
        coinsAwarded,
        capsuleAwarded,
      });
    }
  }));

  // Mark resolved — the atomic claim above already flipped this for hosts
  // that have migration 027 applied. For pre-migration hosts we still need
  // to flip it explicitly here.
  if (!league.is_resolved) {
    await supabase
      .from('leagues')
      .update({ is_resolved: true })
      .eq('id', leagueId);
  }
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
