// src/components/workout/__tests__/injuryFormSheets.test.jsx
//
// Sheets A and C of the Injuries redesign, rendered.
//
// This is the only verification these screens get. InjuryForm sits behind the
// auth wall and is a `z-[200]` portal opened from a profile menu, so it cannot
// be reached in a browser without signing in as a real user — and the two
// things being built here are exactly the kind a build cannot catch: a hook
// ordering slip, a const read before its declaration (the TDZ trap that cost a
// production Hub crash), or a claim rendered from the wrong number.
//
// The claim is the point. Sheet A says "N exercises are out of your sessions"
// and sheet C names them; both read `injuryImpact`, which walks the same
// catalog `generateWorkout` filters on. If that count is ever wrong it is
// wrong in the most reassuring direction — telling an injured user the app is
// protecting more than it is — so it is asserted against the real catalog
// rather than a fixture.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listInjuries = vi.fn();
const logInjury = vi.fn();
const snoozeCheckIn = vi.fn();
const navigate = vi.fn();

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }),
}));
// The real tFallback interpolates into the fallback, and a stub that ignores
// vars would hide a missing placeholder — the exact blind spot CLAUDE.md
// documents from the journal's "Dormiste {n} h".
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    tFallback: (key, fallback, vars) => {
      let s = fallback;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
  }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/hooks/useOverlayBackButton', () => ({ useOverlayBackButton: () => {} }));
vi.mock('@/lib/data/injuries', async () => {
  // getExcludedMuscleGroups / checkInIntervalDays stay REAL — they are half of
  // what the rendered number depends on.
  const actual = await vi.importActual('@/lib/data/injuries');
  return {
    ...actual,
    listInjuries: (...a) => listInjuries(...a),
    logInjury: (...a) => logInjury(...a),
    snoozeCheckIn: (...a) => snoozeCheckIn(...a),
    clearInjury: vi.fn(),
    extendRecovery: vi.fn(),
    deleteInjury: vi.fn(),
  };
});
// The catalog behind injuryImpact is real; only the history read is stubbed.
vi.mock('@/api/db', () => ({
  db: { entities: { WorkoutLog: { filter: vi.fn(async () => []) } } },
}));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: vi.fn() } }));

import InjuryForm from '../InjuryForm';
import { injuryImpact } from '@/lib/aiCoach/workoutGenerator';
import { getExcludedMuscleGroups } from '@/lib/data/injuries';

const injury = (over = {}) => ({
  id: 'i1', muscle_group: 'Shoulders', severity: 'serious', status: 'active',
  injured_at: '2026-07-24', estimated_recovery_date: null, notes: null, ...over,
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InjuryForm onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listInjuries.mockResolvedValue([]);
});

describe('sheet A — the list leads with what the injury costs', () => {
  it('states the real number of exercises the injury withholds', async () => {
    listInjuries.mockResolvedValue([injury()]);
    mount();

    // Not a fixture: the same helper the generator's filter is built from.
    const expected = injuryImpact(getExcludedMuscleGroups([injury()])).removedCount;
    expect(expected).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText(`${expected} exercises are out of your sessions`)).toBeTruthy();
    });
  });

  it('says "1 exercise" rather than "1 exercises"', async () => {
    // Core has exactly one catalog entry that nothing else shares, so this is
    // the singular branch reached through real data rather than a stub.
    const one = [{ muscle_group: 'Glutes', severity: 'moderate' }];
    const n = injuryImpact(getExcludedMuscleGroups(one)).removedCount;
    listInjuries.mockResolvedValue([injury({ muscle_group: 'Glutes', severity: 'moderate' })]);
    mount();
    await waitFor(() => {
      const text = n === 1 ? '1 exercise is out of your sessions' : `${n} exercises are out of your sessions`;
      expect(screen.getByText(text)).toBeTruthy();
    });
  });

  it('offers the same two answers as the Workout-tab check-in', async () => {
    listInjuries.mockResolvedValue([injury()]);
    mount();
    await waitFor(() => expect(screen.getByText("I'm cleared")).toBeTruthy());
    expect(screen.getByText('Still hurts')).toBeTruthy();
  });

  it('defers by the severity interval when Still hurts is tapped', async () => {
    listInjuries.mockResolvedValue([injury()]);
    snoozeCheckIn.mockResolvedValue({});
    mount();
    await waitFor(() => expect(screen.getByText('Still hurts')).toBeTruthy());

    fireEvent.click(screen.getByText('Still hurts'));
    await waitFor(() => expect(snoozeCheckIn).toHaveBeenCalledWith('i1', 'serious'));
  });

  it('collapses cleared injuries behind one row', async () => {
    listInjuries.mockResolvedValue([
      injury(),
      injury({ id: 'c1', status: 'cleared', cleared_at: '2026-08-01' }),
      injury({ id: 'c2', status: 'cleared', cleared_at: '2026-08-02' }),
    ]);
    mount();

    await waitFor(() => expect(screen.getByText('2 cleared')).toBeTruthy());
    // History must not compete with the live list until asked for.
    expect(screen.queryByText('Cleared')).toBeNull();

    fireEvent.click(screen.getByText('2 cleared'));
    await waitFor(() => expect(screen.getByText('Cleared')).toBeTruthy());
  });

  it('says the Coach knows, and routes there', async () => {
    listInjuries.mockResolvedValue([injury()]);
    mount();
    await waitFor(() => expect(screen.getByText('Coach knows about this.')).toBeTruthy());

    fireEvent.click(screen.getByText(/Ask it what to train instead/));
    expect(navigate).toHaveBeenCalledWith('/coach');
  });

  it('says none of that when there are no active injuries', async () => {
    listInjuries.mockResolvedValue([injury({ status: 'cleared', cleared_at: '2026-08-01' })]);
    mount();
    await waitFor(() => expect(screen.getByText('1 cleared')).toBeTruthy());
    expect(screen.queryByText(/Coach knows/)).toBeNull();
  });
});

