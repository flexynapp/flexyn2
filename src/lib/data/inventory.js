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
