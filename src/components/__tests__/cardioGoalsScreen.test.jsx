/**
 * Cardio → Goals, end to end through the component.
 *
 * The calculator has its own unit tests in
 * src/lib/__tests__/cardioGoalProgress.test.js. These exist because the
 * bug was not in the arithmetic — it was in the QUERY. The screen asked
 * for `goal_type = 'cardio'`, a value nothing in the app writes, so it
 * rendered its empty state at an account holding two cardio goals while
 * every number it would have computed was correct.
 *
 * So the assertions here are deliberately about what reaches the screen:
 * the goal appears, the empty state does not, and creating one writes a
 * goal_type the rest of the app can read back.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CARDIO_GOAL_TYPES } from '@/lib/goalProgress';

// The real row from production on 2026-08-11, and the one run that counts
// toward it — a TREADMILL run, which only scores if activity matching
// keys on the mode prefix rather than the full type.
const GOALS = [
  {
    id: 'a', title: 'Run a 5K', goal_type: 'cardio_distance', cardio_activity: 'running',
    period: 'lifetime', period_start_date: null, target_distance_meters: 5000,
    created_date: '2026-08-09T01:40:54Z', status: 'active',
  },
];
const LOGS = [
  {
    date: '2026-08-09', created_date: '2026-08-09T05:25:33Z',
    type: 'running_treadmill', distance_meters: 3219, duration_seconds: 900,
  },
];

const created = [];
let goalRows = GOALS;

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { email: 'k@x.com' } }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi' }) }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/data/goals', () => ({
  create: (payload) => { created.push(payload); return Promise.resolve({ id: 'new' }); },
  update: () => Promise.resolve(),
}));

// A chainable stub that ACTUALLY APPLIES eq / in / neq.
//
// This matters more than it looks. The first version ignored the filters
// and handed back every row, so the headline test — "the screen shows the
// goal" — passed against the broken code too: the old
// `.eq('goal_type', 'cardio')` was simply not consulted. A stub that
// ignores the predicate cannot see a bug that IS the predicate. With
// filtering on, the old query matches zero rows and the test fails, which
// is the whole point of writing it.
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      let rows = table === 'goals' ? goalRows : LOGS;
      const chain = {
        select: () => chain,
        eq: (col, val) => {
          // created_by is the row-ownership filter; the fixtures carry no
          // such column, so applying it would empty every result.
          if (col !== 'created_by') rows = rows.filter(r => r[col] === val);
          return chain;
        },
        in: (col, vals) => { rows = rows.filter(r => vals.includes(r[col])); return chain; },
        neq: (col, val) => { rows = rows.filter(r => r[col] !== val); return chain; },
        order: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
      };
      return chain;
    },
  },
}));

import CardioGoals from '@/components/cardio/CardioGoals';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CardioGoals /></QueryClientProvider>);
}

beforeEach(() => { created.length = 0; goalRows = GOALS; });

describe('reading — the bug', () => {
  it('shows a cardio_distance goal instead of the empty state', async () => {
    mount();
    expect(await screen.findByText('Run a 5K')).toBeTruthy();
    expect(screen.queryByText('No cardio goals yet')).toBeNull();
  });

  it('reports its real progress — 3219 m of 5000, in the viewer’s unit', async () => {
    mount();
    expect(await screen.findByText(/2\.0 mi \/ 3\.1 mi/)).toBeTruthy();
    expect(screen.getByText('Distance')).toBeTruthy();
  });

  it('still shows the empty state when there genuinely are no goals', async () => {
    goalRows = [];
    mount();
    expect(await screen.findByText('No cardio goals yet')).toBeTruthy();
  });
});

describe('writing — the other half of the bug', () => {
  it('creates a goal with a goal_type the rest of the app reads', async () => {
    mount();
    await screen.findByText('Run a 5K');

    act(() => { fireEvent.click(screen.getByText('New Cardio Goal')); });
    const title = await screen.findByPlaceholderText(/Run 3× this week/);
    act(() => { fireEvent.change(title, { target: { value: 'Weekly runs' } }); });
    act(() => { fireEvent.change(screen.getByPlaceholderText('e.g. 3'), { target: { value: '3' } }); });
    act(() => { fireEvent.click(screen.getByText('Create Goal')); });

    await waitFor(() => expect(created.length).toBe(1));
    const payload = created[0];
    // The assertion that would have caught the original defect.
    expect(payload.goal_type).toBe('cardio_sessions');
    expect(CARDIO_GOAL_TYPES).toContain(payload.goal_type);
    expect(payload.goal_type).not.toBe('cardio');
    expect(payload.target_sessions).toBe(3);
    // period_start_date is what makes a weekly goal reset on Monday; the
    // old payload never wrote it, so every non-lifetime goal it made
    // counted logs from all time on any surface but this one.
    expect(payload.period).toBe('week');
    expect(payload.period_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('writes the distance type and no session target when Distance is picked', async () => {
    mount();
    await screen.findByText('Run a 5K');

    act(() => { fireEvent.click(screen.getByText('New Cardio Goal')); });
    const title = await screen.findByPlaceholderText(/Run 3× this week/);
    act(() => { fireEvent.change(title, { target: { value: '10 miles' } }); });
    // byRole, not byText: "Distance" is also the progress-bar label on the
    // goal card already on screen, so a text query matches two nodes.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Distance' })); });
    act(() => { fireEvent.change(screen.getByPlaceholderText('e.g. 10'), { target: { value: '10' } }); });
    act(() => { fireEvent.click(screen.getByText('Create Goal')); });

    await waitFor(() => expect(created.length).toBe(1));
    const payload = created[0];
    expect(payload.goal_type).toBe('cardio_distance');
    expect(payload.target_sessions).toBeUndefined();
    // 10 mi in metres, since the viewer's unit is miles.
    expect(Math.round(payload.target_distance_meters)).toBe(16093);
  });

  it('refuses a goal with no target rather than writing a 0% row', async () => {
    mount();
    await screen.findByText('Run a 5K');
    act(() => { fireEvent.click(screen.getByText('New Cardio Goal')); });
    const title = await screen.findByPlaceholderText(/Run 3× this week/);
    act(() => { fireEvent.change(title, { target: { value: 'No target' } }); });
    act(() => { fireEvent.click(screen.getByText('Create Goal')); });
    await new Promise(r => setTimeout(r, 30));
    expect(created.length).toBe(0);
  });
});
