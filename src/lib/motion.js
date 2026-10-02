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

/**
 * Accelerating curve, for something LEAVING. An exit that decelerates looks
 * like it is reluctant to go; one that accelerates gets out of the way.
 */
export const EASE_IN = [0.4, 0, 1, 1];

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
 * `settle` is for something MOVING to a new place (a tab's icon lifting, a
 * sheet arriving): no overshoot, it just lands. `heavy` is for the few
 * full-screen moments (a rank change, a capsule opening), where the object
 * should feel like it has weight. Damping ratios: press 1.0, pop 0.45,
 * settle 0.84 (under 1% overshoot, which reads as no overshoot), heavy 0.61.
 *
 * Names are permanent once something imports them. Add a spring, never
 * retune one in place: a retune silently changes every screen that uses it.
 */
export const SPRING = {
  press: { type: 'spring', stiffness: 520, damping: 34, mass: 0.6 },
  pop: { type: 'spring', stiffness: 460, damping: 16, mass: 0.7 },
  settle: { type: 'spring', stiffness: 320, damping: 30, mass: 1 },
  heavy: { type: 'spring', stiffness: 220, damping: 20, mass: 1.2 },
};

/**
 * The three tiers every animation in the app belongs to. Pick the tier
 * first, then take its spring and haptic from here, so the same kind of
 * event feels the same on every screen.
 *
 * - `answer`: the app acknowledging a tap or a save. Under a quarter of a
 *   second, firm, the lightest haptic. Most motion is this.
 * - `reward`: something good happened (a check drawing, a number rolling
 *   up). Up to half a second, one overshoot, the success haptic, and the
 *   only tier that may turn something `--success` green.
 * - `moment`: a full-screen sequence the user stops to watch. Its timing
 *   lives with the sequence (see `DRAMA` in capsules/openFx.jsx); this only
 *   fixes the spring and the haptic. Shake, flash and sparks belong here
 *   and nowhere else.
 *
 * `haptic` is an intensity name for `triggerHaptic` in `@/lib/haptic`.
 */
export const TIER = {
  answer: { maxDuration: 0.26, spring: SPRING.press, haptic: 'subtle' },
  reward: { maxDuration: 0.7, spring: SPRING.pop, haptic: 'success' },
  moment: { maxDuration: null, spring: SPRING.heavy, haptic: 'success' },
};

/**
 * The same transition played `factor` times slower, for judging motion on a
 * test bench. A spring is time-scaled exactly by dividing stiffness by
 * factor squared and damping by factor, which keeps its overshoot and
 * settling shape identical, only longer. Durations and delays are
 * multiplied. Never ship a slowed transition; this is for preview pages.
 *
 * @param {object} transition framer transition
 * @param {number} factor     2 means half speed, 4 means quarter speed
 * @returns {object}
 */
export function slowMotion(transition, factor = 1) {
  const f = Number(factor) > 0 ? Number(factor) : 1;
  if (!transition || f === 1) return transition;
  const out = { ...transition };
  if (out.type === 'spring') {
    if (typeof out.stiffness === 'number') out.stiffness /= f * f;
    if (typeof out.damping === 'number') out.damping /= f;
  }
  if (typeof out.duration === 'number') out.duration *= f;
  if (typeof out.delay === 'number') out.delay *= f;
  return out;
}

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
