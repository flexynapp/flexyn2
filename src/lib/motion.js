// src/lib/motion.js
//
// Shared motion vocabulary. The owner's feedback (2026-09-26) was that the
// app read as "static and bland", and the answer is MOTION AND FEEDBACK, not
// decoration: a page that arrives in a short cascade, numbers that count to
// their value, a card that gives under the thumb. None of that is a new
// colour, gradient or shadow, so none of it touches the composition rules.
//
// Three rules keep it from turning into noise:
//
// 1. **Short.** Entrances are 180 to 260ms. Anything longer is the user
//    waiting for the app rather than the app responding to the user.
// 2. **Small.** A rise is 8px, the same distance `listMotion.js` uses for a
//    tile, so the page and the collections inside it move as one system.
// 3. **Opacity and transform only.** Never `layout` here. Dashboard's rows
//    are `Reorder.Item`s whose membership changes as queries resolve, and
//    layout projection outside edit mode is exactly what painted Discover on
//    top of the rows below it (see CLAUDE.md, UI composition). These
//    variants animate an element's own paint and never its box.
//
// Reduced motion needs nothing here. App.jsx wraps the tree in
// `<MotionConfig reducedMotion="user">`, which strips transform and opacity
// animation for anyone who has asked the OS for less movement, so every
// variant below resolves to its final state immediately for them. Components
// that animate outside framer (count ups, CSS fills) read the setting through
// `useCountUp` / `prefersReducedMotion` instead.

/** Decelerating curve. Arrives fast, settles gently. Same as listMotion. */
export const EASE_OUT = [0.22, 1, 0.36, 1];

/** Durations in seconds, for framer transitions. */
export const DURATION = {
  fast: 0.18,
  base: 0.22,
  slow: 0.26,
};

/** Delay between siblings in a staggered entrance, in seconds. */
export const STAGGER = 0.04;

/** Rise distance for an entering element, in px. */
export const RISE_PX = 8;

/**
 * Springs. `press` is stiff and heavily damped so a tap reads as a firm
 * give rather than a wobble; `pop` overshoots once, for a completion mark.
 */
export const SPRING = {
  press: { type: 'spring', stiffness: 520, damping: 34, mass: 0.6 },
  pop: { type: 'spring', stiffness: 460, damping: 16, mass: 0.7 },
};

/** Plain eased tween for entrances. */
export const TWEEN = { duration: DURATION.base, ease: EASE_OUT };

/**
 * Container variant: staggers its children in. Put this on the parent and
 * `staggerItem` on each child, then drive the parent with
 * `initial="hidden" animate="show"`.
 *
 * @param {object} [opts]
 * @param {number} [opts.stagger]      seconds between children
 * @param {number} [opts.delayChildren] seconds before the first child
 */
export function staggerContainer({ stagger = STAGGER, delayChildren = 0 } = {}) {
  return {
    hidden: {},
    show: {
      transition: { staggerChildren: stagger, delayChildren },
    },
  };
}

/** Child variant: fade plus an 8px rise. */
export const staggerItem = {
  hidden: { opacity: 0, y: RISE_PX },
  show: { opacity: 1, y: 0, transition: TWEEN },
};

/**
 * Props for one element that fades up on mount without a parent container.
 * `index` staggers it against its siblings. Use this where the siblings do
 * not share a motion parent, such as Dashboard rows that each live inside
 * their own `Reorder.Item`.
 *
 * Capped at 8 steps so the tenth section on a long page does not wait
 * 400ms to appear; everything past the fold arrives with the eighth.
 *
 * @param {number} [index]
 * @returns {object} spread onto a motion component
 */
export function fadeUp(index = 0) {
  const step = Math.max(0, Math.min(8, Number(index) || 0));
  return {
    initial: { opacity: 0, y: RISE_PX },
    animate: { opacity: 1, y: 0 },
    transition: { ...TWEEN, delay: step * STAGGER },
  };
}

/** Scale pop for a mark that just became true (a quest check). */
export const popIn = {
  initial: { scale: 0.4, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  transition: SPRING.pop,
};
