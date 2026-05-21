// src/lib/data/marketplace.js
// Marketplace data-access layer — backed by Supabase marketplace_listings.

import { supabase } from '@/api/supabaseClient';

/**
 * List all active marketplace listings.
 * @param {number} limit  Max rows to return.
 * @param {'recent'|'price'} sortBy  Column to sort by.
 * @param {'asc'|'desc'} sortDir     Sort direction.
 */
export async function listActive(limit = 50, sortBy = 'recent', sortDir = 'desc') {
  const column = sortBy === 'price' ? 'asking_price' : 'created_at';
  const ascending = sortDir === 'asc';
  const { data, error } = await supabase
    .from('marketplace_listings')
    .select('*')
    .eq('status', 'active')
    .order(column, { ascending })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Create a new marketplace listing.
 *
 * data: {
 *   inventory_id, listing_type ('sale'|'trade'),
 *   asking_price (integer, required for 'sale'),
 *   trade_for_rarity (string, required for 'trade'),
 * }
 *
 * Goes through the create_marketplace_listing RPC (migration 025)
 * which atomically validates ownership, locks the inventory row, sets
 * is_listed=true, and inserts the listing. Fails CLOSED if the RPC
 * is unavailable — the previous fallback inserted directly without
 * ownership validation, letting a malicious client list any
 * inventory_id including items they don't own. Migration 025 is
 * deployed; the fallback was dead weight with attack surface.
 */
export async function createListing(data) {
  if (!data) return null;
  const { data: listingId, error } = await supabase.rpc('create_marketplace_listing', {
    p_inventory_id:     data.inventory_id,
    p_listing_type:     data.listing_type,
    p_asking_price:     data.asking_price ?? null,
    p_trade_for_rarity: data.trade_for_rarity ?? null,
  });
  if (error) throw error;
  // Fetch the freshly-created row for the caller.
  const { data: row } = await supabase
    .from('marketplace_listings')
    .select('*')
    .eq('id', listingId)
    .maybeSingle();
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
