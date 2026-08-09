// src/hooks/__tests__/useOverlayBackButton.test.jsx
//
// The property under test is the one the bug report turned on: back must
// dismiss the overlay WITHOUT navigating the page underneath it, and the
// hook must not leave a stray history entry behind either way.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOverlayBackButton } from '@/hooks/useOverlayBackButton';

describe('useOverlayBackButton', () => {
  let pushSpy;
  let backSpy;

  beforeEach(() => {
    pushSpy = vi.spyOn(window.history, 'pushState');
    backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes one history entry when the overlay opens', () => {
    renderHook(() => useOverlayBackButton(true, vi.fn()));
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing while inactive', () => {
    renderHook(() => useOverlayBackButton(false, vi.fn()));
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('closes the overlay on back instead of letting the page navigate', () => {
    const onClose = vi.fn();
    renderHook(() => useOverlayBackButton(true, onClose));
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call history.back() after a popstate close', () => {
    // The browser already removed our entry. A second back here would
    // navigate the real page away — the exact bug being fixed, inverted.
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useOverlayBackButton(true, onClose));
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    unmount();
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('drops its history entry when closed from inside the app', () => {
    // Closing via the back chevron leaves our pushed entry on the stack;
    // without this the user would need two backs to leave the page.
    const { unmount } = renderHook(() => useOverlayBackButton(true, vi.fn()));
    unmount();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('does not push a new entry on every render', () => {
    // Callers pass an inline arrow, so depending on onClose directly would
    // re-run the effect each render and stack history entries — after
    // which back would appear to do nothing several times over.
    const { rerender } = renderHook(({ cb }) => useOverlayBackButton(true, cb), {
      initialProps: { cb: () => {} },
    });
    rerender({ cb: () => {} });
    rerender({ cb: () => {} });
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the latest onClose even though the effect does not re-run', () => {
    const first = vi.fn(), second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useOverlayBackButton(true, cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('survives history being unavailable rather than breaking the overlay', () => {
    pushSpy.mockImplementation(() => { throw new Error('SecurityError'); });
    const onClose = vi.fn();
    expect(() => renderHook(() => useOverlayBackButton(true, onClose))).not.toThrow();
  });
});
