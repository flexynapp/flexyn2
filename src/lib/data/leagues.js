// src/lib/data/leagues.js
//
// Weekly League data layer. Lifecycle, as of migration 310:
//
//   • On any XP-earning action, recordWeeklyXp(user) is called. It ensures
//     the user is placed in this week's bracket, then asks the server to
//     RE-DERIVE their standing from the XP ledger.
//   • Rollover is owned by pg_cron (`roll-weekly-leagues`, Mondays 12:10
//     UTC, once Sunday has ended in every time zone). The client neither
//     triggers nor participates in it.
//
// ── Two things this module used to do, and must never do again ──────────────
//
// 1. IT USED TO TRIGGER RESOLUTION ON READ, and that path was dead code.
//    getMyLeague() carried `if (!league.is_resolved && weekEnd < new Date())`,
//    but migration 242 made ensure_my_league() always return a bracket for the
//    CURRENT week — whose week_end is always the coming Sunday. The branch was
//    unreachable from the day 242 landed, so no bracket ever resolved: verified
//    2026-08-08 against production, 8 leagues since May, `rank` non-null on
//    zero rows. Resolution is a cron's job because it must happen for brackets
//    nobody opens the app to look at.
//
// 2. IT USED TO TELL THE SERVER HOW MUCH XP TO ADD. increment_league_xp took a
//    client-supplied amount — clamped (2k/call, 150k/week) but still asserted
//    by the browser, and weekly_xp was an independent counter rather than a
//    projection of anything real. 75 calls bought 150,000 weekly XP with no
//    workout. sync_my_weekly_league() takes no amount and derives the standing
//    from SUM(xp_grant_log.amount) inside the bracket week, the same shape
//    migration 297 used for the monthly board. There is no number here for a
//    client to inflate.
//
// Week boundaries, capacity and tier are all decided server-side.

import { supabase } from '@/api/supabaseClient';
import {
  getTier,
  isQualified,
  leagueLevel,
  prizeCount,
  MIN_QUALIFIED_FOR_PRIZE,
} from '@/lib/leagueTiers';
import { reportError } from '@/lib/reportError';

// The local-week helpers (currentWeekRange / fmtDate) and the
// MAX_LEAGUE_SIZE / TIERS imports lived here to support the client-side
// find-or-create that migration 242 moved into the database. Week
// boundaries, capacity and tier are all decided server-side now, so
// nothing in this module computes them any more.

/**
 * Get (or create) the user's league for the current week. Returns:
 *   { league, member } — both rows. null if user is not authenticated.
 *
 * Runs entirely inside migration 242's `ensure_my_league` RPC.
 *
 * This used to do the find-or-create from the browser: SELECT an open
 * league, INSERT one if none had room, then INSERT the membership row.
 * The league INSERT returned 403 on every call and always had — `leagues`
 * grants `authenticated` SELECT only, and its RLS has a read policy and
 * no insert policy, so the write was blocked twice over. Both locks are
 * deliberate: a `leagues` row is a competition bracket, and placement
 * pays out through claim_league_resolution / distribute_league_rewards.
 * Letting the client mint brackets would let anyone create a private
 * league at any tier, sit in it alone and collect first place. So the
 * call site was the bug, not the missing grant.
 *
 * The RPC derives every trust-bearing input from the session: the user
 * from auth.uid(), the email from current_user_email() (mig 241, so
 * guest sessions work), the TIER from user_profiles, and the WEEK from
 * the database clock. None of those are parameters any more — a
 * client-passed tier would let anyone drop into Legend, and a
 * client-passed week would let anyone join a resolved bracket.
 *
 * Membership moved in too. `league_members` does grant INSERT under a
 * `user_id = auth.uid()` policy, but that only checks WHO is joining —
 * not which league_id they attach to or what weekly_xp they start with.
 */
export async function ensureCurrentLeague(user) {
  if (!user?.id) return null;

  const { data, error } = await supabase.rpc('ensure_my_league');
  if (error) {
    console.warn('[leagues] ensure_my_league failed:', error);
    return null;
  }
  if (!data?.league || !data?.member) return null;
  return { league: data.league, member: data.member };
}

