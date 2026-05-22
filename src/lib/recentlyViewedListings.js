// src/lib/recentlyViewedListings.js
//
// LocalStorage-backed "recently viewed marketplace items" log. Powers
// the small horizontal rail at the top of the Marketplace feed that
// shows the last few listings the user tapped into but didn't buy.
// Pattern lifted from Instagram Shop, Amazon, eBay — comparison
// shoppers rely on it constantly.
//
// Purely local — no server tracking, no algorithmic recommendation.
// User-scoped via the email key so multiple sessions on the same
// device don't mix histories.

const MAX_ENTRIES = 5;

const STORAGE_KEY = (userEmail) =>
  `flexyn.recentlyViewedListings.${userEmail || 'anon'}`;

function safeRead(userEmail) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(userEmail));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(userEmail, list) {
  try {
    localStorage.setItem(STORAGE_KEY(userEmail), JSON.stringify(list));
  } catch { /* Safari private mode / quota — best-effort */ }
}

/**
 * Get the user's recent-view history (newest first). Returns up to
 * MAX_ENTRIES lightweight summaries.
 */
export function listRecentlyViewed(userEmail) {
  return safeRead(userEmail);
}

/**
 * Record a viewed listing. Moves an existing entry to the front
 * (dedupe by id) so re-viewing reorders rather than duplicates.
 * Caps the list at MAX_ENTRIES.
 *
 * `summary` is the small render-ready shape — id, emoji, name,
 * price, rarity, seller. Keeping it minimal so the localStorage
 * payload stays tiny even with many listings.
 */
export function addRecentlyViewed(userEmail, listing) {
  if (!userEmail || !listing?.id) return;
  // Don't add the user's own listings — "recently viewed" implies
  // browsing for things to buy, not seeing your own posts.
  if (listing.seller_email === userEmail) return;
  const summary = {
    id: listing.id,
    item_emoji: listing.item_emoji,
    item_name: listing.item_name,
    item_rarity: listing.item_rarity,
    asking_price: listing.asking_price,
    listing_type: listing.listing_type,
    seller_email: listing.seller_email,
    viewedAt: new Date().toISOString(),
  };
  const existing = safeRead(userEmail).filter(e => e.id !== listing.id);
  const next = [summary, ...existing].slice(0, MAX_ENTRIES);
  safeWrite(userEmail, next);
  try {
    window.dispatchEvent(new CustomEvent('flexyn:recently-viewed-changed'));
  } catch { /* ignore */ }
}

/**
 * Remove a single entry by id. Used by the per-thumbnail "×" button
 * on the rail.
 */
export function removeRecentlyViewed(userEmail, listingId) {
  if (!userEmail || !listingId) return;
  const next = safeRead(userEmail).filter(e => e.id !== listingId);
  safeWrite(userEmail, next);
  try {
    window.dispatchEvent(new CustomEvent('flexyn:recently-viewed-changed'));
  } catch { /* ignore */ }
}

/**
 * Wipe the entire recents list for the current user. Used by the
 * "Clear" link at the end of the rail.
 */
export function clearRecentlyViewed(userEmail) {
  if (!userEmail) return;
  safeWrite(userEmail, []);
  try {
    window.dispatchEvent(new CustomEvent('flexyn:recently-viewed-changed'));
  } catch { /* ignore */ }
}
