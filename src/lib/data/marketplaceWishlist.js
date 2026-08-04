// src/lib/data/marketplaceWishlist.js
//
// "Save for later" on marketplace listings (mig 121). Per-viewer
// private list — RLS restricts SELECT/INSERT/DELETE to the owner.
// The marketplace renders a heart icon on each listing card; tapping
// toggles the save state and updates the local cache instantly.

import { supabase } from '@/api/supabaseClient';

/** List the viewer's wishlist (listing_id + created_at). */
export async function listMine(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('marketplace_wishlist')
    .select('listing_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

/**
 * Add a listing to the wishlist. Idempotent (PK constraint).
 *
 * `ignoreDuplicates: true` is required, not cosmetic: marketplace_wishlist
 * has an INSERT policy but no UPDATE policy, so supabase-js's default
 * merge-duplicates (`ON CONFLICT ... DO UPDATE`) failed with `42501 new row
 * violates row-level security policy` whenever the listing was already
 * saved — and this one THROWS. The conflict target IS the whole payload, so
 * there is nothing to update on conflict; DO NOTHING is what "idempotent"
 * meant here all along.
 */
export async function add(userId, listingId) {
  if (!userId || !listingId) throw new Error('userId + listingId required');
  const { error } = await supabase
    .from('marketplace_wishlist')
    .upsert(
      { user_id: userId, listing_id: listingId },
      { onConflict: 'user_id,listing_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

/** Remove a listing from the wishlist. */
export async function remove(userId, listingId) {
  if (!userId || !listingId) throw new Error('userId + listingId required');
  const { error } = await supabase
    .from('marketplace_wishlist')
    .delete()
    .eq('user_id', userId)
    .eq('listing_id', listingId);
  if (error) throw error;
}

/**
 * Toggle helper — returns the new saved state so the caller can update
 * optimistic UI without a second query.
 */
export async function toggle(userId, listingId, currentlySaved) {
  if (currentlySaved) {
    await remove(userId, listingId);
    return false;
  }
  await add(userId, listingId);
  return true;
}
