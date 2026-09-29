// src/lib/inventoryFlow.js
// Owns the Bag → CapsuleOpener flow so it works from any surface (today:
// ProfileMenu; previously: Hub). The capsule-claim logic was lifted from
// Hub.jsx so the bag is no longer tied to the social route.
//
// Pattern (Layout mounts this once):
//   const bag = useBagFlow();
//   <UserBag open={bag.bagOpen} onClose={bag.closeBag} onOpenCapsule={bag.openCapsule} />
//   {bag.opening && <CapsuleOpener key={bag.openSeq} rows={bag.opening} next={bag.next}
//        onClaim={bag.claim} onClaimAndOpenNext={bag.claimAndOpenNext} onClose={bag.closeOpener} />}
//
// Nothing here writes a capsule row. Capsules are spent by open_capsule_atomic
// inside the opener; this module only finalizes legacy rolls through
// finalize_capsule_claim and refreshes the caches.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { supabase } from '@/api/supabaseClient';
import { CAPSULE_TIERS, MAX_OPEN_AT_ONCE, nextOnShelf, shelfByTier } from '@/lib/capsuleShelf';
import { useAuth } from '@/lib/AuthContext';
import * as capsules from '@/lib/data/capsules';
import { asT } from '@/lib/translatorArg';

// Custom event name used by external callers (e.g. StatsHubModal "Bag &
// Capsules" tile) to ask whatever currently owns the bag flow to open
// it. Modeled on the existing `flexyn-title` cardio-header convention.
export const OPEN_BAG_EVENT = 'flexyn-open-bag';

// Custom event for surfaces outside the bag (the Capsules page) that want
// the opener itself, skipping the bag. `detail.rows` is the capsules to open.
export const OPEN_CAPSULES_EVENT = 'flexyn-open-capsules';

// Everything an open changes, for one refresh.
function capsuleRefreshKeys(email) {
  return [
    ['userInventory', email],
    ['userCapsules', email],
    ['userCapsulesCount', email],
    ['capsuleOpenHistory', email],
    ['capsulePity', email],
  ];
}

export function useBagFlow(t) {
  const tf = asT(t);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [bagOpen, setBagOpen] = useState(false);
  // The capsules the opener is running: one row or several of one tier.
  const [opening, setOpening] = useState(null);
  // Where the open started. Collecting from the bag lands back in the bag;
  // collecting from the Capsules page lands back on the page, so the bag
  // must not pop open over it.
  const [origin, setOrigin] = useState('bag');
  // Bumped on every open so "Collect and open the next" mounts a fresh
  // opener rather than reusing the finished one's state.
  const [openSeq, setOpenSeq] = useState(0);
  // Rows already sent to the opener. The unopened-capsule cache can lag the
  // server by a refetch, so "what's next" must never offer one of these.
  const spentRef = useRef(new Set());

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

  const openBag = useCallback(() => setBagOpen(true), []);
  const closeBag = useCallback(() => setBagOpen(false), []);

  const begin = useCallback((rows, from) => {
    const list = (Array.isArray(rows) ? rows : [rows]).filter(r => r?.id).slice(0, MAX_OPEN_AT_ONCE);
    if (list.length === 0) return;
    list.forEach(r => spentRef.current.add(r.id));
    // Closing the bag first prevents a frame where both surfaces stack.
    setBagOpen(false);
    setOrigin(from);
    setOpening(list);
    setOpenSeq(n => n + 1);
  }, []);

  /** Open one capsule (from the bag). */
  const openCapsule = useCallback((row) => begin([row], 'bag'), [begin]);
  /** Open several capsules of one tier in one run (from the bag). */
  const openCapsuleBatch = useCallback((rows) => begin(rows, 'bag'), [begin]);

  // What the reveal can offer next: more of the same tier, else the rarest
  // other tier still on the shelf. Read from the shelf cache, minus rows
  // already spent in this session.
  const next = useMemo(() => {
    if (!opening || !user?.email) return null;
    const cached = queryClient.getQueryData(['userCapsules', user.email]);
    if (!Array.isArray(cached)) return null;
    const left = cached.filter(r => r?.id && !spentRef.current.has(r.id));
    const shelf = shelfByTier(left);
    const tier = CAPSULE_TIERS.includes(opening[0]?.capsule_type) ? opening[0].capsule_type : 'standard';
    return nextOnShelf(shelf, tier, 0);
    // openSeq: recompute for every open, since spentRef changes in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, openSeq, user?.email, queryClient]);

  const closeOpener = useCallback(() => setOpening(null), []);

  /**
   * Settle every result from an open, without touching the UI.
   *
   * Anything opened through open_capsule_atomic (mig 255) is already in
   * inventory, so there is nothing to do but refresh. Only a legacy roll
   * (a pre-255 database) still needs finalize_capsule_claim, one call per
   * capsule, sequentially: firing a dozen concurrent grants is the shape
   * the atomic RPCs were introduced to kill. Failures are counted rather
   * than thrown so one bad row can't strand the rest; the rolled rarity is
   * persisted on each capsule row, so a failed finalize stays retryable.
   */
  const settle = useCallback(async (results) => {
    if (!Array.isArray(results) || results.length === 0 || !user?.email) return;
    const pending = results.filter(r => !r.granted);
    let failed = 0;

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
      } catch (err) {
        console.warn('[inventoryFlow] capsule finalize failed:', capsuleId, err?.message);
        failed += 1;
      }
    }

    for (const key of capsuleRefreshKeys(user.email)) queryClient.invalidateQueries({ queryKey: key });

    // No success toast: the opener shows the item dropping into the bag
    // and says so in place before it closes. The toast used to land over
    // the page title the opener had just uncovered.
    if (failed > 0) {
      toast.error(tf('inventoryFlow.saveFailedMany', '{n} could not be saved. Open them again to retry.', { n: failed }));
    }
  }, [user, queryClient, tf]);

  /** Collect: close the opener, land back where the open started. */
  const claim = useCallback(async (results) => {
    setOpening(null);
    if (origin === 'bag') setBagOpen(true);
    await settle(results);
  }, [origin, settle]);

  /** Collect this open and go straight into the next one. */
  const claimAndOpenNext = useCallback(async (results) => {
    const target = next;
    if (!target) { await claim(results); return; }
    begin(target.rows, origin);
    await settle(results);
  }, [next, claim, begin, origin, settle]);

  // Global events: "open the bag" from any surface, and "open these
  // capsules" from the Capsules page.
  useEffect(() => {
    const onBag = () => setBagOpen(true);
    const onCapsules = (e) => begin(e?.detail?.rows ?? [], 'page');
    window.addEventListener(OPEN_BAG_EVENT, onBag);
    window.addEventListener(OPEN_CAPSULES_EVENT, onCapsules);
    return () => {
      window.removeEventListener(OPEN_BAG_EVENT, onBag);
      window.removeEventListener(OPEN_CAPSULES_EVENT, onCapsules);
    };
  }, [begin]);

  return {
    bagOpen,
    openBag,
    closeBag,
    opening,
    openSeq,
    next,
    openCapsule,
    openCapsuleBatch,
    closeOpener,
    claim,
    claimAndOpenNext,
    capsuleCount,
  };
}

// Convenience: anywhere outside the bag-owning component can call this
// to request that the bag be opened.
export function requestOpenBag() {
  window.dispatchEvent(new CustomEvent(OPEN_BAG_EVENT));
}

/** Ask the global opener to open these capsule rows (one tier, up to ten). */
export function requestOpenCapsules(rows) {
  window.dispatchEvent(new CustomEvent(OPEN_CAPSULES_EVENT, { detail: { rows } }));
}
