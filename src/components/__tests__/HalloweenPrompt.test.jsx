import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const setHalloween = vi.fn();
let available = true;

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (_k, en) => en }),
}));
vi.mock('@/lib/ThemeContext', () => ({
  useTheme: () => ({ halloweenAvailable: available, setHalloween }),
}));

import HalloweenPrompt from '../seasonal/HalloweenPrompt';
import { halloweenStorageKey } from '@/lib/halloween';

describe('HalloweenPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setHalloween.mockReset();
    available = true;
  });
  afterEach(() => vi.useRealTimers());

  const mount = () => {
    render(<HalloweenPrompt />);
    act(() => { vi.advanceTimersByTime(3000); });
  };

  it('offers the look once in season and records a yes', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Turn it on' }));
    expect(setHalloween).toHaveBeenCalledWith(true);
  });

  it('records a no the same way', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(setHalloween).toHaveBeenCalledWith(false);
  });

  it('stays away once answered', () => {
    localStorage.setItem(halloweenStorageKey(), 'off');
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays away out of season', () => {
    available = false;
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
