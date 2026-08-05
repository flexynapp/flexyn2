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
import { getTier } from '@/lib/leagueTiers';
import { notifyLeagueResolution } from './notifications';
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
    if (!error) {
      // Monthly board rides along on the weekly write. This is the one place
      // the app already knows "XP was just earned", and all four callers
      // (Workout + the three cardio surfaces) route through here — wiring it
      // at the call sites instead would have been four edits that can drift.
      //
      // Ordering matters: xp_grant_log is written upstream by grant_action_xp
      // (mig 188) before this runs, so the SUM the RPC derives already
      // includes the XP that triggered this call.
      //
      // Not awaited — a monthly-standing write must not delay the caller, and
      // syncMonthlyLeague swallows its own failures.
      syncMonthlyLeague(user);
      return;
    }
    if (error.code === '42883' || error.code === '42P01') {
      // RPC missing — fall through to legacy path.
      console.warn('[leagues] xp RPC missing, falling back');
    } else {
      // Real RPC failure (RLS, network, etc). Previously silently
      // returned with only a console.warn; now also surface to Sentry
      // so we can see the failure pattern. User's weekly XP didn't
      // land but they got no UI signal — at least the operator sees it.
      reportError(error, {
        feature: 'leagues.recordWeeklyXp.rpc',
        level: 'warning',
        userEmail: user.email,
        amount,
      });
      return;
    }
  } catch (err) {
    if (err?.code !== '42883' && err?.code !== '42P01') {
      reportError(err, {
        feature: 'leagues.recordWeeklyXp.rpc-throw',
        level: 'warning',
        userEmail: user.email,
        amount,
      });
      return;
    }
  }

  // The legacy read-modify-write fallback that used to live here is gone.
  //
  // It did `UPDATE league_members SET weekly_xp = <read value + amount>`
  // straight from the browser, which required a permissive user-facing
  // UPDATE policy on the table. That policy constrained WHICH ROW you
  // could touch (your own) but not WHICH COLUMNS, so any signed-in user
  // could set their own weekly_xp to an arbitrary number and forge league
  // standings — and league placement pays out through
  // claim_league_resolution / distribute_league_rewards. Migration 245
  // drops the policy and adds an update guard, so this path could no
  // longer work anyway.
  //
  // Nothing is lost: it was only ever reached when increment_league_xp
  // was missing (42883 / 42P01), and that RPC is deployed. XP now has
  // exactly one writer, server-side and atomic.
  reportError(new Error('increment_league_xp unavailable; weekly XP not recorded'), {
    feature: 'leagues.recordWeeklyXp.rpc-missing',
    level: 'warning',
    userEmail: user.email,
    amount,
  });
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
      *,
      user:public_profiles ( username, avatar_url )
    `)
    .eq('league_id', leagueId)
    .order('weekly_xp', { ascending: false });
  if (error) {
    // Embed failure (older PostgREST cache or RLS): fall back to a
    // plain select so the standings still render.
    const { data: fallback } = await supabase
      .from('league_members')
      .select('*')
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

  // Run the entire reward distribution server-side via the atomic
  // SECURITY DEFINER RPC (migration 067). The audit caught that the
  // previous client-side fan-out silently no-op'd on every cross-user
  // user_profiles / league_members UPDATE because RLS scopes those
  // tables to auth.uid() = id / user_id. Only the resolver themselves
  // ever received their tier change / coins / capsule. Other members
  // got the notification but no payout.
  //
  // The RPC streams back (user_id, user_email, outcome, from_tier,
  // new_tier, coins_awarded, capsule) per member so we can still
  // dispatch language-aware notifications via
  // notify_league_resolution_for. Idempotent — second call sees
  // populated ranks and returns zero rows.
  let distributions = [];
  try {
    const { data, error } = await supabase.rpc('distribute_league_rewards', {
      p_league_id: leagueId,
    });
    if (error) {
      // 42883 / 42P01 = pre-migration host (067 not yet applied).
      // No fallback path: the previous client-side distribution silently
      // no-op'd on RLS for every non-resolver row anyway, so attempting
      // the same code path here would just confirm the same broken
      // behavior the RPC was built to replace. Bail loudly instead.
      if (error.code === '42883' || error.code === '42P01') {
        console.warn(
          '[leagues] distribute_league_rewards missing — apply migration 067 to enable league reward payouts.'
        );
        return;
      }
      console.warn('[leagues] distribute_league_rewards failed:', error);
      return;
    }
    distributions = data || [];
  } catch (err) {
    console.warn('[leagues] distribute_league_rewards threw:', err);
    return;
  }

  // Dispatch per-member notifications using the existing language-aware
  // RPC. Skip silent middle-of-pack holds (outcome=stay, no coins) to
  // avoid notification spam.
  await Promise.all(distributions.map(async (d) => {
    const noteworthy =
      d.outcome === 'promote' || d.outcome === 'demote' || d.coins_awarded > 0;
    if (!noteworthy) return;

    const fromTier = getTier(d.from_tier).label;
    const toTier   = getTier(d.new_tier).label;
    const { error: rpcError } = await supabase.rpc('notify_league_resolution_for', {
      p_user_id:   d.user_id,
      p_outcome:   d.outcome,
      p_from_tier: fromTier,
      p_to_tier:   toTier,
      p_coins:     d.coins_awarded || 0,
      p_capsule:   d.capsule || null,
    });
    if (rpcError && (rpcError.code === '42883' || rpcError.code === '42P01')) {
      // Pre-migration host — fall back to the legacy client-rendered
      // English text. Better than dropping the notification.
      await notifyLeagueResolution({
        user: { id: d.user_id, email: d.user_email },
        outcome: d.outcome,
        fromTier,
        toTier,
        coinsAwarded:  d.coins_awarded,
        capsuleAwarded: d.capsule,
      });
    } else if (rpcError) {
      console.warn('[leagues] notify_league_resolution_for failed:', rpcError);
    }
  }));
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
