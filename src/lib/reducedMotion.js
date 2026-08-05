// src/lib/reducedMotion.js
//
// One-line read of the OS "reduce motion" setting, for components that
// need to branch on it at render time rather than in CSS.
//
// Extracted while collapsing the three AnimatedNumber implementations:
// HeroSlideshow's private copy of the count-up also owned the module's
// only `prefersReducedMotion`, which two unrelated components in the same
// file (Sparkline, ProgressBar) had quietly started using. Deleting the
// duplicate count-up therefore broke them — the kind of coupling that only
// shows up when you pull the thread.
//
// Not a hook on purpose. It reads the value once, at the moment it's
// called, which is what a mount-time animation decision needs. If a
// component has to REACT to the setting changing mid-session, subscribe to
// the MediaQueryList directly (StreakFlame and BackToTopButton both do);
// this returning a plain boolean is what keeps it usable inside a render
// body, an effect, or a plain module function alike.
//
// Guards on `window` and on `matchMedia` separately: jsdom provides
// `window` but the test setup does not always stub `matchMedia`, and a
// throwing media query must degrade to "motion allowed" rather than
// crashing a render — the worst case is an animation that plays, never a
// blank screen.
//
// Several other components still carry their own identical copy of this
// (CapsuleOpener, StepsLogCard, LevelUpOverlay, SnakeGameModal,
// ThemeAnimationLayer, DailyQuestsCard, SplashScreen). Point them here
// when you next touch them; they weren't swept in the same commit as the
// AnimatedNumber work because animation code is where a silent regression
// is hardest to notice, and none of them is wrong today.

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

export default prefersReducedMotion;
