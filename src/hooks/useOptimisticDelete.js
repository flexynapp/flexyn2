// src/hooks/useOptimisticDelete.js
//
// Gmail-style optimistic-delete-with-undo. Replaces the universal
// "Are you sure?" dialog pattern with a faster, more forgiving flow:
//
//   1. User taps Delete on an item.
//   2. Item disappears INSTANTLY from the local cache (optimistic).
//   3. A toast slides up: "Deleted · Undo" with a 6-second progress bar.
//   4a. User taps Undo → item reappears, no server round-trip ever happens.
//   4b. User does nothing → at 6s the actual server delete fires.
//   4c. User navigates away → commit the pending delete on unmount so
//       nothing dangles.
//
// The 6-second deferred-delete window is the whole point: until it
// elapses, the server still has the row. The optimistic state is
// purely client-side. This is what makes the Undo path zero-cost —
// it just cancels a setTimeout.
//
// USAGE
//
//   const optDelete = useOptimisticDelete({
//     queryKey: ['workouts', userEmail],
//     identify: (item) => item.id,
//     deleteFn: (id) => workouts.remove(id),
//     label: 'Workout deleted',
//   });
//
//   const handleDeleteClick = (workout) => {
//     optDelete.deleteWithUndo(workout);
//   };
//
// PROPS
//
//   queryKey   The TanStack Query key holding the list. We mutate
//              this cache directly to drop the item from view; the
//              real delete fires later.
//   identify   item → unique id (string|number). Used to filter.
//   deleteFn   (id) → Promise. The real server call.
//   label      Toast headline. "Deleted" alone is too terse; surface
//              the noun: "Workout deleted", "Goal deleted", etc.
//   restoreFn  Optional. If the cache is wiped between optimistic-
//              hide and undo (e.g., a refetch landed), this rebuilds.
//              Most cases can rely on TanStack's cache holding state.
//   commitMs   Default 6000ms. The undo window.
//
// EDGE CASES HANDLED
//
//   • Rapid multi-delete: each tap fires an independent timer. The
//     toast stacks (sonner handles this).
//   • Page unmount before commit: useEffect cleanup runs the commit
//     so nothing dangles unsent.
//   • Server delete fails: re-inserts the item into the cache + shows
//     an error toast. The 6-second window already passed, so the user
//     might not be on the same screen — accept that the restored
//     item is back where it was, marked appropriately by TanStack's
//     cache freshness.
//   • Component remounts while a delete is pending: the timer is
//     kept alive in a module-level Map so a stale-closure remount
//     doesn't lose the pending operation.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { triggerHaptic } from '@/lib/haptic';
import { reportError } from '@/lib/reportError';

// Module-level pending-deletes registry. Survives component unmount
// so an unrelated render doesn't lose state. Map<id, { timer, item, queryKey, deleteFn }>.
const PENDING = new Map();

function commitPending(id) {
  const entry = PENDING.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  PENDING.delete(id);
  // Fire the real server delete. We don't wait for it; on failure
  // the catch handler re-inserts the item.
  Promise.resolve(entry.deleteFn(id)).catch((err) => {
    reportError(err, { feature: entry.feature || 'optimistic-delete.commit', level: 'warning' });
    // Restore: put the item back at its original index if we can.
    try {
      entry.queryClient.setQueryData(entry.queryKey, (prev) => {
        if (!Array.isArray(prev)) return prev;
        // Idempotent re-insert: skip if already present.
        if (prev.some((row) => entry.identify(row) === id)) return prev;
        const next = [...prev];
        const idx = Math.min(entry.originalIndex ?? next.length, next.length);
        next.splice(idx, 0, entry.item);
        return next;
      });
      toast.error(`Couldn't delete — restored.`);
    } catch { /* best-effort */ }
  });
}

function undoPending(id) {
  const entry = PENDING.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  PENDING.delete(id);
  // Restore the optimistic cache hide.
  try {
    entry.queryClient.setQueryData(entry.queryKey, (prev) => {
      if (!Array.isArray(prev)) return prev;
      if (prev.some((row) => entry.identify(row) === id)) return prev; // already there
      const next = [...prev];
      const idx = Math.min(entry.originalIndex ?? next.length, next.length);
      next.splice(idx, 0, entry.item);
      return next;
    });
    triggerHaptic('subtle');
  } catch { /* ignore */ }
}

export function useOptimisticDelete({
  queryKey,
  identify,
  deleteFn,
  label = 'Deleted',
  commitMs = 6000,
  feature,
} = {}) {
  const queryClient = useQueryClient();
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  // Commit all of THIS instance's pending deletes on unmount. We can't
  // tell which entries in PENDING belong to this hook, so we tag them
  // with a per-mount session id and clean up that subset.
  const sessionIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    const sid = sessionIdRef.current;
    return () => {
      // Commit anything outstanding for this session so we don't leave
      // orphaned delete intents floating after the user navigates away.
      for (const [id, entry] of PENDING.entries()) {
        if (entry.sessionId === sid) commitPending(id);
      }
    };
  }, []);

  const deleteWithUndo = (item) => {
    if (!item || !identify) return;
    const id = identify(item);
    if (id == null) return;

    // Locate the item's index in the live cache so we can restore in
    // place if the user hits Undo OR if the server delete fails.
    const list = queryClient.getQueryData(queryKeyRef.current);
    const originalIndex = Array.isArray(list)
      ? list.findIndex((row) => identify(row) === id)
      : -1;

    // Optimistic remove from cache.
    queryClient.setQueryData(queryKeyRef.current, (prev) =>
      Array.isArray(prev) ? prev.filter((row) => identify(row) !== id) : prev
    );

    // Schedule the actual delete after the undo window.
    const timer = setTimeout(() => commitPending(id), commitMs);
    PENDING.set(id, {
      timer,
      item,
      identify,
      queryKey: queryKeyRef.current,
      deleteFn,
      queryClient,
      originalIndex: originalIndex >= 0 ? originalIndex : undefined,
      sessionId: sessionIdRef.current,
      feature,
    });

    triggerHaptic('warning');

    // Sonner action toast → tap dismisses + invokes the action.
    toast(label, {
      duration: commitMs,
      action: {
        label: 'Undo',
        onClick: () => undoPending(id),
      },
    });
  };

  /**
   * Force-commit any pending deletes RIGHT NOW. Useful when the user
   * explicitly chooses a finality action (e.g., logging out) and we
   * don't want their pending deletes to be canceled by the unmount
   * + new-mount cycle.
   */
  const flushPending = () => {
    const sid = sessionIdRef.current;
    for (const [id, entry] of PENDING.entries()) {
      if (entry.sessionId === sid) commitPending(id);
    }
  };

  return { deleteWithUndo, flushPending };
}
