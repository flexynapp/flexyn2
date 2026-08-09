// src/lib/__tests__/scrollLock.test.js
//
// The page behind an open menu must not move, and the overlay's own
// scroller must keep working. Neither is visible in a screenshot, and the
// failure modes are asymmetric: a lock that leaks looks like a frozen app
// one screen later, and a lock that is too aggressive looks like a sheet
// whose content simply won't scroll.
//
// The properties under test:
//   • one overlay holds the page and leaves its scroll POSITION alone
//   • a gesture with nowhere to go is cancelled; one with room is not
//   • pinch-zoom is never interfered with
//   • nested overlays produce ONE lock, released by the outermost
//   • release restores the caller's own inline styles, not `''`

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  lockBodyScroll,
  unlockBodyScroll,
  isBodyScrollLocked,
  __resetBodyScrollLock,
} from '@/lib/scrollLock';

const SCROLL_Y = 640;

/** A div that reports itself as a real scroller with `max` px of travel. */
function makeScroller({ max = 500, top = 250, overflowY = 'auto' } = {}) {
  const el = document.createElement('div');
  el.style.overflowY = overflowY;
  Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 1000 - max, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: top, writable: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

/** Drive a one-finger drag and report whether the page was held. */
function drag(target, { dx = 0, dy = 0 } = {}) {
  const touch = (x, y) => [{ clientX: x, clientY: y }];
  const start = new Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(start, 'touches', { value: touch(100, 400) });
  Object.defineProperty(start, 'target', { value: target });
  document.dispatchEvent(start);

  const move = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(move, 'touches', { value: touch(100 - dx, 400 - dy) });
  Object.defineProperty(move, 'target', { value: target });
  document.dispatchEvent(move);
  return move.defaultPrevented;
}

beforeEach(() => {
  __resetBodyScrollLock();
  document.body.replaceChildren();
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');

  Object.defineProperty(window, 'scrollY', {
    value: SCROLL_Y, writable: true, configurable: true,
  });
  // jsdom reports clientWidth 0, which would read as a full-viewport
  // scrollbar gutter. Match innerWidth so the gutter is 0, like a phone.
  Object.defineProperty(document.documentElement, 'clientWidth', {
    value: window.innerWidth, writable: true, configurable: true,
  });
});

afterEach(() => {
  __resetBodyScrollLock();
  document.body.replaceChildren();
  document.body.removeAttribute('style');
});

describe('scrollLock — holding the page', () => {
  it('stops the page without moving it', () => {
    lockBodyScroll();

    expect(document.body.style.overflow).toBe('hidden');
    // index.css already pins body overscroll-behavior to `none`, which is
    // stricter than the `contain` Radix writes — the lock must not weaken it.
    expect(document.body.style.overscrollBehavior).toBe('');
    expect(isBodyScrollLocked()).toBe(true);
    // The whole point of not pinning the body: the scroll position is never
    // taken away, so window.scrollY stays truthful for everything that
    // reads it (Layout's auto-hiding nav, BackToTopButton).
    expect(window.scrollY).toBe(SCROLL_Y);
    expect(document.body.style.position).toBe('');
  });

  it('releases without scrolling anything', () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo;

    lockBodyScroll();
    unlockBodyScroll();

    expect(document.body.style.overflow).toBe('');
    expect(scrollTo).not.toHaveBeenCalled();
    expect(isBodyScrollLocked()).toBe(false);
  });

  it('reserves the desktop scrollbar gutter so the page does not shift', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: window.innerWidth - 15, writable: true, configurable: true,
    });

    lockBodyScroll();
    expect(document.body.style.paddingRight).toBe('15px');

    unlockBodyScroll();
    expect(document.body.style.paddingRight).toBe('');
  });

  it('ignores a viewport-scale gap too wide to be a scrollbar', () => {
    // Seen for real in the in-app browser pane mid-resize: innerWidth 423
    // against clientWidth 375.
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: window.innerWidth - 48, writable: true, configurable: true,
    });

    lockBodyScroll();
    expect(document.body.style.paddingRight).toBe('');
  });
});

