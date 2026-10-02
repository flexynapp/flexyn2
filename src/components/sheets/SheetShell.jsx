// SheetShell — the bottom-sheet chrome QuestsSheet and ReadinessSheet
// established, extracted so new sheets inherit it rather than re-typing it.
//
// WHY THIS EXISTS. Two sheets already carry this markup inline, which was
// fine at two. Advanced Analytics and Personal Bests were rebuilt onto the
// same shape (kegan, 2026-08-10 — "I would like these two menus to open and
// appear as the Daily Quests and Readiness menus"), and writing the same
// twenty lines a third and fourth time in one commit is not defensible.
//
// All four sheets are on it as of 2026-08-10: QuestsSheet and ReadinessSheet
// were migrated once the sessions editing them had landed. The markup below
// is originally theirs. **A fifth sheet uses this rather than copying it**,
// and sheetShell.test.jsx fails if any of the four re-inlines an overlay —
// the extraction only pays off while it stays extracted.
//
// Migrating them found one thing worth recording: ReadinessSheet carried
// `exit` props on its backdrop and panel that could never fire. Its own
// comment said so ("No AnimatePresence: Dashboard unmounts this component on
// close"), and its caller confirms it — `{open && <ReadinessSheet …/>}`. The
// comment was right and the code had drifted past it.
//
// What the shell owns, and why each piece is load-bearing:
//
//   · A backdrop that closes on tap, and Escape — every dismissible
//     surface in this app answers to both.
//   · `useBodyScrollLock(open)`, or the page scrolls underneath the sheet.
//   · A grab handle that actually dismisses. It was drawn as an affordance
//     with no drag behind it — this comment claimed the sheet was
//     "swipe-dismissible by habit on iOS" while a swipe did nothing, which is
//     the worst version: the control that says "pull me down" was the one
//     control on the sheet that wasn't wired. Dragging starts on the handle
//     ALONE, because the panel is also the scroller and a live drag listener
//     on it makes framer write `touch-action: pan-x` over the content. See
//     the comment at the drag props for the full mechanism.
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
import { motion, useDragControls } from 'framer-motion';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// Matches BottomSheet and DuelDetailSheet, so every dismissible sheet in the
// app answers to the same flick. Those two still carry their own copies of
// these numbers; if a third place needs them, move this predicate up rather
// than typing 300 and 80 again.
const VELOCITY_THRESHOLD = 300;  // px/s
const DISTANCE_THRESHOLD = 80;   // px

/**
 * Does this drag-end mean "close"? Exported so the thresholds can be tested
 * as behaviour rather than restated as arithmetic in a test file.
 *
 * Both conditions read DOWNWARD only (y is positive downward), which is what
 * keeps an upward flick from dismissing — `dragConstraints` pins the top at 0,
 * so an upward drag has nowhere to go and must not be read as intent.
 */
export function shouldDismiss(info) {
  return info.velocity.y >= VELOCITY_THRESHOLD || info.offset.y >= DISTANCE_THRESHOLD;
}

export default function SheetShell({ open, onClose, kicker, children, labelledBy }) {
  useBodyScrollLock(open);
  const { tFallback } = useLanguage();
  // Above the early return — hooks cannot sit behind one.
  const dragControls = useDragControls();

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
        drag="y"
        // The handle drags; the panel does not. That is not a style choice —
        // this element is ALSO the scroller (`overflow-y-auto` below), and
        // framer writes `touch-action: pan-x` onto a `drag="y"` element whose
        // listener is live (render/html/use-props.mjs). touch-action resolves
        // down the ancestor chain, so a live listener here would forbid the
        // very vertical pan the overflow exists for, and nothing past 88vh
        // could be reached. Four sheets share this shell, so that is four
        // features truncated at once — which is exactly what shipped in
        // components/ui/BottomSheet.jsx before 256b1551.
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.3 }}
        onDragEnd={(_e, info) => { if (shouldDismiss(info)) onClose(); }}
        className="relative z-10 w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl bg-card border-t border-border pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {/* `touch-none` because this bar is the one element that claims the
            vertical gesture; the panel keeps its own, so the content still
            scrolls. Stays `sticky top-0`, so the affordance is still there
            after you have scrolled down inside a long sheet. */}
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="sticky top-0 z-10 bg-card pt-2.5 pb-1 flex justify-center cursor-grab active:cursor-grabbing touch-none select-none"
        >
          <span className="w-10 h-1 rounded-full bg-foreground/20" aria-hidden="true" />
        </div>

        <div className="px-4 md:px-6 pb-4">
          <div className="flex items-start justify-between gap-3">
            <p id={labelledBy} className="kicker text-primary">
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
