// src/lib/data/capsules.js
// Capsule data-access layer — backed by Supabase user_capsules + user_profiles.

import { supabase } from '@/api/supabaseClient';
import { patchProfile } from '@/api/profileCache';
import { safeSelect } from '@/api/safeSelect';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: there is deliberately no `_grantCapsule` helper here any more.
//
// `user_capsules` has no INSERT policy for `authenticated` — every capsule
// is created by a SECURITY DEFINER RPC (grant_level_up_rewards mig 070,
// grant_achievement_milestones, grant_streak_capsule, claim_daily_chest,
// claim_referral, and now grant_welcome_capsule / grant_first_workout_capsule
// from mig 277). The helper that used to live here did a bare
// `.from('user_capsules').insert(...)` and returned 42501 on every call, so
// the two grants built on it had never once landed. An INSERT policy that
// would have "fixed" it is the same policy that lets any client mint itself
// an elite capsule, so the fix was to move the grants server-side.
//
// If you need a new capsule grant, add an RPC — don't reintroduce a client
// insert here.

// `_addFlexCoins` used to live here. Its only caller was
// grantForFirstWorkout, which now credits coins inside
// grant_first_workout_capsule (mig 277) in the same transaction as the
// capsule — so a partial grant is no longer representable. Every other coin
// grant in this module already went through its own RPC.
//
// Its legacy branch also wrote flex_coins directly, which migrations 142/173
// reject with 42501 and migration 264's ledger trigger can clamp. Nothing in
// the client should be computing a coin balance; take the number the server
// returns.

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grant capsules and Flex Coins when a user levels up.
 *
 * Rules:
 *   - Levels 2+: 1 standard capsule + 50 Flex Coins per level
 *   - Multiple of 5: +1 premium capsule + 100 bonus Flex Coins
 *   - Multiple of 10: +1 elite capsule
 *
 * Level 1 is owned by grantWelcomeCapsule (fired on first device
 * baseline by LevelUpManager). A fresh user hitting level 2 thus
 * receives exactly: welcome (1 standard) + level-up (1 standard).
 * Pre-074 hosts double-granted on first level-up; the RPC now floors
 * the loop at level 2. (in addition to premium)
 *
 * Atomic + idempotent via the grant_level_up_rewards RPC (migration
 * 070). Returns the RPC payload so callers can read whether the grant
 * happened or was a no-op (already_granted=true). The previous
 * implementation was a Promise.all of independent inserts with NO
 * idempotency check — a profile refetch / two tabs / network retry
 * could fire grantForLevelUp twice and dupe capsules + coins.
 *
 * The RPC tracks the highest level paid via the new column
 * user_profiles.level_capsules_awarded_through. Even if the user
 * jumps multiple levels in one earn (rare but possible), the RPC
 * grants rewards for every intervening level — the old code only
 * ever processed the SINGLE level passed in.
 *
 * Throws if the RPC is missing (pre-070 host). Previously fell back
 * to the non-atomic path, which is the bug we just fixed — failing
 * loud is safer than silently re-enabling the race.
 */
export async function grantForLevelUp(userId, userEmail, newLevel) {
  if (!userId || !userEmail || !newLevel) return null;

  const { data, error } = await supabase.rpc('grant_level_up_rewards', {
    p_new_level: newLevel,
  });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') {
      // Pre-070 host. We deliberately don't fall back to the legacy
      // race-prone path; the caller surfaces this as a warn-and-skip.
      const e = new Error('grant_level_up_rewards RPC missing — apply migration 070');
      e.code = error.code;
      throw e;
    }
    throw error;
  }
  return data; // { already_granted, awarded_through, standard, premium, elite, coins, new_balance }
}

/**
 * Return all unopened capsules for a user, newest first.
 */
