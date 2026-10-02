// The animated tab icons must look exactly like the lucide icons they
// replace when at rest, and play only when a tab becomes active.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { LayoutDashboard, Play, Users, UserCircle } from 'lucide-react';
import { TodayIcon, TrainIcon, HubIcon, YouIcon } from '../TabIcons';

const shapes = (container) => [...container.querySelectorAll('rect, circle, path, polygon')]
  .map((el) => {
    const keep = ['x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r', 'd', 'points'];
    return el.tagName + keep.map((k) => (el.getAttribute(k) != null ? ` ${k}=${el.getAttribute(k)}` : '')).join('');
  })
  .sort();

describe('tab icons at rest', () => {
  it.each([
    ['Today', TodayIcon, LayoutDashboard],
    ['Train', TrainIcon, Play],
    ['Hub', HubIcon, Users],
    ['You', YouIcon, UserCircle],
  ])('%s draws the same shapes as the lucide icon', (_, Mine, Lucide) => {
    const mine = render(<Mine active={false} />);
    const theirs = render(<Lucide />);
    expect(shapes(mine.container)).toEqual(shapes(theirs.container));
  });

  it('is hidden from screen readers, since the label names the tab', () => {
    const { container } = render(<HubIcon active />);
    expect(container.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('when the motion plays', () => {
  afterEach(() => vi.doUnmock('@/lib/reducedMotion'));

  const svgOf = (c) => c.querySelector('svg');

  it('does not play on first render, even on the active tab', () => {
    const { container, rerender } = render(<TodayIcon active />);
    const first = svgOf(container);
    rerender(<TodayIcon active />);
    expect(svgOf(container)).toBe(first);
  });

  it('plays when the tab becomes active, and not when it is left', () => {
    const { container, rerender } = render(<TodayIcon active={false} />);
    const resting = svgOf(container);
    rerender(<TodayIcon active />);
    const played = svgOf(container);
    expect(played).not.toBe(resting);
    rerender(<TodayIcon active={false} />);
    expect(svgOf(container)).toBe(played);
  });

  it('stays still with Reduce Motion on', async () => {
    vi.resetModules();
    vi.doMock('@/lib/reducedMotion', () => ({ prefersReducedMotion: () => true }));
    const { TodayIcon: Still } = await import('../TabIcons');
    const { container, rerender } = render(<Still active={false} />);
    const resting = svgOf(container);
    rerender(<Still active />);
    expect(svgOf(container)).toBe(resting);
  });

  it('thickens the stroke on the active tab like the old icons', () => {
    const { container } = render(<YouIcon active />);
    expect(svgOf(container).getAttribute('stroke-width')).toBe('2.5');
  });
});
