// "Log today": five rows that each answer a tap. What is pinned here is what a
// person would notice going wrong: the count, the in-place water and mood logs
// writing the right thing, the forms opening on the right signal, and the one
// "everything logged" line appearing only when all five are in.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }) }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (_, n) => vars[n]) : en),
  }),
}));
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));
vi.mock('@/lib/haptic', () => ({ triggerHaptic: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/hooks/useCountUp', () => ({ default: (v) => v }));

const fuel = { today: '2026-09-27', calories: 0, waterOz: 0, calorieGoal: 2200, waterGoal: 64 };
vi.mock('@/hooks/useTodayFuel', () => ({ useTodayFuel: () => fuel }));
const create = vi.fn(async () => ({}));
vi.mock('@/lib/data/nutrition', () => ({ create: (...a) => create(...a) }));
vi.mock('@/lib/waterLogging', () => ({ rewardWaterLog: vi.fn(), WATER_DAILY_CAP_OZ: 200 }));
let stepLog = null;
vi.mock('@/lib/data/stepLogs', () => ({ getTodayStepLog: async () => stepLog }));
const logMoodAction = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/data/logMoodAction', () => ({ logMoodAction: (...a) => logMoodAction(...a) }));

import TodayLogCard, { glassesFor } from '../TodayLogCard';

function show(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TodayLogCard readiness={null} onOpenReadiness={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fuel, { calories: 0, waterOz: 0 });
  stepLog = null;
});

describe('glassesFor', () => {
  it('draws a glass per 8 oz of the goal and fills whole glasses only', () => {
    expect(glassesFor(20, 64)).toEqual({ total: 8, full: 2 });
  });
  it('caps the row at twelve glasses and never overfills', () => {
    expect(glassesFor(500, 200)).toEqual({ total: 12, full: 12 });
  });
});

describe('TodayLogCard', () => {
  it('starts a fresh day at 0 of 5 with a pill on every row', () => {
    show();
    expect(screen.getByText('0 of 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a glass of water' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log sleep' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log mood' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log steps' })).toBeTruthy();
    expect(screen.queryByText('Everything logged for today')).toBeNull();
  });

  it('logs a glass of water in place', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add a glass of water' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ date: '2026-09-27', calories: 0 });
  });

  it('opens the mood choices inside the row and saves the one picked', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Log mood' }));
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(() => expect(logMoodAction).toHaveBeenCalledTimes(1));
    expect(logMoodAction.mock.calls[0][0]).toMatchObject({ mood: 4 });
    // Optimistic: the choice shows while it saves.
    expect(screen.getByText('Good')).toBeTruthy();
  });

  it('opens the readiness sheet on the signal whose pill was tapped', () => {
    const onOpenReadiness = vi.fn();
    show({ onOpenReadiness });
    fireEvent.click(screen.getByRole('button', { name: 'Log steps' }));
    expect(onOpenReadiness).toHaveBeenCalledWith('steps');
  });

  it('shows the done line only once all five are logged', async () => {
    Object.assign(fuel, { calories: 900, waterOz: 16 });
    stepLog = { steps: 4200 };
    show({
      readiness: {
        score: 74, label: 'Ready',
        sleep: { hours: 7 }, mood: { mood: 3 },
        breakdown: { sleep: { logged: true } },
      },
    });
    expect(await screen.findByText('Everything logged for today')).toBeTruthy();
    expect(screen.getByText('5 of 5')).toBeTruthy();
  });
});
