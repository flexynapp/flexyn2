import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SKINS, skinStorageKey } from '@/lib/skins';

const setSkinOn = vi.fn();
const halloween = SKINS.find((s) => s.id === 'halloween');
let skin = halloween;

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (_k, en) => en }),
}));
vi.mock('@/lib/ThemeContext', () => ({
  useTheme: () => ({ skin, skinOn: false, setSkinOn }),
}));

import SkinPrompt from '../skins/SkinPrompt';

describe('SkinPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setSkinOn.mockReset();
    skin = halloween;
  });
  afterEach(() => vi.useRealTimers());

  const mount = (path = '/dashboard') => {
    render(<MemoryRouter initialEntries={[path]}><SkinPrompt /></MemoryRouter>);
    act(() => { vi.advanceTimersByTime(3000); });
  };

  it('offers the in-season skin by its own copy and records a yes', () => {
    mount();
    expect(screen.getByText('Halloween look is here')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn it on' }));
    expect(setSkinOn).toHaveBeenCalledWith(true);
  });

  it('records a no the same way', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(setSkinOn).toHaveBeenCalledWith(false);
  });

  it('stays away once answered', () => {
    localStorage.setItem(skinStorageKey(halloween), 'off');
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never covers the workout logger, or any page but Home', () => {
    for (const path of ['/workout', '/hub', '/progress']) {
      mount(path);
      expect(screen.queryByRole('dialog'), path).toBeNull();
    }
    expect(localStorage.getItem(skinStorageKey(halloween))).toBeNull();
  });

  it('stays away out of season', () => {
    skin = null;
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
