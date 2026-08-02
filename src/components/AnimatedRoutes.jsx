import { motion } from 'framer-motion';
import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';

// Order of bottom-tab routes — used to compute slide direction so
// switching forward (Dashboard → Workout) slides right-to-left, and
// switching backward (Workout → Dashboard) slides left-to-right.
// Routes not in this list (modals, sub-routes) get a soft cross-fade
// instead of a directional slide to avoid "where did the page come
// from" confusion.
const TAB_ORDER = [
  '/dashboard',
  '/workout',
  '/hub',
  '/progress',
  '/nutrition',
];

function tabIndex(pathname) {
  return TAB_ORDER.indexOf(pathname);
}

// ── Why there is no <AnimatePresence> here ──────────────────────────────
//
// This used to be `<AnimatePresence mode="popLayout">` wrapping a keyed
// motion.div whose child was `<Outlet />`. Two things went wrong, and
// together they produced the "I had to exit the nutrition onboarding five
// times, and the background is black" report:
//
//   1. Exiting children never got removed. Under React 18 StrictMode with
//      framer-motion 11, the exit-complete callback doesn't fire reliably,
//      so every navigation left one more corpse `motion.div` in the tree at
//      `opacity: 0; pointer-events: none`.
//   2. `<Outlet />` is a context consumer — it renders whatever route
//      matches RIGHT NOW, not the route that was live when it mounted. So
//      each of those corpses re-rendered as the *incoming* page. Land on
//      /nutrition after N navigations and you get N+1 live Nutrition pages,
//      each running its own effects and queries.
//
// `opacity: 0` hides a corpse's own markup, but anything it portals to
// `document.body` escapes that — and every Radix Dialog portals. Hence N
// stacked onboarding modals (one dismissal each) over N stacked
// `bg-black/80` scrims (1 − 0.2^N → solid black).
//
// `mode="wait"` doesn't fix it: it hits the same stuck-exit bug, and then
// the incoming page never mounts at all — the app just goes blank.
//
// So: no exit animation. A keyed motion.div with an enter-only transition
// lets React do what it already does correctly — unmount the old subtree
// synchronously when the key changes, mount exactly one new one. The
// outgoing page disappears instead of fading, which is a fraction of a
// frame of polish traded for a guarantee that a page can never be mounted
// twice. Don't reintroduce AnimatePresence here without a mount-count
// check on a route change.
// ── Why the enter animation is skipped on a hidden document ─────────────────
//
// The page's visibility is gated on this animation running: it mounts at
// `opacity: 0` and only the animation brings it to 1. Framer drives that on
// requestAnimationFrame, and rAF does not fire while `document.hidden` — so a
// page that MOUNTS hidden sits at `opacity: 0` indefinitely. Its markup is
// still laid out and still hit-tested, because opacity doesn't affect either.
//
// That's an invisible-but-interactive page, which is the bad half of both
// states: a tap lands on a real control the user cannot see. It's reachable
// whenever a route mounts in a background tab — "open in new tab" on a shared
// link, a PWA restored into the background, an automated/offscreen browser.
//
// Passing `initial={false}` tells framer to start AT the animate values rather
// than transition to them, so the page is simply visible with no enter
// animation. Nothing changes for a normally-focused mount, which is every
// mount a user actually watches: the polish is only skipped in the case where
// by definition nobody is looking.
function mountedHidden() {
  return typeof document !== 'undefined' && document.hidden === true;
}

export default function AnimatedRoutes({ resetNonce = 0 }) {
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Read once per mount. The motion.div is keyed, so it remounts per route and
  // each page independently gets the right answer for its own mount.
  const [hiddenAtMount] = useState(mountedHidden);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  // Directional slide: -1 = previous was further right → new slides in
  // from left. +1 = previous was further left → new slides in from
  // right. 0 = non-tab transition → cross-fade only.
  const prevIdx = tabIndex(previousPathRef.current);
  const currIdx = tabIndex(location.pathname);
  const direction =
    prevIdx >= 0 && currIdx >= 0 && prevIdx !== currIdx
      ? Math.sign(currIdx - prevIdx)
      : 0;

  useEffect(() => {
    previousPathRef.current = location.pathname;
  }, [location.pathname]);

  // Reduced motion → no transform, cross-fade only. Modest distance
  // (24px) keeps the slide subtle.
  const slideOffset = reducedMotion ? 0 : 24;

  return (
    <motion.div
      // Nonce is appended so re-tapping the active tab (which bumps it
      // in Layout) forces a fresh remount of the page — resetting any
      // open sub-view back to the root. Different-tab navigation still
      // remounts via the pathname portion.
      key={`${location.pathname}#${resetNonce}`}
      // `false` = start at the animate values. See the note above: a hidden
      // document never runs rAF, so animating in would leave the page
      // invisible-but-tappable instead of just un-animated.
      initial={hiddenAtMount ? false : { opacity: 0, x: direction * slideOffset }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
    >
      <Outlet />
    </motion.div>
  );
}
