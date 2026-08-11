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
  useLanguage: () => ({ tFallback: (_k, english) => english }),
}));
vi.mock('@/hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: (open) => { lockCalls.push(open); },
}));

const SheetShell = (await import('@/components/sheets/SheetShell')).default;

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