/**
 * Re-derive the user's weekly AND monthly league standings from the XP ledger.
 *
 * `amount` is accepted and ignored. Callers pass what they just granted, and
 * keeping the parameter means the four call sites (Workout plus the three
 * cardio surfaces) did not have to change — but nothing is sent to the server.
 * The RPCs read `xp_grant_log` themselves, so the client cannot overstate a
 * standing even by accident. It is used only as a "was anything earned?" guard
 * so a zero-XP action doesn't cost two round trips.
 *
 * Ordering matters: xp_grant_log is written upstream by grant_action_xp
 * (migration 188) before this runs, so the SUM both RPCs derive already
 * includes the XP that triggered this call.
 */
export async function recordWeeklyXp(user, amount) {
  if (!user?.id || !amount || amount <= 0) return;
  const ctx = await ensureCurrentLeague(user);
  if (!ctx) return;

  try {
    const { error } = await supabase.rpc('sync_my_weekly_league');
    // 42883 / 42P01 — host predates migration 310. The weekly board simply
    // isn't syncing yet; not worth a Sentry event, and the monthly board
    // below is unaffected.
    if (error && error.code !== '42883' && error.code !== '42P01') {
      reportError(error, {
        feature: 'leagues.recordWeeklyXp.sync',
        level: 'warning',
        userEmail: user.email,
      });
    }
  } catch (err) {
    if (err?.code !== '42883' && err?.code !== '42P01') {
      reportError(err, {
        feature: 'leagues.recordWeeklyXp.sync-throw',
        level: 'warning',
        userEmail: user.email,
      });
    }
  }

  // Not awaited — a monthly-standing write must not delay the caller, and
  // syncMonthlyLeague swallows its own failures.
  syncMonthlyLeague(user);
}

/**
 * Place the user on this month's board and set their standing.
 *
 * Monthly leagues shipped with no reachable writer and stayed empty from the
 * day they were created — `record_monthly_xp` was revoked from
 * `authenticated` by migration 147 (it took an arbitrary p_user_id and
 * p_amount) and the revoke was never lifted after 147 also made the body
 * safe. Migration 297 replaced it with `sync_my_monthly_league`, and this is
 * the call site that finally makes the feature run.
 *
 * Deliberately takes no amount. The RPC derives the tier from the profile and
 * the standing from SUM(xp_grant_log) for the current UTC month, so there is
 * no number here for a client to inflate — re-granting the old RPC would have
 * reintroduced exactly that. It also SETs rather than increments, so calling
 * it twice on one action is harmless.
 *
 * Fire-and-forget on purpose: monthly standing is a leaderboard nicety, and
 * a failure here must never surface to someone who just finished a workout.
 * Errors go to Sentry, not the user.
 */
export async function syncMonthlyLeague(user) {
  if (!user?.id) return;
  try {
    const { error } = await supabase.rpc('sync_my_monthly_league');
    // 42883 / 42P01 — host predates migration 297. Not worth reporting; the
    // feature simply isn't there yet and the weekly board is unaffected.
    if (error && error.code !== '42883' && error.code !== '42P01') {
      reportError(error, {
        feature: 'leagues.syncMonthlyLeague',
        level: 'warning',
        userEmail: user.email,
      });
    }
  } catch (err) {
    if (err?.code !== '42883' && err?.code !== '42P01') {
      reportError(err, {
        feature: 'leagues.syncMonthlyLeague.throw',
        level: 'warning',
        userEmail: user.email,
      });
    }
  }
}

// Every column but user_email. Standings are read by every member of the
// bracket, and nothing renders an address; rows are keyed by user_id.
const MEMBER_COLUMNS = 'id, league_id, user_id, tier, weekly_xp, rank, joined_at, active_days, qualified, outcome, coins_awarded';

/**
 * List all members of a league, ranked by weekly_xp desc.
 */
