// src/components/__tests__/tabBarRedesign.test.jsx
//
// Navigation redesign, phase 2: the tab bar is Today, Train, +, Hub,
// You. Two things here are easy to break without noticing.
//
// 1. Which tab is lit. Progress and Nutrition stopped being tabs and now
//    open from You, so on /progress the You tab must stay lit. If this
//    mapping drifts, the bar shows no tab selected at all, which reads as
//    being lost, the exact problem the redesign exists to fix.
//
// 2. The + sheet. Nutrition gave up its tab on the promise that meals are
//    logged from +, so every row must reach its deep link. And it must
//    REPLACE the history entry the open sheet pushed, or Back from the
//    destination lands on a sheet that is no longer there.

import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import { NAV_PATHS, tabForPath } from '@/lib/navTabs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import QuickLogSheet, { QUICK_LOG_ITEMS, searchScreens, SEARCH_INDEX } from '@/components/QuickLogSheet';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/lib/haptic', () => ({ triggerHaptic: () => {} }));

const h = vi.hoisted(() => ({
  createWater: vi.fn(async (row) => ({ id: 'w1', ...row })),
  rewardWaterLog: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  fuel: { waterOz: 40 },
}));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c', weight_lbs: 180 } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));
vi.mock('@/lib/reportError', () => ({ reportError: () => {} }));
vi.mock('@/lib/data/nutrition', () => ({ create: h.createWater }));
vi.mock('@/lib/waterLogging', () => ({ rewardWaterLog: h.rewardWaterLog, WATER_DAILY_CAP_OZ: 200 }));
vi.mock('@/hooks/useTodayFuel', () => ({
  useTodayFuel: () => ({ today: '2026-09-26', waterOz: h.fuel.waterOz, waterGoal: 64 }),
}));

describe('which tab is lit', () => {
  it('has four tabs, with + between Train and Hub rather than a route', () => {
    expect(NAV_PATHS).toEqual(['/dashboard', '/workout', '/hub', '/you']);
  });

  it.each([
    ['/dashboard', '/dashboard'],
    ['/workout', '/workout'],
    ['/hub', '/hub'],
    ['/messages', '/hub'],
    ['/you', '/you'],
    ['/progress', '/you'],
    ['/nutrition', '/you'],
    ['/market', '/you'],
    ['/my-gym', '/you'],
    ['/settings', '/you'],
  ])('%s lights %s', (path, tab) => {
    expect(tabForPath(path)).toBe(tab);
  });

  it('lights nothing on a page that belongs to no tab', () => {
    expect(tabForPath('/coach')).toBe(null);
  });
});

function Where() {
  const loc = useLocation();
  const type = useNavigationType();
  return <output data-testid="where">{`${type} ${loc.pathname}${loc.search}`}</output>;
}

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <QuickLogSheet open={open} onClose={() => setOpen(false)} />
      <Where />
    </>
  );
}

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the + sheet', () => {
  it('offers a meal, since Nutrition is no longer a tab', () => {
    expect(QUICK_LOG_ITEMS.map((i) => i.id)).toContain('meal');
  });

  it.each(QUICK_LOG_ITEMS.filter((i) => !i.inline).map((i) => [i.en, i.to]))('%s goes to %s, replacing the sheet entry', (label, to) => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByTestId('where').textContent).toBe(`REPLACE ${to}`);
  });

  it('closes once a row is chosen', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Meal' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cardio' })).toBeNull());
  });

  it('offers cardio in place of weight, opening the cardio sheet', () => {
    const ids = QUICK_LOG_ITEMS.map((i) => i.id);
    expect(ids).toContain('cardio');
    expect(ids).not.toContain('weight');
    expect(QUICK_LOG_ITEMS.find((i) => i.id === 'cardio').to).toBe('/workout?openCardio=1');
  });

  it('keeps weight logging one search away', () => {
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText('Find a screen'), { target: { value: 'weight' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log weight' }));
    expect(screen.getByTestId('where').textContent).toBe('REPLACE /dashboard?logWeight=1');
  });
});

// Phase 4: water logs in the sheet itself, so you never leave
// the page you were on to record one number.
describe('logging inline', () => {
  it('logs a glass of water without leaving the page', async () => {
    h.fuel.waterOz = 40;
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Water' }));
    expect(screen.getByText('40')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+8 oz' }));
    await waitFor(() => expect(h.createWater).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-09-26', calories: 0 }),
    ));
    // The same side effects the Nutrition page runs: XP and the quest.
    await waitFor(() => expect(h.rewardWaterLog).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-09-26', oz: 8 }),
    ));
    expect(screen.getByTestId('where').textContent).toBe('POP /dashboard');
  });

  it('refuses water past the daily cap, like the Nutrition page', () => {
    h.fuel.waterOz = 190;
    h.createWater.mockClear();
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Water' }));
    fireEvent.click(screen.getByRole('button', { name: '+16 oz' }));
    expect(h.createWater).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalled();
  });

  it('goes back to the grid from a panel', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Water' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Meal' })).toBeTruthy();
  });
});

describe('finding a screen', () => {
  it('matches every word, across the label and extra terms', () => {
    expect(searchScreens('crew war').map((i) => i.id)).toEqual(['crewwars']);
    expect(searchScreens('weekly').map((i) => i.id)).toEqual(expect.arrayContaining(['reviews', 'gauntlet']));
    expect(searchScreens('SHOP').map((i) => i.id)).toEqual(['rewards']);
    expect(searchScreens('   ')).toEqual([]);
  });

  it('searches the translated label, ignoring accents', () => {
    const es = (item) => (item.id === 'nutrition' ? 'Nutrición' : item.en);
    expect(searchScreens('nutricion', es).map((i) => i.id)).toEqual(['nutrition']);
  });

  it('every entry either goes somewhere or does something', () => {
    for (const item of SEARCH_INDEX) expect(Boolean(item.to) || typeof item.run === 'function').toBe(true);
  });

  it('opens a result, replacing the sheet entry', () => {
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText('Find a screen'), { target: { value: 'duel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Duels' }));
    expect(screen.getByTestId('where').textContent).toBe('REPLACE /duels');
  });

  it('says so when nothing matches', () => {
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText('Find a screen'), { target: { value: 'zzzz' } });
    expect(screen.getByText('Nothing matches that. Try another word.')).toBeTruthy();
  });
});
