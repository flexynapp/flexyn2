// The bottom-sheet chrome, tested once for the four sheets that share it.
//
// Before the extraction this markup existed in four places and was tested in
// none — every sheet re-typed the backdrop, the Escape handler, the scroll
// lock and the close button, so a fix to any one of them fixed one quarter
// of the app. The point of testing it here is that these behaviours now have
// exactly one implementation to get wrong.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const lockCalls = [];
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, english, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), english) : english,
  }),
}));
vi.mock('@/hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: (open) => { lockCalls.push(open); },
}));

// Spy on the drag controls without replacing them. framer's own drag setup
// calls `dragControls.subscribe`, so a bare `{ start: fn }` stub would throw —
// this keeps the real instance and stubs only the method the handle calls.
// `start` is not called through because the real one wants a live pointer,
// which jsdom has no concept of.
const dragStart = vi.fn();
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useDragControls: (...args) => {
      const controls = actual.useDragControls(...args);
      controls.start = dragStart;
      return controls;
    },
  };
});

const mod = await import('@/components/sheets/SheetShell');
const SheetShell = mod.default;
const { shouldDismiss } = mod;

describe('SheetShell', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SheetShell open={false} onClose={() => {}} kicker="K"><p>body</p></SheetShell>);
    expect(container.innerHTML).toBe('');
  });

  it('is a modal dialog labelled by its kicker', () => {
    render(<SheetShell open onClose={() => {}} kicker="READINESS · TODAY" labelledBy="x"><p>body</p></SheetShell>);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('x');
    // The kicker carries the id, so a screen reader announces the sheet by
    // the same words the eye sees.
    expect(document.getElementById('x').textContent).toBe('READINESS · TODAY');
  });

  it('renders its children', () => {
    render(<SheetShell open onClose={() => {}} kicker="K"><p>the body</p></SheetShell>);
    expect(screen.getByText('the body')).toBeTruthy();
  });

  it('shows the grab handle, which is what says "swipe me"', () => {
    const { container } = render(<SheetShell open onClose={() => {}} kicker="K"><p>b</p></SheetShell>);
    expect(container.querySelector('span.rounded-full[aria-hidden="true"]')).toBeTruthy();
  });

  it('closes on the backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(<SheetShell open onClose={onClose} kicker="K"><p>b</p></SheetShell>);
    fireEvent.click(container.querySelector('.absolute.inset-0'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the close button, which has a resting fill rather than hover-only', () => {
    const onClose = vi.fn();
    render(<SheetShell open onClose={onClose} kicker="K"><p>b</p></SheetShell>);
    const btn = screen.getByRole('button', { name: 'Close' });
    // There is no hover on the phones this ships to. A hover-only fill would
    // make this invisible until tapped, which is why the class is asserted.
    expect(btn.className).toContain('bg-foreground/[0.08]');
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape, and stops listening once unmounted', () => {
    const onClose = vi.fn();
    const { unmount } = render(<SheetShell open onClose={onClose} kicker="K"><p>b</p></SheetShell>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pins the page behind it', () => {
    lockCalls.length = 0;
    render(<SheetShell open onClose={() => {}} kicker="K"><p>b</p></SheetShell>);
    expect(lockCalls).toContain(true);
  });
});

/* The handle was an affordance with nothing behind it. This file's own test
 * above asserts it "says swipe me", and the component's header comment said
 * the sheet was "swipe-dismissible by habit on iOS" — but no drag was wired,
 * so the pill was the one control on the sheet that did nothing.
 *
 * Wiring it has a trap, which is the other half of what these assert. The
 * panel is BOTH the draggable and the scroller (`max-h-[88vh]
 * overflow-y-auto`), and framer writes `touch-action: pan-x` onto a
 * `drag="y"` element whose listener is live — one branch in
 * render/html/use-props.mjs sets touch-action, user-select and draggable
 * together. touch-action resolves down the ancestor chain, so a live listener
 * would have forbidden vertical panning of the sheet's own content. Four
 * sheets share this shell; that is four features truncated at 88vh at once,
 * which is precisely what shipped in BottomSheet.
 *
 * So: the panel must claim NO gesture, and the handle must claim it.
 */
function panel() {
  return document.querySelector('.overflow-y-auto');
}

describe('SheetShell swipe-to-dismiss', () => {
  it('leaves the panel free to scroll: no touch-action, user-select or draggable', () => {
    render(<SheetShell open onClose={() => {}} kicker="K"><p>b</p></SheetShell>);
    const el = panel();
    expect(el).toBeTruthy();
    // 'pan-x' here is the bug. Empty means framer's drag branch never ran.
    expect(el.style.touchAction).toBe('');
    expect(el.style.userSelect).toBe('');
    expect(el.getAttribute('draggable')).toBeNull();
  });

  it('gives the handle bar the gesture, and keeps it reachable after scrolling', () => {
    render(<SheetShell open onClose={() => {}} kicker="K"><p>b</p></SheetShell>);
    const bar = panel().firstElementChild;
    expect(bar.className).toContain('touch-none');
    expect(bar.className).toContain('cursor-grab');
    // sticky, or the affordance scrolls away inside a long sheet and the
    // only way back to it is scrolling to the top first.
    expect(bar.className).toContain('sticky');
  });

  it('starts the drag when the handle is pressed — the pill used to be inert', () => {
    dragStart.mockClear();
    render(<SheetShell open onClose={() => {}} kicker="K"><p>b</p></SheetShell>);
    const bar = panel().firstElementChild;

    bar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));

    // Against the old shell this is 0: there was no handler on the bar at all.
    expect(dragStart).toHaveBeenCalledTimes(1);
  });

  it('does not start a drag from the sheet body', () => {
    dragStart.mockClear();
    render(<SheetShell open onClose={() => {}} kicker="K"><p>the body</p></SheetShell>);

    screen.getByText('the body')
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));

    // If this ever fires, the content has stopped scrolling on a phone.
    expect(dragStart).not.toHaveBeenCalled();
  });
});

describe('shouldDismiss — the thresholds every sheet shares', () => {
  it.each([
    ['a fast downward flick',      { velocity: { y: 400 },  offset: { y: 10 } },  true],
    ['dragged past 80px slowly',   { velocity: { y: 0 },    offset: { y: 120 } }, true],
    ['exactly at each threshold',  { velocity: { y: 300 },  offset: { y: 80 } },  true],
    ['a small nudge',              { velocity: { y: 0 },    offset: { y: 20 } },  false],
    ['an upward flick',            { velocity: { y: -800 }, offset: { y: -50 } }, false],
  ])('%s → %s', (_why, info, expected) => {
    expect(shouldDismiss(info)).toBe(expected);
  });
});

describe('no sheet re-inlines the chrome', () => {
  // The extraction only pays off while it stays extracted. A copy-paste of
  // the overlay back into any sheet silently forks the Escape handler and
  // the scroll lock again.
  const SHEETS = [
    'src/components/dashboard/QuestsSheet.jsx',
    'src/components/dashboard/ReadinessSheet.jsx',
    'src/components/progress/AdvancedAnalyticsSheet.jsx',
    'src/components/progress/PersonalBestsSheet.jsx',
  ];

  it.each(SHEETS)('%s uses SheetShell instead of its own overlay', async (file) => {
    const fs = await import('fs');
    const src = fs.readFileSync(file, 'utf8');
    expect(src, `${file} still has its own overlay`).not.toMatch(/fixed inset-0 z-50/);
    expect(src, `${file} still owns a scroll lock`).not.toMatch(/useBodyScrollLock/);
    expect(src, `${file} does not use SheetShell`).toMatch(/<SheetShell/);
  });
});
