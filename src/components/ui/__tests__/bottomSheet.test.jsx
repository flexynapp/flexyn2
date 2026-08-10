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
