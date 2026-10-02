// src/components/OneShotTooltip.jsx
//
// Floating "hint" tooltip that fires EXACTLY ONCE per user/device per
// registered id. Each new feature gets one shot at a hint, then never
// shows it again. The "never again" is the trust contract — users
// learn the app trusts them to remember.
//
// USAGE
//
//   <OneShotTooltip
//     id={TOOLTIP.LONG_PRESS_TABS}
//     anchorRef={tabRef}
//     placement="top"
//   >
//     Hold any tab for shortcuts.
//   </OneShotTooltip>
//
// While it is visible it TRACKS the anchor — scroll, resize, keyboard,
// rotation, or the anchor being reflowed by something loading above it.
// It is `position: fixed`, so a one-time measurement goes stale as soon as
// anything moves, and these are anchored inside scrollers (a DM message, a
// set row, a nav tab) where something usually does.
//
// PROPS
//
//   id           Registered tooltip id from tooltipRegistry.
//   anchorRef    React ref to the element this tooltip points at.
//                Used to compute position (above/below the anchor).
//   placement    'top' | 'bottom'. Default 'top'.
//   children     Tooltip body text or React node.
//   delayMs      How long after mount before fading in. Default 600ms
//                — lets the user finish whatever interaction triggered
//                the mount before the tooltip pops up.
//   durationMs   How long the tooltip stays visible. Default 4000ms, up
//                from 3000 when the bubble gained its "Turn off tips"
//                link: a link needs time to be read and reached.
//
// TURNING TIPS OFF (2026-10-02)
//
// Every bubble carries a small "Turn off tips" link. A new user meets
// several of these in their first sessions; someone who already knows the
// app says "no more" once instead of waiting each one out. The pill that
// answers says where to turn them back on (Settings › About), because a
// switch that only exists where you flipped it is one you can't find again.

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  hasSeenTooltip, markTooltipSeen, TOOLTIPS_RESET_EVENT,
  tipsEnabled, setTipsEnabled, TIPS_PREF_EVENT,
} from '@/lib/tooltipRegistry';
import { getTranslation } from '@/lib/i18n';
import { toast } from '@/lib/toast';

const DEFAULT_DELAY = 600;
const DEFAULT_DURATION = 4000;

// Not useLanguage(): this mounts in Layout, set rows and DM lists, and its
// tests render it bare. A tooltip lives four seconds, so reading the page
// language at render is enough (LanguageContext sets <html lang>).
function tr(key, english) {
  let lang = 'en';
  try { lang = document.documentElement.lang || 'en'; } catch { /* no DOM */ }
  const v = getTranslation(lang, key);
  return v && v !== key ? v : english;
}
// How far a finger may travel and still count as a tap rather than the
// start of a scroll. The platform convention is ~10px.
const TAP_SLOP = 10;

function measure(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, bottom: r.bottom, width: r.width };
}

function same(a, b) {
  return !!a && !!b
    && a.left === b.left && a.top === b.top
    && a.bottom === b.bottom && a.width === b.width;
}

