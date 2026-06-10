// src/lib/data/inventory.js
// Inventory data-access layer — backed by Supabase user_inventory.

import { supabase } from '@/api/supabaseClient';

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
 * Add an item to the user's inventory.
 * `item` must be a catalog item object (from lootCatalog.js).
 * Returns the inserted row.
 */
export async function addItem(userId, userEmail, item, acquiredVia = 'capsule') {
  if (!userId || !userEmail || !item) return null;
  const { data, error } = await supabase
    .from('user_inventory')
    .insert({
      user_id:     userId,
      user_email:  userEmail,
      item_id:     item.id,
      item_name:   item.name,
      item_emoji:  item.emoji,
      item_rarity: item.rarity,
      item_type:   item.type,
      acquired_via: acquiredVia,
      variant:     item.variant ?? null,
    })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
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
 * Deletes the inventory row and credits the coins to the user's profile.
 * Returns the user's new flex_coins total (or null when only the legacy
 * fallback ran on a host that's so old the RPC isn't available — the
 * UserBag caller refetches via TanStack Query invalidation either way,
 * so the return value is informational).
 *
 * Coin credit goes through increment_flex_coins (migration 030) for
 * atomic delta arithmetic. The previous read-modify-write sequence
 * raced any concurrent coin grant (capsule open, quest claim, streak
 * milestone, marketplace credit) — those grants got overwritten by the
 * stale "newTotal" computed off the original read.
 */
export async function sellItem(inventoryId, userId, coinsToEarn) {
  if (!inventoryId || !userId) throw new Error('Missing inventoryId or userId');

  // 1. Remove the item from inventory.
  await removeItem(inventoryId);

  if (!coinsToEarn || coinsToEarn <= 0) return null;

  // 2. Credit coins atomically via the delta RPC.
  const { error: rpcErr } = await supabase.rpc('increment_flex_coins', { p_delta: coinsToEarn });
  if (!rpcErr) {
    // RPC returned void; refetch the new total for the caller. The
    // credit already landed — refetch is purely informational, so a
    // refetch error is non-fatal. Log it so a flaky network doesn't
    // hide a genuine RLS / connectivity problem from the operator.
    const { data: after, error: refetchErr } = await supabase
      .from('user_profiles')
      .select('flex_coins')
      .eq('id', userId)
      .maybeSingle();
    if (refetchErr) {
      console.warn('[inventory] sellItem post-credit refetch failed (credit DID land):', refetchErr);
    }
    return after?.flex_coins ?? null;
  }

  // 3. Pre-030 host — fall back to legacy RMW so the user still gets
  // their coins on hosts without migration 030 applied (those also
  // predate the 142/173 trigger, so the direct write is allowed there).
  // Any other failure surfaces to the caller instead: mig 142/173
  // rejects direct flex_coins writes with 42501, and silently RMW-ing
  // on transient errors raced concurrent grants anyway.
  if (rpcErr.code !== '42883' && rpcErr.code !== '42P01') {
    throw rpcErr;
  }
  const { data: profile, error: pe } = await supabase
    .from('user_profiles')
    .select('flex_coins')
    .eq('id', userId)
    .maybeSingle();
  if (pe) throw pe;
  const newTotal = (profile?.flex_coins ?? 0) + coinsToEarn;
  const { error: ue } = await supabase
    .from('user_profiles')
    .update({ flex_coins: newTotal })
    .eq('id', userId);
  if (ue) throw ue;
  return newTotal;
}

/**
 * Mark an inventory item as listed (or unmark it).
 */
export async function setListed(inventoryId, isListed) {
  if (!inventoryId) return;
  const { error } = await supabase
    .from('user_inventory')
    .update({ is_listed: isListed })
    .eq('id', inventoryId);
  if (error) throw error;
}
