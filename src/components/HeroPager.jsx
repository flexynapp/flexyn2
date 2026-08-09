// src/components/HeroPager.jsx
//
// The paged carousel engine behind every hero on the app — Dashboard's
// HeroSlideshow, the Progress stat carousel and the Nutrition shortcuts
// carousel. It owns the track, the gesture, the settle spring, the
// auto-rotation and the pagination dots. Callers own what a slide LOOKS
// like and nothing else.
//
// It exists because there were two carousels, not one. Dashboard's had been
// rebuilt as a real pager — a track holding every slide, translated under
// the finger, settling on a spring, clamped at the ends like an iOS home
// screen. Progress and Nutrition still ran the ORIGINAL version: a single
// slide cross-fading in place, with `drag` on a card pinned by
// `dragConstraints={{ left: 0, right: 0 }}` so the gesture rubber-banded
// back to where it started and the slide changed afterwards. Nothing
// travelled with the thumb, so the swipe read as a nudge that happened to
// trigger a fade — and side by side with the dashboard they read as two
// different components wearing the same dots.
//
// Everything below is that rebuilt engine, moved here verbatim. The comments
// are the expensive part: each one is a bug that was measured on a device.
//
// Imperative handle: { next, prev, goTo(i), goToId(id) }.

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { motion, animate, useMotionValue } from 'framer-motion';
import { useLanguage } from '@/lib/LanguageContext';
import { heroSlideAccent } from '@/lib/heroChrome';

const DEFAULT_ROTATE_MS = 8000;
// How long a touch holds the rotation still. Long enough to read a slide
// you deliberately navigated to; short enough that a stray tap doesn't
// freeze the carousel for the rest of the session.
const HOLD_MS = 12_000;

