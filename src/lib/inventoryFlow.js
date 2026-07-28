// src/lib/inventoryFlow.js
// Owns the Bag → CapsuleOpener flow so it works from any surface (today:
// ProfileMenu; previously: Hub). The capsule-claim logic was lifted from
// Hub.jsx so the bag is no longer tied to the social route.
//
// Pattern:
//   const bag = useBagFlow();
//   bag.openBag(); bag.bagOpen; bag.capsuleCount;  // bag UI
//   <UserBag open={bag.bagOpen} onClose={bag.closeBag} onOpenCapsule={bag.openCapsule} />
//   {bag.openingCapsule && <CapsuleOpener capsule={bag.openingCapsule}
//        onClaim={bag.claimCapsule} onClose={bag.closeOpener} />}

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { useAuth } from '@/lib/AuthContext';
import * as capsules from '@/lib/data/capsules';

// Custom event name used by external callers (e.g. StatsHubModal "Bag &
// Capsules" tile) to ask whatever currently owns the bag flow to open
// it. Modeled on the existing `flexyn-title` cardio-header convention.
export const OPEN_BAG_EVENT = 'flexyn-open-bag';

export function useBagFlow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [bagOpen, setBagOpen] = useState(false);
  const [openingCapsule, setOpeningCapsule] = useState(null);
  // Batch open — an array of same-type capsule rows. Mutually exclusive
  // with openingCapsule; the opener renders whichever is set.
  const [openingBatch, setOpeningBatch] = useState(null);

  // Unopened-capsule count — drives the badge on the Bag menu entry.
  const { data: capsuleCount = 0 } = useQuery({
    queryKey: ['userCapsulesCount', user?.email],
    queryFn: async () => {
      const list = await capsules.listUnopenedCapsules(user.email);
      return list.length;
    },
    enabled: !!user?.email,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Minimal user_profiles row for inventory writes (id + flex_coins).
  // Same query Hub.jsx used; distinct key from the global 'userProfile'
  // to avoid clobbering full_name / avatar_url in the cache.
  const { data: userProfile } = useQuery({
    queryKey: ['hubUserProfile', user?.email],
    queryFn: async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return null;
      const { data } = await safeSelect({
        columns: ['id', 'flex_coins'],
        build: (cols) => supabase
          .from('user_profiles')
          .select(cols)
          .eq('id', authUser.id)
          .maybeSingle(),
      });
      return data;
    },
    enabled: !!user?.email,
  });

  const openBag = useCallback(() => setBagOpen(true), []);
  const closeBag = useCallback(() => setBagOpen(false), []);

  // Bag → Opener handoff. Closing the bag first prevents a brief frame
  // where both surfaces render stacked.
  const openCapsule = useCallback((capsuleRow) => {
    setBagOpen(false);
    setOpeningBatch(null);
    setOpeningCapsule(capsuleRow);
  }, []);

  /** Open several capsules of the same type in one spin. */
  const openCapsuleBatch = useCallback((rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return;
    // A one-item "batch" is just a normal open — routing it through the
    // batch path would show the grid treatment for a single card.
    if (rows.length === 1) {
      setBagOpen(false);
      setOpeningBatch(null);
      setOpeningCapsule(rows[0]);
      return;
    }
    setBagOpen(false);
    setOpeningCapsule(null);
    setOpeningBatch(rows);
  }, []);

  const closeOpener = useCallback(() => {
    setOpeningCapsule(null);
    setOpeningBatch(null);
  }, []);

  const claimCapsule = useCallback(async (wonItem) => {
    const capsuleId = openingCapsule?.id;
    setOpeningCapsule(null);
    // Re-open the bag so the user lands back on the bag menu (where
    // they came from) instead of falling through to whatever surface
    // was rendered behind the opener. Without this, opening a capsule
    // from the marketplace or any other surface forced the user to
    // re-navigate back to the bag to open the next one.
    setBagOpen(true);
    if (!wonItem || !user?.email) return;
    try {
      // Atomic verify-capsule + insert-inventory via the
      // finalize_capsule_claim RPC (migration 070). The previous flow
      // was Promise.all([inventory.addItem, capsules.openCapsule]) —
      // two independent writes. If addItem failed AFTER
      // claim_capsule_loot had already rolled + marked the capsule
      // opened, the loot was destroyed (capsule opened, no inventory
      // row). The RPC does both writes in one transaction.
      //
      // Fallback path: if the RPC fails for ANY reason, retry the
      // insert via the legacy inventory.addItem. The capsule has
      // already been marked is_opened=true by claim_capsule_loot at
      // this point (which ran before this callback), so the worry
      // about "loot destroyed if addItem fails" no longer applies —
      // the rolled rarity/category/variant are persisted on the
      // user_capsules row and any inventory insert here is purely
      // additive. This unblocks new users hitting RPC edge cases
      // (missing user_profiles row on fresh signup, host without
      // migration 074, column drift, etc.) where the inventory
      // insert was previously failing and the user saw the bug
      // screenshot's "Could not save item" toast.
      // finalize_capsule_claim is the ONLY path that can write inventory:
      // direct client inserts into user_inventory are locked server-side
      // (migration 197) to stop item injection (a client could otherwise
      // grant itself any cosmetic at any rarity with no capsule). The
      // previous fallback did exactly that direct insert, so it's gone.
      // This is safe: claim_capsule_loot already persisted the rolled
      // rarity/category/variant on the user_capsules row before this
      // callback, so a finalize failure loses nothing — it's retryable,
      // and we surface the error rather than silently dropping loot.
      if (!capsuleId) throw new Error('missing_capsule_id');
      const { error: finalizeError } = await supabase.rpc('finalize_capsule_claim', {
        p_capsule_id:  capsuleId,
        p_item_id:     wonItem.id,
        p_item_name:   wonItem.name,
        p_item_emoji:  wonItem.emoji ?? '',
        p_item_rarity: wonItem.rarity ?? 'common',
        p_item_type:   wonItem.type   ?? 'sticker',
        p_variant:     wonItem.variant ?? null,
      });
      if (finalizeError) {
        console.warn('[inventoryFlow] finalize_capsule_claim failed:', finalizeError.code, finalizeError.message);
        throw finalizeError;
      }

      queryClient.invalidateQueries({ queryKey: ['userInventory', user.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
      // Keeps the streak line on the opener honest after this open.
      queryClient.invalidateQueries({ queryKey: ['capsuleOpenHistory', user.email] });
      toast.success(`${wonItem.emoji} ${wonItem.name} added to your bag!`);
    } catch (err) {
      console.error('[inventoryFlow] capsule claim failed (both paths):', err);
      toast.error('Could not save item. Try again.');
    }
  }, [openingCapsule, user, userProfile, queryClient]);

  /**
   * Finalize every item from a batch open.
   *
   * Each result is finalized by its own finalize_capsule_claim call — the
   * same RPC and the same one-transaction guarantee as a single open, just
   * N of them. Failures are counted rather than thrown so one bad row
   * can't strand the other nine: the rolled rarity is already persisted on
   * each user_capsules row, so a failed finalize loses nothing and stays
   * retryable.
   */
  const claimCapsuleBatch = useCallback(async (results) => {
    setOpeningBatch(null);
    setBagOpen(true);
    if (!Array.isArray(results) || results.length === 0 || !user?.email) return;

    const outcomes = await Promise.all(results.map(async ({ capsuleId, item }) => {
      try {
        if (!capsuleId) throw new Error('missing_capsule_id');
        const { error } = await supabase.rpc('finalize_capsule_claim', {
          p_capsule_id:  capsuleId,
          p_item_id:     item.id,
          p_item_name:   item.name,
          p_item_emoji:  item.emoji ?? '',
          p_item_rarity: item.rarity ?? 'common',
          p_item_type:   item.type   ?? 'sticker',
          p_variant:     item.variant ?? null,
        });
        if (error) throw error;
        return true;
      } catch (err) {
        console.warn('[inventoryFlow] batch finalize failed:', capsuleId, err?.message);
        return false;
      }
    }));

    const saved = outcomes.filter(Boolean).length;
    const failed = outcomes.length - saved;

    queryClient.invalidateQueries({ queryKey: ['userInventory', user.email] });
    queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
    queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
    queryClient.invalidateQueries({ queryKey: ['capsuleOpenHistory', user.email] });

    if (saved > 0) toast.success(`${saved} item${saved === 1 ? '' : 's'} added to your bag!`);
    if (failed > 0) toast.error(`${failed} item${failed === 1 ? '' : 's'} could not be saved — try opening again.`);
  }, [user, queryClient]);

  // Listen for the global "open bag" event so external surfaces (e.g.
  // the StatsHub modal) can open the bag without holding a ref to the
  // owner component.
  useEffect(() => {
    const handler = () => setBagOpen(true);
    window.addEventListener(OPEN_BAG_EVENT, handler);
    return () => window.removeEventListener(OPEN_BAG_EVENT, handler);
  }, []);

  return {
    bagOpen,
    openBag,
    closeBag,
    openingCapsule,
    openingBatch,
    openCapsule,
    openCapsuleBatch,
    closeOpener,
    claimCapsule,
    claimCapsuleBatch,
    capsuleCount,
  };
}

// Convenience: anywhere outside the bag-owning component can call this
// to request that the bag be opened.
export function requestOpenBag() {
  window.dispatchEvent(new CustomEvent(OPEN_BAG_EVENT));
}
