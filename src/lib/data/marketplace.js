// src/lib/data/marketplace.js
// Marketplace data-access layer — backed by Supabase marketplace_listings.

import { supabase } from '@/api/supabaseClient';

/**
 * List all active marketplace listings, newest first.
 */
export async function listActive(limit = 50) {
  const { data, error } = await supabase
    .from('marketplace_listings')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Create a new marketplace listing.
 *
 * data: {
 *   seller_user_id, seller_email, seller_username,
 *   inventory_id, item_id, item_name, item_emoji, item_rarity,
 *   listing_type ('sale'|'trade'),
 *   asking_price (integer, required for 'sale'),
 *   trade_for_rarity (string, required for 'trade'),
 * }
 *
 * Returns the inserted row.
 */
export async function createListing(data) {
  if (!data) return null;
  const { data: row, error } = await supabase
    .from('marketplace_listings')
    .insert({
      seller_user_id:  data.seller_user_id,
      seller_email:    data.seller_email,
      seller_username: data.seller_username ?? '',
      inventory_id:    data.inventory_id,
      item_id:         data.item_id,
      item_name:       data.item_name,
      item_emoji:      data.item_emoji ?? '',
      item_rarity:     data.item_rarity ?? 'common',
      listing_type:    data.listing_type,
      asking_price:    data.asking_price ?? null,
      trade_for_rarity: data.trade_for_rarity ?? null,
      status:          'active',
    })
    .select()
    .maybeSingle();
  if (error) throw error;
  return row;
}

/**
 * Cancel a listing — only the seller can cancel their own listing.
 * RLS enforces ownership; this function is a convenience wrapper.
 */
export async function cancelListing(listingId) {
  if (!listingId) return;
  const { error } = await supabase
    .from('marketplace_listings')
    .update({ status: 'cancelled' })
    .eq('id', listingId);
  if (error) throw error;
}

/**
 * Get all listings created by a specific seller, any status, newest first.
 */
export async function listBySeller(sellerEmail) {
  if (!sellerEmail) return [];
  const { data, error } = await supabase
    .from('marketplace_listings')
    .select('*')
    .eq('seller_email', sellerEmail)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Mark a listing as completed (called after a successful purchase/trade).
 */
export async function completeListing(listingId) {
  if (!listingId) return;
  const { error } = await supabase
    .from('marketplace_listings')
    .update({ status: 'completed' })
    .eq('id', listingId);
  if (error) throw error;
}
