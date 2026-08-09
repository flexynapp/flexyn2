// src/lib/__tests__/scrollLock.test.js
//
// The page behind an open menu must not move, and must come back exactly
// where it was. Both halves are easy to break by hand, and neither is
// visible in a screenshot — a lock that never releases looks like a frozen
// app one screen later, not like a scroll-lock bug.
//
// The properties under test:
//   • one overlay pins the page and records where it was
//   • nested overlays produce ONE lock — the inner one closing must not
//     un-pin the page while the outer one is still open
//   • release restores the caller's own inline styles, not `''`
//   • release lands the user back on the same scroll position

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  lockBodyScroll,
  unlockBodyScroll,
  isBodyScrollLocked,
  __resetBodyScrollLock,
} from '@/lib/scrollLock';

const SCROLL_Y = 640;

let scrollToSpy;

beforeEach(() => {
  __resetBodyScrollLock();
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');

  // jsdom never scrolls and doesn't implement scrollTo.
  Object.defineProperty(window, 'scrollY', {
    value: SCROLL_Y,
    writable: true,
    configurable: true,
  });
  scrollToSpy = vi.fn();
  window.scrollTo = scrollToSpy;

  // jsdom reports clientWidth 0, which would read as a full-viewport
  // scrollbar gutter. Match innerWidth so the gutter is 0, like a phone.
  Object.defineProperty(document.documentElement, 'clientWidth', {
    value: window.innerWidth,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  __resetBodyScrollLock();
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
});

describe('scrollLock — pinning the page', () => {
  it('pins the body at its current scroll offset', () => {
    lockBodyScroll();

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe(`-${SCROLL_Y}px`);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(isBodyScrollLocked()).toBe(true);
  });

  it('releases the page and restores the scroll position', () => {
    lockBodyScroll();
    unlockBodyScroll();

    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
    expect(scrollToSpy).toHaveBeenCalledWith(0, SCROLL_Y);
    expect(isBodyScrollLocked()).toBe(false);
  });

  it('reserves the desktop scrollbar gutter so the page does not shift', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: window.innerWidth - 15,
      writable: true,
      configurable: true,
    });

    lockBodyScroll();
    expect(document.body.style.paddingRight).toBe('15px');

    unlockBodyScroll();
    expect(document.body.style.paddingRight).toBe('');
  });

  it('ignores a viewport-scale gap too wide to be a scrollbar', () => {
    // Seen for real in the in-app browser pane mid-resize: innerWidth 423
    // against clientWidth 375. Padding the body by 48px would indent the
    // whole page every time a menu opened.
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: window.innerWidth - 48,
      writable: true,
      configurable: true,
    });

    lockBodyScroll();
    expect(document.body.style.paddingRight).toBe('');
  });
});

describe('scrollLock — nesting', () => {
  it('stays pinned until the outermost overlay releases', () => {
    lockBodyScroll(); // a sheet
    lockBodyScroll(); // a confirm dialog opened from inside it

    unlockBodyScroll(); // the confirm closes
    expect(document.body.style.position).toBe('fixed');
    expect(isBodyScrollLocked()).toBe(true);
    expect(scrollToSpy).not.toHaveBeenCalled();

    unlockBodyScroll(); // the sheet closes
    expect(document.body.style.position).toBe('');
    expect(scrollToSpy).toHaveBeenCalledWith(0, SCROLL_Y);
  });

  it('snapshots once, so a nested lock cannot capture the pinned state', () => {
    // This is the bug the old per-component copies had: the second one to
    // run recorded `overflow: hidden` as the "previous" value and leaked it
    // back on restore, leaving the page permanently un-scrollable.
    lockBodyScroll();
    lockBodyScroll();
    unlockBodyScroll();
    unlockBodyScroll();

    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
  });
});

describe('scrollLock — restoring what was already there', () => {
  it('puts the caller\'s own inline styles back rather than clearing them', () => {
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
    expect(document.body.style.position).toBe('');
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