describe('scrollLock — which gestures survive', () => {
  it('cancels a drag on the page behind the overlay', () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);

    lockBodyScroll();
    expect(drag(plain, { dy: 40 })).toBe(true);
  });

  it("leaves a drag inside the overlay's own scroller alone", () => {
    const sheet = makeScroller({ max: 500, top: 250 });
    const child = document.createElement('p');
    sheet.appendChild(child);

    lockBodyScroll();
    expect(drag(child, { dy: 40 })).toBe(false);   // scrolling down, room below
    expect(drag(child, { dy: -40 })).toBe(false);  // scrolling up, room above
  });

  it('cancels the drag once that scroller has run out', () => {
    // This is the reported bug in its exact shape: a sheet already at its
    // top, dragged further up. Before, that chained to the page.
    const sheet = makeScroller({ max: 500, top: 0 });
    const child = document.createElement('p');
    sheet.appendChild(child);

    lockBodyScroll();
    expect(drag(child, { dy: -40 })).toBe(true);   // nothing above — held
    expect(drag(child, { dy: 40 })).toBe(false);   // still room below
  });

  it('does not treat an overflow-hidden box as a scroller', () => {
    const clipped = makeScroller({ max: 500, top: 250, overflowY: 'hidden' });
    const child = document.createElement('p');
    clipped.appendChild(child);

    lockBodyScroll();
    expect(drag(child, { dy: 40 })).toBe(true);
  });

  it('yields to a drag surface that owns the gesture itself', () => {
    // framer-motion `drag`, our pull-to-dismiss handle and the avatar
    // cropper all set this.
    const handle = document.createElement('div');
    handle.style.touchAction = 'none';
    document.body.appendChild(handle);

    lockBodyScroll();
    expect(drag(handle, { dy: 60 })).toBe(false);
  });

  it('yields on an axis the browser was told not to pan', () => {
    // maplibre marks its canvas `pinch-zoom` while drag-pan is on — not
    // `none`, but it still means "I handle dragging". A `=== none` check
    // would have cancelled every pan of the gym map.
    const canvas = document.createElement('div');
    canvas.style.touchAction = 'pinch-zoom';
    document.body.appendChild(canvas);

    lockBodyScroll();
    expect(drag(canvas, { dy: 60 })).toBe(false);
    expect(drag(canvas, { dx: 60 })).toBe(false);
  });

  it('still holds the vertical axis on a pan-y swipe row', () => {
    // useSwipeToDelete sets pan-y: JS owns horizontal, the browser still
    // owns vertical — so a downward drag there must not scroll the page.
    const row = document.createElement('div');
    row.style.touchAction = 'pan-y';
    document.body.appendChild(row);

    lockBodyScroll();
    expect(drag(row, { dy: 60 })).toBe(true);   // vertical: still held
    expect(drag(row, { dx: 60 })).toBe(false);  // horizontal: the row's own
  });

  it('never interferes with a two-finger pinch', () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    lockBodyScroll();

    const move = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(move, 'touches', {
      value: [{ clientX: 80, clientY: 300 }, { clientX: 220, clientY: 500 }],
    });
    Object.defineProperty(move, 'target', { value: plain });
    document.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(false);
  });

  it('stops cancelling anything once released', () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);

    lockBodyScroll();
    unlockBodyScroll();
    expect(drag(plain, { dy: 40 })).toBe(false);
  });
});

describe('scrollLock — nesting', () => {
  it('stays held until the outermost overlay releases', () => {
    lockBodyScroll(); // a sheet
    lockBodyScroll(); // a confirm dialog opened from inside it

    unlockBodyScroll(); // the confirm closes
    expect(document.body.style.overflow).toBe('hidden');
    expect(isBodyScrollLocked()).toBe(true);

    unlockBodyScroll(); // the sheet closes
    expect(document.body.style.overflow).toBe('');
  });

  it('snapshots once, so a nested lock cannot capture the held state', () => {
    // This is the bug the old per-component copies had: the second one to
    // run recorded `overflow: hidden` as the "previous" value and leaked it
    // back on restore, leaving the page permanently un-scrollable.
    lockBodyScroll();
    lockBodyScroll();
    unlockBodyScroll();
    unlockBodyScroll();

    expect(document.body.style.overflow).toBe('');
  });
});

describe('scrollLock — restoring what was already there', () => {
  it("puts the caller's own inline styles back rather than clearing them", () => {
    document.body.style.overflow = 'auto';
    document.body.style.paddingRight = '8px';

    lockBodyScroll();
    unlockBodyScroll();

    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.paddingRight).toBe('8px');
  });

  it('ignores an unlock with no matching lock', () => {
    unlockBodyScroll();

    expect(isBodyScrollLocked()).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });
});
