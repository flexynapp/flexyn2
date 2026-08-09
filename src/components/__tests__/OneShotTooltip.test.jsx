// src/components/__tests__/OneShotTooltip.test.jsx
//
// The tooltip is `position: fixed`, so its coordinates are viewport
// coordinates and a single measurement at open time is only true until
// something moves. Everything it points at lives inside a scroller — a DM
// message, a set row, a nav tab — so something usually does, and the
// failure is silent: the hint just drifts off its anchor and points at
// whatever happens to be there.
//
// Also covered: a scroll must not be read as a tap. Dismissing on
// touchstart made the tracking unreachable on the platform this app ships
// to, because a scroll BEGINS with a touchstart.

import React, { useRef } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import OneShotTooltip from '@/components/OneShotTooltip';
import { TOOLTIP, markTooltipSeen, resetAllSeenTooltips } from '@/lib/tooltipRegistry';

const ID = Object.values(TOOLTIP)[0];

/** Anchor whose rect we can move, the way a scroll would. */
let anchorTop = 400;

function Harness({ ...props }) {
  const ref = useRef(null);
  return (
    <>
      <div ref={ref} data-testid="anchor" />
      <OneShotTooltip id={ID} anchorRef={ref} {...props}>hint text</OneShotTooltip>
    </>
  );
}

function tooltipBox() {
  return screen.queryByText('hint text')?.closest('[style*="position"]') || null;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  anchorTop = 400;
  // jsdom gives every element a zero rect; drive it from `anchorTop` so a
  // "scroll" is just a change to that number.
  Element.prototype.getBoundingClientRect = function getRect() {
    return {
      left: 100, top: anchorTop, bottom: anchorTop + 20,
      right: 160, width: 60, height: 20, x: 100, y: anchorTop,
      toJSON() { return this; },
    };
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete Element.prototype.getBoundingClientRect;
});

/** Advance past the open delay and the 200ms dismiss arming. */
function open() {
  act(() => { vi.advanceTimersByTime(650); });
  act(() => { vi.advanceTimersByTime(250); });
}

/**
 * Tracking coalesces into a requestAnimationFrame, and framer-motion's
 * exit runs on rAF too. Vitest's fake timers drive rAF, so both need the
 * clock nudged before the DOM reflects the event.
 */
function flush(ms = 60) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe('OneShotTooltip — tracking its anchor', () => {
  it('follows the anchor when the page scrolls under it', () => {
    render(<Harness placement="top" />);
    open();

    expect(tooltipBox()).toHaveStyle({ top: '388px' }); // 400 - 12 gap

    // The anchor scrolls up 150px.
    anchorTop = 250;
    act(() => { window.dispatchEvent(new Event('scroll')); });
    flush();

    expect(tooltipBox()).toHaveStyle({ top: '238px' });
  });

  it('hears a scroll inside a nested scroller, not just the document', () => {
    // scroll doesn't bubble — a window listener without capture only ever
    // hears the document, which is not where the DM list scrolls.
    render(<Harness placement="top" />);
    open();

    anchorTop = 120;
    act(() => {
      screen.getByTestId('anchor').dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    flush();

    expect(tooltipBox()).toHaveStyle({ top: '108px' });
  });

  it('re-measures on resize, for rotation and the keyboard', () => {
    render(<Harness placement="bottom" />);
    open();

    expect(tooltipBox()).toHaveStyle({ top: '432px' }); // bottom (420) + 12

    anchorTop = 300;
    act(() => { window.dispatchEvent(new Event('resize')); });
    flush();

    expect(tooltipBox()).toHaveStyle({ top: '332px' });
  });

  it('stops tracking once it has been dismissed', () => {
    // Asserted as "no longer follows" rather than "gone from the DOM":
    // framer-motion's exit is rAF-driven and does not settle reliably in
    // jsdom, and the listener leak is the part worth proving anyway.
    render(<Harness placement="top" />);
    open();
    act(() => { window.dispatchEvent(new MouseEvent('mousedown')); });
    flush();

    anchorTop = 50;
    act(() => { window.dispatchEvent(new Event('scroll')); });
    flush();

    expect(tooltipBox()).toHaveStyle({ top: '388px' }); // never re-measured
  });
});

describe('OneShotTooltip — a scroll is not a tap', () => {
  function touch(type, x, y) {
    const e = new Event(type, { bubbles: true });
    Object.defineProperty(e, 'touches', { value: y == null ? [] : [{ clientX: x, clientY: y }] });
    return e;
  }

  it('survives the touch that starts a scroll, and keeps following', () => {
    render(<Harness placement="top" />);
    open();

    act(() => { window.dispatchEvent(touch('touchstart', 100, 500)); });
    expect(screen.getByText('hint text')).toBeInTheDocument();

    // Finger travels well past the tap slop — this is a scroll.
    act(() => { window.dispatchEvent(touch('touchmove', 100, 430)); });
    anchorTop = 330;
    act(() => { window.dispatchEvent(new Event('scroll')); });
    act(() => { window.dispatchEvent(touch('touchend')); });
    flush();

    expect(screen.getByText('hint text')).toBeInTheDocument();
    expect(tooltipBox()).toHaveStyle({ top: '318px' });
  });

  it('still dismisses on a real tap', () => {
    render(<Harness placement="top" />);
    open();

    act(() => { window.dispatchEvent(touch('touchstart', 100, 500)); });
    act(() => { window.dispatchEvent(touch('touchmove', 103, 502)); }); // within slop
    act(() => { window.dispatchEvent(touch('touchend')); });
    flush();

    // Dismissed, so it unhooks — same reasoning as the test above.
    anchorTop = 50;
    act(() => { window.dispatchEvent(new Event('scroll')); });
    flush();

    expect(tooltipBox()).toHaveStyle({ top: '388px' });
  });
});

describe('OneShotTooltip — coming back after a reset', () => {
  it('re-arms an already-mounted instance, without a reload', () => {
    // The bottom-nav hint is mounted in Layout for the whole session, so
    // clearing the flag alone would have meant "reset, then relaunch the
    // app". Settings fires an event; this is the half that listens.
    markTooltipSeen(ID);
    render(<Harness placement="top" />);
    open();
    expect(screen.queryByText('hint text')).toBeNull();  // already seen

    act(() => { resetAllSeenTooltips(); });
    open();

    expect(screen.getByText('hint text')).toBeInTheDocument();
  });
});