export async function listUnopenedCapsules(userEmail) {
  if (!userEmail) return [];
  const { data, error } = await supabase
    .from('user_capsules')
    .select('*')
    .eq('user_email', userEmail)
    .eq('is_opened', false)
    .order('earned_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// There is deliberately no client "mark opened" write here. The UPDATE that
// lived here had no callers, and it is the shape the user_capsules guard
// exists to refuse: a capsule is spent only by open_capsule_atomic (or the
// legacy claim_capsule_loot / finalize_capsule_claim pair), server side.

/**
 * Opened capsules with their rolled rarity, newest first — the input to
 * the pity/streak display on the opener.
 *
 * Reads through safeSelect because rolled_rarity / rolled_category /
 * rolled_variant arrive in migration 028; a pre-028 host would otherwise
 * 42703 the whole query and blank the opener rather than just hiding the
 * streak line. Returns [] on any read failure for the same reason — a
 * decorative stat must never be able to break capsule opening.
 */
export async function listOpenHistory(userEmail, limit = 200) {
  if (!userEmail) return [];
  try {
    const { data, error } = await safeSelect({
      columns: ['rolled_rarity', 'opened_at', 'earned_at', 'capsule_type'],
      build: (cols) => supabase
        .from('user_capsules')
        .select(cols)
        .eq('user_email', userEmail)
        .eq('is_opened', true)
        .order('opened_at', { ascending: false, nullsFirst: false })
        .limit(limit),
    });
    if (error) {
      console.warn('[capsules] listOpenHistory failed:', error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.warn('[capsules] listOpenHistory threw:', err);
    return [];
  }
}

/**
 * Where the user stands against the pity guarantees (migration 256).
 *
 * The THRESHOLDS come from the server too, not just the counters. The
 * rarity tables already live in two places — lootCatalog.js for the odds
 * panel and the SQL for the actual roll — and hardcoding "30" and "90" in
 * the UI as well would make a third copy that silently drifts. The odds
 * panel exists because loot-box disclosure is legally required in several
 * markets, so a UI that promises a guarantee the server doesn't honour is
 * worse than no UI at all.
 *
 * Returns null on pre-256 hosts so the panel simply hides.
 */
export async function getPity() {
  try {
    const { data, error } = await supabase.rpc('get_capsule_pity');
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Capsules whose loot was STRANDED: consumed by claim_capsule_loot (so
 * is_opened is true and the roll is recorded) but never finalized into an
 * inventory row.
 *
 * How a row gets here: the capsule is spent the instant the reel starts,
 * but the item only exists once finalize_capsule_claim runs on Claim.
 * Anything interrupting that window — a reload, navigating away, a crash,
 * a reveal that never completes — destroys the loot. Confirmed on a live
 * account: 5 of 21 opened capsules, including an epic and two rares.
 *
 * `graceMs` excludes capsules opened very recently, because an open that
 * is happening RIGHT NOW looks identical to a stranded one. Recovering it
 * would grant a different item than the reel is showing and then make the
 * user's own Claim fail with 'capsule already claimed'.
 */
export async function listStranded(userEmail, graceMs = 120_000) {
  if (!userEmail) return [];
  const cutoff = new Date(Date.now() - graceMs).toISOString();
  try {
    const { data, error } = await safeSelect({
      columns: ['id', 'capsule_type', 'rolled_rarity', 'rolled_category', 'rolled_variant', 'opened_at'],
      build: (cols) => supabase
        .from('user_capsules')
        .select(cols)
        .eq('user_email', userEmail)
        .eq('is_opened', true)
        .is('finalized_at', null)
        .not('rolled_rarity', 'is', null)
        .lt('opened_at', cutoff)
        .order('opened_at', { ascending: true }),
    });
    if (error) {
      // Pre-028 / pre-198 hosts lack rolled_* or finalized_at. Nothing to
      // recover there, and a decorative sweep must never break the bag.
      console.warn('[capsules] listStranded failed:', error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.warn('[capsules] listStranded threw:', err);
    return [];
  }
}

/**
 * Total capsule count (opened + unopened) for a user.
 */
export async function countCapsules(userEmail) {
  if (!userEmail) return 0;
  const { count, error } = await supabase
    .from('user_capsules')
    .select('id', { count: 'exact', head: true })
    .eq('user_email', userEmail);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Grant a premium capsule + bonus coins when the user logs their FIRST
 * workout ever. This is the day-1 reinforcement of the loot loop the
 * welcome capsule established on day-0 — without it, a user who opened
 * their welcome capsule and then trained has no second hit of the
 * reward loop until they level up (which could be days away).
 *
 * Premium tier (vs the standard welcome) signals a step up — "you
 * earned something better by actually showing up."
 *
 * Idempotent: looks for the boolean profile flag `first_workout_capsule_granted`.
 * The flag is also missing/false on legacy hosts where the column
 * doesn't exist — in that case the function still grants (so legacy
 * users get the new reward on their next first-workout-of-an-era) and
 * relies on the PGRST204 strip-and-retry in db.js to silently drop the
 * unknown column from the update payload.
 *
 * Returns `true` if a capsule was granted, `false` if skipped.
 */
export async function grantForFirstWorkout(userId, userEmail) {
  if (!userId || !userEmail) return false;

  // Atomic + idempotent via grant_first_workout_capsule (mig 277). The
  // capsule, the 75 coins and the idempotency flag now land in ONE
  // transaction, server-side.
  //
  // What this replaces: a read-the-flag / insert-capsule / add-coins /
  // write-the-flag sequence of four independent client calls. The capsule
  // insert in the middle of it returned 42501 on EVERY call — user_inventory
  // and user_capsules both lost their client INSERT policy in the economy
  // lockdown — so this reward had never once been granted. The caller in
  // Workout.jsx is fire-and-forget with a `.catch()`, so it failed silently.
  //
  // The old sequence was also non-atomic: a failure between the grant and the
  // flag write re-granted on the next call, indefinitely. That's now
  // impossible — the flag moves in the same transaction as the capsule.
  const { data, error } = await supabase.rpc('grant_first_workout_capsule');
  if (error) throw error;
  if (!data?.granted) return false;

  // Keep the cached profile in step so a re-read this session sees the flag.
  // flex_coins is deliberately NOT patched from a client-computed number —
  // but the RPC returns the post-credit balance the SERVER wrote, which is
  // exactly the case profileCache is safe to take (see CLAUDE.md).
  patchProfile({
    first_workout_capsule_granted: true,
    ...(typeof data.new_balance === 'number' ? { flex_coins: data.new_balance } : {}),
  });

  try {
    window.dispatchEvent(
      new CustomEvent('flexyn:capsule-granted', {
        detail: { type: 'premium', source: 'first_workout' },
      })
    );
  } catch { /* SSR / no window — non-fatal */ }

  return true;
}

/**
 * Grant a welcome (standard) capsule to new users who have none.
 * Idempotent — skips the insert if the user already has at least one capsule.
 *
 * Returns `true` if a capsule was actually granted, `false` if the
 * idempotency check skipped. Callers (LevelUpManager) use the return
 * value to decide whether to fire the celebration toast — we don't
 * want to surprise a returning user with a "you got a capsule!" message
 * when the grant was a no-op.
 */
export async function grantWelcomeCapsule(userId, userEmail) {
  if (!userId || !userEmail) return false;

  // Atomic + idempotent via grant_welcome_capsule (mig 277), which applies
  // the same rule the client used to — grant only when the user has no
  // capsules at all — but under a row lock, so two tabs opening at once
  // can't both pass the check. The client insert this replaces returned
  // 42501 on every call, so no user had ever actually received it.
  const { data, error } = await supabase.rpc('grant_welcome_capsule');
  if (error) throw error;
  if (!data?.granted) return false;
  // Dispatch the global capsule-granted event so LevelUpManager (or
  // anything else listening) can surface a toast / badge / celebration.
  // The 'welcome' source distinguishes this from achievement-milestone
  // and level-up grants so the toast copy can be tailored.
  try {
    window.dispatchEvent(
      new CustomEvent('flexyn:capsule-granted', {
        detail: { type: 'standard', source: 'welcome' },
      })
    );
  } catch { /* SSR / no window — non-fatal */ }
  return true;
}

// ─── Achievement-milestone capsules ──────────────────────────────────────────
//
// As users unlock achievements, they earn capsules at these thresholds.
// Tiered so high counts feel meaningful — the elite drop at 100 is a real
// flex. Idempotency is enforced by milestone_capsules_awarded on
// user_profiles (migration 022): the column counts how many milestones
// have already been granted, and grantForAchievementMilestone only inserts
// capsules whose milestone index is >= awarded count.

export const ACHIEVEMENT_MILESTONES = [
  { threshold: 5,   type: 'standard' },
  { threshold: 10,  type: 'standard' },
  { threshold: 25,  type: 'premium'  },
  { threshold: 50,  type: 'premium'  },
  { threshold: 100, type: 'elite'    },
];

/**
 * Compare a user's current unlocked-achievement count against the milestone
 * schedule and grant any capsules they're owed but haven't received.
 *
 * Atomic + idempotent via the grant_achievement_milestones RPC (migration
 * 071). The previous client-side implementation read milestone_capsules_
 * awarded, looped one-at-a-time inserts, then bumped the counter in a
 * separate statement — if the bump failed between the insert and the
 * update, the next call re-derived the same "owed" list and re-inserted
 * the same milestones. The RPC does insert + counter bump in one
 * transaction; either both happen or neither does.
 *
 * Emits a `flexyn:capsule-granted` window event per capsule so the UI can
 * surface a toast/notification without this function having any UI deps.
 *
 * @returns {Array<{type:string, threshold:number}>} milestones granted this call
 */
export async function grantForAchievementMilestone(userId, userEmail, unlockedCount) {
  if (!userId || !userEmail || !Number.isFinite(unlockedCount)) return [];

  const { data, error } = await supabase.rpc('grant_achievement_milestones', {
    p_unlocked_count: Math.max(0, Math.floor(unlockedCount)),
  });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') {
      // Pre-071 host. Fail closed (was: client-side read-then-write
      // path with the documented race window). Better to skip the
      // grant than silently re-enable the bug we just fixed.
      console.warn('[capsules] grant_achievement_milestones missing — apply migration 071');
      return [];
    }
    console.warn('[capsules] grant_achievement_milestones failed:', error);
    return [];
  }

  // RPC payload: { granted_count, granted: [{threshold, type}, ...], awarded_total }
  const granted = Array.isArray(data?.granted)
    ? data.granted.map(g => ({ type: g.type, threshold: g.threshold }))
    : [];

  // Fire window events so UI can surface toasts without this module
  // depending on sonner/i18n.
  try {
    for (const m of granted) {
      window.dispatchEvent(new CustomEvent('flexyn:capsule-granted', {
        detail: { type: m.type, source: 'achievement_milestone', threshold: m.threshold },
      }));
    }
  } catch { /* SSR / non-browser */ }

  return granted;
}
