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
import { format, subDays, addDays, startOfWeek } from 'date-fns';
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
    expect(screen.getByText(new RegExp(`One workout so far, on ${expected}`))).toBeInTheDocument();
  });

  it('gives one session a date, not an age', () => {
    // A single workout eight weeks ago used to read "2 months" of training.
    show({ logs: [{ date: d(subDays(new Date(), 56)), exercises: [] }] });
    expect(screen.queryByText('2 months')).toBeNull();
    expect(screen.getByText(/One workout so far/)).toBeInTheDocument();
  });

  it('says "Training since" once there are two sessions', () => {
    const first = subDays(new Date(), 10);
    show({ logs: [{ date: d(first), exercises: [] }, { date: d(new Date()), exercises: [] }] });
    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(parseLocalDate(d(first)));
    expect(screen.getByText(`Training since ${expected}`)).toBeInTheDocument();
  });

  it('says "1 day", not "1 days"', () => {
    show({ logs: [{ date: d(subDays(new Date(), 1)), exercises: [] }, { date: d(new Date()), exercises: [] }] });
    expect(screen.getByText('1 day')).toBeInTheDocument();
    expect(screen.queryByText('1 days')).toBeNull();
  });

  it('withholds consistency in week one rather than awarding a free 100%', () => {
    // activeWeeks/totalWeeks is 1/1 for every brand-new account, so the
    // old card congratulated a three-day-old user on being 100% consistent.
    show({ logs: [{ date: d(startOfWeek(new Date(), { weekStartsOn: 1 })), exercises: [] }, { date: d(new Date()), exercises: [] }] });

    expect(screen.getByText(/Consistency unlocks after two weeks/)).toBeInTheDocument();
    expect(screen.queryByText('consistent')).toBeNull();
    expect(screen.queryByText('100%')).toBeNull();
  });

  it('counts calendar weeks inclusively once there are two, with singular labels', () => {
    const thisWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
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

  it('joins the missing fields as a locale list, not a hardcoded comma', () => {
    // `.join(', ')` is wrong in Arabic (`و`) and Japanese (`、`), and in
    // English it cannot produce the "and". The separator is locale data.
    // English is the one language that makes this look almost right, which
    // is why it survived — the "and" is the only visible tell here.
    show({ userProfile: USER });
    expect(screen.getByText('Add your body weight, height, and age in Settings to get a TDEE estimate.'))
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

// ── Goal projection ─────────────────────────────────────────────────────────
//
// ⚠ READ THIS BEFORE "FIXING" A FAILURE HERE.
//
// Several of these are CHARACTERIZATION tests, not regression tests. They
// assert what the card does TODAY, including where that is wrong — so they
// pass on the defect and will FAIL the moment someone repairs it. That is
// deliberate: the defects were found by an audit (2026-08-11) and pinned so
// they cannot drift further or be argued about, but they are NOT yet fixed
// and fixing them was not in that change's scope.
//
// The ones that encode a known defect are labelled B4, B6, B7, B2b and
// A/B4 below, each with the audit item it belongs to. When you fix one,
// INVERT its assertion rather than deleting it. Full write-up, including
// what "correct" should look like for each:
//   docs/progress-insights-goal-audit.md
//
// Everything else here (B2, B3, B3b, C1–C5, D1–D4) asserts correct or
// merely-unfortunate behaviour and should stay as written.
//
// The date the card prints is the whole feature, and it is derived from a
// least-squares fit rather than from the user's latest weigh-in. Those two
// disagree more often than they look like they would, so the checks below
// pin the arithmetic to hand-computed answers and then push on the branches
// where the fit and the reality part company.
//
// Numbered against docs/progress-insights-goal-audit.md.
//
// The clock is frozen at midday on purpose. `differenceInDays` truncates, and
// every weigh-in date parses to LOCAL MIDNIGHT, so a projection is always
// half a day short of a whole number — freezing at noon makes that visible
// and deterministic instead of making the suite flaky at 00:xx.

describe('Goal projection', () => {
  const NOON = new Date(2026, 7, 11, 12, 0, 0);

  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOON); });
  afterEach(() => { vi.useRealTimers(); });

  const medium = (date) => new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date);
  const at = (daysAgo, weight_lbs) => ({ date: d(subDays(NOON, daysAgo)), weight_lbs });
  /** Day 0 of a series, as the component parses it — local midnight. */
  const day0 = (daysAgo) => parseLocalDate(d(subDays(NOON, daysAgo)));

  const setGoal = (v, unitLabel = 'lbs') => {
    fireEvent.change(screen.getByPlaceholderText(`Goal in ${unitLabel}`), { target: { value: String(v) } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));
  };

  // A plain losing trend, for checks that need a working projection but do
  // not care about its exact shape.
  const LOSING = [at(20, 200), at(0, 190)];

  // ── B — the arithmetic ───────────────────────────────────────────────────

  it('B2 — anchors the projection to the first weigh-in, not to today', () => {
    // 200 lb on day 0, 190 lb on day 20 → −0.5 lb/day, intercept 200.
    // Goal 180 is (180−200)/−0.5 = 40 days from the FIRST weigh-in.
    show({ bodyMetrics: LOSING, userProfile: USER });
    setGoal(180);

    expect(screen.getByText(medium(addDays(day0(20), 40)))).toBeInTheDocument();
    expect(screen.getByText('losing weight')).toBeInTheDocument();
    // 0.5 lb/day × 7. If this reads 3.5 the slope is right.
    expect(screen.getByText(/3.5 lbs\/week pace/)).toBeInTheDocument();
  });

  it('B2b — the "days away" count is a day short of the date beside it', () => {
    // The date above resolves to 20 days after today; this line says 19,
    // because differenceInDays truncates a 19.5-day gap. Cosmetic, but the
    // two numbers are printed one above the other and disagree.
    show({ bodyMetrics: LOSING, userProfile: USER });
    setGoal(180);

    const projected = addDays(day0(20), 40);
    expect(screen.getByText(medium(projected))).toBeInTheDocument();   // 20 days out
    expect(screen.getByText(/^19 days away/)).toBeInTheDocument();     // says 19
  });

  it('B3 — flags a trend moving away from the goal', () => {
    show({ bodyMetrics: [at(20, 180), at(0, 190)], userProfile: USER });
    setGoal(170);

    expect(screen.getByText('Trending wrong way')).toBeInTheDocument();
    expect(screen.getByText(/moving away from your goal at 3.5 lbs\/week/)).toBeInTheDocument();
    expect(screen.queryByText(/Already reached/)).toBeNull();
  });

  it('B3b — a goal equal to current weight reads as reached, correctly', () => {
    // goalDirection is 0, so the mismatch guard deliberately lets this by.
    // Included because it is the one branch where "Already reached!" is true.
    show({ bodyMetrics: [at(20, 180), at(0, 190)], userProfile: USER });
    setGoal(190);

    expect(screen.getByText('Already reached! 🎉')).toBeInTheDocument();
    expect(screen.getByText('0 lbs')).toBeInTheDocument();  // Remaining
  });

  it('B4 — congratulates a goal the user has NOT reached', () => {
    // 200 → 175 → 185. Least squares over those three gives slope −0.75 and
    // intercept 194.17, so the LINE crosses 180 one day ago. The user's
    // actual last weigh-in is 185 — five pounds short.
    show({ bodyMetrics: [at(20, 200), at(10, 175), at(0, 185)], userProfile: USER });
    setGoal(180);

    expect(screen.getByText('Already reached! 🎉')).toBeInTheDocument();
    // ...printed directly above the two stats that contradict it.
    expect(screen.getByText('185 lbs')).toBeInTheDocument();  // Current
    expect(screen.getByText('5 lbs')).toBeInTheDocument();    // Remaining
  });

  it('B6 — a real weekly rate renders as 0.0 in stone', () => {
    unit = 'stone';
    // 1 lb over 14 days = 0.5 lb/week. In stone that is 0.036/week, and the
    // call site formats rates at 1 decimal → "0.0 stone".
    show({ bodyMetrics: [at(14, 200), at(0, 199)], userProfile: USER });
    setGoal(14, 'stone');   // 14 st = 196 lb

    expect(screen.getByText(/0.0 stone\/week pace/)).toBeInTheDocument();
  });

  it('B7 — extrapolates half a century with no horizon cap', () => {
    // slope −0.0011 lb/day, just past the 0.001 cutoff that returns null.
    show({ bodyMetrics: [at(100, 200), at(0, 199.89)], userProfile: USER });
    setGoal(180);

    expect(screen.getByText(/1[0-9],\d{3} days away/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp('20[7-9]\\d'))).toBeInTheDocument();
  });

  // ── C — persistence ──────────────────────────────────────────────────────

  it('C1 — reports success for a goal it discarded while the profile loads', () => {
    // userProfile arrives from an async query, so `userProfile?.id` is
    // undefined on the first render(s). saveGoalWeight early-returns on a
    // falsy id; the success toast fires regardless.
    show({ bodyMetrics: LOSING, userProfile: {} });
    setGoal(180);

    expect(toast.success).toHaveBeenCalledWith('Goal weight saved');
    expect(localStorage.length).toBe(0);
    expect(screen.queryByText('Remaining')).toBeNull();
  });

  it('C2 — a goal round-trips through unit changes without drift', () => {
    unit = 'stone';
    // A FRESH element each time. React short-circuits reconciliation when the
    // new element is referentially identical to the old one, so re-rendering
    // a stored `tree` const never picks the new unit up.
    const tree = () => (
      <MemoryRouter>
        <LanguageProvider>
          <InsightsTab logs={[]} cardioLogs={[]} bodyMetrics={LOSING} userProfile={USER} />
        </LanguageProvider>
      </MemoryRouter>
    );
    const { rerender } = render(tree());
    setGoal(12, 'stone');
    expect(localStorage.getItem('flexyn.goalWeightLbs.u-1')).toBe('168');

    unit = 'kg';    rerender(tree());
    expect(screen.getByPlaceholderText('Goal in kg')).toHaveValue(76.2);
    unit = 'stone'; rerender(tree());
    expect(screen.getByPlaceholderText('Goal in stone')).toHaveValue(12);
    expect(localStorage.getItem('flexyn.goalWeightLbs.u-1')).toBe('168');
  });

  it('C3 — setting a goal draws the projection without a remount', () => {
    show({ bodyMetrics: LOSING, userProfile: USER });
    expect(screen.queryByText('Remaining')).toBeNull();
    setGoal(180);
    expect(screen.getByText('Remaining')).toBeInTheDocument();
  });

  it('C5 — reports success when the write threw', () => {
    // Spy on the INSTANCE, not Storage.prototype — jsdom's localStorage is a
    // Proxy, so a prototype spy silently never fires and the test passes for
    // the wrong reason (the write succeeds and the projection renders).
    const spy = vi.spyOn(window.localStorage, 'setItem')
      .mockImplementation(() => { throw new Error('QuotaExceededError'); });
    show({ bodyMetrics: LOSING, userProfile: USER });
    setGoal(180);

    expect(toast.success).toHaveBeenCalledWith('Goal weight saved');
    expect(screen.queryByText('Remaining')).toBeNull();
    spy.mockRestore();
  });

  // ── D — the states that draw nothing ─────────────────────────────────────

  it('D1 — a flat trend leaves the card blank with no explanation', () => {
    show({ bodyMetrics: [at(14, 185), at(0, 185)], userProfile: USER });
    setGoal(180);

    // The write landed and the user was told so...
    expect(toast.success).toHaveBeenCalledWith('Goal weight saved');
    expect(localStorage.getItem('flexyn.goalWeightLbs.u-1')).toBe('180');
    // ...and the card says nothing at all about it.
    expect(screen.queryByText('Current')).toBeNull();
    expect(screen.queryByText('Remaining')).toBeNull();
    expect(screen.queryByText(/Already reached/)).toBeNull();
    expect(screen.queryByText(/Trending wrong way/)).toBeNull();
    expect(screen.queryByText(/Based on your logged weight trend/)).toBeNull();
  });

  it('D2 — weigh-ins on a single day leave the same blank card', () => {
    show({ bodyMetrics: [at(0, 190), at(0, 188)], userProfile: USER });
    setGoal(180);

    expect(screen.queryByText('Remaining')).toBeNull();
    expect(screen.queryByText(/Based on your logged weight trend/)).toBeNull();
  });

  it('D4 — two weigh-ins are enough, and the disclaimer is shown', () => {
    show({ bodyMetrics: LOSING, userProfile: USER });
    setGoal(180);
    expect(screen.getByText(/Based on your logged weight trend/)).toBeInTheDocument();
  });

  it('A/B4 — the only production user with a projection hits the false congratulation', () => {
    // Verbatim from public.body_metrics on 2026-08-11: user ead69f89 is the
    // ONLY account of 57 with two weigh-ins on two days, so this is the whole
    // live population of this card. 699 lb → 140 lb over 15 days, both inside
    // LogWeightModal's 70–700 guard.
    //
    // The fit crossed any sub-140 goal back in June, so every goal this user
    // can set reads as achieved while the Remaining stat says otherwise.
    show({
      bodyMetrics: [
        { date: '2026-05-20', weight_lbs: '699' },
        { date: '2026-06-04', weight_lbs: '140' },
      ],
      userProfile: USER,
    });
    setGoal(135);

    expect(screen.getByText('Already reached! 🎉')).toBeInTheDocument();
    expect(screen.getByText('140 lbs')).toBeInTheDocument();   // Current
    expect(screen.getByText('135 lbs')).toBeInTheDocument();   // Goal
    expect(screen.getByText('5 lbs')).toBeInTheDocument();     // Remaining — not reached
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
    fireEvent.click(screen.getByRole('button', { name: /Body metrics/ }));

    const [rows, filename] = downloadCsvMock.mock.calls[0];
    expect(filename).toBe('flexyn-body-metrics.csv');
    expect(rows[0]).toEqual(['Date', 'Weight (lbs)', 'Body Fat %', 'Waist (cm)', 'Chest (cm)', 'Hip (cm)', 'Notes']);
    expect(rows[1]).toEqual(['2026-08-07', 190, 18, 82, 104, 96, 'n']);
    expect(rows[0].join()).not.toMatch(/\(in\)|Arm|Thigh/);
  });

  it('names the workout from `title`, the column that exists', () => {
    // `workout_logs` has no `regimen_name`. The client wrote it anyway,
    // db.js's strip-and-retry dropped it, and the row saved without it — so
    // this column read `undefined` for every log ever written and the
    // "Freestyle" fallback was doing all the work.
    show({
      logs: [{
        date: '2026-08-07',
        title: 'Push Day',
        exercises: [{ name: 'Bench', sets: [{ weight: 135, reps: 5 }] }],
      }],
      userProfile: USER,
    });
    fireEvent.click(screen.getByRole('button', { name: /Workout logs/ }));

    expect(downloadCsvMock.mock.calls[0][0][1][1]).toBe('Push Day');
  });

  it('falls back to the translated freestyle label, not an English literal', () => {
    // Every historical row has a NULL title with no recoverable name, so
    // this path is the common one and has to be translatable.
    show({
      logs: [{ date: '2026-08-07', exercises: [{ name: 'Bench', sets: [{ weight: 135, reps: 5 }] }] }],
      userProfile: USER,
    });
    fireEvent.click(screen.getByRole('button', { name: /Workout logs/ }));

    expect(downloadCsvMock.mock.calls[0][0][1][1]).toBe('Freestyle session');
  });

  it('keeps commas in notes instead of blanking them out', () => {
    // Notes used to be run through `.replace(/,/g, ' ')` because the writer
    // did not quote properly. downloadCsv quotes, so the text survives.
    show({ cardioLogs: [{ date: '2026-08-07', activity_type: 'Run', notes: 'easy, windy' }], userProfile: USER });
    fireEvent.click(screen.getByRole('button', { name: /Cardio logs/ }));

    expect(downloadCsvMock.mock.calls[0][0][1]).toContain('easy, windy');
  });

  it('refuses to hand over an empty file', () => {
    show({ logs: [], userProfile: USER });
    fireEvent.click(screen.getByRole('button', { name: /Workout logs/ }));

    expect(downloadCsvMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('No workout data to export.');
  });

  it('counts sessions with the right plural', () => {
    show({ logs: [{ date: d(new Date()), exercises: [] }], userProfile: USER });
    const btn = screen.getByRole('button', { name: /Workout logs/ });
    expect(within(btn).getByText(/1 session · /)).toBeInTheDocument();
  });
});
