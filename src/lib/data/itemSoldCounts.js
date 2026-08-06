// src/lib/data/itemSoldCounts.js
//
// Read wrapper for the per-item "sold X times" counter (mig 119).
// One row per catalog item id; populated by the bump-counter trigger
// on marketplace_listings status → 'completed'.
//
// Usage is bulk — the marketplace renders many listings at once, so
// the typical call is countsFor([...itemIds]) returning a Map.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';


/**
 * Look up sold counts for many item ids in one query. Returns a
 * Map<item_id, sold_count>; missing ids = 0.
 */
export async function countsFor(itemIds) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) return new Map();
  const ids = Array.from(new Set(itemIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const { data, error } = await safeSelect({
    columns: ['item_id', 'sold_count'],
    build: (cols) => supabase
      .from('item_sold_counts')
      .select(cols)
      .in('item_id', ids),
  });
  if (error) return new Map();
  const m = new Map();
  for (const row of data || []) {
    m.set(row.item_id, Number(row.sold_count) || 0);
  }
  return m;
}

/**
 * Format a sold count for display. Designed to feel quiet when low
 * and impressive when high — "1 sold" / "27 sold" / "1.2k sold".
 * Returns null when count is 0 so the caller can hide the chip.
 */
export function formatSoldCount(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1000) return `${n} sold`;
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k sold`;
  return `${Math.round(n / 1000)}k sold`;
}
