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
    if (!wonItem || !user?.email) return;
    try {
      const saveOps = [
        inventory.addItem(userProfile?.id || user?.id, user.email, wonItem, 'capsule'),
      ];
      if (capsuleId) saveOps.push(capsules.openCapsule(capsuleId));
      await Promise.all(saveOps);

      queryClient.invalidateQueries({ queryKey: ['userInventory', user.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
      toast.success(`${wonItem.emoji} ${wonItem.name} added to your bag!`);
    } catch (err) {
      console.error('[inventoryFlow] capsule claim failed:', err);
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
