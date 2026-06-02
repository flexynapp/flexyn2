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
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { useAuth } from '@/lib/AuthContext';
import * as inventory from '@/lib/data/inventory';
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
    setOpeningCapsule(capsuleRow);
  }, []);

  const closeOpener = useCallback(() => setOpeningCapsule(null), []);

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
      let rpcError = null;
      if (capsuleId) {
        const { error } = await supabase.rpc('finalize_capsule_claim', {
          p_capsule_id:  capsuleId,
          p_item_id:     wonItem.id,
          p_item_name:   wonItem.name,
          p_item_emoji:  wonItem.emoji ?? '',
          p_item_rarity: wonItem.rarity ?? 'common',
          p_item_type:   wonItem.type   ?? 'sticker',
          p_variant:     wonItem.variant ?? null,
        });
        if (error) {
          rpcError = error;
          console.warn('[inventoryFlow] finalize_capsule_claim failed — falling back to addItem:', error.code, error.message);
        }
      }
      if (!capsuleId || rpcError) {
        // No capsuleId OR RPC failed — direct insert via legacy path.
        // Returns null silently if userId/userEmail/item are missing,
        // so wrap in try and throw if the row didn't land.
        const row = await inventory.addItem(
          userProfile?.id || user?.id,
          user.email,
          wonItem,
          'capsule',
        );
        if (!row) throw rpcError || new Error('inventory_insert_failed');
      }

      queryClient.invalidateQueries({ queryKey: ['userInventory', user.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
      toast.success(`${wonItem.emoji} ${wonItem.name} added to your bag!`);
    } catch (err) {
      console.error('[inventoryFlow] capsule claim failed (both paths):', err);
      toast.error('Could not save item. Try again.');
    }
  }, [openingCapsule, user, userProfile, queryClient]);

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
    openCapsule,
    closeOpener,
    claimCapsule,
    capsuleCount,
  };
}

// Convenience: anywhere outside the bag-owning component can call this
// to request that the bag be opened.
export function requestOpenBag() {
  window.dispatchEvent(new CustomEvent(OPEN_BAG_EVENT));
}
