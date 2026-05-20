// src/lib/data/capsules.js
// Capsule data-access layer — backed by Supabase user_capsules + user_profiles.

import { supabase } from '@/api/supabaseClient';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Insert a single capsule row. */
async function _grantCapsule(userId, userEmail, capsuleType) {
  const { error } = await supabase
    .from('user_capsules')
    .insert({ user_id: userId, user_email: userEmail, capsule_type: capsuleType });
  if (error) throw error;
}

/** Add flex_coins delta to the user's profile.
 *
 * Atomic path uses `increment_flex_coins` RPC (migration 030). Falls back
 * to non-atomic read-modify-write only when the RPC isn't available.
 * The previous comment said "to avoid race conditions" but the
 * implementation BELOW the comment was the racy version — that's now
 * actually fixed.
 */
async function _addFlexCoins(userId, amount) {
  if (!amount || amount <= 0) return;

  try {
    const { error } = await supabase.rpc('increment_flex_coins', { p_delta: amount });
    if (!error) return;
    if (error.code !== '42883' && error.code !== '42P01') {
      console.warn('[capsules] flex_coins RPC failed, falling back:', error);
    }
  } catch (err) {
    if (err?.code !== '42883' && err?.code !== '42P01') {
      console.warn('[capsules] flex_coins RPC threw, falling back:', err);
    }
  }

  // Legacy non-atomic fallback for pre-migration-030 hosts.
  const { data: profile, error: readErr } = await supabase
    .from('user_profiles')
    .select('flex_coins')
    .eq('id', userId)
    .maybeSingle();
  if (readErr) throw readErr;

  const current = profile?.flex_coins ?? 0;
  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ flex_coins: current + amount })
    .eq('id', userId);
  if (updateErr) throw updateErr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grant capsules and Flex Coins when a user levels up.
 *
 * Rules:
 *   - Every level: 1 standard capsule + 50 Flex Coins
 *   - Multiple of 5: +1 premium capsule + 100 bonus Flex Coins
 *   - Multiple of 10: +1 elite capsule (in addition to premium)
 */
export async function grantForLevelUp(userId, userEmail, newLevel) {
  if (!userId || !userEmail || !newLevel) return;

  const grants = [_grantCapsule(userId, userEmail, 'standard')];
  let coins = 50;

  if (newLevel % 5 === 0) {
    grants.push(_grantCapsule(userId, userEmail, 'premium'));
    coins += 100;
  }
  if (newLevel % 10 === 0) {
    grants.push(_grantCapsule(userId, userEmail, 'elite'));
  }

  grants.push(_addFlexCoins(userId, coins));

  await Promise.all(grants);
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

/**
 * Mark a capsule as opened. Idempotent — only fires the UPDATE when
 * is_opened is still false, so a second call from the same client (or
 * from a concurrent tab racing the open) returns null without changing
 * the row. Migration 028's `claim_capsule_loot` RPC already flips the
 * flag atomically; this function is kept for the legacy fallback path
 * where the RPC isn't available yet.
 *
 * Returns the updated row when this call did the flip, or null when the
 * capsule was already opened by another path.
 */
export async function openCapsule(capsuleId) {
  if (!capsuleId) return null;
  const { data, error } = await supabase
    .from('user_capsules')
    .update({ is_opened: true, opened_at: new Date().toISOString() })
    .eq('id', capsuleId)
    .eq('is_opened', false)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
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

  // Read the flag — if already true, we've granted before. Defensive:
  // missing column / missing row should be treated as "not yet."
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('first_workout_capsule_granted')
    .eq('id', userId)
    .maybeSingle();
  if (profile?.first_workout_capsule_granted === true) return false;

  await Promise.all([
    _grantCapsule(userId, userEmail, 'premium'),
    _addFlexCoins(userId, 75),
  ]);

  // Mark the flag so this never grants twice. Tolerates the column
  // being absent — db.js's updateMe equivalent isn't reachable from
  // here, so we just do a raw update and swallow 42703 / PGRST204.
  try {
    await supabase
      .from('user_profiles')
      .update({ first_workout_capsule_granted: true })
      .eq('id', userId);
  } catch (err) {
    if (err?.code !== '42703' && err?.code !== 'PGRST204') {
      console.warn('[capsules] first_workout flag write failed:', err);
    }
  }

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
  const existing = await countCapsules(userEmail);
  if (existing > 0) return false; // already has capsules — nothing to do
  await _grantCapsule(userId, userEmail, 'standard');
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
 * Idempotent: safe to call from multiple paths (the XP grant in _invokeXp
 * AND the backfill in leaderboardStats) without double-granting. Awarded
 * count is persisted on user_profiles.milestone_capsules_awarded.
 *
 * Emits a `flexyn:capsule-granted` window event per capsule so the UI can
 * surface a toast/notification without this function having any UI deps.
 *
 * @returns {Array<{type:string, threshold:number}>} milestones granted this call
 */
export async function grantForAchievementMilestone(userId, userEmail, unlockedCount) {
  if (!userId || !userEmail || !Number.isFinite(unlockedCount)) return [];

  // Read current awarded count from the source of truth (NOT the cached
  // profile — that can be stale by minutes during a streak of unlocks).
  const { data: profile, error: readErr } = await supabase
    .from('user_profiles')
    .select('milestone_capsules_awarded')
    .eq('id', userId)
    .maybeSingle();
  if (readErr) {
    console.warn('[capsules] milestone read failed:', readErr);
    return [];
  }
  const alreadyAwarded = Number(profile?.milestone_capsules_awarded) || 0;

  // Milestones the user has now passed (by index), minus what they've
  // already received. Slice preserves order so we grant low→high.
  const earnedIndices = ACHIEVEMENT_MILESTONES
    .map((m, i) => (unlockedCount >= m.threshold ? i : -1))
    .filter(i => i >= 0);
  const owedIndices = earnedIndices.slice(alreadyAwarded);
  if (owedIndices.length === 0) return [];

  const owed = owedIndices.map(i => ACHIEVEMENT_MILESTONES[i]);

  // Insert capsules one at a time so a partial failure still gives the
  // user whatever portion went through, and only bump the counter by the
  // number we actually inserted. Stop on first failure.
  let inserted = 0;
  for (const m of owed) {
    try {
      await _grantCapsule(userId, userEmail, m.type);
      inserted += 1;
    } catch (err) {
      console.warn('[capsules] milestone insert failed:', err);
      break;
    }
  }
  if (inserted === 0) return [];

  // Bump the awarded counter to match what actually got inserted.
  const { error: updErr } = await supabase
    .from('user_profiles')
    .update({ milestone_capsules_awarded: alreadyAwarded + inserted })
    .eq('id', userId);
  if (updErr) {
    console.warn('[capsules] milestone counter bump failed:', updErr);
    // Counter didn't move — next call will try to grant these again, which
    // would double-grant. Don't return granted list in that case so the
    // toast doesn't fire either.
    return [];
  }

  // Fire window events so UI can surface toasts without this module
  // depending on sonner/i18n.
  const granted = owed.slice(0, inserted);
  try {
    for (const m of granted) {
      window.dispatchEvent(new CustomEvent('flexyn:capsule-granted', {
        detail: { type: m.type, source: 'achievement_milestone', threshold: m.threshold },
      }));
    }
  } catch { /* SSR / non-browser */ }

  return granted;
}
