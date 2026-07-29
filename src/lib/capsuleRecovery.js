// src/lib/capsuleRecovery.js
//
// Auto-grant loot that was rolled but never handed over.
//
// THE PROBLEM
//
// A capsule is spent the instant the reel starts: claim_capsule_loot
// (migration 028) flips is_opened and persists the rolled rarity/category.
// The ITEM, though, only exists once finalize_capsule_claim runs — and
// that only happens when the user taps Claim. Everything in between is a
// window where the capsule is gone and the reward doesn't exist yet:
//
//   • reload or navigate away mid-reveal
//   • tab crash / OS kills the PWA
//   • a reveal that never completes, leaving Claim unreachable
//
// Measured on a live account: 5 of 21 opened capsules were stranded this
// way, including an epic and two rares. Migration 254 cleaned up the
// backlog once; nothing stopped it recurring.
//
// THE FIX
//
// The roll is already durable — rarity and category are on the row. Only
// the client's choice of WHICH item of that tier was lost, and items
// within a tier are interchangeable. So a stranded capsule can simply be
// finalized after the fact with a fresh pick of the recorded tier. The
// user gets exactly what the odds gave them.
//
// SAFETY
//
//   • Grace window — a capsule opened seconds ago is indistinguishable
//     from one being opened RIGHT NOW. Recovering an in-flight open would
//     grant a different item than the reel is showing and then break the
//     user's own Claim. listStranded excludes anything recent.
//   • Idempotent — finalize_capsule_claim rejects an already-finalized
//     capsule ('capsule already claimed'), so a double sweep from two
//     tabs grants once. That rejection is expected, not an error.
//   • Never throws — this runs in the background on bag open. A failure
//     here must not break the bag.

import { supabase } from '@/api/supabaseClient';
import * as capsules from '@/lib/data/capsules';
import { resolveRolledItem } from '@/lib/lootRoll';

/** Errors that mean "someone else already handled it" — not failures. */
function isAlreadyClaimed(err) {
  return /already claimed/i.test(err?.message || '');
}

/**
 * Finalize one stranded capsule.
 * @returns {Promise<{ok: boolean, item?: object, skipped?: boolean}>}
 */
export async function recoverOne(row) {
  const item = resolveRolledItem(row.rolled_category, row.rolled_rarity);
  if (!item) return { ok: false, skipped: true };

  const { error } = await supabase.rpc('finalize_capsule_claim', {
    p_capsule_id:  row.id,
    p_item_id:     item.id,
    p_item_name:   item.name,
    p_item_emoji:  item.emoji ?? '',
    p_item_rarity: row.rolled_rarity,
    p_item_type:   item.type ?? 'sticker',
    p_variant:     row.rolled_variant ?? null,
  });

  if (error) {
    if (isAlreadyClaimed(error)) return { ok: false, skipped: true };
    console.warn('[capsuleRecovery] finalize failed for', row.id, error.message);
    return { ok: false };
  }
  return { ok: true, item };
}

/**
 * Sweep every stranded capsule for this user and grant what they're owed.
 *
 * Sequential, not parallel: each call credits inventory, and firing a
 * dozen concurrent grants is the shape that produced the races the atomic
 * RPCs were introduced to kill.
 *
 * @returns {Promise<{recovered: number, items: object[], failed: number}>}
 */
export async function recoverStrandedCapsules(userEmail) {
  const out = { recovered: 0, items: [], failed: 0 };
  if (!userEmail) return out;

  let stranded = [];
  try {
    stranded = await capsules.listStranded(userEmail);
  } catch {
    return out;
  }
  if (stranded.length === 0) return out;

  for (const row of stranded) {
    try {
      const res = await recoverOne(row);
      if (res.ok) {
        out.recovered += 1;
        out.items.push(res.item);
      } else if (!res.skipped) {
        out.failed += 1;
      }
    } catch (err) {
      console.warn('[capsuleRecovery] threw for', row.id, err?.message);
      out.failed += 1;
    }
  }
  return out;
}

/**
 * Copy for the recovery toast. Kept pure so it can be tested without a
 * DOM, and so the wording stays in one place.
 */
export function recoveryMessage({ recovered, items }) {
  if (recovered <= 0) return null;
  if (recovered === 1) {
    const it = items[0];
    return `Recovered ${it?.emoji ?? ''} ${it?.name ?? 'an item'} from an interrupted capsule.`.replace(/\s+/g, ' ').trim();
  }
  return `Recovered ${recovered} items from interrupted capsules.`;
}
