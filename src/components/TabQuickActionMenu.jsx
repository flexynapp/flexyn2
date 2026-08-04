// src/components/TabQuickActionMenu.jsx
//
// Small floating popover that springs out of a bottom-tab on long-press
// (400ms). Renders 1-3 contextual quick actions per tab — same gesture
// as Instagram/Twitter, ergonomic on mobile because the user doesn't
// have to navigate AWAY to start the action they came for.
//
// Per-tab action maps live in `TAB_ACTIONS` below. To add a new tab:
//   1. Add an entry keyed by route path.
//   2. Each action: { id, label, icon (Lucide component), onClick }.
//   3. The menu auto-renders the entries; no JSX change needed.
//
// Anchored to the tab's bounding rect — we read the rect from the
// click target passed via props so the popover slots directly above
// it regardless of which tab fired the gesture.

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

export default function TabQuickActionMenu({ open, anchorRect, actions, onClose }) {
  const menuRef = useRef(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // Slight delay so the same long-press release doesn't also count
    // as an "outside click" and immediately dismiss the menu.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onDocClick);
      window.addEventListener('touchstart', onDocClick);
      window.addEventListener('keydown', onKey);
    }, 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('touchstart', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!actions || actions.length === 0) return null;

  // Center horizontally over the tab; sit ~12px above its top edge.
  const left = anchorRect ? anchorRect.left + anchorRect.width / 2 : 0;
  const bottom = anchorRect
    ? Math.max(0, window.innerHeight - anchorRect.top + 12)
    : 80;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Invisible backdrop catches the next tap to dismiss. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-40"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.9, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 6 }}
            transition={{ type: 'spring', stiffness: 460, damping: 28 }}
            style={{
              left,
              bottom,
              transform: 'translateX(-50%)',
            }}
            className="fixed z-50 min-w-[200px] rounded-2xl border border-border bg-card shadow-xl overflow-hidden"
            role="menu"
          >
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  try { action.onClick(); } catch { /* swallow — menu's job is to dispatch, not own errors */ }
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-foreground hover:bg-secondary active:bg-secondary transition-colors border-b border-border last:border-b-0"
              >
                {action.icon && <action.icon className="w-4 h-4 text-primary shrink-0" />}
                <span className="text-start flex-1">{action.label}</span>
              </button>
            ))}
            {/* Small downward-pointing tab connector so the menu looks
                tethered to the originating tab, not floating randomly. */}
            <div
              aria-hidden="true"
              className="absolute -bottom-1.5 start-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-card border-e border-b border-border"
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
