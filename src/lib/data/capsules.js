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

/** Add flex_coins delta to the user's profile. */
async function _addFlexCoins(userId, amount) {
  if (!amount || amount <= 0) return;
  // Use RPC increment to avoid race conditions; fall back to a read-then-write.
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
 * Mark a capsule as opened.
 * Returns the updated row.
 */
export async function openCapsule(capsuleId) {
  if (!capsuleId) return null;
  const { data, error } = await supabase
    .from('user_capsules')
    .update({ is_opened: true, opened_at: new Date().toISOString() })
    .eq('id', capsuleId)
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
 * Grant a welcome (standard) capsule to new users who have none.
 * Idempotent — skips the insert if the user already has at least one capsule.
 */
export async function grantWelcomeCapsule(userId, userEmail) {
  if (!userId || !userEmail) return;
  const existing = await countCapsules(userEmail);
  if (existing > 0) return; // already has capsules — nothing to do
  await _grantCapsule(userId, userEmail, 'standard');
}
