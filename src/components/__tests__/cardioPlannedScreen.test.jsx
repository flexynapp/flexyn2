/**
 * Planned Sessions, rendered off `scheduled_workouts`.
 *
 * The screen used to read `planned_cardio`, whose columns are gone from
 * the payload entirely — `planned_date` is now `scheduled_date`, `type` is
 * assembled from `workout.mode` + `workout.env`, and `completed_cardio_id`
 * (read forever, written never) is replaced by a real `status`. Every one
 * of those is a silent blank if it is read off the wrong shape, which is
 * why this renders rather than asserting on a query.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.fn(() => Promise.resolve({ data: 'new-id', error: null }));
let ROWS = [];

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, e, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), e) : e,
    language: 'en' }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { email: 'k@x.com' } }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi' }) }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
// Honours its options, because ONE stub now serves two different renders.
// `formatHour` calls formatDate with `{ hour }`, and the date beside it calls
// it with `{ weekday, month, day }` — that second caller replaced a date-fns
// `format(d, 'EEE, MMM d')`, which bound no locale and printed English month
// names under a fully translated screen. A stub returning '7 AM' for
// everything made both spans identical and `getByText('7 AM')` ambiguous,
// which reads as a component bug and is a mock that stopped describing the
// function it stands in for.
vi.mock('@/lib/intlFormat', () => ({
  formatDate: (_d, _lang, opts) => (opts?.hour ? '7 AM' : 'Mon, Jan 5'),
}));
vi.mock('@/api/supabaseClient', () => {
  const chain = () => {
    const c = {
      select: () => c, eq: () => c, in: () => c, gte: () => c, order: () => c,
      update: () => c,
      limit: () => Promise.resolve({ data: ROWS, error: null }),
      then: (res, rej) => Promise.resolve({ data: ROWS, error: null }).then(res, rej),
    };
    return c;
  };
  return { supabase: { rpc: (...a) => rpc(...a), from: () => chain() } };
});

import CardioPlanned from '@/components/cardio/CardioPlanned';

const future = () => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10); };
const pastDay = () => { const d = new Date(); d.setDate(d.getDate() - 5); return d.toISOString().slice(0, 10); };

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CardioPlanned /></QueryClientProvider>);
}

afterEach(() => { cleanup(); rpc.mockClear(); ROWS = []; });

describe('the upcoming list', () => {
  it('renders a scheduled cardio session with its time and distance', async () => {
    ROWS = [{
      id: '1', scheduled_date: future(), scheduled_hour: 7, title: 'Morning 5K',
      status: 'pending',
      workout: { kind: 'cardio', mode: 'running', env: 'outside', distance_meters: 5000, notes: 'easy pace' },
    }];
    mount();
    expect(await screen.findByText('Morning 5K')).toBeTruthy();
    // The time is the thing planned_cardio could not store at all.
    expect(screen.getByText('7 AM')).toBeTruthy();
    expect(screen.getByText('3.11 mi')).toBeTruthy();
    expect(screen.getByText('easy pace')).toBeTruthy();
  });

  it('does not show a cancelled plan as upcoming even when its date is ahead', async () => {
    ROWS = [{
      id: '1', scheduled_date: future(), scheduled_hour: 7, title: 'Cancelled one',
      status: 'cancelled', workout: { kind: 'cardio', mode: 'running', env: 'outside' },
    }];
    mount();
    await screen.findByText('Cancelled one');
    expect(screen.queryByText('Upcoming')).toBeNull();
    expect(screen.getByText('Past plans')).toBeTruthy();
  });
});

describe('the past list reports a real outcome', () => {
  // The defect this replaces: `completed_cardio_id` was read and never
  // written, so EVERY past plan said "Not logged" — including one you did.
  it.each([
    ['completed', 'Completed'],
    ['missed',    'Missed'],
    ['cancelled', 'Cancelled'],
  ])('shows %s as "%s"', async (status, label) => {
    ROWS = [{
      id: '1', scheduled_date: pastDay(), scheduled_hour: 7, title: 'Old plan',
      status, workout: { kind: 'cardio', mode: 'running', env: 'outside' },
    }];
    mount();
    await screen.findByText('Old plan');
    expect(screen.getByText(new RegExp(label))).toBeTruthy();
    expect(screen.queryByText(/Not logged/)).toBeNull();
  });
});

describe('creating a plan', () => {
  it('goes through schedule_workout with a date, an hour and a cardio payload', async () => {
    ROWS = [];
    mount();
    // findBy, not getBy: the component renders a loading skeleton until the
    // schedules query resolves, so the button is not there on first paint.
    const addBtn = await screen.findByText('Schedule a Session');
    act(() => { addBtn.click(); });

    const setValue = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const title = await screen.findByPlaceholderText(/Morning 5k/);
    act(() => { setValue(title, 'Thursday run'); });

    // Move the date to TOMORROW before picking a slot.
    //
    // This test used to pick "Night" on today's date, with a comment
    // claiming that slot could never already be past. That was wrong in the
    // most ordinary way: slotIsPast() marks hour 20 as past from 20:00, so
    // the pill was disabled and the click did nothing every evening. It
    // failed at 20:55 the day after it shipped.
    //
    // On a future date NO slot is past, so the assertion no longer depends
    // on what time the suite runs — which is the property it should have
    // had rather than a cleverer choice of hour.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    const dateInput = document.querySelector('input[type="date"]');
    act(() => {
      setValue(dateInput, `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`);
    });

    act(() => { screen.getByText('Night').click(); });
    act(() => { screen.getByText('Add Plan').click(); });

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('schedule_workout');
    expect(args.p_title).toBe('Thursday run');
    expect(args.p_hour).toBe(20);
    expect(args.p_workout.kind).toBe('cardio');
    expect(args.p_workout.mode).toBe('running');
    expect(args.p_workout.env).toBe('outside');
  });
});
