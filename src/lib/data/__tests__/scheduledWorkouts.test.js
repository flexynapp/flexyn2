import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const _state = { rpcName: null, rpcArgs: null, rpcError: null, rpcData: 'new-id' };

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (name, args) => {
      _state.rpcName = name;
      _state.rpcArgs = args;
      return Promise.resolve({ data: _state.rpcData, error: _state.rpcError });
    },
  },
}));

import {
  scheduleWorkout, localDateKey, dateKeyOffset, daySlots,
  HOUR_SLOTS, formatHour, slotIsPast,
} from '../scheduledWorkouts';

beforeEach(() => {
  _state.rpcName = null;
  _state.rpcArgs = null;
  _state.rpcError = null;
  _state.rpcData = 'new-id';
});
afterEach(() => vi.useRealTimers());

describe('localDateKey', () => {
  it('uses the LOCAL calendar date, not the UTC one', () => {
    // 22:30 on the 5th in UTC-5 is still the 5th locally, but toISOString()
    // would say the 6th — which would schedule the reminder a day late for
    // everyone west of Greenwich who plans their workout in the evening.
    const evening = new Date(2026, 7, 5, 22, 30, 0);
    expect(localDateKey(evening)).toBe('2026-08-05');
  });

  it('zero-pads month and day', () => {
    expect(localDateKey(new Date(2026, 0, 3))).toBe('2026-01-03');
  });

  it('rolls the year over correctly', () => {
    vi.useFakeTimers().setSystemTime(new Date(2026, 11, 31, 10, 0, 0));
    expect(dateKeyOffset(1)).toBe('2027-01-01');
  });

  it('handles a month boundary', () => {
    vi.useFakeTimers().setSystemTime(new Date(2026, 1, 28, 10, 0, 0));
    expect(dateKeyOffset(1)).toBe('2026-03-01'); // 2026 is not a leap year
  });
});

describe('daySlots', () => {
  it('offers today, tomorrow and the two days after', () => {
    const slots = daySlots(new Date(2026, 7, 5, 9, 0, 0));
    expect(slots.map(s => s.date)).toEqual(['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08']);
    expect(slots[0].label).toBe('Today');
    expect(slots[1].label).toBe('Tomorrow');
    // The far days get weekday names — "in 2 days" is harder to act on.
    expect(slots[2].label).not.toMatch(/day/i);
  });
});

describe('formatHour', () => {
  // Was a hardcoded 12-hour am/pm string — English convention wearing a
  // number, on a label that renders inside a translated Coach sentence.
  // Now Intl picks the clock from the locale.
  it.each([[0, '12 AM'], [7, '7 AM'], [12, '12 PM'], [13, '1 PM'], [18, '6 PM'], [23, '11 PM']])(
    'renders %i as %s in English', (h, expected) => expect(formatHour(h, 'en')).toBe(expected),
  );

  it('uses a 24-hour clock where the locale does', () => {
    // Most of the 15 languages we ship write 19:00, not 7pm. This is the
    // whole reason the parameter exists.
    expect(formatHour(19, 'de')).toBe('19 Uhr');
    expect(formatHour(19, 'fr')).toBe('19 h');
    expect(formatHour(19, 'ja')).toBe('19時');
  });

  it('defaults to English when no language is passed', () => {
    // Every call site threads `language`; this keeps an un-threaded caller
    // rendering something sane rather than the browser's locale.
    expect(formatHour(7)).toBe('7 AM');
  });

  it('normalizes out-of-range hours instead of producing an invalid date', () => {
    expect(formatHour(24, 'en')).toBe('12 AM');
    expect(formatHour(-1, 'en')).toBe('11 PM');
  });
});

describe('slotIsPast', () => {
  const now = new Date(2026, 7, 5, 14, 0, 0); // 2pm

  it('rejects an hour that has already gone today', () => {
    // Scheduling "today, morning" at 2pm would fire the reminder immediately
    // or be swept up as missed.
    expect(slotIsPast('2026-08-05', 7, now)).toBe(true);
    expect(slotIsPast('2026-08-05', 12, now)).toBe(true);
  });

  it('accepts a later hour today', () => {
    expect(slotIsPast('2026-08-05', 18, now)).toBe(false);
  });

  it('accepts any hour on a future day', () => {
    expect(slotIsPast('2026-08-06', 7, now)).toBe(false);
  });

  it('rejects every hour on a past day', () => {
    expect(slotIsPast('2026-08-04', 20, now)).toBe(true);
  });

  it('agrees with the hour slots the picker actually offers', () => {
    const evening = new Date(2026, 7, 5, 19, 0, 0);
    const open = HOUR_SLOTS.filter(s => !slotIsPast('2026-08-05', s.hour, evening));
    expect(open.map(s => s.hour)).toEqual([20]); // only Night is left at 7pm
  });
});

describe('scheduleWorkout', () => {
  const workout = { title: 'Full Body · 45 min', exercises: [{ name: 'Squat' }] };

  it('sends the local date and hour through to the RPC', async () => {
    const id = await scheduleWorkout({ date: '2026-08-06', hour: 7, title: 'Full Body', workout });
    expect(_state.rpcName).toBe('schedule_workout');
    expect(_state.rpcArgs).toEqual({
      p_date: '2026-08-06',
      p_hour: 7,
      p_title: 'Full Body',
      p_workout: workout,
    });
    expect(id).toBe('new-id');
  });

  it('stores the session whole, so what fires is what was committed to', async () => {
    await scheduleWorkout({ date: '2026-08-06', hour: 18, title: 'x', workout });
    expect(_state.rpcArgs.p_workout).toBe(workout);
  });

  it('falls back to a title rather than sending an empty one', async () => {
    await scheduleWorkout({ date: '2026-08-06', hour: 18, title: '', workout });
    expect(_state.rpcArgs.p_title).toBe('Workout');
  });

  it('throws on an RPC error so the card can show it inline', async () => {
    _state.rpcError = { message: 'too many scheduled workouts' };
    await expect(scheduleWorkout({ date: '2026-08-06', hour: 7, title: 't', workout }))
      .rejects.toMatchObject({ message: 'too many scheduled workouts' });
  });
});
