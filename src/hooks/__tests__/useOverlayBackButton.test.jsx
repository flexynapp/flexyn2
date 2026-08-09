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

describe('useOverlayBackButton — nested overlays', () => {
  // The Debrief Vault stacks: a list at z-200, and expanding a week puts
  // a second overlay over it at z-300. A popstate is delivered to EVERY
  // window listener, so without a stack both would close on one press and
  // the user would land outside the vault, skipping the list.
  let backSpy;
  beforeEach(() => {
    vi.spyOn(window.history, 'pushState');
    backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const mountBoth = () => {
    const outer = vi.fn(), inner = vi.fn();
    const o = renderHook(() => useOverlayBackButton(true, outer));
    const i = renderHook(() => useOverlayBackButton(true, inner));
    return { outer, inner, o, i };
  };

  it('closes only the innermost overlay on the first back', () => {
    const { outer, inner } = mountBoth();
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('closes the outer overlay on the second back, once the inner has gone', () => {
    const { outer, inner, i } = mountBoth();
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    i.unmount();                       // inner closed, its entry already popped
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('hands control back to the outer overlay when the inner closes by chevron', () => {
    const { outer, inner, i } = mountBoth();
    i.unmount();                       // dismissed from inside the app
    expect(backSpy).toHaveBeenCalledTimes(1);   // its own entry dropped
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(inner).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('handles a sub-VIEW that toggles, not just a second mounted overlay', () => {
    // InjuryForm's shape: one overlay whose inner registration is active
    // only while the New form is showing. Backing out of New must not
    // consume the overlay's own entry, or the next press navigates the
    // page underneath — the original bug, reintroduced one level down.
    const close = vi.fn();
    const toList = vi.fn();
    const { rerender } = renderHook(
      ({ isNew }) => {
        useOverlayBackButton(true, close);
        useOverlayBackButton(isNew, toList);
      },
      { initialProps: { isNew: true } },
    );

    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(toList).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    rerender({ isNew: false });          // onClose flipped the view to list
    expect(backSpy).not.toHaveBeenCalled();   // popstate already dropped it

    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('drops the sub-view entry when it is left by chevron rather than back', () => {
    const close = vi.fn();
    const toList = vi.fn();
    const { rerender } = renderHook(
      ({ isNew }) => {
        useOverlayBackButton(true, close);
        useOverlayBackButton(isNew, toList);
      },
      { initialProps: { isNew: true } },
    );
    rerender({ isNew: false });          // chevron: setView('list')
    expect(backSpy).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(toList).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves no stale registration behind, so a later solo overlay still works', () => {
    const { o, i } = mountBoth();
    i.unmount();
    o.unmount();
    const solo = vi.fn();
    renderHook(() => useOverlayBackButton(true, solo));
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(solo).toHaveBeenCalledTimes(1);
  });
});
