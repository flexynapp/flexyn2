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
import { CAPSULE_ODDS } from '@/lib/lootCatalog';

export const SHOP_CATALOG = {
  capsule_standard: {
    sku: 'capsule_standard',
    name: 'Standard Capsule',
    description: 'Common to rare drops. Always something new.',
    icon: '📦',
    price: 100,
    rarity: 'common',
    grants: { type: 'capsule', capsuleType: 'standard' },
  },
  capsule_premium: {
    sku: 'capsule_premium',
    name: 'Premium Capsule',
    description: 'Better odds at rare and epic drops.',
    icon: '🎁',
    price: 350,
    rarity: 'rare',
    grants: { type: 'capsule', capsuleType: 'premium' },
  },
  capsule_elite: {
    sku: 'capsule_elite',
    // Was "Guaranteed epic+, with a real shot at legendary." That is not what
    // CAPSULE_ODDS.elite says — it's 30% epic-or-better and 10% plain common.
    // Overstating loot odds on a paid-currency item is a real compliance
    // problem, not just sloppy copy: App Store Review Guideline 3.1.1 and
    // Google Play's real-money-gambling policy both require published,
    // accurate odds for loot boxes. See getCapsuleOdds() below — the shop
    // now renders the true numbers rather than a claim.
    description: 'The best odds we offer. Real shot at legendary.',
    icon: '💎',
    price: 1000,
    rarity: 'epic',
    grants: { type: 'capsule', capsuleType: 'elite' },
  },
  streak_freeze: {
    sku: 'streak_freeze',
    name: 'Streak Freeze',
    description: 'Insurance against missing a day. Auto-spent if needed.',
    icon: '❄️',
    price: 200,
    rarity: 'uncommon',
    grants: { type: 'streak_freeze', amount: 1 },
  },
};

/**
 * Published drop odds for a capsule SKU, derived from the single source of
 * truth in lootCatalog. Returns null for non-capsule SKUs.
 *
 * Both app stores require loot-box odds to be disclosed before purchase, so
 * this is surfaced in the shop row rather than buried in a help page.
 *
 * @returns {{ epicPlus: number, legendaryPlus: number, table: Record<string, number> } | null}
 */
export function getCapsuleOdds(sku) {
  const item = SHOP_CATALOG[sku];
  if (item?.grants?.type !== 'capsule') return null;
  const table = CAPSULE_ODDS[item.grants.capsuleType];
  if (!table) return null;
  return {
    epicPlus: (table.epic || 0) + (table.legendary || 0) + (table.animated || 0),
    legendaryPlus: (table.legendary || 0) + (table.animated || 0),
    table,
  };
}

/**
 * The capsule SKU with the lowest coin cost per expected epic-or-better drop.
 * Computed rather than hardcoded so it stays honest if prices or odds move.
 *
 * Every shipping currency store marks its best tier — it's what makes a price
 * ladder legible. Ours had three capsules at 100/350/1000 with prose
 * descriptions and no way to tell which was the good deal.
 */
export const BEST_VALUE_SKU = (() => {
  let best = null;
  for (const item of Object.values(SHOP_CATALOG)) {
    const odds = getCapsuleOdds(item.sku);
    if (!odds || odds.epicPlus <= 0) continue;
    const costPerEpic = item.price / odds.epicPlus;
    if (!best || costPerEpic < best.costPerEpic) best = { sku: item.sku, costPerEpic };
  }
  return best?.sku ?? null;
})();

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
