// src/lib/listMotion.js
//
// The shared shape for "a grid of cards whose MEMBERSHIP changes" — a
// filtered marketplace, the Bag, the regimen store, a photo grid.
//
// WHY THIS EXISTS
//
// Every one of those surfaces independently reached for the same three
// framer-motion features, and the same three of them are what made
// filtering feel choppy:
//
//   <motion.div layout>                       ← parent projects too
//     <AnimatePresence>                       ← default mode is "sync"
//       {items.map(i => <Card layout … />)}   ← full layout on every card
//     </AnimatePresence>
//   </motion.div>
//
// Three separate costs, and they compound:
//
// 1. **`<AnimatePresence>` defaults to `mode="sync"`, which keeps exiting
//    children IN THE DOCUMENT FLOW for the whole exit animation.** Tap
//    "Trade" on a 60-listing marketplace and ~40 cards begin fading while
//    still occupying their grid slots. The survivors cannot reach their
//    final positions until those slots are released, so they animate to
//    where they'd sit in the OLD layout, and then the exits unmount, the
//    row reflows, and every survivor re-projects to a second target. That
//    double move is the "choppy" the eye actually catches — it is not a
//    frame-rate problem, it is the cards visibly changing their minds.
//    `mode="popLayout"` takes exiting children out of flow immediately
//    (they're absolutely positioned where they were), so survivors get one
//    correct target and travel to it once.
//
// 2. **`layout` (unqualified) animates position AND size**, which makes
//    framer measure each node twice per pass and then run scale correction
//    over its children — for a card holding a frame, a glow, a badge and
//    four text rows, that is a lot of work for an element whose size never
//    changes. These tiles have a fixed flex-basis and content-driven
//    height; only their POSITION moves when the grid refilters.
//    `layout="position"` is the accurate description and skips the
//    correction pass entirely.
//
// 3. **`layout` on the container as well** adds a projection node whose
//    only job is animating the row's own height. With exits already out of
//    flow the row can simply snap to its new height and let the cards
//    animate into it — animating the container too means the destination
//    is moving while the cards fly toward it.
//
// One more, which is not a framer issue but reads as one: a Tailwind
// `transition-opacity` class on an element whose opacity framer is ALSO
// animating. Framer writes `style.opacity` every frame, and each write
// starts a fresh 150ms CSS transition toward that value, so what renders
// lags what framer computed and the fade looks smeared rather than clean.
// Never put a CSS transition on a property a motion component animates.
//
// USAGE
//
//   <div className={`${ROW} relative`}>
//     <AnimatePresence {...LIST_PRESENCE}>
//       {items.map(i => <Card key={i.id} {...listItemMotion()} />)}
//     </AnimatePresence>
//   </div>
//
// The container MUST be `relative`. `popLayout` positions an exiting child
// absolutely from its measured `offsetTop`/`offsetLeft`, which are relative
// to the nearest positioned ancestor — leave the row static and exiting
// cards jump to coordinates measured against something further up the tree.
//
// ── TWO RULES BEFORE YOU APPLY THIS ANYWHERE ELSE ───────────────────────────
//
// A sweep of the app found 12 candidate collections and only 4 wanted this.
// Applying it mechanically would have broken most of the rest, so check both:
//
// **1. Does the exit collapse `height`?** Then popLayout is WRONG and `sync`
//    is already correct. `exit={{ opacity: 0, height: 0 }}` is a deliberate
//    in-flow collapse: the row shrinks and everything below slides up to
//    meet it. popLayout takes the row out of flow, so there is nothing left
//    to collapse and the rows below snap instead. The set logger, the cardio
//    segment list, the meal list, the crew join queue and the resume-session
//    list all rely on this. Leave them alone. This module is for collections
//    that FADE OUT IN PLACE and need their neighbours to reflow around them.
//
// **2. Does the container space with `space-y-*`?** Then convert it to
//    `flex flex-col gap-*` first — same pixels, different mechanism.
//    `space-y` puts a `margin-top` on every child after the first, and
//    framer pins an exiting child with `top: <its offsetTop>` while adding
//    `position/width/height/top/left` — but NOT `margin: 0`. offsetTop
//    already includes that margin, so it lands twice and the card visibly
//    drops by one space step the instant it starts to leave. A `gap` belongs
//    to the parent, so it cannot double-count. Flex/grid `gap` is safe;
//    `space-y` is not.
//
// Reduced motion needs no handling here: App.jsx wraps the tree in
// `<MotionConfig reducedMotion="user">`, which strips transforms and opacity
// for anyone who has asked the OS for less movement.

/** Spread onto `<AnimatePresence>` for any data-driven collection. */
export const LIST_PRESENCE = {
  // See (1) above — the single highest-value change.
  mode: 'popLayout',
  // Don't animate the first paint. A grid that flies 60 cards in on every
  // mount costs the most at the moment the user is least able to wait, and
  // items added later still animate normally.
  initial: false,
};

// Short and decelerating. framer's default layout transition is a spring
// tuned for one hero element; run it on 40 tiles at once and the tail of the
// settle reads as the grid wobbling rather than as weight.
const EASE_OUT = [0.22, 1, 0.36, 1];

/**
 * Motion props for one tile in such a collection.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.dim]  Render at half opacity instead of full — for
 *   a tile that is still on screen but no longer actionable (the
 *   marketplace's ~5s SOLD stamp). This has to be an animation target, not
 *   an `opacity-50` class: framer writes opacity inline, and an inline style
 *   beats a class, so the class silently does nothing.
 * @returns {object} spread onto a motion component.
 */
export function listItemMotion({ dim = false } = {}) {
  return {
    layout: 'position',
    initial: { opacity: 0, y: 8 },
    animate: { opacity: dim ? 0.5 : 1, y: 0 },
    exit: { opacity: 0 },
    transition: { duration: 0.18, ease: EASE_OUT },
  };
}
