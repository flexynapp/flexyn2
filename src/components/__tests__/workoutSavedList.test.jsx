/**
 * All Workouts ▸ Gym — the saved workout list.
 *
 * 180 lines with no test of any kind before this file. It is the surface
 * whose entire job is "show me every workout I have logged", and it was
 * reading another component's cache entry.
 *
 * The first test is the regression that matters and it uses a REAL
 * QueryClient, because the bug lives in React Query's cache and cannot be
 * reproduced against a mock: `WorkoutSavedList` asked for 500 rows under
 * the bare key `['workoutLogs', email]`, and `Workout.jsx` — which
 * statically imports it — had already registered that same key with a
 * limit of 50. One key, one entry, first writer wins.
 *
 * Revert `workoutLogsKey` to the bare key and test 1 fails: the list
 * renders the 50-row neighbour's payload instead of its own.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { workoutLogsKey } from '@/lib/data/workoutKeys';

const EMAIL = 'k@x.com';
const t = (key) => ({
  'workout.exercises': 'Exercises', 'common.sets': 'Sets',
  'workout.freestyle': 'Freestyle',
}[key] ?? key);
const tFallback = (key, english) => english;

// What the list's OWN query returns.
let listRows = [];
const listSpy = vi.fn(async () => listRows);

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...p }) => <div {...p}>{children}</div> }),
}));
vi.mock('@/lib/LanguageContext', () => ({ useLanguage: () => ({ t, tFallback, language: 'en' }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { email: EMAIL } }) }));
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));
vi.mock('@/lib/dateLocales', () => ({ getDateLocale: () => undefined }));
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));
vi.mock('@/api/db', () => ({
  db: {
    auth: { me: async () => ({ include_bar_in_volume: false }) },
  },
}));

vi.mock('@/lib/data/workouts', () => ({ list: (...a) => listSpy(...a) }));

import WorkoutSavedList from '@/components/workout/WorkoutSavedList';

const log = (over = {}) => ({
  id: 'l1', date: '2026-08-09', title: 'Push A',
  exercises: [{ name: 'Bench Press', sets: [{ weight: 135, reps: 5 }] }],
  ...over,
});

let qc;
const mount = (props = {}) => render(
  <QueryClientProvider client={qc}>
    <WorkoutSavedList onSelectLog={() => {}} {...props} />
  </QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  listRows = [log()];
  listSpy.mockClear();
});
afterEach(cleanup);

describe('the cache entry it reads is its own', () => {
  // The symptom is NOT "the list is capped at 50" — measured against the
  // installed react-query, a second observer on a shared key refetches
  // with its OWN queryFn and OVERWRITES the entry. So the list did get its
  // 500; what broke was everyone else. Opening All Workouts ▸ Gym replaced
  // the Workout page's 50-row entry with 500 rows, and the page's own
  // stats then recomputed over rows it never asked for.
  it("does not clobber the Workout page's 50-row entry when it mounts", async () => {
    const pageRows = Array.from({ length: 50 }, (_, i) => log({ id: `page-${i}` }));
    qc.setQueryData(workoutLogsKey(EMAIL, 'workout'), pageRows);
    // Also seed the OLD bare key, which is what the page used to own.
    qc.setQueryData(['workoutLogs', EMAIL], pageRows);
    listRows = [log({ id: 'mine', title: 'My own 500-row payload' })];

    mount();
    expect(await screen.findByText('My own 500-row payload')).toBeTruthy();

    // The neighbour's entries are untouched — both the scoped one and the
    // bare one. Revert the fix and the bare entry becomes the list's rows.
    expect(qc.getQueryData(workoutLogsKey(EMAIL, 'workout'))).toHaveLength(50);
    expect(qc.getQueryData(['workoutLogs', EMAIL])).toHaveLength(50);
  });

  it('registers under the savedList scope, not the bare key', async () => {
    mount();
    await waitFor(() => expect(qc.getQueryData(workoutLogsKey(EMAIL, 'savedList'))).toBeTruthy());
    // The bare key stays untouched, so no other reader is poisoned either.
    expect(qc.getQueryData(['workoutLogs', EMAIL])).toBeUndefined();
  });

  it('still asks for 500 — the limit it always meant to use', async () => {
    mount();
    await waitFor(() => expect(listSpy).toHaveBeenCalled());
    expect(listSpy.mock.calls[0][1]).toBe(500);
  });
});

describe('what a row says', () => {
  it('shows the title and a metrics line', async () => {
    mount();
    expect(await screen.findByText('Push A')).toBeTruthy();
    expect(screen.getByText(/Aug 9/)).toBeTruthy();
    expect(screen.getByText(/1 exercise/)).toBeTruthy();
  });

  it('falls back to Freestyle when the log has no title', async () => {
    listRows = [log({ title: null })];
    mount();
    expect(await screen.findByText('Freestyle')).toBeTruthy();
  });

  // CLAUDE.md: "a section with no data must not render as zeros." Row
  // dad0ba31 in production carries exercises:[] — it must not read
  // "0 exercises • 0 sets • 0 lbs".
  it('renders no zeros for a log with no exercises', async () => {
    listRows = [log({ id: 'empty', exercises: [] })];
    mount();
    await screen.findByText('Push A');
    expect(screen.queryByText(/0 exercise/)).toBeNull();
    expect(screen.queryByText(/0 set/)).toBeNull();
    expect(screen.queryByText(/0 lbs/)).toBeNull();
  });
});

describe('search', () => {
  it('filters by title', async () => {
    listRows = [log({ id: 'a', title: 'Push A' }), log({ id: 'b', title: 'Leg Day' })];
    mount({ search: 'leg' });
    expect(await screen.findByText('Leg Day')).toBeTruthy();
    expect(screen.queryByText('Push A')).toBeNull();
  });

  // The month name is rendered through a locale and indexed WITHOUT one,
  // so this passes in English and is the reason a Spanish user seeing
  // "ago 9" has to type "August". Documented in the audit, not fixed here.
  it('filters by an English month name', async () => {
    mount({ search: 'august' });
    expect(await screen.findByText('Push A')).toBeTruthy();
  });

  it('says so when nothing matches, without blaming an empty log list', async () => {
    mount({ search: 'zzzz' });
    expect(await screen.findByText('No workouts match your search')).toBeTruthy();
  });
});
