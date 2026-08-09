// src/lib/data/marketplaceBundles.js
//
// The SELLER side of bundle deals (mig 134, reworked by mig 320).
//
// Buying a bundle lives in marketplace.js next to the other purchase paths;
// creating one lives here, the same way marketplaceWishlist.js owns its own
// corner rather than growing marketplace.js further.
//
// The economics a seller has to understand before using this, because they
// changed in mig 320 and the UI is required to say so: **the discount comes
// out of the seller's proceeds.** purchase_bundle now credits the seller
// exactly what the buyer paid. It used to credit each listing's full
// asking_price while charging the discounted total, which minted the
// difference out of nothing on every sale. A bundle is the seller's own
// promotion, so it is the seller who funds it.

import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';

/** Discount bounds, mirroring the CHECK on marketplace_bundles. */
export const BUNDLE_DISCOUNT_MIN = 1;
export const BUNDLE_DISCOUNT_MAX = 75;
/** A bundle of one is just a listing with a discount. */
export const BUNDLE_MIN_LISTINGS = 2;

/**
 * What a bundle of these listings would cost, and what the seller nets.
 *
 * Mirrors purchase_bundle: sale listings only, `GREATEST(1, ROUND(...))`.
 * Pure, so the dialog's preview and any test can share one definition —
 * a seller-facing "you'll receive" number that disagreed with the RPC
 * would be worse than showing nothing.
 */
export function quoteBundle(rows, discountPct) {
  const total = (rows ?? [])
    .filter(l => l.listing_type === 'sale')
    .reduce((sum, l) => sum + (l.asking_price ?? 0), 0);
  const pct = Number(discountPct) || 0;
  const price = Math.max(1, Math.round(total * (1 - pct / 100)));
  // Seller proceeds ARE the buyer's payment since mig 320 — one payee, one
  // number. Named separately anyway: the whole point of the preview is that
  // the seller sees the gap between the sticker prices they set and what
  // actually reaches them.
  return { total, price, sellerReceives: price, givenUp: Math.max(0, total - price) };
}

/**
 * Attach a listing to (or detach it from) a bundle.
 *
 * Goes through `set_listing_bundle` (mig 320), which checks that BOTH the
 * listing and the bundle belong to the caller. The blanket UPDATE policy
 * that used to allow this write was revoked in that migration precisely
 * because it could only check the first half — it let a seller point their
 * own listing at ANY bundle, injecting an item into someone else's deal.
 *
 * Pass null as bundleId to detach.
 */
export async function setListingBundle(listingId, bundleId) {
  if (!listingId) throw new Error('listingId required');
  const { error } = await supabase.rpc('set_listing_bundle', {
    p_listing_id: listingId,
    p_bundle_id:  bundleId ?? null,
  });
  if (error) throw error;
}

/**
 * Create a bundle over several of your own active sale listings.
 *
 * Two steps with different trust models: the bundle row is a plain insert
 * (RLS pins seller_user_id to auth.uid()), then each listing is attached
 * through the RPC above.
 *
 * If any attach fails the bundle row is DELETED rather than left behind.
 * `marketplace_listings.bundle_id` is ON DELETE SET NULL, so that one
 * statement also unlinks whatever did attach and those listings drop
 * straight back into the normal grid. A half-attached bundle is worse than
 * no bundle: purchase_bundle prices whatever it finds, so it would quietly
 * sell a smaller set at the discount chosen for the full one.
 */
export async function createBundle({ title, discountPct, listingIds, sellerUserId, sellerEmail }) {
  const ids = Array.from(new Set(listingIds ?? [])).filter(Boolean);
  if (!sellerUserId)  throw new Error('sellerUserId required');
  if (!title?.trim()) throw new Error('title required');
  if (ids.length < BUNDLE_MIN_LISTINGS) throw new Error('bundle_needs_two');

  const pct = Math.round(Number(discountPct));
  if (!Number.isFinite(pct) || pct < BUNDLE_DISCOUNT_MIN || pct > BUNDLE_DISCOUNT_MAX) {
    throw new Error('bundle_discount_out_of_range');
  }

  const { data: bundle, error } = await supabase
    .from('marketplace_bundles')
    .insert({
      seller_user_id: sellerUserId,
      // NOT NULL on the table, and delivery/legacy identity only: nothing
      // renders it (userDisplay never surfaces an email) and the payout keys
      // on seller_user_id, which RLS pins to auth.uid().
      seller_email:   sellerEmail ?? '',
      title:          title.trim(),
      discount_pct:   pct,
      status:         'active',
    })
    .select('*')
    .single();
  if (error) throw error;

  try {
    for (const id of ids) {
      await setListingBundle(id, bundle.id);
    }
  } catch (attachErr) {
    // Best-effort cleanup. If the delete ALSO fails the bundle survives with
    // fewer items than the seller intended, which is the one outcome worth
    // reporting on its own rather than folding into the attach error.
    const { error: cleanupErr } = await supabase
      .from('marketplace_bundles')
      .delete()
      .eq('id', bundle.id);
    if (cleanupErr) {
      reportError(cleanupErr, {
        feature: 'marketplace.bundle-cleanup', level: 'error', bundleId: bundle.id,
      });
    }
    throw attachErr;
  }

  return bundle;
}

/**
 * Break up one of your own bundles.
 *
 * Deletes the row rather than flipping status to 'cancelled': the FK is
 * ON DELETE SET NULL, so the listings unlink in the same statement and
 * reappear individually in the grid — no second call that could fail
 * halfway and leave them stranded in a bundle that no longer sells.
 *
 * Scoped to status='active' so a COMPLETED bundle — a real sale, and the
 * only record it happened — can never be erased through this path.
 */
export async function cancelBundle(bundleId) {
  if (!bundleId) return;
  const { error } = await supabase
    .from('marketplace_bundles')
    .delete()
    .eq('id', bundleId)
    .eq('status', 'active');
  if (error) throw error;
}

/** Your own bundles, newest first. */
export async function listMyBundles(sellerUserId) {
  if (!sellerUserId) return [];
  const { data, error } = await supabase
    .from('marketplace_bundles')
    .select('*')
    .eq('seller_user_id', sellerUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
