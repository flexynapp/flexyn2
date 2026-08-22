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
import { asT } from '@/lib/translatorArg';

// Custom event name used by external callers (e.g. StatsHubModal "Bag &
// Capsules" tile) to ask whatever currently owns the bag flow to open
// it. Modeled on the existing `flexyn-title` cardio-header convention.
export const OPEN_BAG_EVENT = 'flexyn-open-bag';

export function useBagFlow(t) {
  const tf = asT(t);
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

  const claimCapsule = useCallback(async (wonItem, opts = {}) => {
    const capsuleId = openingCapsule?.id;
    setOpeningCapsule(null);
    // Re-open the bag so the user lands back where they came from rather
    // than falling through to whatever surface was behind the opener.
    setBagOpen(true);
    if (!wonItem || !user?.email) return;

    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['userInventory', user.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
      queryClient.invalidateQueries({ queryKey: ['capsuleOpenHistory', user.email] });
    queryClient.invalidateQueries({ queryKey: ['capsulePity', user.email] });
    };

    // Migration 255: open_capsule_atomic already inserted the inventory row
    // in the same transaction that spent the capsule. Nothing is owed, so
    // Claim is purely "acknowledge and close" — which is the entire point:
    // there is no longer a window in which abandoning the reveal can
    // destroy the item.
    if (opts.granted) {
      refresh();
      toast.success(`${wonItem.emoji} ${wonItem.name} added to your bag!`);
      return;
    }

    // Legacy two-step path — only reachable on a pre-255 database, where
    // the roll and the grant are still separate calls.
    try {
      if (!capsuleId) throw new Error('missing_capsule_id');
      const { data, error } = await supabase.rpc('finalize_capsule_claim', {
        p_capsule_id:  capsuleId,
        p_item_id:     wonItem.id,
        p_item_name:   wonItem.name,
        p_item_emoji:  wonItem.emoji ?? '',
        p_item_rarity: wonItem.rarity ?? 'common',
        p_item_type:   wonItem.type   ?? 'sticker',
        p_variant:     wonItem.variant ?? null,
      });
      if (error) throw error;
      refresh();
      // Announce what the SERVER granted. Since migration 267 finalize
      // derives the item from loot_catalog and ignores the arguments above,
      // so naming wonItem here could credit an item the user didn't get.
      const grantedEmoji = data?.item_emoji ?? wonItem.emoji;
      const grantedName  = data?.item_name  ?? wonItem.name;
      toast.success(`${grantedEmoji} ${grantedName} added to your bag!`);
    } catch (err) {
      console.error('[inventoryFlow] legacy capsule claim failed:', err);
      toast.error(tf('inventoryFlow.saveFailed', 'Could not save item. Try again.'));
    }
  }, [openingCapsule, user, queryClient]);

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

    // Anything opened through open_capsule_atomic (mig 255) is already in
    // inventory. Only legacy rolls still need finalizing.
    const pending = results.filter(r => !r.granted);
    const alreadyGranted = results.length - pending.length;

    let saved = alreadyGranted;
    let failed = 0;

    // Sequential: each finalize credits inventory, and firing a dozen
    // concurrent grants is the shape the atomic RPCs were introduced to
    // kill.
    for (const { capsuleId, item } of pending) {
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
        saved += 1;
      } catch (err) {
        console.warn('[inventoryFlow] batch finalize failed:', capsuleId, err?.message);
        failed += 1;
      }
    }

    queryClient.invalidateQueries({ queryKey: ['userInventory', user.email] });
    queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
    queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
    queryClient.invalidateQueries({ queryKey: ['capsuleOpenHistory', user.email] });
    queryClient.invalidateQueries({ queryKey: ['capsulePity', user.email] });

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
