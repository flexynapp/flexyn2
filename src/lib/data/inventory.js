// src/lib/data/inventory.js
// Inventory data-access layer — backed by Supabase user_inventory.
//
// ── What a client may do to user_inventory ───────────────────────────────────
// The table carries exactly two policies for `authenticated`:
//
//   SELECT  user_id = auth.uid()
//   DELETE  user_id = auth.uid()
//
// There is no INSERT policy and no UPDATE policy, and that is deliberate —
// the economy lockdown. Anything that CREATES an inventory row or changes
// one goes through a SECURITY DEFINER RPC that validates server-side:
//
//   grant an item      → open_capsule_atomic       (mig 255)
//   list an item       → create_marketplace_listing (mig 025)  ← sets is_listed
//   unlist an item     → cancel_marketplace_listing (mig 078)  ← clears is_listed
//   transfer on buy    → purchase_listing           (mig 025)  ← moves the row
//
// So DO NOT add an `addItem` or a `setListed` back to this module. Both used
// to exist here, both issued a bare `.insert()` / `.update()`, and both could
// only ever return `42501 permission denied for table user_inventory`. An
// INSERT policy that would make `addItem` work is the same policy that lets
// any client grant itself a mythic for free.

import { supabase } from '@/api/supabaseClient';
import { patchProfile } from '@/api/profileCache';

/**
 * List all inventory items for a user, newest first.
 */
export async function listItems(userEmail) {
  if (!userEmail) return [];
  const { data, error } = await supabase
    .from('user_inventory')
    .select('*')
    .eq('user_email', userEmail)
    .order('acquired_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Delete an inventory row by its id (used after a trade or listing completes).
 */
export async function removeItem(inventoryId) {
  if (!inventoryId) return;
  const { error } = await supabase
    .from('user_inventory')
    .delete()
    .eq('id', inventoryId);
  if (error) throw error;
}

/**
 * Count items of a given type in the user's inventory.
 */
export async function countByType(userEmail, type) {
  if (!userEmail || !type) return 0;
  const { count, error } = await supabase
    .from('user_inventory')
    .select('id', { count: 'exact', head: true })
    .eq('user_email', userEmail)
    .eq('item_type', type);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Sell one inventory item for Flex Coins.
 *
 * One server call, sell_inventory_item (2026-09-27): it locks the row,
 * prices it server-side, credits through the mint ledger and returns what
 * was ACTUALLY credited. It used to be a client DELETE followed by
 * increment_flex_coins(clientPrice), which past the daily mint cap deleted
 * the item and silently credited 0, and which two tabs could both complete.
 *
 * Returns `{ coins, newBalance }`. Throws with `code === 'COIN_CAP'` when
 * the daily limit would pay less than the price; the item is kept.
 */
export async function sellItem(inventoryId) {
  if (!inventoryId) throw new Error('Missing inventoryId');
  const { data, error } = await supabase.rpc('sell_inventory_item', {
    p_inventory_id: inventoryId,
  });
  if (error) {
    if (error.hint === 'daily_coin_cap') {
      const capErr = new Error('Daily coin limit reached');
      capErr.code = 'COIN_CAP';
      throw capErr;
    }
    throw error;
  }
  const coins = Number(data?.coins ?? 0);
  const newBalance = typeof data?.new_balance === 'number' ? data.new_balance : null;
  // The balance came from the server, which is the one case the profile
  // cache may take a flex_coins value (see CLAUDE.md, Profile cache).
  if (newBalance !== null) patchProfile({ flex_coins: newBalance });
  return { coins, newBalance };
}
