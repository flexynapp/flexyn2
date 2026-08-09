// src/lib/data/marketplace.js
// Marketplace data-access layer — backed by Supabase marketplace_listings.

import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';

// Funnel data-layer throws through a single helper so every failure
// reaches Sentry with a consistent feature tag. Callers (React
// components) still see the original error and can show their own
// user-facing copy — this wrapper just adds observability without
// changing the throw shape.
function throwReported(err, feature, ctx) {
  try { reportError(err, { feature, level: 'warning', ...(ctx || {}) }); } catch { /* never block throw on reporting failure */ }
  throw err;
}

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
  if (error) throwReported(error, 'marketplace');
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
  if (error) throwReported(error, 'marketplace');
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
  if (error) throwReported(error, 'marketplace');
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
 * The RPC is now the ONLY path. A pre-078 fallback used to sit here that
 * flipped `status` directly, and migration 319 removed the policy it needed:
 * `marketplace: sellers can update own listings` was an unrestricted UPDATE,
 * so it also let a seller re-price a live listing under a buyer, repoint it
 * at a different item, or hand themselves the admin-only `is_featured`. The
 * table takes no direct client writes at all now.
 *
 * Keeping the fallback would have been worse than removing it: with the
 * policy gone the UPDATE matches no rows and PostgREST reports success, so a
 * failed cancel would have looked exactly like a successful one. A missing
 * RPC throws instead.
 */
export async function cancelListing(listingId) {
  if (!listingId) return;
  const { error } = await supabase.rpc('cancel_marketplace_listing', {
    p_listing_id: listingId,
  });
  if (error) throw error;
}

/**
 * Delete one of your own listings outright, rather than cancelling it.
 *
 * Cancel keeps the row (status='cancelled') as a record that you listed the
 * thing; delete removes it. Both release the item back to your bag — that is
 * the part a plain `DELETE` could never do, which is why migration 321 took
 * the raw DELETE policy away and put the capability here instead. The RPC
 * also cancels any pending trade offer aimed at the listing and releases the
 * offerer's escrowed item, so deleting cannot strand someone else's sticker.
 *
 * Refuses on a COMPLETED listing: the item is the buyer's by then, and
 * priceStatsForItem reads completed rows to answer "what has this sold for" —
 * the panel the next seller prices against. Errors surface as
 * `completed_sale_cannot_be_deleted` / `not_your_listing`.
 *
 * Returns `{ deleted, listing_id, inventory_id, offers_cancelled }`, or
 * `{ deleted: false, already_gone: true }` if it had gone already — a second
 * tap on a slow connection is not an error.
 */
export async function deleteListing(listingId) {
  if (!listingId) return null;
  const { data, error } = await supabase.rpc('delete_my_listing', {
    p_listing_id: listingId,
  });
  if (error) throw error;
  return data;
}

/**
 * Get all listings created by a specific seller, any status, newest first.
 */
export async function listBySeller(sellerUserId) {
  // Key by seller_user_id, not seller_email: create_marketplace_listing
  // (mig 025) stamps seller_email from auth.email(), which is '' for
  // guest accounts — an email read would miss a guest's own listings.
  // seller_user_id is auth.uid() and always populated. (No current
  // callers; fixed so future use can't inherit the guest hole.)
  if (!sellerUserId) return [];
  const { data, error } = await supabase
    .from('marketplace_listings')
    .select('*')
    .eq('seller_user_id', sellerUserId)
    .order('created_at', { ascending: false });
  if (error) throwReported(error, 'marketplace');
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
  if (error) throwReported(error, 'marketplace');
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
  if (error) throwReported(error, 'marketplace');
  return data;
}

/**
 * Price history for a single catalog item, built from completed sale
 * listings. Powers the Item Detail sheet's "what does this go for?" block
 * and the suggested-price hint when listing.
 *
 * BUNDLED SALES ARE EXCLUDED, and that is the point of the bundle_id
 * filter. A completed listing records `asking_price`, which is what it was
 * LISTED at — and for a standalone sale that is also what the buyer paid,
 * because purchase_listing charges asking_price exactly. A bundle does not
 * work that way: purchase_bundle charges the discounted total for the whole
 * basket, so at a 40% discount every item in it reports a price 40% above
 * what anyone actually paid. Feeding those into the median quietly inflates
 * the number the next seller prices against, and inflates it most for the
 * items that get bundled most.
 *
 * The alternative is to allocate the basket price back across its items
 * pro-rata and record that. It is not obviously better: a bundle clears at a
 * basket price and any per-item split is a rule we invented, so it would
 * turn a wrong number into a made-up one. What this block answers is "what
 * do standalone sales of this go for", which is exactly the comparable a
 * seller pricing a single listing needs. If bundle sales should be
 * represented, that wants a real `sold_price` column written at sale time,
 * not arithmetic at read time.
 *
 * CAVEAT worth knowing before you build on this: marketplace_listings has
 * no sold_at / updated_at column, only created_at (when the item was
 * LISTED). So `recent` is ordered by listing date, not sale date — close
 * enough for a price hint, wrong if you ever need a true time series.
 * Adding sold_at is the fix; it needs a migration.
 *
 * Returns null when there's no completed-sale history, so callers can
 * hide the block rather than render an empty chart.
 *
 * @returns {Promise<null | {count:number, median:number, low:number,
 *                           high:number, recent:number[]}>}
 */
export async function priceStatsForItem(itemId, limit = 20) {
  if (!itemId) return null;
  const { data, error } = await supabase
    .from('marketplace_listings')
    .select('asking_price, created_at')
    .eq('item_id', itemId)
    .eq('status', 'completed')
    .eq('listing_type', 'sale')
    .is('bundle_id', null)
    .not('asking_price', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  // A missing price history is not worth surfacing as an error — the
  // detail sheet just hides the block.
  if (error) { throwReported(error, 'marketplace'); }

  const prices = (data ?? [])
    .map(r => Number(r.asking_price))
    .filter(n => Number.isFinite(n) && n > 0);
  if (prices.length === 0) return null;

  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);

  return {
    count:  prices.length,
    median,
    low:    sorted[0],
    high:   sorted[sorted.length - 1],
    recent: prices, // newest-first, as returned
  };
}

// `completeListing()` was removed by migration 319. Its doc comment claimed it
// was "called after a successful purchase/trade" and it had ZERO callers —
// purchase_listing, purchase_bundle and respond_to_trade_offer each set
// status='completed' inside their own transaction, which is the only place it
// can be set correctly. As an exported direct UPDATE it was a standing
// invitation to mark a listing sold without a sale, and 319 closed the policy
// it depended on.