const HeroPager = forwardRef(function HeroPager({
  slides,
  renderSlide,
  rotateMs = DEFAULT_ROTATE_MS,
  onIndexChange,
  dotsClassName = 'mt-5',
  dotLabel,
}, ref) {
  const { tFallback } = useLanguage();
  const [idx, setIdx] = useState(0);

  // Reset to slide 0 if the slide set length shrinks below idx.
  useEffect(() => { if (idx >= slides.length) setIdx(0); }, [slides.length, idx]);

  // Auto-rotate. Pause via the `paused` state when the user touches the
  // carousel so they get a beat to read.
  const [paused, setPaused] = useState(false);
  const pauseTimerRef = useRef(null);
  // Declared here rather than beside page() so the auto-rotate effect below
  // isn't reading a binding defined further down the body — see CLAUDE.md's
  // TDZ note. Assigned on every render once page() exists.
  const pageRef = useRef(null);
  useEffect(() => {
    if (paused || slides.length <= 1) return;
    // Through page() rather than setIdx so a rotation GLIDES like a swipe.
    // Committing the index alone would cut straight to the next slide, and
    // a carousel that cuts on its own but glides under the thumb reads as
    // two different components sharing one card.
    const t = setTimeout(() => pageRef.current?.(1), rotateMs);
    return () => clearTimeout(t);
  }, [idx, paused, slides.length, rotateMs]);

  // Pause the rotation without moving the slide. Auto-rotate used to be
  // paused only when the user hit a dot or a chevron, so reaching for a
  // slide's own CTA raced the timer: an automated click pass lost that race
  // 133 times, and a thumb is slower than a clicker. Since the hero is the
  // largest tap target on its page, losing the race means tapping "Log a
  // meal" when you aimed at "Open a duel". Touching the slide at all now
  // holds it still.
  const holdRotation = () => {
    setPaused(true);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => setPaused(false), HOLD_MS);
  };

  /* ── Paged-track motion ─────────────────────────────────────────────
     `x` is the track's translation. It rests at `-idx * trackW`, i.e. with
     the current page in the box, and every commit animates it there. */
  const trackBoxRef = useRef(null);
  const [trackW, setTrackW] = useState(0);
  const x = useMotionValue(0);

  // Measure with a ResizeObserver rather than once on mount: the band is
  // min-height and (on Dashboard) full-bleed, so this width changes on
  // rotation and on any layout shift above it. A stale width leaves the
  // pages a different size from their container and the resting offset
  // wrong by exactly that error — measured 343px pages inside a 311px box
  // before this was fixed.
  //
  // `slides.length` stays in the deps: re-measuring when the slide set
  // changes is cheap, and it is the one moment the surrounding layout is
  // most likely to shift.
  useEffect(() => {
    const el = trackBoxRef.current;
    if (!el) return;
    const apply = () => setTrackW(el.clientWidth);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slides.length]);

  // Re-park on a WIDTH change only. idx is read through a ref rather than
  // taken as a dependency: settle() below moves the index and animates in
  // the same breath, so re-running this on idx would snap the track to rest
  // and eat the transition it just started.
  const idxRef = useRef(0);
  idxRef.current = idx;
  useEffect(() => {
    if (slides.length > 1) x.set(-idxRef.current * trackW);
  }, [trackW, slides.length, x]);

  /* Softer and slightly overdamped, after a second judder report.
   *
   * 420 stiffness against 40 damping was UNDER-damped for this mass: the
   * critical value is 2·√(k·m) = 2·√(420 × 0.8) ≈ 36.7, so 40 was only just
   * over it and the spring arrived fast and hard. On a phone that lands as
   * a snap at the end of an otherwise smooth drag, which reads as a judder
   * even when no frame is dropped.
   *
   * 260 / 34 / 0.9 sits comfortably past critical (2·√(260 × 0.9) ≈ 30.6),
   * so it eases in with no overshoot at all. Slower, and deliberately —
   * the finger has already done the fast part of the travel; the spring
   * only has to finish it.
   */
  const SETTLE = { type: 'spring', stiffness: 260, damping: 34, mass: 0.9 };
  // Gates re-entry only, so it wants to be a little longer than the visible
  // motion rather than exact. Raised with the softer spring — a window
  // shorter than the travel would let a second swipe start mid-settle,
  // which is the thing this exists to stop.
  const SETTLE_MS = 420;
  const settleUntilRef = useRef(0);

  /* settle — move to a slide index and animate the track to match.
   *
   * THE STUTTER THIS REPLACES. An earlier version mounted a three-slide
   * WINDOW (prev / current / next) and kept the track parked on the middle
   * one, so committing an index re-keyed every page into a different slot
   * and `x` had to shift a whole page to compensate. Those two changes go
   * through DIFFERENT schedulers — `setIdx` lands on React's, `x.set` on
   * Framer's rAF render loop — so they do not land on the same frame. In
   * the gap the browser paints the old window at the new offset, or the
   * reverse: a one-frame jump of exactly one page width, on every turn.
   *
   * The track holds EVERY slide and rests at `-idx * trackW`. Changing idx
   * no longer moves any slide between DOM slots — the pages are static and
   * only the transform moves them. So there is nothing to compensate for,
   * which means there is no compensation left to mis-time. The class of bug
   * is gone rather than tuned.
   *
   * Index still commits UP FRONT, before the spring. An animation that
   * never completes — interrupted by the next swipe, or a backgrounded tab
   * where rAF stops — must not leave the index behind, or the carousel
   * parks between slides with no way back. Worst case here is a transition
   * cut short, which is invisible.
   */
  const settle = (target, { instant = false } = {}) => {
    if (!trackW) return;
    setIdx(target);
    if (instant) { x.set(-target * trackW); return; }
    animate(x, -target * trackW, SETTLE);
  };

  const page = (dir) => {
    if (slides.length < 2 || !trackW) return;
    // ONE page per gesture. Reported from a device: a single swipe moved
    // two slides. Two things can do that and the guard covers both.
    //
    // The auto-rotate timer is the race. It is scheduled on every idx
    // change, and a drag that lands in the last few milliseconds before it
    // fires gets its own page() plus the timer's — the pause set on
    // dragStart arrives too late to cancel a timeout already in flight.
    //
    // A second onDragEnd from a re-entrant gesture would do the same.
    //
    // Time-based rather than a boolean the settle clears: a flag cleared in
    // onComplete goes stale the moment an animation is interrupted, and a
    // stuck flag means the carousel silently stops accepting swipes. A
    // deadline cannot stick.
    if (Date.now() < settleUntilRef.current) return;
    settleUntilRef.current = Date.now() + SETTLE_MS;

    // CLAMPED, not wrapped — which is what an iOS home screen does. A
    // linear track cannot wrap without either scrolling all the way back
    // through every slide or cutting, and both are worse than the rubber
    // band you get by running out of pages. Auto-rotate handles its own
    // wrap below, where a cut happens once per cycle instead of per swipe.
    const target = Math.min(Math.max(idx + dir, 0), slides.length - 1);
    if (target === idx) { animate(x, -idx * trackW, SETTLE); return; }
    settle(target);
  };
  // Auto-rotate reaches page()/settle() through this ref — see its
  // declaration above. At the last slide it returns to the first with an
  // instant reset: the pages are static, so idx and x move together with no
  // window to re-key, and a cut once per full cycle beats rewinding the
  // whole track on screen.
  pageRef.current = () => {
    if (slides.length < 2 || !trackW) return;
    if (Date.now() < settleUntilRef.current) return;
    settleUntilRef.current = Date.now() + SETTLE_MS;
    if (idx >= slides.length - 1) settle(0, { instant: true });
    else settle(idx + 1);
  };

  const handleTrackDragEnd = (_e, info) => {
    if (slides.length < 2 || !trackW) return;
    const dx = info.offset.x;
    const vx = info.velocity.x;
    // A page turns on distance OR flick. The distance gate is a third of a
    // page rather than a fixed pixel count so it scales with the device:
    // 125px on a 375pt phone, and the same *proportion* on a Pro Max.
    const far = Math.abs(dx) > trackW / 3;
    const flick = Math.abs(vx) > 500;
    if (!far && !flick) { animate(x, -idx * trackW, SETTLE); return; }
    page(dx < 0 ? 1 : -1);
  };

  const goTo = (i) => {
    settle(i);
    holdRotation();
  };
  // These route through page() rather than setting idx directly so a chevron
  // produces the same travel as a swipe. Setting idx alone would cut
  // straight to the next slide, which next to a gesture that glides reads as
  // two different carousels sharing one card.
  const next = () => { if (slides.length > 1) { holdRotation(); page(1); } };
  const prev = () => { if (slides.length > 1) { holdRotation(); page(-1); } };

  // Cleanup pause timer on unmount.
  useEffect(() => () => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
  }, []);

  // The handle is created ONCE and dispatches through a ref that is
  // refreshed every render. next/prev/goTo close over `idx` and `trackW`,
  // so a handle built directly from them would have to be rebuilt on every
  // render to stay correct — and a handle whose identity changes on every
  // render invalidates any parent effect that depends on it. This way the
  // object is stable and the behaviour is always current.
  const actionsRef = useRef(null);
  actionsRef.current = { next, prev, goTo, slides };
  useImperativeHandle(ref, () => ({
    next: () => actionsRef.current.next(),
    prev: () => actionsRef.current.prev(),
    goTo: (i) => actionsRef.current.goTo(i),
    goToId: (id) => {
      const i = actionsRef.current.slides.findIndex(s => s?.id === id);
      if (i >= 0) actionsRef.current.goTo(i);
    },
  }), []);

  // Report the live slide up — the band paints its tint, its identity rule
  // and (on Dashboard) its whole accent from whichever slide is on screen.
  useEffect(() => {
    onIndexChange?.(idx, slides[idx] ?? null);
  }, [idx, slides, onIndexChange]);

  const current = slides[idx];
  if (!current) return null;

  // Pagination dots take the CURRENT slide's accent so they always match
  // the slide on screen (and follow theme changes, since the fallback is
  // the --primary token rather than a hard-coded colour).
  const accent = heroSlideAccent(current);
  const dotStyle = (active) => ({
    background: active ? `hsl(${accent})` : `hsl(${accent} / 0.25)`,
  });

  /* ── The paged track ────────────────────────────────────────────────
     Every slide is mounted side by side and the track is translated to the
     current one. Dragging moves the track itself, so the neighbour is
     genuinely on screen and partly visible under the finger rather than
     appearing after the gesture ends.

     Everything the band paints — tint, fade, identity rule, chevron —
     stays OUTSIDE this element on purpose. In a paged carousel the pages
     move and the chrome does not; dragging the band itself (which is what
     Progress and Nutrition used to do) moved the entire hero, which is why
     that gesture read as a nudge rather than a page turn. */
  const pageW = trackW || 1;
  const multi = slides.length > 1;

  return (
    <div className="relative">
      <div ref={trackBoxRef} className="overflow-hidden">
        <motion.div
          className="flex"
          style={{ x: multi ? x : 0 }}
          drag={multi ? 'x' : false}
          // A thumb arcs, and `touch-action: pan-y` has already promised the
          // browser it may scroll vertically, so without a lock the gesture
          // gets claimed as a page scroll partway through.
          dragDirectionLock
          // No elastic. At 0.12 the track kept moving a fraction of the
          // finger's travel past the constraints, so at the first and last
          // slide the drag rubber-banded and then the spring pulled it back
          // — two motions in opposite directions inside one gesture, which
          // is the judder at the ends. 0 pins the track to the finger while
          // it is inside range and stops it dead at the edges.
          dragElastic={0}
          dragConstraints={{ left: -(slides.length - 1) * pageW, right: 0 }}
          // Framer runs an inertia animation on release by default, aimed at
          // the drag constraints. Those span TWO pages here, so a flick threw
          // its own momentum at `x` while page()'s spring was pulling the
          // other way — the momentum wins the tail of the gesture and coasts
          // a full extra page. On screen that is a single swipe advancing two
          // slides, which is exactly what got reported. The settle is the
          // only thing that should move the track after release.
          dragMomentum={false}
          onDragStart={holdRotation}
          onDragEnd={handleTrackDragEnd}
        >
          {slides.map((s, i) => (
            <div
              // Keyed by slide id, and safe to be: a slide never changes
              // slot now, so this key is stable for the life of the list and
              // nothing remounts mid-gesture.
              key={s?.id ?? `page-${i}`}
              className="shrink-0"
              style={{ width: multi ? pageW : '100%' }}
              // Touching a page holds the rotation. On the page WRAPPER
              // rather than each slide root so every caller gets it without
              // remembering to wire it up.
              onPointerDownCapture={holdRotation}
              onFocusCapture={holdRotation}
            >
              {s ? renderSlide(s, { index: i, isActive: i === idx, count: slides.length }) : null}
            </div>
          ))}
        </motion.div>
      </div>

      {/* Pagination dots — one row, outside the track, so they stay put
          while pages move under them. A dot row inside a slide travels WITH
          that slide, so on a paged carousel you would watch the dots slide
          off the screen with the page they belong to. */}
      {multi && (
        <div className={`flex items-center gap-1.5 ${dotsClassName}`}>
          {slides.map((s, i) => (
            <button
              // Use slide.id (stable) instead of array index — when slides
              // shift order (e.g. a PR slide demotes itself by age),
              // index-keyed buttons retain stale DOM state and animations
              // played for the wrong destination dot.
              key={s?.id ?? `dot-${i}`}
              type="button"
              onClick={() => goTo(i)}
              aria-label={dotLabel
                ? dotLabel(i)
                : tFallback('dashboard.hero.slide', `Slide ${i + 1}`)}
              // 6x6px is an indicator, not a control. `before:` grows the
              // TAP target vertically without changing the rendered dot or
              // the row's height — vertical is where the room is, because
              // nine dots at a full 44px wide would need 396px on a 375px
              // screen. Horizontal expansion is held to the gap so
              // neighbouring targets don't overlap and steal each other's
              // taps.
              className={`relative h-1.5 rounded-full transition-all before:absolute before:content-[''] before:-inset-y-4 before:-inset-x-0.5 ${i === idx ? 'w-6' : 'w-1.5'}`}
              style={dotStyle(i === idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default HeroPager;
