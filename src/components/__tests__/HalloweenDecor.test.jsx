import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let theme = null;
vi.mock('@/lib/ThemeContext', () => ({ useTheme: () => theme }));

import HalloweenDecor from '../seasonal/HalloweenDecor';

describe('HalloweenDecor', () => {
  it('renders nothing unless the skin is on and in season', () => {
    theme = { halloween: false, halloweenAvailable: true };
    const { rerender } = render(<HalloweenDecor />);
    expect(screen.queryByTestId('halloween-decor')).toBeNull();
    theme = { halloween: true, halloweenAvailable: false };
    rerender(<HalloweenDecor />);
    expect(screen.queryByTestId('halloween-decor')).toBeNull();
    theme = null;
    rerender(<HalloweenDecor />);
    expect(screen.queryByTestId('halloween-decor')).toBeNull();
  });

  it('never takes taps and stays hidden from screen readers', () => {
    theme = { halloween: true, halloweenAvailable: true };
    render(<HalloweenDecor />);
    const el = screen.getByTestId('halloween-decor');
    expect(el.className).toContain('pointer-events-none');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});