export async function listLeagueMembers(leagueId) {
  if (!leagueId) return [];
  // Embed the profile so the standings UI can show @username instead of
  // leaking the email local-part. The original `select('*')` returned only
  // league_members columns (user_id + user_email + weekly_xp), forcing the
  // UI to fall back to the local-part and leaking corporate handles to
  // every other league member. (Audit 15 #H5.)
  //
  // Embed target is `public_profiles`, NOT `user_profiles`, and that is
  // load-bearing. RLS on user_profiles permits reading only your OWN row
  // (three policies, all auth.uid() = id), so embedding it returns
  // `user: null` for every other member — the board renders a list of blank
  // names. public_profiles is the SECURITY DEFINER view that exists exactly
  // for cross-user reads; it exposes a reviewed column subset and, since
  // migration 220, no email.
  //
  // This embed ALSO needs the FK added in migration 283
  // (league_members.user_id -> user_profiles.id). PostgREST infers a view's
  // relationships through its base table, and the only FK on this column
  // before 283 pointed at auth.users, which is not an exposed schema — so
  // there was no path to traverse and the query 400'd with PGRST200 on
  // every call, for every user, since the day it was written.
  //
  // Verified over real HTTP with a signed-in session: this returns real
  // usernames; the user_profiles form returns null on every row.
  const { data, error } = await supabase
    .from('league_members')
    .select(`
      ${MEMBER_COLUMNS},
      user:public_profiles ( username, avatar_url )
    `)
    .eq('league_id', leagueId)
    .order('weekly_xp', { ascending: false });
  if (error) {
    // Embed failure (older PostgREST cache or RLS): fall back to a
    // plain select so the standings still render.
    const { data: fallback } = await supabase
      .from('league_members')
      .select(MEMBER_COLUMNS)
      .eq('league_id', leagueId)
      .order('weekly_xp', { ascending: false });
    return fallback ?? [];
  }
  return (data ?? []).map(m => ({
    ...m,
    username:   m.user?.username   || null,
    avatar_url: m.user?.avatar_url || null,
  }));
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

  // Refresh my own standing before reading the board. Only workouts and cardio
  // call recordWeeklyXp, so points from meals, water, bounties and quests
  // would otherwise sit unseen until the next session. Best effort: the board
  // still renders on the last synced number.
  try {
    await supabase.rpc('sync_my_weekly_league');
  } catch { /* read the stored standing */ }

  // NOTE: there is deliberately no resolve-on-read here. Rollover belongs to
  // the `roll-weekly-leagues` cron (migration 310) because a bracket has to
  // settle whether or not anyone in it opens the app. The branch that used to
  // sit at this spot could never fire — see the module header.

  const tierId = ctx.league.tier;
  const tier = getTier(tierId);
  const raw = await listLeagueMembers(ctx.league.id);

  // Same order as the resolver: qualified first, then training days, then XP.
  // Days lead because the weekly race is about training, not about which XP
  // sources someone happened to farm.
  const members = raw
    .map(m => ({ ...m, isQualified: isQualified(tierId, m) }))
    .sort((a, b) => {
      if (a.isQualified !== b.isQualified) return a.isQualified ? -1 : 1;
      const days = (Number(b.active_days) || 0) - (Number(a.active_days) || 0);
      if (days !== 0) return days;
      return (b.weekly_xp || 0) - (a.weekly_xp || 0);
    })
    // Rank is a property of the qualified field only. Unqualified members
    // carry null so the UI renders "Unranked" instead of a losing position in
    // a contest they were not entered in.
    .map((m, i, arr) => ({
      ...m,
      rankInBracket: m.isQualified
        ? arr.slice(0, i + 1).filter(x => x.isQualified).length
        : null,
    }));

  const qualifiedCount = members.filter(m => m.isQualified).length;
  const me = members.find(m => m.user_id === user.id) || null;
  // Your league is your own tier. In a mixed bracket it can differ from the
  // bracket's, which only sets the size of the prize zone.
  const myTier = getTier(me?.tier || ctx.member?.tier || tierId);
  const level = await getMyLeagueLevel(user, myTier.id);

  return {
    league: ctx.league,
    member: ctx.member,
    members,
    myRank: me?.rankInBracket ?? null,
    myQualified: me?.isQualified ?? false,
    myActiveDays: Number(me?.active_days) || 0,
    totalMembers: members.length,
    qualifiedCount,
    prizeN: prizeCount(tierId, qualifiedCount),
    bracketTooSmall: qualifiedCount < MIN_QUALIFIED_FOR_PRIZE,
    mixedBracket: members.some(m => m.tier && m.tier !== tierId),
    tier: myTier,
    level,
  };
}

