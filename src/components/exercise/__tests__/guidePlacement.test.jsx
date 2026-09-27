// Opened from the ⋯ menu, the guide scrolls itself so the WHOLE guide is
// readable: bottom clear of the rest timer and tab bar when it fits, top just
// under the header when it does not. The figure is lazy and grows the panel
// after the first measurement, so placement re-runs on resize.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@/test/utils';
import ExerciseFormPanel from '../ExerciseFormPanel';
import { LanguageProvider } from '@/lib/LanguageContext';

let observers;
let rect;
let scrollTo;

class FakeResizeObserver {
  constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
}

const resize = (next) => {
  rect = next;
  act(() => { observers.forEach(o => { if (!o.disconnected) o.cb([]); }); });
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  observers = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  scrollTo = vi.fn();
  window.scrollTo = scrollTo;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 1000 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const show = async () => {
  render(<LanguageProvider><ExerciseFormPanel exerciseName="Bench Press" open onOpenChange={() => {}} /></LanguageProvider>);
  await screen.findByRole('button', { name: /how to do bench press/i });
  act(() => { vi.advanceTimersByTime(80); });
};

// Viewport 667: room is 180 → 507 (327px).
describe('guide placement', () => {
  it('lifts a guide that fits until its bottom clears the rest timer', async () => {
    rect = { top: 400, bottom: 700, height: 300 };
    await show();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000 + 700 - 507, behavior: 'smooth' });
  });

  it('leaves a guide that is already in the clear alone', async () => {
    rect = { top: 200, bottom: 480, height: 280 };
    await show();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('puts the top under the header once the figure makes it too tall', async () => {
    rect = { top: 400, bottom: 700, height: 300 };
    await show();
    // The page has scrolled 193px when the figure lands and grows the panel.
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1193 });
    resize({ top: 207, bottom: 638, height: 431 });
    // Page coordinates, not a second delta on top of the first.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1193 + 207 - 180, behavior: 'smooth' });
  });

  it('stops following once the person touches the page', async () => {
    rect = { top: 200, bottom: 480, height: 280 };
    await show();
    act(() => { window.dispatchEvent(new Event('touchstart')); });
    resize({ top: 200, bottom: 900, height: 700 });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
