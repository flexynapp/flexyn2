// src/components/hub/__tests__/rowActionSheet.test.jsx
//
// The sheet's only real logic is the destructive arm-then-confirm, and it
// guards the one action in Messages that cannot be undone from the app:
// leaving a crew. A single-tap Leave sitting third in a list you reached by
// HOLDING a row — a gesture that opens without any deliberate aim — is a
// mis-tap away from dropping someone out of their crew.
//
// The reopen case is the one worth being explicit about: a sheet that
// remembered its armed state would present "Confirm leave" to someone who
// had no idea they had armed anything.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import RowActionSheet from '@/components/hub/RowActionSheet';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, english) => english,
  }),
}));

const haptics = [];
vi.mock('@/lib/haptic', () => ({
  triggerHaptic: (kind) => haptics.push(kind),
}));

const onLeave = vi.fn();
const onPin = vi.fn();
const onClose = vi.fn();

function actions() {
  return [
    { id: 'pin', label: 'Pin Chat', onSelect: onPin },
    {
      id: 'leave',
      label: 'Leave crew',
      destructive: true,
      confirmLabel: 'Confirm leave',
      confirmWarning: "You'll need a new invite to rejoin.",
      onSelect: onLeave,
    },
  ];
}

function renderSheet(open = true) {
  return render(
    <RowActionSheet
      open={open}
      onClose={onClose}
      header={{ label: '@dana', initials: 'DA' }}
      actions={actions()}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  haptics.length = 0;
  onLeave.mockClear();
  onPin.mockClear();
  onClose.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RowActionSheet', () => {
  it('names the row it was opened from', () => {
    renderSheet();
    expect(screen.getByText('@dana')).toBeTruthy();
  });

  it('fires a plain action on the first tap and closes', () => {
    renderSheet();
    fireEvent.click(screen.getByText('Pin Chat'));
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT fire a destructive action on the first tap', () => {
    renderSheet();
    fireEvent.click(screen.getByText('Leave crew'));
    expect(onLeave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('arms instead — swapping the label and showing what it costs', () => {
    renderSheet();
    fireEvent.click(screen.getByText('Leave crew'));
    expect(screen.getByText('Confirm leave')).toBeTruthy();
    expect(screen.getByText("You'll need a new invite to rejoin.")).toBeTruthy();
  });

  it('fires a different haptic on arm than the one that opened the sheet', () => {
    renderSheet();
    fireEvent.click(screen.getByText('Leave crew'));
    expect(haptics).toContain('warning');
    expect(haptics).not.toContain('primary');
  });

  it('fires on the second tap', () => {
    renderSheet();
    fireEvent.click(screen.getByText('Leave crew'));
    fireEvent.click(screen.getByText('Confirm leave'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('disarms itself after 5s so a forgotten sheet is not primed', () => {
    renderSheet();
    fireEvent.click(screen.getByText('Leave crew'));
    expect(screen.getByText('Confirm leave')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText('Confirm leave')).toBeNull();
    expect(screen.getByText('Leave crew')).toBeTruthy();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('never reopens still armed', () => {
    const { rerender } = renderSheet();
    fireEvent.click(screen.getByText('Leave crew'));
    expect(screen.getByText('Confirm leave')).toBeTruthy();

    rerender(
      <RowActionSheet open={false} onClose={onClose} header={{ label: '@dana' }} actions={actions()} />,
    );
    rerender(
      <RowActionSheet open onClose={onClose} header={{ label: '@dana' }} actions={actions()} />,
    );

    expect(screen.queryByText('Confirm leave')).toBeNull();
    expect(screen.getByText('Leave crew')).toBeTruthy();
  });

  it('Cancel closes without running anything', () => {
    renderSheet();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onPin).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    renderSheet(false);
    expect(screen.queryByText('Pin Chat')).toBeNull();
  });
});
