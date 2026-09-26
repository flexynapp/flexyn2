// Coming back to the app opens each page on its default view (Kegan,
// 2026-09-26: relaunched and Hub was still on Crews, expected Global).
// A refresh still keeps your place.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useUrlState } from '@/hooks/useUrlState';
import { initAppResume, _resetAppResume, LONG_AWAY_MS } from '@/lib/appResume';

let nav;
function Hub() {
  const [feed] = useUrlState('feed', 'pump', ['pump', 'squad', 'crews']);
  const location = useLocation();
  nav = useNavigate();
  return (
    <div>
      <span data-testid="feed">{feed}</span>
      <span data-testid="url">{location.pathname + location.search}</span>
    </div>
  );
}
const renderAt = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="/hub" element={<Hub />} /></Routes>
  </MemoryRouter>,
);
const feed = () => screen.getByTestId('feed').textContent;
const url = () => screen.getByTestId('url').textContent;

const boot = (path, { refresh = false } = {}) => {
  _resetAppResume();
  sessionStorage.clear();
  if (refresh) sessionStorage.setItem('flexyn.appSession', '1');
  window.history.replaceState(null, '', path);
  initAppResume();
};

const setHidden = (hidden) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => { vi.useRealTimers(); });

describe('relaunching', () => {
  it('opens on the default feed when the launch restored another one', () => {
    boot('/hub?feed=crews');
    renderAt('/hub?feed=crews');
    expect(feed()).toBe('pump');
    expect(url()).toBe('/hub');
  });

  it('keeps the feed on a refresh', () => {
    boot('/hub?feed=crews', { refresh: true });
    renderAt('/hub?feed=crews');
    expect(feed()).toBe('crews');
  });

  it('still follows an in-app link to that same view afterwards', () => {
    boot('/hub?feed=crews');
    renderAt('/hub?feed=crews');
    act(() => nav('/hub?feed=crews'));
    expect(feed()).toBe('crews');
  });
});

describe('resuming after a while away', () => {
  it('resets to the default after a long time hidden, not a short one', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    boot('/hub', { refresh: true });
    renderAt('/hub?feed=crews');
    expect(feed()).toBe('crews');

    setHidden(true);
    vi.setSystemTime(1_000_000 + 60_000);
    act(() => setHidden(false));
    expect(feed()).toBe('crews');

    setHidden(true);
    vi.setSystemTime(1_000_000 + 60_000 + LONG_AWAY_MS);
    act(() => setHidden(false));
    expect(feed()).toBe('pump');
    expect(url()).toBe('/hub');
  });
});