describe('sheet C — what it changed', () => {
  async function logOne({ area = 'Shoulders', severity = 'serious' } = {}) {
    const saved = injury({ muscle_group: area, severity });
    logInjury.mockResolvedValue(saved);
    // Empty until the log lands, then holding it — the list refetches after
    // the mutation and sheet C computes its impact from the full active set,
    // which is what the generator will actually apply.
    let rows = [];
    listInjuries.mockImplementation(async () => rows);
    logInjury.mockImplementation(async () => { rows = [saved]; return saved; });
    mount();

    await waitFor(() => expect(screen.getByText('No injuries logged')).toBeTruthy());
    fireEvent.click(screen.getByText('Log Injury', { selector: 'button, button *' }));
    await waitFor(() => expect(screen.getByText('Affected area')).toBeTruthy());
    fireEvent.click(screen.getByText(area));
    fireEvent.click(screen.getByText(severity === 'serious' ? 'Serious' : 'Moderate'));
    fireEvent.click(screen.getByRole('button', { name: 'Log Injury' }));
    return saved;
  }

  it('replaces the toast-and-nothing-else with the actual consequence', async () => {
    const saved = await logOne();
    await waitFor(() => expect(screen.getByText('Your sessions just changed.')).toBeTruthy());

    // Every lift it names must be one the generator genuinely withholds.
    const { removed } = injuryImpact(getExcludedMuscleGroups([saved]));
    expect(removed.length).toBeGreaterThan(0);
    for (const name of removed) expect(screen.getByText(name)).toBeTruthy();
  });

  it('explains the extra groups on a SERIOUS injury, and only then', async () => {
    await logOne({ severity: 'serious' });
    await waitFor(() => expect(screen.getByText(/also takes out what it helps move/)).toBeTruthy());
  });

  it('stays quiet about synergists on a moderate injury', async () => {
    await logOne({ area: 'Legs', severity: 'moderate' });
    await waitFor(() => expect(screen.getByText('Your sessions just changed.')).toBeTruthy());
    expect(screen.queryByText(/also takes out what it helps move/)).toBeNull();
  });

  it('offers the Coach a session built around it', async () => {
    await logOne();
    await waitFor(() => expect(screen.getByText('Build me a session around it')).toBeTruthy());

    fireEvent.click(screen.getByText('Build me a session around it'));
    expect(navigate).toHaveBeenCalledWith('/coach');
  });

  it('lets you back out to the list without going to the Coach', async () => {
    await logOne();
    await waitFor(() => expect(screen.getByText('Not now')).toBeTruthy());

    fireEvent.click(screen.getByText('Not now'));
    await waitFor(() => expect(screen.queryByText('Your sessions just changed.')).toBeNull());
    expect(navigate).not.toHaveBeenCalled();
  });
});
