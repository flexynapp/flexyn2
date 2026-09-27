import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const complete = vi.fn();
const celebrate = vi.fn();
const recordAction = vi.fn(() => Promise.resolve());
const invoke = vi.fn(() => Promise.resolve(null));

vi.mock('@/lib/data/goals', () => ({ complete: (...a) => complete(...a) }));
vi.mock('@/lib/data/quests', () => ({ recordAction: (...a) => recordAction(...a) }));
vi.mock('@/api/db', () => ({ db: { functions: { invoke: (...a) => invoke(...a) } } }));
vi.mock('@/lib/goalCelebration', () => ({ fireGoalCelebration: (...a) => celebrate(...a) }));
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

import useGoalAutoComplete from '@/hooks/useGoalAutoComplete';

const user = { id: 'u1', email: 'a@b.c' };
const CREATED = '2026-09-01T00:00:00Z';
const pullups = (status = 'active') => ({
  id: 'g1', status, goal_type: 'strength', exercise_name: 'Pull-ups', target_reps: 10, created_date: CREATED,
});
const logsWith = (reps) => [{ created_date: '2026-09-10T00:00:00Z', exercises: [{ name: 'Pull-ups', sets: [{ weight: 0, reps }] }] }];

function run(props) {
  const qc = new QueryClient();
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook((p) => useGoalAutoComplete(p), { wrapper, initialProps: props });
}

beforeEach(() => { complete.mockReset(); celebrate.mockReset(); recordAction.mockClear(); invoke.mockClear(); });

describe('useGoalAutoComplete', () => {
  it('completes a goal the moment it is hit and celebrates with the XP the server paid', async () => {
    complete.mockResolvedValue({ completed: true, xp: 40 });
    run({ user, goals: [pullups()], logs: logsWith(10), cardioLogs: [] });
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
    expect(complete).toHaveBeenCalledWith('g1');
    expect(celebrate.mock.calls[0][0]).toMatchObject({ goalName: 'Pull-ups', xpReward: 40 });
    // XP milestones run with xp_gained 0: the client never names an amount.
    expect(invoke).toHaveBeenCalledWith('updateUserXpAndAchievements', { xp_gained: 0 });
    expect(recordAction).toHaveBeenCalledTimes(1);
  });

  it('does not ask about a goal that is not hit, or not active', async () => {
    run({ user, goals: [pullups(), { ...pullups('archived'), id: 'g2' }], logs: logsWith(9), cardioLogs: [] });
    await new Promise(r => setTimeout(r, 20));
    expect(complete).not.toHaveBeenCalled();
  });

  it('stays quiet when the server says no, and asks only once per goal', async () => {
    complete.mockResolvedValue({ completed: false, reason: 'not_met' });
    const { rerender } = run({ user, goals: [pullups()], logs: logsWith(10), cardioLogs: [] });
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    rerender({ user, goals: [pullups()], logs: logsWith(12), cardioLogs: [] });
    await new Promise(r => setTimeout(r, 20));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(celebrate).not.toHaveBeenCalled();
  });

  it('waits while the page is still loading', async () => {
    run({ user, goals: [pullups()], logs: logsWith(10), cardioLogs: [], enabled: false });
    await new Promise(r => setTimeout(r, 20));
    expect(complete).not.toHaveBeenCalled();
  });
});
