// The shared unread mark. Four hand-rolled versions used to sit side by side
// in the same header and sidebar, in three colours; these pin the shape the
// one replacement promises.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import CountBadge from '../CountBadge';

const mark = (c) => c.querySelector('[data-badge]');

describe('CountBadge', () => {
  it('renders nothing with no count and no dot', () => {
    const { container } = render(<CountBadge />);
    expect(mark(container)).toBeNull();
  });

  it('prefers the number over the dot', () => {
    const { container } = render(<CountBadge count={3} dot />);
    expect(mark(container).dataset.badge).toBe('count');
    expect(mark(container).textContent).toBe('3');
  });

  it('caps at 9+', () => {
    const { container } = render(<CountBadge count={12} />);
    expect(mark(container).textContent).toBe('9+');
  });

  it('draws an empty dot', () => {
    const { container } = render(<CountBadge dot />);
    expect(mark(container).dataset.badge).toBe('dot');
    expect(mark(container).textContent).toBe('');
  });

  it('cuts itself out of the icon with a ring in the surface colour', () => {
    const { container } = render(<CountBadge count={1} />);
    expect(mark(container).className).toMatch(/\bborder-2\b/);
    expect(mark(container).className).toMatch(/\bborder-card\b/);
  });

  it('uses theme tokens only, never a raw palette red', () => {
    for (const tone of ['alert', 'primary']) {
      const { container, unmount } = render(<CountBadge dot tone={tone} />);
      expect(mark(container).className).not.toMatch(/red-\d/);
      unmount();
    }
  });
});
