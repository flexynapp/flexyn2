// src/lib/journalOverlay.js
//
// Who owns the My Journal overlay, and how anything else asks for it.
//
// It used to live inside ProfileMenu — which Layout renders TWICE, once
// in the desktop sidebar and once in the mobile header (see the comment
// above `useBagFlow` in Layout.jsx, which moved the Bag out for exactly
// this reason). Two copies means two independent `journalOpen` states and
// two JournalView instances, each with its own debounced autosave writing
// the same (user, date) row. Only one menu is visible at a time so a user
// cannot normally trigger both, but driving them both from a script mounts
// two overlays at once, which is how this surfaced.
//
// So the overlay gets a single global mount in Layout, and everything else
// — the profile menu, the dashboard widget — asks for it by event. Modeled
// exactly on OPEN_BAG_EVENT in inventoryFlow.js, which solved the same
// problem for the same reason.

import { useState, useEffect, useCallback } from 'react';

export const OPEN_JOURNAL_EVENT = 'flexyn-open-journal';

/**
 * Owns the overlay's open state. Mount this ONCE, in Layout.
 * `detail.date` (YYYY-MM-DD) is optional and opens straight to that day.
 */
export function useJournalOverlay() {
  const [open, setOpen] = useState(false);
  const [initialDate, setInitialDate] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      setInitialDate(e?.detail?.date || null);
      setOpen(true);
    };
    window.addEventListener(OPEN_JOURNAL_EVENT, handler);
    return () => window.removeEventListener(OPEN_JOURNAL_EVENT, handler);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  return { open, initialDate, close };
}

/**
 * Ask whoever owns the overlay to open it. Safe from anywhere — no ref, no
 * context, and no knowledge of which copy of a menu is currently on screen.
 */
export function requestOpenJournal(date) {
  window.dispatchEvent(new CustomEvent(OPEN_JOURNAL_EVENT, { detail: { date: date || null } }));
}
