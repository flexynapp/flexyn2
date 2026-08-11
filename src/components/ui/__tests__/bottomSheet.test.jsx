// src/components/ui/__tests__/bottomSheet.test.jsx
//
// The backdrop rendered at `opacity: 0` for the whole life of this
// component — on every sheet in the app, not one of them. Measured in a
// browser, not inferred: computed 0, inline `opacity: 0`, flat across a
// second, surviving a full reload.
//
// It carried BOTH a drag-linked motion value in `style` and
// initial/animate/exit opacity keyframes. Framer will not own one property
// twice, so the element sat at its `initial` and never moved.
//
// Nothing threw. The sheet opened, and a tap on the invisible layer still
// dismissed it, so every surface behaved correctly while looking wrong —
// which is exactly why no test caught it. The missing piece was the only
// thing that says the page behind is inert.
//
// So this asserts the RENDERED opacity, not the presence of a className. A
// backdrop that is in the tree is not a backdrop the user can see.

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import BottomSheet from '@/components/ui/BottomSheet';

vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));

function backdrop() {
  return document.querySelector('.z-\\[200\\]');
}

/** Let the mount effect's rAF fire, the way a real frame would. */
async function settle() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r()));
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('BottomSheet backdrop', () => {
  it('is actually visible once open — not merely present', async () => {
    render(<BottomSheet open onClose={() => {}}><p>body</p></BottomSheet>);
    await settle();
    const el = backdrop();
    expect(el).toBeTruthy();
    expect(el.style.opacity).toBe('1');
  });

  it('starts transparent so the fade has somewhere to travel from', () => {
    render(<BottomSheet open onClose={() => {}}><p>body</p></BottomSheet>);
    // First paint, before the rAF — this is the frame the transition needs.
    expect(backdrop().style.opacity).toBe('0');
  });

  it('carries the dim on a child layer, so the drag fade can multiply with it', async () => {
    render(<BottomSheet open onClose={() => {}}><p>body</p></BottomSheet>);
    await settle();
    const dim = backdrop().firstElementChild;
    expect(dim).toBeTruthy();
    expect(dim.className).toContain('bg-black/60');
  });

  it('does not blur the page behind it', async () => {
    // Glassmorphism is on the banned list in docs/ui-craft-prompt.md, and
    // this layer was never visible, so nothing regressed by dropping it.
    render(<BottomSheet open onClose={() => {}}><p>body</p></BottomSheet>);
    await settle();
    expect(backdrop().className).not.toContain('backdrop-blur');
  });

  it('renders its children', async () => {
    render(<BottomSheet open onClose={() => {}}><p>hello sheet</p></BottomSheet>);
    await settle();
    expect(screen.getByText('hello sheet')).toBeTruthy();
  });

  it('renders nothing while closed', () => {
    render(<BottomSheet open={false} onClose={() => {}}><p>hello sheet</p></BottomSheet>);
    expect(backdrop()).toBeNull();
    expect(screen.queryByText('hello sheet')).toBeNull();
  });

  it('dismisses on a backdrop tap', async () => {
    const onClose = vi.fn();
    render(<BottomSheet open onClose={onClose}><p>body</p></BottomSheet>);
    await settle();
    act(() => { backdrop().click(); });
    expect(onClose).toHaveBeenCalled();
  });
});

/* The sheet's content could not be scrolled by touch, and the file's own doc
 * comment had described the correct behaviour the whole time: "swiping down
 * on the handle / header". The implementation put `dragListener` on the
 * panel, so framer wrote `touch-action: pan-x` there (its
 * render/html/use-props.mjs writes touch-action, user-select and draggable
 * from ONE branch — `props.drag && props.dragListener !== false`).
 *
 * touch-action resolves by intersecting down the ancestor chain, so pan-x on
 * the panel forbade vertical panning inside it — including the
 * `overflow-y-auto` content div. And `dragConstraints` pins the top at 0, so
 * swiping up moved nothing either. Anything below the fold in any of the six
 * surfaces built on this component was unreachable on a phone.
 *
 * These assert the panel claims no gesture and the handle bar claims it
 * instead. The three properties come from that single framer branch, so
 * their absence is proof it did not run — which is the regression to catch.
 */
function panel() {
  return document.querySelector('.z-\\[201\\]');
}

describe('BottomSheet gesture ownership', () => {
  it('leaves the panel free to scroll: no touch-action, user-select or draggable', async () => {
    render(<BottomSheet open onClose={() => {}}><p>body</p></BottomSheet>);
    await settle();
    const el = panel();
    expect(el).toBeTruthy();
    // 'pan-x' here is the bug. Empty means framer's drag branch never ran.
    expect(el.style.touchAction).toBe('');
    expect(el.style.userSelect).toBe('');
    expect(el.getAttribute('draggable')).toBeNull();
  });

  it('keeps the content in a scroll container the panel no longer blocks', async () => {
    render(<BottomSheet open onClose={() => {}}><p>hello sheet</p></BottomSheet>);
    await settle();
    const scroller = screen.getByText('hello sheet').parentElement;
    expect(scroller.className).toContain('overflow-y-auto');
    // Walk to the panel; nothing between may re-claim the vertical gesture.
    for (let el = scroller; el && el !== document.body; el = el.parentElement) {
      expect(el.style.touchAction).not.toBe('pan-x');
    }
  });

  it('gives the handle bar the gesture instead, per this file\'s doc comment', async () => {
    render(<BottomSheet open onClose={() => {}} title="Sheet"><p>body</p></BottomSheet>);
    await settle();
    const bar = panel().firstElementChild;
    expect(bar.className).toContain('touch-none');
    expect(bar.className).toContain('cursor-grab');
  });

  it('does not let the handle bar swallow a tap on the close button', async () => {
    const onClose = vi.fn();
    render(<BottomSheet open onClose={onClose} title="Sheet"><p>body</p></BottomSheet>);
    await settle();
    // The bar starts a drag on pointerdown; the close button inside it is
    // excluded, or the press would be captured and the tap never land.
    const close = screen.getByLabelText('Close');
    act(() => {
      close.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      close.click();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
