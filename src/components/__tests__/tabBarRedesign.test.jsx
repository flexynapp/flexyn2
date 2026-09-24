// src/components/__tests__/tabBarRedesign.test.jsx
//
// Navigation redesign, phase 2: the tab bar is Today, Train, +, Social,
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
import QuickLogSheet, { QUICK_LOG_ITEMS } from '@/components/QuickLogSheet';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/lib/haptic', () => ({ triggerHaptic: () => {} }));

describe('which tab is lit', () => {
  it('has four tabs, with + between Train and Social rather than a route', () => {
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
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the + sheet', () => {
  it('offers a meal, since Nutrition is no longer a tab', () => {
    expect(QUICK_LOG_ITEMS.map((i) => i.id)).toContain('meal');
  });

  it.each(QUICK_LOG_ITEMS.map((i) => [i.en, i.to]))('%s goes to %s, replacing the sheet entry', (label, to) => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByTestId('where').textContent).toBe(`REPLACE ${to}`);
  });

  it('closes once a row is chosen', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Meal' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Weight' })).toBeNull());
  });
});
