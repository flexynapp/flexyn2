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
 * Atomicity / ownership / price validation are enforced server-side by the
 * create_marketplace_listing RPC (migration 025). Falls back to the legacy
 * direct insert ONLY when the RPC isn't available (pre-migration). The
 * legacy path lets the client list any inventory_id without ownership
 * validation — keep it for migration grace but warn loudly.
 */
export async function createListing(data) {
  if (!data) return null;

  // Server-side RPC path — atomically validates ownership, locks the
  // inventory row, sets is_listed=true, inserts the listing.
  try {
    const { data: listingId, error } = await supabase.rpc('create_marketplace_listing', {
      p_inventory_id:     data.inventory_id,
      p_listing_type:     data.listing_type,
      p_asking_price:     data.asking_price ?? null,
      p_trade_for_rarity: data.trade_for_rarity ?? null,
    });
    if (!error) {
      // Fetch the freshly-created row for the caller.
      const { data: row } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('id', listingId)
        .maybeSingle();
      return row;
    }
    if (error.code !== '42883' && error.code !== '42P01') {
      // RPC exists but rejected — surface the real error (e.g. "item not
      // owned", "price floor") instead of falling through silently.
      throw error;
    }
    console.warn('[marketplace] create RPC missing, falling back:', error);
  } catch (err) {
    // 42883 = function not found. Re-throw anything else.
    if (err?.code !== '42883' && err?.code !== '42P01') throw err;
    console.warn('[marketplace] create RPC unavailable, falling back:', err);
  }

  // Legacy fallback — only runs pre-migration-025.
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
 * Atomically purchase a sale listing. Wraps the purchase_listing RPC
 * (migration 025) which performs lock, validate, deduct buyer, credit
 * seller, transfer item, mark completed — all in one transaction.
 *
 * Returns the RPC payload: { listing_id, inventory_id, price, buyer_coins }
 * or throws with the server error (e.g. "insufficient_coins", "item no
 * longer available", "listing is cancelled").
 */
export async function purchaseListing(listingId) {
  if (!listingId) throw new Error('listingId required');
  const { data, error } = await supabase.rpc('purchase_listing', {
    p_listing_id: listingId,
  });
  if (error) throw error;
  return data;
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
