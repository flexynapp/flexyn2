// The account menu that replaced the nine-row profile dropdown. What must
// hold: it carries only account rows plus a way into You (so nothing that
// left the menu is stranded), it behaves as a keyboard menu, and the level
// line still opens the Stats Hub the old chip used to.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const setLanguage = vi.fn();
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    setLanguage,
    SUPPORTED_LANGUAGES: [
      { code: 'en', flag: 'US', nativeLabel: 'English', label: 'English' },
      { code: 'es', flag: 'ES', nativeLabel: 'Español', label: 'Spanish' },
    ],
    currentLanguage: { code: 'en', nativeLabel: 'English' },
    t: (_k, vars) => `Lv. ${vars?.n}`,
    tFallback: (_k, fb) => fb,
  }),
}));
vi.mock('@/hooks/useGlobalRank', () => ({ useGlobalRank: () => ({ rank: 4 }) }));
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));

import AccountMenu from '../AccountMenu';

const user = { full_name: 'Kegan Bergeron', username: 'kegan', total_xp: 0 };

function setup(extra = {}) {
  const props = {
    user,
    capsuleCount: 2,
    open: true,
    onNavigate: vi.fn(),
    onOpenStats: vi.fn(),
    onSignOut: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  };
  render(<AccountMenu {...props} />);
  return props;
}

beforeEach(() => { setLanguage.mockClear(); });

describe('AccountMenu', () => {
  it('holds account rows and a row into You, not a copy of You', () => {
    setup();
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(labels.some((l) => l.startsWith('View profile'))).toBe(true);
    expect(labels.some((l) => l.startsWith('You'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Settings'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Language'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Sign out'))).toBe(true);
    for (const gone of ['My Bag', 'My Gym', 'My Journal', 'Weekly Reviews', 'My Injuries', 'Achievements']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it('routes each row and carries the capsule count to You', () => {
    const p = setup();
    fireEvent.click(screen.getByText('View profile'));
    fireEvent.click(screen.getByText('You'));
    fireEvent.click(screen.getByText('Settings'));
    expect(p.onNavigate.mock.calls.map((c) => c[0])).toEqual(['/profile', '/you', '/settings']);
    expect(screen.getByText('You').closest('button').textContent).toContain('2');
    fireEvent.click(screen.getByText('Sign out'));
    expect(p.onSignOut).toHaveBeenCalled();
  });

  it('opens the Stats Hub from the level line', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open your stats' }));
    expect(p.onOpenStats).toHaveBeenCalled();
    expect(screen.getByText('#4')).toBeTruthy();
  });

  it('is a keyboard menu: focus lands inside, arrows move, Escape closes', () => {
    const p = setup();
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalled();
  });

  it('switches language in place and returns to the main list', () => {
    setup();
    fireEvent.click(screen.getByText('Language'));
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByText('Español'));
    expect(setLanguage).toHaveBeenCalledWith('es');
    expect(screen.getByText('View profile')).toBeTruthy();
  });
});

describe('every row that left the menu is on the You page', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const you = fs.readFileSync(path.resolve(here, '../../pages/You.jsx'), 'utf8');
  it.each([
    ['My Bag', 'requestOpenBag'],
    ['My Gym', "navigate('/my-gym')"],
    ['My Journal', 'requestOpenJournal'],
    ['Weekly Reviews', "requestProfilePanel('reviews')"],
    ['My Injuries', "requestProfilePanel('injuries')"],
    ['Achievements', 'openAchievements'],
  ])('%s', (_label, call) => {
    expect(you).toContain(call);
  });
});
