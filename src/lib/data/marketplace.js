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
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('marketplace_listings')
    .select('*')
    .eq('status', 'active')
    // Seasonal / limited-time filter (migration 131).
    // Listings with no window (both NULL) are always shown.
    // Listings with a window only appear when now() is inside it.
    .or(`available_from.is.null,available_from.lte.${now}`)
    .or(`available_until.is.null,available_until.gt.${now}`)
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
 *
 * Atomic via cancel_marketplace_listing RPC (migration 078). Flips
 * marketplace_listings.status = 'cancelled' AND user_inventory.is_listed
 * = false in one transaction. The previous flow ran the listing
 * update and the inventory release as TWO separate client calls; if
 * the second one failed (network blip, tab close), the item was
 * orphaned — invisible in the user's bag AND can't be re-listed.
 *
 * Pre-078 hosts fall back to the legacy two-write path so the feature
 * doesn't break on stale deployments; the orphan-on-failure race is
 * the documented bug.
 */
export async function cancelListing(listingId) {
  if (!listingId) return;
  const { error } = await supabase.rpc('cancel_marketplace_listing', {
    p_listing_id: listingId,
  });
  if (!error) return;
  if (error.code !== '42883' && error.code !== '42P01') {
    throw error;
  }

  // Legacy fallback for pre-078 hosts. The caller (MarketplaceFeed
  // handleCancel) still runs inventory.setListed(false) after this
  // returns, so the two-write path is preserved on stale hosts.
  const { error: updateErr } = await supabase
    .from('marketplace_listings')
    .update({ status: 'cancelled' })
    .eq('id', listingId);
  if (updateErr) throw updateErr;
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
 * List active bundles (migration 134).
 * Returns an array of bundle rows that still have active status.
 */
export async function listActiveBundles() {
  const { data, error } = await supabase
    .from('marketplace_bundles')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Purchase all sale listings in a bundle at a discount.
 * Calls the purchase_bundle RPC (migration 134).
 * Returns { bundle_id, listing_count, total_price, paid_price, buyer_coins }
 */
export async function purchaseBundle(bundleId) {
  if (!bundleId) throw new Error('bundleId required');
  const { data, error } = await supabase.rpc('purchase_bundle', {
    p_bundle_id: bundleId,
  });
  if (error) throw error;
  return data;
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