export default function OneShotTooltip({
  id,
  anchorRef,
  placement = 'top',
  children,
  delayMs = DEFAULT_DELAY,
  durationMs = DEFAULT_DURATION,
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const fired = useRef(false);
  // The bubble is tappable now (its "Turn off tips" link), so a touch that
  // lands on it must not count as the tap-anywhere dismissal.
  const bubbleRef = useRef(null);
  const inside = (e) => !!bubbleRef.current && e?.target instanceof Node && bubbleRef.current.contains(e.target);

  // Bumped by Settings → Help → "Show one-time tips again". The effect below
  // reads localStorage once and its deps are the id and the anchor, so an
  // instance that has already decided not to fire never reconsiders — and
  // the bottom-nav hint lives in Layout, mounted for the whole session, so
  // "reset" would have meant "reset, then relaunch the app". Re-arming on
  // the event is what makes the row's label true.
  const [rearm, setRearm] = useState(0);
  useEffect(() => {
    const onReset = () => { fired.current = false; setRearm((n) => n + 1); };
    // Switched off from another bubble or from Settings: close this one too.
    const onPref = () => { if (!tipsEnabled()) setOpen(false); else onReset(); };
    window.addEventListener(TOOLTIPS_RESET_EVENT, onReset);
    window.addEventListener(TIPS_PREF_EVENT, onPref);
    return () => {
      window.removeEventListener(TOOLTIPS_RESET_EVENT, onReset);
      window.removeEventListener(TIPS_PREF_EVENT, onPref);
    };
  }, []);

  useEffect(() => {
    if (fired.current) return;
    if (!id) return;
    if (!tipsEnabled()) return;
    if (hasSeenTooltip(id)) return;
    if (!anchorRef?.current) return;

    fired.current = true;
    const showTimer = setTimeout(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      // Several instances of one id can mount together (the paste hint sits
      // on the first set of EVERY exercise), and all of them pass the check
      // above before any has fired. The first to fire marks it seen; the
      // rest stand down here, so a hint shows once rather than once each.
      if (hasSeenTooltip(id) || !tipsEnabled()) return;
      setRect(measure(anchor));
      setOpen(true);
      markTooltipSeen(id);
    }, delayMs);

    return () => clearTimeout(showTimer);
    // `rearm` is in the deps precisely so a reset re-runs this.
  }, [id, anchorRef, delayMs, rearm]);

  // Follow the anchor for as long as we're visible.
  //
  // The position is `fixed`, so it's in viewport coordinates and goes stale
  // the moment anything moves — which is most of the time, given where
  // these are anchored: a message in the DM list, a set row inside the
  // workout page, a tab in the auto-hiding nav. Scroll is the obvious
  // cause, but so are a keyboard opening, a rotation, an image loading
  // above the anchor, and a `scrollIntoView` fired by the app itself, so
  // this listens for all of them rather than scroll alone.
  //
  // `capture: true` on scroll is load-bearing: scroll doesn't bubble, so a
  // listener on window only hears the document. Capture hears every
  // scroller on the way down, including the DM list the tooltip is
  // pointing into.
  useEffect(() => {
    const anchor = anchorRef?.current;
    if (!open || !anchor) return undefined;

    let frame = 0;
    const remeasure = () => {
      frame = 0;
      const next = measure(anchor);
      // Bail on an unchanged rect — these fire in bursts and every one of
      // them would otherwise be a re-render.
      setRect((prev) => (same(prev, next) ? prev : next));
    };
    // Coalesce a burst of scroll events into one measurement per frame.
    const schedule = () => { if (!frame) frame = requestAnimationFrame(remeasure); };

    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(anchor);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      ro?.disconnect();
    };
  }, [open, anchorRef]);

  // Auto-hide after `durationMs` of being visible. Also dismiss on any tap
  // inside the document, so the user can dismiss early by doing anything.
  //
  // A touch is resolved on touchEND, not touchSTART, and only if the finger
  // stayed put. Dismissing on touchstart made "follow the anchor" dead code
  // on the only platform this app ships to: a scroll BEGINS with a
  // touchstart, so the tooltip was always gone before the first scroll
  // event landed. A drag past TAP_SLOP is a scroll — let the tooltip ride
  // along with its anchor instead.
  useEffect(() => {
    if (!open) return undefined;
    const hideTimer = setTimeout(() => setOpen(false), durationMs);
    const dismiss = (e) => { if (!inside(e)) setOpen(false); };

    let startX = 0;
    let startY = 0;
    let dragged = false;
    let onBubble = false;
    const onTouchStart = (e) => {
      onBubble = inside(e);
      const t = e.touches[0];
      startX = t ? t.clientX : 0;
      startY = t ? t.clientY : 0;
      dragged = false;
    };
    const onTouchMove = (e) => {
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - startX) > TAP_SLOP || Math.abs(t.clientY - startY) > TAP_SLOP) {
        dragged = true;
      }
    };
    const onTouchEnd = () => { if (!dragged && !onBubble) setOpen(false); };

    // Slight delay so the same tap that triggered the mount doesn't
    // immediately dismiss the tooltip.
    const armTimer = setTimeout(() => {
      window.addEventListener('mousedown', dismiss);
      window.addEventListener('keydown', dismiss);
      window.addEventListener('touchstart', onTouchStart, { passive: true });
      window.addEventListener('touchmove', onTouchMove, { passive: true });
      window.addEventListener('touchend', onTouchEnd, { passive: true });
    }, 200);

    return () => {
      clearTimeout(hideTimer);
      clearTimeout(armTimer);
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [open, durationMs]);

  const turnOff = () => {
    setTipsEnabled(false);
    setOpen(false);
    toast.info(tr('tips.offTitle', 'Tips turned off'), {
      description: tr('tips.offWhere', 'Turn them back on in Settings › About.'),
    });
  };

  if (!rect) return null;

  // Center horizontally above/below the anchor.
  const left = rect.left + rect.width / 2;
  const isTop = placement === 'top';
  const top = isTop ? rect.top - 12 : rect.bottom + 12;
  const transform = `translate(-50%, ${isTop ? '-100%' : '0'})`;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: isTop ? 4 : -4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: isTop ? 4 : -4, scale: 0.96 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            left,
            top,
            zIndex: 60,
            pointerEvents: 'none',
          }}
        >
          {/* The centring translate lives on its own element. On the
              motion.div it was overwritten by framer's own transform (the
              y and scale it animates), so every bubble hung off to the
              right of its anchor and ran past the screen edge. */}
          <div style={{ transform, width: 'max-content' }}>
          <div
            ref={bubbleRef}
            style={{ pointerEvents: 'auto' }}
            className="relative max-w-[240px] px-3 pt-2 pb-1 rounded-lg bg-primary text-primary-foreground text-xs font-medium shadow-lg"
          >
            {children}
            <button
              type="button"
              onClick={turnOff}
              className="block min-h-[32px] -mb-1 text-micro font-bold underline underline-offset-2 opacity-90 hover:opacity-100"
            >
              {tr('tips.turnOff', 'Turn off tips')}
            </button>
            <div
              aria-hidden="true"
              className="absolute start-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-primary"
              style={isTop ? { bottom: -3 } : { top: -3 }}
            />
          </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
