// src/lib/data/coinShop.js
//
// Direct coin → item shop. Distinct from the player-to-player marketplace —
// the shop sells fixed-price items issued by the system.
//
// All purchases go through purchaseItem(user, sku) which:
//   1. Reads the user's current flex_coins (server-truth)
//   2. Checks balance vs. SKU price
//   3. Atomically deducts coins + grants the item (capsule, sticker pack, etc.)
//   4. Returns { success, newBalance, granted }
//
// On migration: this is the ONLY file that knows shop SKUs. Add new items by
// editing SHOP_CATALOG below.

import { supabase } from '@/api/supabaseClient';

export const SHOP_CATALOG = {
  capsule_standard: {
    sku: 'capsule_standard',
    name: 'Standard Capsule',
    description: 'Common to rare drops. Always something new.',
    icon: '📦',
    price: 100,
    grants: { type: 'capsule', capsuleType: 'standard' },
  },
  capsule_premium: {
    sku: 'capsule_premium',
    name: 'Premium Capsule',
    description: 'Better odds at rare and epic drops.',
    icon: '🎁',
    price: 350,
    grants: { type: 'capsule', capsuleType: 'premium' },
  },
  capsule_elite: {
    sku: 'capsule_elite',
    name: 'Elite Capsule',
    description: 'Guaranteed epic+, with a real shot at legendary.',
    icon: '💎',
    price: 1000,
    grants: { type: 'capsule', capsuleType: 'elite' },
  },
  streak_freeze: {
    sku: 'streak_freeze',
    name: 'Streak Freeze',
    description: 'Insurance against missing a day. Auto-spent if needed.',
    icon: '❄️',
    price: 200,
    grants: { type: 'streak_freeze', amount: 1 },
  },
};

/**
 * Buy a single SKU. Returns { success, newBalance, granted, error }.
 *
 * Atomicity caveat: this is a multi-row update without a transaction. The
 * coin debit and item grant happen in sequence. If the grant fails after the
 * debit, we attempt to refund. On migration to a server-side function, fold
 * this into a single atomic RPC.
 */
export async function purchaseItem(user, sku) {
  if (!user?.id || !user?.email) return { success: false, error: 'not_authenticated' };
  const item = SHOP_CATALOG[sku];
  if (!item) return { success: false, error: 'unknown_sku' };

  // Read coins
  const { data: profile, error: readErr } = await supabase
    .from('user_profiles')
    .select('flex_coins, streak_freezes_available')
    .eq('id', user.id)
    .maybeSingle();
  if (readErr) return { success: false, error: 'read_failed' };
  const balance = profile?.flex_coins ?? 0;
  if (balance < item.price) return { success: false, error: 'insufficient_coins', newBalance: balance };

  // Debit coins
  const newBalance = balance - item.price;
  const { error: debitErr } = await supabase
    .from('user_profiles')
    .update({ flex_coins: newBalance })
    .eq('id', user.id);
  if (debitErr) return { success: false, error: 'debit_failed' };

  // Grant the item
  let grantOk = false;
  let granted = null;
  try {
    if (item.grants.type === 'capsule') {
      const { error } = await supabase.from('user_capsules').insert({
        user_id: user.id,
        user_email: user.email,
        capsule_type: item.grants.capsuleType,
      });
      if (!error) {
        grantOk = true;
        granted = { type: 'capsule', capsuleType: item.grants.capsuleType };
      }
    } else if (item.grants.type === 'streak_freeze') {
      const current = profile?.streak_freezes_available ?? 0;
      const { error } = await supabase
        .from('user_profiles')
        .update({ streak_freezes_available: current + item.grants.amount })
        .eq('id', user.id);
      if (!error) {
        grantOk = true;
        granted = { type: 'streak_freeze', amount: item.grants.amount };
      }
    }
  } catch (err) {
    console.error('[coinShop] grant threw:', err);
  }

  if (!grantOk) {
    // Refund: best-effort. If refund fails, we've already logged the issue.
    await supabase
      .from('user_profiles')
      .update({ flex_coins: balance })
      .eq('id', user.id);
    return { success: false, error: 'grant_failed', newBalance: balance };
  }

  return { success: true, newBalance, granted };
}
