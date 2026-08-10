/**
 * InsightsTab — the numbers this tab prints are ones people eat and train
 * by, and every defect below reached production because a wrong number
 * looks exactly like a right one.
 *
 * TIMEZONE NOTE: the "Training since" assertion compares against a date
 * built with `parseLocalDate`, which is the contract — the label must name
 * the day the workout was logged, in every timezone. It is only capable of
 * FAILING outside UTC, because inside UTC the old `new Date(str)` parse was
 * accidentally correct. Run `TZ=America/New_York npx vitest run` to
 * exercise it against the bug it was written for.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { format, subDays, startOfWeek } from 'date-fns';
import { LanguageProvider } from '@/lib/LanguageContext';
import { parseLocalDate } from '@/lib/dateUtils';

const downloadCsvMock = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock('@/lib/downloadCsv', () => ({ downloadCsv: (...a) => downloadCsvMock(...a) }));

let unit = 'lbs';
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: unit }) }));

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import InsightsTab from '@/components/progress/InsightsTab';
import { toast } from '@/lib/toast';

const USER = { id: 'u-1' };
const d = (date) => format(date, 'yyyy-MM-dd');

/** A profile with everything Mifflin-St Jeor needs. */
const FULL_PROFILE = { ...USER, weight_lbs: 180, height_inches: 70, age: 30, gender: 'male' };

const ex = (muscle, weight = 100, reps = 10) => ({
  name: `${muscle} lift`,
  ...(muscle ? { muscle_groups: [muscle] } : {}),
  sets: [{ weight, reps }],
});

const show = (props = {}) => render(
  <MemoryRouter>
    <LanguageProvider>
      <InsightsTab logs={[]} cardioLogs={[]} bodyMetrics={[]} userProfile={USER} {...props} />
    </LanguageProvider>
  </MemoryRouter>,
);

beforeEach(() => { unit = 'lbs'; localStorage.clear(); downloadCsvMock.mockClear(); });
afterEach(cleanup);

// ── Training age ────────────────────────────────────────────────────────────

describe('Training age', () => {
  it('names the day the workout was logged, not the UTC instant before it', () => {
    const LOG_DATE = '2026-08-07';
    show({ logs: [{ date: LOG_DATE, exercises: [] }] });

    // `new Date('2026-08-07')` is UTC midnight — Aug 6 20:00 in US Eastern —
    // so this label read "August 6" for a workout logged on the 7th.
    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'long' })
      .format(parseLocalDate(LOG_DATE));
    expect(screen.getByText(`Training since ${expected}`)).toBeInTheDocument();
  });

  it('says "1 day", not "1 days"', () => {
    show({ logs: [{ date: d(subDays(new Date(), 1)), exercises: [] }] });
    expect(screen.getByText('1 day')).toBeInTheDocument();
    expect(screen.queryByText('1 days')).toBeNull();
  });

  it('withholds consistency in week one rather than awarding a free 100%', () => {
    // activeWeeks/totalWeeks is 1/1 for every brand-new account, so the
    // old card congratulated a three-day-old user on being 100% consistent.
    show({ logs: [{ date: d(startOfWeek(new Date())), exercises: [] }] });

    expect(screen.getByText(/Consistency unlocks after two weeks/)).toBeInTheDocument();
    expect(screen.queryByText('consistent')).toBeNull();
    expect(screen.queryByText('100%')).toBeNull();
  });

  it('counts calendar weeks inclusively once there are two, with singular labels', () => {
    const thisWeek = startOfWeek(new Date());
    show({
      logs: [
        { date: d(subDays(thisWeek, 7)), exercises: [] },
        { date: d(thisWeek),             exercises: [] },
      ],
    });
    expect(screen.getByText('2 active weeks')).toBeInTheDocument();
    expect(screen.getByText('2 total weeks')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});

// ── TDEE ────────────────────────────────────────────────────────────────────

describe('TDEE', () => {
  it('measures sessions against days trained, not a flat 30-day denominator', () => {
    const logs   = [{ date: d(subDays(new Date(), 2)), exercises: [] }];
    const cardio = [
      { date: d(subDays(new Date(), 1)), calories: 200 },
      { date: d(new Date()),             calories: 200 },
    ];
    show({ logs, cardioLogs: cardio, userProfile: FULL_PROFILE });

    // 3 sessions over a 7-day floor = 3/wk → the 1.55 band. Divided by a
    // fixed 4.3 weeks this read 0.7/wk and took the 1.375 "lightly active"
    // band, roughly 300 kcal low before the double-count pushed it back up.
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('×1.55')).toBeInTheDocument();
    expect(screen.getByText('1,783')).toBeInTheDocument();       // BMR
    expect(screen.getByText('2,763')).toBeInTheDocument();       // 1782.7 × 1.55
  });

  it('does not add workout calories on top of the activity multiplier', () => {
    // The multiplier IS the exercise term. A workout with a lot of sets
    // must not move TDEE beyond the band it already selected.
    const many = { date: d(new Date()), exercises: [{ name: 'x', sets: Array(40).fill({ weight: 100, reps: 10 }) }] };
    show({ logs: [many], cardioLogs: [{ date: d(new Date()), calories: 5000 }], userProfile: FULL_PROFILE });

    // 2 sessions / 7-day floor = 2/wk → 1.375. 1782.7 × 1.375 = 2451.2.
    expect(screen.getByText('2,451')).toBeInTheDocument();
  });

  it('names only the profile fields that are actually missing', () => {
    // `missingFields` was assembled after the bail-out, on a path where all
    // three inputs exist by construction — so the empty state hardcoded all
    // three chips and the "partial estimate" banner was unreachable.
    show({ userProfile: { ...FULL_PROFILE, age: null } });

    expect(screen.getByText('Add your age in Settings to get a TDEE estimate.')).toBeInTheDocument();
    expect(screen.queryByText(/body weight, height, age/)).toBeNull();
  });

  it('lists every missing field when the profile is empty', () => {
    show({ userProfile: USER });
    expect(screen.getByText('Add your body weight, height, age in Settings to get a TDEE estimate.'))
      .toBeInTheDocument();
  });
});

