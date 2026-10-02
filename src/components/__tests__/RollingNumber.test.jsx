// RollingNumber: odometer digits that roll and go green only on a real gain.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import AnimatedNumber from '@/components/AnimatedNumber';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const root = (c) => c.firstChild;

describe('AnimatedNumber roll', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('reads as one number to a screen reader', () => {
    const { container } = render(<AnimatedNumber roll value={1250} format={fmt} />);
    expect(screen.getByText('1,250').className).toContain('sr-only');
    // the visible columns are hidden from assistive tech
    const cols = container.querySelectorAll('[aria-hidden="true"]');
    expect(cols.length).toBe(5); // four digit columns plus the comma
  });

  it('uses tabular figures so turning digits do not shift the row', () => {
    const { container } = render(<AnimatedNumber roll value={7} />);
    expect(root(container).className).toContain('tabular-nums');
  });

  it('keys columns from the right, so 999 to 1,000 only adds one on the left', () => {
    const { container, rerender } = render(<AnimatedNumber roll value={999} format={fmt} />);
    const ones = container.querySelectorAll('.overflow-hidden')[2];
    rerender(<AnimatedNumber roll value={1000} format={fmt} />);
    const cols = container.querySelectorAll('.overflow-hidden');
    expect(cols.length).toBe(4);
    expect(cols[3]).toBe(ones);
  });

  it('turns green for a moment on a gain, once the value has settled', () => {
    const { container, rerender } = render(<AnimatedNumber roll value={100} format={fmt} />);
    act(() => { vi.advanceTimersByTime(1500); });
    rerender(<AnimatedNumber roll value={150} format={fmt} />);
    expect(root(container).className).toContain('text-success');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(root(container).className).not.toContain('text-success');
  });

  it('does not celebrate a drop', () => {
    const { container, rerender } = render(<AnimatedNumber roll value={150} format={fmt} />);
    act(() => { vi.advanceTimersByTime(1500); });
    rerender(<AnimatedNumber roll value={100} format={fmt} />);
    expect(root(container).className).not.toContain('text-success');
    expect(container.querySelector('.sr-only').textContent).toBe('100');
  });

  it('does not celebrate the live balance replacing a cached one on open', () => {
    const { container, rerender } = render(<AnimatedNumber roll value={100} format={fmt} />);
    act(() => { vi.advanceTimersByTime(200); });
    rerender(<AnimatedNumber roll value={180} format={fmt} />);
    expect(root(container).className).not.toContain('text-success');
  });

  it('renders 0 for a missing value rather than NaN', () => {
    const { container } = render(<AnimatedNumber roll value={null} format={fmt} />);
    expect(container.querySelector('.sr-only').textContent).toBe('0');
  });
});
