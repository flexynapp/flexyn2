import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/haptic', () => ({ triggerHaptic: vi.fn() }));

let mockUser = null;
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

// Interpolates its own template rather than returning the fallback, so a
// placeholder the component forgot to pass would show up as `{n}`.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, en, vars) => (vars
      ? Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), en)
      : en),
  }),
}));

import FirstWeekCheckin from '../FirstWeekCheckin';
import { _resetActiveSessions, setSessionActive } from '@/lib/activeSession';

const LADDER = [[20, 10], [20, 10], [30, 15], [30, 15], [40, 20], [50, 25], [100, 50]];
function stateFor(day, claimed = []) {
  return {
    eligible: true,
    day,
    claimable: !claimed.includes(day),
    days: LADDER.map(([xp, coins], i) => {
      const d = i + 1;
      let status = d < day ? 'missed' : d === day ? 'today' : 'future';
      if (claimed.includes(d)) status = 'claimed';
      return { day: d, xp, coins, status };
    }),
  };
}

function mount(path = '/') {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><FirstWeekCheckin /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  rpc.mockReset();
  _resetActiveSessions();
  localStorage.clear();
  mockUser = { id: 'u1', email: 'u1@x', created_at: new Date(Date.now() - 2 * 864e5).toISOString() };
});
afterEach(() => { vi.useRealTimers(); });

describe('FirstWeekCheckin', () => {
  it('rises with the day, its prize and the seven-day track', async () => {
    rpc.mockResolvedValue({ data: stateFor(3, [1]), error: null });
    mount();
    expect(await screen.findByText('Day 3 of 7')).toBeTruthy();
    expect(screen.getByText('+30')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(rpc).toHaveBeenCalledWith('get_first_week_checkin', { p_today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('claims through the server and shows what it credited', async () => {
    rpc.mockImplementation((name) => Promise.resolve(name === 'get_first_week_checkin'
      ? { data: stateFor(3), error: null }
      : { data: { claimed: true, day: 3, xp_awarded: 30, coins_awarded: 15, total_xp: 130, flex_coins: 40 }, error: null }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Check in' }));
    await flush();
    expect(rpc).toHaveBeenCalledWith('claim_first_week_checkin', { p_today: expect.any(String) });
    expect(screen.getAllByText('Checked in').length).toBeGreaterThan(0);
  });

  it('stays down while a workout is running and rises when it ends', async () => {
    rpc.mockResolvedValue({ data: stateFor(2), error: null });
    setSessionActive('workout', true);
    mount();
    await flush();
    expect(screen.queryByText('Day 2 of 7')).toBeNull();
    act(() => setSessionActive('workout', false));
    expect(await screen.findByText('Day 2 of 7')).toBeTruthy();
  });

  it('treats a workout paused minutes ago as still in progress', async () => {
    rpc.mockResolvedValue({ data: stateFor(2), error: null });
    localStorage.setItem('paused_workouts.u1', JSON.stringify([{ id: 'w', pausedAt: new Date().toISOString() }]));
    mount();
    await flush();
    expect(screen.queryByText('Day 2 of 7')).toBeNull();
  });

  it('does not rise during onboarding', async () => {
    rpc.mockResolvedValue({ data: stateFor(1), error: null });
    mount('/onboarding');
    await flush();
    expect(screen.queryByText('Day 1 of 7')).toBeNull();
  });

  it('does not rise when today is already claimed', async () => {
    rpc.mockResolvedValue({ data: stateFor(4, [4]), error: null });
    mount();
    await flush();
    expect(screen.queryByText('Day 4 of 7')).toBeNull();
  });

  it('never asks the server for an account older than a week', async () => {
    mockUser = { ...mockUser, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
    mount();
    await flush();
    expect(rpc).not.toHaveBeenCalled();
  });
});