// ── Muscle balance ──────────────────────────────────────────────────────────

describe('Muscle imbalance', () => {
  const logsWith = (exercises) => [{ date: d(new Date()), exercises }];

  it('reports shares of CATEGORIZED volume so the bars sum to 100', () => {
    // 1000 push + 1000 pull + 2000 uncategorized. Uncategorized volume used
    // to sit in the denominator with no bar of its own, so these read 25%
    // and 25% and half the chart was silently missing.
    show({ logs: logsWith([ex('chest'), ex('back'), ex(null)].concat(ex(null))) });

    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(screen.getByText(/50% of your volume has no muscle group assigned/)).toBeInTheDocument();
  });

  it('shows the empty state when nothing is categorized, not three 0% bars', () => {
    show({ logs: logsWith([ex(null)]) });
    expect(screen.getByText(/Log workouts with muscle groups assigned/)).toBeInTheDocument();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('warns on an infinite imbalance instead of hiding the whole indicator', () => {
    // `ratio` is null when pull volume is 0, and the indicator was gated on
    // `ratio !== null` — so the one user this feature exists for saw nothing.
    show({ logs: logsWith([ex('chest')]) });

    expect(screen.getByText('No pull volume')).toBeInTheDocument();
    expect(screen.getByText(/All your logged volume is push/)).toBeInTheDocument();
  });
});

// ── Goal weight ─────────────────────────────────────────────────────────────

describe('Goal weight', () => {
  const METRICS = [
    { date: d(subDays(new Date(), 14)), weight_lbs: 200 },
    { date: d(new Date()),              weight_lbs: 190 },
  ];

  it('converts stone with the stone factor, not the kg one', () => {
    unit = 'stone';
    show({ bodyMetrics: METRICS, userProfile: USER });

    fireEvent.change(screen.getByPlaceholderText('Goal in stone'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));

    // 12 st = 168 lb. Dividing by the kg factor stored 26.5 lb and read
    // back as 1.9 st — reachable, because stone is selectable in Settings.
    expect(localStorage.getItem('flexyn.goalWeightLbs.u-1')).toBe('168');
  });

  it('scopes the stored goal to the user instead of sharing one device key', () => {
    show({ bodyMetrics: METRICS, userProfile: { id: 'u-2' } });
    fireEvent.change(screen.getByPlaceholderText('Goal in lbs'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));

    expect(localStorage.getItem('flexyn.goalWeightLbs.u-2')).toBe('150');
    expect(localStorage.getItem('flexyn_goal_weight_lbs')).toBeNull();
  });

  it('migrates a goal off the old unscoped key exactly once', () => {
    localStorage.setItem('flexyn_goal_weight_lbs', '175');
    show({ bodyMetrics: METRICS, userProfile: USER });

    expect(localStorage.getItem('flexyn.goalWeightLbs.u-1')).toBe('175');
    expect(localStorage.getItem('flexyn_goal_weight_lbs')).toBeNull();
    expect(screen.getByPlaceholderText('Goal in lbs')).toHaveValue(175);
  });

  it('surfaces an error rather than looking like a dead button', () => {
    show({ bodyMetrics: METRICS, userProfile: USER });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));

    expect(toast.error).toHaveBeenCalledWith('Enter a goal weight above 0 first.');
    expect(localStorage.getItem('flexyn.goalWeightLbs.u-1')).toBeNull();
  });

  it('can clear a goal once set — there was no way back before', () => {
    show({ bodyMetrics: METRICS, userProfile: USER });
    fireEvent.change(screen.getByPlaceholderText('Goal in lbs'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(localStorage.getItem('flexyn.goalWeightLbs.u-1')).toBeNull();
    expect(screen.getByPlaceholderText('Goal in lbs')).toHaveValue(null);
  });

  it('sends the user to the surface that can actually log a weight', () => {
    // The old copy said "in the Body tab", which stopped accepting body
    // measurements — the only writer is LogWeightModal on Dashboard.
    show({ bodyMetrics: [], userProfile: USER });
    expect(screen.getByText(/Log at least 2 body weight entries/)).toBeInTheDocument();
    expect(screen.queryByText(/Body tab/)).toBeNull();
    expect(screen.getByRole('button', { name: /Log your weight/ })).toBeInTheDocument();
  });

  it('treats a numeric-string weight_lbs as a number', () => {
    // PostgREST hands `numeric` back as a string, and the regression summed
    // those with `+` — concatenating instead of adding.
    show({
      bodyMetrics: [
        { date: d(subDays(new Date(), 14)), weight_lbs: '200' },
        { date: d(new Date()),              weight_lbs: '190' },
      ],
      userProfile: USER,
    });
    fireEvent.change(screen.getByPlaceholderText('Goal in lbs'), { target: { value: '180' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));

    expect(screen.getByText('losing weight')).toBeInTheDocument();
    expect(screen.getByText(/days away · 5.0 lbs\/week pace/)).toBeInTheDocument();
  });
});

// ── Export ──────────────────────────────────────────────────────────────────

describe('CSV export', () => {
  it('exports the body-metric columns that exist', async () => {
    // The old header promised chest/waist/hips/arms/thighs in INCHES. None
    // of those columns are on `body_metrics` — the real ones are metric —
    // so every row was blank past body fat.
    show({
      bodyMetrics: [{ date: '2026-08-07', weight_lbs: 190, body_fat_pct: 18, waist_cm: 82, chest_cm: 104, hip_cm: 96, notes: 'n' }],
      userProfile: USER,
    });
    fireEvent.click(screen.getByRole('button', { name: /Body Metrics/ }));

    const [rows, filename] = downloadCsvMock.mock.calls[0];
    expect(filename).toBe('flexyn-body-metrics.csv');
    expect(rows[0]).toEqual(['Date', 'Weight (lbs)', 'Body Fat %', 'Waist (cm)', 'Chest (cm)', 'Hip (cm)', 'Notes']);
    expect(rows[1]).toEqual(['2026-08-07', 190, 18, 82, 104, 96, 'n']);
    expect(rows[0].join()).not.toMatch(/\(in\)|Arm|Thigh/);
  });

  it('keeps commas in notes instead of blanking them out', () => {
    // Notes used to be run through `.replace(/,/g, ' ')` because the writer
    // did not quote properly. downloadCsv quotes, so the text survives.
    show({ cardioLogs: [{ date: '2026-08-07', activity_type: 'Run', notes: 'easy, windy' }], userProfile: USER });
    fireEvent.click(screen.getByRole('button', { name: /Cardio Logs/ }));

    expect(downloadCsvMock.mock.calls[0][0][1]).toContain('easy, windy');
  });

  it('refuses to hand over an empty file', () => {
    show({ logs: [], userProfile: USER });
    fireEvent.click(screen.getByRole('button', { name: /Workout Logs/ }));

    expect(downloadCsvMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('No workout data to export.');
  });

  it('counts sessions with the right plural', () => {
    show({ logs: [{ date: d(new Date()), exercises: [] }], userProfile: USER });
    const btn = screen.getByRole('button', { name: /Workout Logs/ });
    expect(within(btn).getByText(/1 session · /)).toBeInTheDocument();
  });
});
