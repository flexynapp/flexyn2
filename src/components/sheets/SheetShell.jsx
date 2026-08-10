// SheetShell — the bottom-sheet chrome QuestsSheet and ReadinessSheet
// established, extracted so new sheets inherit it rather than re-typing it.
//
// WHY THIS EXISTS. Two sheets already carry this markup inline, which was
// fine at two. Advanced Analytics and Personal Bests were rebuilt onto the
// same shape (kegan, 2026-08-10 — "I would like these two menus to open and
// appear as the Daily Quests and Readiness menus"), and writing the same
// twenty lines a third and fourth time in one commit is not defensible.
//
// QuestsSheet and ReadinessSheet are deliberately NOT migrated here. They
// were being edited by other sessions when this landed, and a shared shell
// is worth having whether or not they move onto it. **If you touch either
// of them, move them over** — the markup below is theirs, copied.
//
// What the shell owns, and why each piece is load-bearing:
//
//   · A backdrop that closes on tap, and Escape — every dismissible
//     surface in this app answers to both.
//   · `useBodyScrollLock(open)`, or the page scrolls underneath the sheet.
//   · A grab handle. The sheet is swipe-dismissible by habit on iOS and the
//     handle is what says so before someone tries.
//   · `pb-[max(1rem,env(safe-area-inset-bottom))]` — the sheet escapes
//     Layout.jsx, and anything that escapes Layout owns its own insets.
//   · A close button with a RESTING fill, not a hover-only one. There is no
//     hover on the phones this ships to, so a hover-revealed control is
//     invisible until tapped. (QuestsSheet's comment; kept because it is
//     the kind of thing that gets "cleaned up" by someone on a desktop.)
//   · `if (!open) return null` — callers lazy-load these, and React.lazy
//     defers the CHUNK, not any query inside. A mounted-but-closed sheet
//     would still fetch, so callers must ALSO gate queries on `enabled: open`.
//
// NOT in src/components/ui/. That directory is vendored shadcn primitives
// and eslint.config.js puts `src/components/ui/**/*` in its ignores, so a
// component of ours placed there would silently stop being linted. This is
// our own composite, so it lives with the other feature components.
//
// The 0.32s [0.22, 1, 0.36, 1] ease and `max-h-[88vh]` are copied exactly
// from the two originals. They are not tuned values to re-derive; they are
// what "opens like Daily Quests" means.

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

export default function SheetShell({ open, onClose, kicker, children, labelledBy }) {
  useBodyScrollLock(open);
  const { tFallback } = useLanguage();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
      />
      {/* No AnimatePresence: callers unmount on close, so an exit animation
          would never get to run. Entry animates; exit is immediate. */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl bg-card border-t border-border pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="sticky top-0 z-10 bg-card pt-2.5 pb-1 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-foreground/20" aria-hidden="true" />
        </div>

        <div className="px-4 md:px-6 pb-4">
          <div className="flex items-start justify-between gap-3">
            <p id={labelledBy} className="text-micro font-semibold tracking-[0.04em] text-primary">
              {kicker}
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label={tFallback('common.close', 'Close')}
              className="shrink-0 w-8 h-8 -me-1 rounded-full flex items-center justify-center bg-foreground/[0.08] text-muted-foreground hover:bg-foreground/[0.14] active:bg-foreground/[0.14] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {children}
        </div>
      </motion.div>
    </div>
  );
}