/**
 * Your level (1 to 4) inside the league you are in this week. See
 * leagueLevel() for the rule. Reads your last few resolved weeks, which RLS
 * already lets you see. Falls back to level 1 on any failure, because a
 * missing level is cosmetic and must never hide the league card.
 */
export async function getMyLeagueLevel(user, tierId) {
  if (!user?.id || !tierId) return 1;
  try {
    const { data, error } = await supabase
      .from('league_members')
      .select('tier, qualified, joined_at, leagues!inner(tier, week_start, is_resolved)')
      .eq('user_id', user.id)
      .eq('leagues.is_resolved', true)
      // joined_at falls inside its bracket's week, so it orders weeks the
      // same way getLastResolvedLeague does. week_start re-sorts below.
      .order('joined_at', { ascending: false })
      // A stint can hold unqualified weeks between the qualified ones, so
      // read a year of weeks, not just MAX_LEAGUE_LEVEL rows. Sixteen was
      // too few: a long quiet run in one league hid an older qualified week.
      .limit(52);
    if (error || !Array.isArray(data)) return 1;
    const history = data
      .map((r) => ({ tier: r.tier || r.leagues?.tier, qualified: r.qualified, week: r.leagues?.week_start || '' }))
      .sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0));
    return leagueLevel(tierId, history);
  } catch (err) {
    reportError(err, { feature: 'league.level' });
    return 1;
  }
}

/**
 * Your Strength Score and what it means for your league, from
 * `my_league_strength`. Read only: the server computes everything from your
 * own logged sets. Returns null on any failure (the league card then simply
 * leaves the strength line out).
 *
 *   { score, lifts: {squat, bench, deadlift, ohp}, sessions, estimated,
 *     reason: 'no_bodyweight' | 'no_lifts' | null, tier, placed,
 *     tier_floor, drop_below, next_tier, next_floor }
 */
export async function getMyStrength(user) {
  if (!user?.id) return null;
  try {
    const { data, error } = await supabase.rpc('my_league_strength');
    if (error) {
      if (error.code !== '42883') reportError(error, { feature: 'league.strength', level: 'warning' });
      return null;
    }
    return data ?? null;
  } catch (err) {
    reportError(err, { feature: 'league.strength' });
    return null;
  }
}

/**
 * The user's shield stock and current decay counter.
 *
 * Shields are paid (three per account for life) and there is no client grant
 * path — `grant_league_shield` is service_role-only, for a future
 * receipt-validating Edge Function. This read is all the client gets.
 */
export async function getMyShields(user) {
  if (!user?.id) return null;
  try {
    const { data, error } = await supabase.rpc('my_league_shields');
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

// _resolveLeague() lived here and is gone. It ran the entire rollover from
// the browser: claim_league_resolution, distribute_league_rewards, then a
// per-member notify fan-out. Two things were wrong with that, beyond its
// trigger being unreachable (see the module header):
//
//   • A bracket only settled if a member happened to open the app after the
//     week ended. Brackets full of lapsed users — exactly the ones that need
//     resolving — would never settle at all.
//   • It made every client a privileged actor. distribute_league_rewards had
//     to be EXECUTE-able by `authenticated` for this to work, which meant any
//     signed-in user could POST to it and settle a bracket early.
//
// Migration 310 moves all of it server-side behind `roll-weekly-leagues`,
// and revokes the resolver from every client role.

/**
 * The user's most recently-resolved league (last week). Used to show "you
 * promoted to Silver!" toasts on first open after rollover.
 */
export async function getLastResolvedLeague(user) {
  if (!user?.id) return null;
  const { data, error } = await supabase
    .from('league_members')
    .select(`${MEMBER_COLUMNS}, leagues!inner(*)`)
    .eq('user_id', user.id)
    .eq('leagues.is_resolved', true)
    .order('joined_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const member = data[0];
  const league = member.leagues;
  delete member.leagues;
  return { league, member, tier: getTier(member.tier || league.tier) };
}
