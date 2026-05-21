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
 * Atomic path via `purchase_shop_item` RPC (migration 031). The RPC owns
 * the price table — clients pass only the SKU, so a tampered client
 * can't claim a price of 0 or buy an item they can't afford. Debit and
 * grant happen inside one transaction with a row lock on the buyer's
 * profile; concurrent purchases serialize correctly.
 *
 * Fails CLOSED if the RPC is unavailable. Previously this fell back
 * to a client-orchestrated read-modify-write path that retained the
 * original race / cheat surface — kept "for rollout safety" but in
 * practice it's a footgun (a transient RPC outage would silently
 * route every purchase through the vulnerable path). Migration 031
 * has been live since launch; the fallback was dead weight.
 */
export async function purchaseItem(user, sku) {
  if (!user?.id || !user?.email) return { success: false, error: 'not_authenticated' };
  const item = SHOP_CATALOG[sku];
  if (!item) return { success: false, error: 'unknown_sku' };

  try {
    const { data, error } = await supabase.rpc('purchase_shop_item', { p_sku: sku });
    if (error) {
      const msg = error.message || '';
      if (error.code === '42883' || error.code === '42P01') {
        // RPC missing — fail closed. Caller surfaces a retry toast.
        return { success: false, error: 'rpc_missing' };
      }
      if (/insufficient_coins/.test(msg))     return { success: false, error: 'insufficient_coins' };
      if (/unknown_sku/.test(msg))            return { success: false, error: 'unknown_sku' };
      if (/unauthenticated/.test(msg))        return { success: false, error: 'not_authenticated' };
      return { success: false, error: msg || 'rpc_failed' };
    }
    if (!data) return { success: false, error: 'rpc_no_data' };
    return {
      success: true,
      newBalance: data.new_balance,
      granted: data.granted_kind === 'capsule'
        ? { type: 'capsule', capsuleType: data.granted_subtype }
        : { type: 'streak_freeze', amount: data.granted_amount },
    };
  } catch (err) {
    console.error('[coinShop] purchase RPC threw:', err);
    return { success: false, error: err?.message || 'rpc_threw' };
  }
}
