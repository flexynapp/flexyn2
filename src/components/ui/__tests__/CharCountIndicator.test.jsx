// Tests for CharCountIndicator — the "127/280" counter shown on
// length-capped inputs. Verifies tint thresholds (default,
// warn, over) and edge inputs.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CharCountIndicator from '../CharCountIndicator';

function classOf(value, max, warnAt) {
  const { container } = render(
    <CharCountIndicator value={value} max={max} warnAt={warnAt} />
  );
  return container.firstChild?.className || '';
}

describe('CharCountIndicator', () => {
  it('renders nothing when no max is provided', () => {
    const { container } = render(<CharCountIndicator value="hello" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when max is 0 or negative', () => {
    const { container: a } = render(<CharCountIndicator value="x" max={0} />);
    const { container: b } = render(<CharCountIndicator value="x" max={-3} />);
    expect(a.firstChild).toBeNull();
    expect(b.firstChild).toBeNull();
  });

  it('shows "0/N" for empty or non-string values', () => {
    render(<CharCountIndicator value="" max={50} />);
    expect(screen.getByText('0/50')).toBeInTheDocument();

    const { rerender } = render(<CharCountIndicator value={null} max={20} />);
    expect(screen.getByText('0/20')).toBeInTheDocument();

    rerender(<CharCountIndicator value={undefined} max={20} />);
    expect(screen.getByText('0/20')).toBeInTheDocument();
  });

  it('uses muted tint below the warnAt threshold', () => {
    // 50/100 = 0.5 ratio → below default 0.85 warnAt → muted
    expect(classOf('a'.repeat(50), 100)).toMatch(/text-muted-foreground/);
  });

  it('uses amber tint when in the warning band', () => {
    // 90/100 = 0.9 ratio → above default 0.85, not over → amber
    expect(classOf('a'.repeat(90), 100)).toMatch(/text-amber-500/);
  });

  it('uses red tint when over the cap', () => {
    expect(classOf('a'.repeat(120), 100)).toMatch(/text-red-500/);
  });

  it('respects a custom warnAt threshold', () => {
    expect(classOf('a'.repeat(60), 100, 0.5)).toMatch(/text-amber-500/);
  });

  it('shows the live count', () => {
    render(<CharCountIndicator value="hello world" max={280} />);
    expect(screen.getByText('11/280')).toBeInTheDocument();
  });

  it('uses aria-live=polite so screen readers can announce the remaining count', () => {
    const { container } = render(<CharCountIndicator value="x" max={10} />);
    expect(container.firstChild.getAttribute('aria-live')).toBe('polite');
  });
});
