// src/lib/data/trophies.js
//
// Earned-trophies data layer. Two operations:
//   • listEarned(userIdOrEmail) — fetch any user's earned trophies
//     for display on their profile.
//   • grantEligible() — server-checks every catalog trophy's criteria
//     against the current user's stats and inserts any newly earned
//     ones. Returns the array of newly-granted IDs so the caller can
//     fire a celebration toast.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';

import { toast } from '@/lib/toast';
import { getTrophy, trophyName, trophyDescription } from '@/lib/trophyDefinitions';
import { requestOpenAchievements } from '@/lib/achievementsFlow';

export async function listEarned(userIdOrEmail, byEmail = false) {
  if (!userIdOrEmail) return [];
  try {
    // The whole chain is rebuilt per attempt rather than a pre-built `q`
    // being reused: safeSelect may call this more than once, and a
    // supabase query builder is single-use — replaying one would send
    // the second request with the first request's filters already
    // applied.
    const { data, error } = await safeSelect({
      columns: ['trophy_id', 'earned_at'],
      build: (cols) => supabase
        .from('user_trophies')
        .select(cols)
        .eq(byEmail ? 'user_email' : 'user_id', userIdOrEmail)
        .order('earned_at', { ascending: false }),
    });
    if (error) {
      if (error.code === '42P01') return []; // table missing, mig not applied
      return [];
    }
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Raw progress signals for the current user — the numerators behind every
 * ladder's progress bar. Keys match `signal` in LADDERS
 * (src/lib/trophyDefinitions.js); the RPC is migration 323.
 *
 * Takes no user argument on purpose: the RPC reads auth.uid() itself, so
 * there is no parameter to spoof. That means it can only ever answer for
 * the signed-in user — a foreign profile shows earned trophies, never
 * someone else's progress toward unearned ones.
 */
export async function getProgress() {
  try {
    const { data, error } = await supabase.rpc('get_trophy_progress');
    // 42883 = migration 323 not applied yet. An empty object degrades to
    // "0 / target" bars rather than blanking the page.
    if (error) return {};
    return (data && typeof data === 'object') ? data : {};
  } catch {
    return {};
  }
}

/**
 * Earned trophies in the shape the Hub composer's share picker speaks —
 * `{ id, achievement_id, name, description, icon, unlocked_date }`.
 *
 * This exists because the composer was still reading the RETIRED
 * `public.achievements` table through `@/lib/data/achievements`, and then
 * filtering it with `.filter(a => a.unlocked)`. That table holds one row
 * in all of production and has no `unlocked` column at all, so the
 * predicate was `undefined` on every row it could ever see and the
 * picker's Achievements section was empty for 100% of users, forever.
 * Nothing threw — the section simply never rendered, which is
 * indistinguishable from "this user has earned nothing".
 */
export async function listEarnedForShare(userId, tf) {
  const rows = await listEarned(userId);
  return rows
    .map((row) => {
      const trophy = getTrophy(row.trophy_id);
      if (!trophy) return null;
      return {
        id:             row.trophy_id,
        achievement_id: row.trophy_id,
        name:           trophyName(trophy, tf),
        description:    trophyDescription(trophy, tf),
        icon:           trophy.emoji,
        unlocked_date:  row.earned_at || null,
      };
    })
    .filter(Boolean);
}

export async function grantEligible() {
  try {
    const { data, error } = await supabase.rpc('grant_eligible_trophies');
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return { ok: false, error: 'rpc_missing' };
      return { ok: false, error: error.message };
    }
    const granted = (data && Array.isArray(data.newly_granted)) ? data.newly_granted : [];
    return { ok: true, newlyGranted: granted };
  } catch (err) {
    return { ok: false, error: err?.message || 'rpc_threw' };
  }
}

// Convenience: grant + celebrate. Use after workout save / streak update
// / level up.
//
// This used to fire one toast per trophy in a loop, which was fine while
// the catalog was 18 flat badges that unlocked one at a time. Migration
// 323 changed that: it grants RETROACTIVELY, so the first call after it
// ships hands an established user everything they have already earned —
// realistically 10–20 at once. Twenty stacked toasts is not a
// celebration, it is a wall the user has to wait out, and sonner would
// drop most of them anyway.
//
// So: one or two, toast them individually because each is its own
// moment. Three or more, collapse into a single summary that names the
// best one — tier order, then the first returned — and sends them to the
// vault to see the rest.
const TIER_RANK = { bronze: 1, silver: 2, gold: 3, platinum: 4, legendary: 5 };

export async function checkAndCelebrate(tf) {
  // No React context here, so the translator arrives as an argument and
  // every string keeps its English as the fallback. Called without one,
  // this behaves exactly as it did before.
  const tr = tf || ((_k, english) => english);
  const res = await grantEligible();
  if (!res.ok || !res.newlyGranted.length) return res;

  const trophies = res.newlyGranted.map(getTrophy).filter(Boolean);
  if (!trophies.length) return res;

  if (trophies.length <= 2) {
    for (const trophy of trophies) {
      toast.success(
        tr('trophies.toast.earned', '{emoji} Trophy earned: {name}', {
          emoji: trophy.emoji,
          name: trophyName(trophy, tr),
        }),
        {
          description: trophyDescription(trophy, tr),
          duration: 5000,
        },
      );
    }
    return res;
  }

  const best = trophies.reduce((a, b) =>
    (TIER_RANK[b.tier] || 0) > (TIER_RANK[a.tier] || 0) ? b : a);
  toast.success(
    tr('trophies.toast.earnedMany', '{emoji} {count} trophies earned', {
      emoji: best.emoji,
      count: trophies.length,
    }),
    {
      description: tr('trophies.toast.earnedManyDetail', '{name} and {count} more.', {
        name: trophyName(best, tr),
        count: trophies.length - 1,
      }),
      duration: 6000,
      action: {
        label: tr('trophies.toast.view', 'View'),
        onClick: () => { try { requestOpenAchievements(); } catch { /* no-op */ } },
      },
    },
  );
  return res;
}
