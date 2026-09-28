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
// Interpolates the template rather than returning a pre-built fallback, so a
// dropped var would show up as a literal {xp}.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, en, vars = {}) => en.replace(/\{(\w+)\}/g, (_, n) => String(vars[n])),
  }),
}));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

import useGoalAutoComplete from '@/hooks/useGoalAutoComplete';

const user = { id: 'u1', email: 'a@b.c' };
const CREATED = '2026-09-01T00:00:00Z';
const pullups = (status = 'active') => ({
  id: 'g1', status, goal_type: 'strength', exercise_name: 'Pull-ups', target_reps: 10, created_date: CREATED,
});
const logsWith = (reps, id = 'w1') => [{ id, created_date: '2026-09-10T00:00:00Z', exercises: [{ name: 'Pull-ups', sets: [{ weight: 0, reps }] }] }];

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
    expect(celebrate.mock.calls[0][0]).toMatchObject({ title: 'Goal completed! +40 XP', goalName: 'Pull-ups', xpReward: 40 });
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

  it('ignores the optimistic row a save puts in the cache before the insert lands', async () => {
    complete.mockResolvedValue({ completed: true, xp: 40 });
    const optimistic = { ...logsWith(10)[0], id: '__optimistic__123_abc', created_date: undefined };
    const { rerender } = run({ user, goals: [pullups()], logs: [optimistic], cardioLogs: [] });
    await new Promise(r => setTimeout(r, 20));
    expect(complete).not.toHaveBeenCalled();
    // The saved row replaces it: now the server has the log, so ask.
    rerender({ user, goals: [pullups()], logs: logsWith(10, 'real-1'), cardioLogs: [] });
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  });

  it('asks again after a no once a new log arrives', async () => {
    complete.mockResolvedValueOnce({ completed: false, reason: 'not_met' })
            .mockResolvedValueOnce({ completed: true, xp: 40 });
    const { rerender } = run({ user, goals: [pullups()], logs: logsWith(10, 'w1'), cardioLogs: [] });
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    rerender({ user, goals: [pullups()], logs: [...logsWith(11, 'w2'), ...logsWith(10, 'w1')], cardioLogs: [] });
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('does not ask again about a weekly goal already met this week', async () => {
    complete.mockResolvedValue({ completed: false, already: true });
    const monday = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const weekly = { id: 'c2', status: 'active', goal_type: 'cardio_sessions', cardio_activity: 'any',
      period: 'week', target_sessions: 1, created_date: CREATED, period_met_start: monday };
    const cardio = [{ id: 'r1', created_date: new Date().toISOString(), date: monday, type: 'running_outside' }];
    run({ user, goals: [weekly], logs: [], cardioLogs: cardio });
    await new Promise(r => setTimeout(r, 20));
    expect(complete).not.toHaveBeenCalled();
    // Met in an earlier week: this week's session is new, so ask.
    run({ user, goals: [{ ...weekly, period_met_start: '2000-01-03' }], logs: [], cardioLogs: cardio });
    await waitFor(() => expect(complete).toHaveBeenCalledWith('c2'));
  });

  it('names a cardio goal by its activity', async () => {
    complete.mockResolvedValue({ completed: true, xp: 20 });
    const run5k = { id: 'c1', status: 'active', goal_type: 'cardio_distance', cardio_activity: 'running',
      period: 'lifetime', target_distance_meters: 5000, created_date: CREATED };
    const cardio = [{ id: 'r1', created_date: '2026-09-10T00:00:00Z', type: 'running_outside', distance_meters: 5000 }];
    run({ user, goals: [run5k], logs: [], cardioLogs: cardio });
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
    expect(celebrate.mock.calls[0][0]).toMatchObject({ title: 'Goal completed! +20 XP', goalName: 'goals.activity.running' });
  });
});
