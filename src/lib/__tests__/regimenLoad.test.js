import { describe, it, expect } from 'vitest';
import {
  totalSets,
  estimatedMinutes,
  regimenLoad,
  WORK_SECONDS_PER_SET,
  REST_SECONDS_DEFAULT,
} from '../regimenLoad';

// Two of the four real public regimens, copied VERBATIM out of
// production on 2026-08-11 (`select jsonb_agg(...) from regimens where
// is_public`). These are rows the store actually renders, so they are the
// cases that matter — a helper that is right on synthetic input and wrong
// on these would be worse than no helper.
//
// Do not "tidy" these numbers. An earlier draft of this file invented
// exercises 4-8 while claiming to be production data, and the invented
// rest values moved the derived duration by three minutes.
const REAL = {
  'Back & Shoulders Builder': {
    exercises: [
      { name: 'Pull-Up',          target_reps: 8,  target_sets: 4, rest_seconds: 90 },
      { name: 'Barbell Row',      target_reps: 10, target_sets: 4, rest_seconds: 90 },
      { name: 'Lat Pulldown',     target_reps: 12, target_sets: 3, rest_seconds: 75 },
      { name: 'Seated Cable Row', target_reps: 12, target_sets: 3, rest_seconds: 60 },
      { name: 'Overhead Press',   target_reps: 8,  target_sets: 4, rest_seconds: 90 },
      { name: 'Arnold Press',     target_reps: 10, target_sets: 3, rest_seconds: 60 },
      { name: 'Lateral Raise',    target_reps: 15, target_sets: 4, rest_seconds: 45 },
      { name: 'Face Pull',        target_reps: 15, target_sets: 3, rest_seconds: 45 },
    ],
  },
  'Full Body Strength': {
    exercises: [
      { name: 'Squat',             target_reps: 6,  target_sets: 4, rest_seconds: 120 },
      { name: 'Deadlift',          target_reps: 5,  target_sets: 4, rest_seconds: 120 },
      { name: 'Bench Press',       target_reps: 6,  target_sets: 3, rest_seconds: 90 },
      { name: 'Pull-Up',           target_reps: 8,  target_sets: 3, rest_seconds: 90 },
      { name: 'Overhead Press',    target_reps: 8,  target_sets: 3, rest_seconds: 90 },
      { name: 'Romanian Deadlift', target_reps: 10, target_sets: 3, rest_seconds: 75 },
      { name: 'Plank',             target_reps: 45, target_sets: 3, rest_seconds: 45 },
    ],
  },
};

describe('totalSets', () => {
  it('sums target_sets across the exercise list', () => {
    expect(totalSets(REAL['Back & Shoulders Builder'])).toBe(28);
    expect(totalSets(REAL['Full Body Strength'])).toBe(23);
  });

  it('returns 0 rather than NaN when nothing carries a set count', () => {
    expect(totalSets({ exercises: [{ name: 'Squat' }, { name: 'Bench' }] })).toBe(0);
  });

  it('ignores junk set counts instead of poisoning the sum', () => {
    const r = { exercises: [
      { target_sets: 4 },
      { target_sets: null },
      { target_sets: 'four' },
      { target_sets: -2 },
      { target_sets: 3 },
    ] };
    expect(totalSets(r)).toBe(7);
  });

  it('survives a missing or malformed regimen', () => {
    expect(totalSets(null)).toBe(0);
    expect(totalSets({})).toBe(0);
    expect(totalSets({ exercises: 'not an array' })).toBe(0);
  });
});

describe('estimatedMinutes', () => {
  // Σ sets × (rest + 40), less the trailing rest. Worked by hand against
  // the real rows above:
  //   B&S  520+520+345+300+520+300+340+255 = 3100 s, −45 = 3055 → 51 min
  //   FBS  640+640+390+390+390+345+255     = 3050 s, −45 = 3005 → 50 min
  it('derives a session length from sets and rest', () => {
    expect(estimatedMinutes(REAL['Back & Shoulders Builder'])).toBe(51);
    expect(estimatedMinutes(REAL['Full Body Strength'])).toBe(50);
  });

  it('lands every real regimen in a plausible band', () => {
    for (const [name, regimen] of Object.entries(REAL)) {
      const mins = estimatedMinutes(regimen);
      expect(mins, name).toBeGreaterThan(20);
      expect(mins, name).toBeLessThan(120);
    }
  });

  // The whole reason this module exists is to stop the card rendering
  // numbers that mean nothing. Returning 0 here would reintroduce exactly
  // the defect it was written to remove.
  it('returns null, never 0, when a duration cannot be derived', () => {
    expect(estimatedMinutes(null)).toBeNull();
    expect(estimatedMinutes({})).toBeNull();
    expect(estimatedMinutes({ exercises: [] })).toBeNull();
    expect(estimatedMinutes({ exercises: [{ name: 'Squat' }] })).toBeNull();
    expect(estimatedMinutes({ exercises: [{ target_sets: 0, rest_seconds: 90 }] })).toBeNull();
  });

  it('withholds a duration below the 3-set floor', () => {
    expect(estimatedMinutes({ exercises: [{ target_sets: 2, rest_seconds: 90 }] })).toBeNull();
    expect(estimatedMinutes({ exercises: [{ target_sets: 3, rest_seconds: 90 }] })).not.toBeNull();
  });

  // ── CHANGED 2026-08-12 ────────────────────────────────────────────
  // This test used to assert `estimatedMinutes({exercises:[{target_sets:4}]})
  // === 3`, i.e. a missing rest counted as ZERO rest. It was not a
  // characterization test — it pinned the module's stated intent, and the
  // intent was wrong about the data.
  //
  // Measured across all 33 production regimens / 212 exercises:
  // rest_seconds is present on every exercise of 6 regimens, on NO
  // exercise of 27, and partially on 0. Bimodal, not sparse. Under a zero
  // default those 27 rendered ~14.4 min for sessions of ~46.9.
  //
  // Inverted rather than deleted, per the standing rule.
  it('falls back to the default rest rather than assuming none', () => {
    // 4 sets at (90 rest + 40 work) = 520 s, less the 90 s trailing
    // rest = 430 s → 7 min. Under the old zero default this was 3 min.
    expect(estimatedMinutes({ exercises: [{ target_sets: 4 }] }))
      .toBe(Math.round((4 * (REST_SECONDS_DEFAULT + WORK_SECONDS_PER_SET) - REST_SECONDS_DEFAULT) / 60));
  });

  it('an explicit rest always beats the default', () => {
    // Proves the fallback did not become a floor or an override: a
    // regimen that DOES carry rest must be unaffected by this change.
    const explicit = estimatedMinutes({ exercises: [{ target_sets: 4, rest_seconds: 30 }] });
    const defaulted = estimatedMinutes({ exercises: [{ target_sets: 4 }] });
    expect(explicit).toBe(Math.round((4 * (30 + WORK_SECONDS_PER_SET) - 30) / 60));
    expect(explicit).toBeLessThan(defaulted);
  });

  // The regression this shipped to fix, stated as the shape of the real
  // data rather than as a synthetic case. A hand-built regimen carries no
  // rest anywhere, because RegimenForm has no per-exercise rest field.
  it('a rest-less hand-built regimen no longer reads as a third of its length', () => {
    // "Your Starter Plan — Build Strength" shape: 6 exercises, 24 sets,
    // no rest_seconds on any of them. Production measured ~24 min under
    // the old default against a realistic ~78.
    const handBuilt = {
      exercises: Array.from({ length: 6 }, () => ({ target_sets: 4, target_reps: 8 })),
    };
    const mins = estimatedMinutes(handBuilt);
    expect(mins).toBeGreaterThan(45);
    expect(mins).toBeLessThan(60);
  });

  it('never reports a sub-minute session as 0 min', () => {
    // One set at 40 s would round to 1, but the 3-set floor withholds it;
    // three sets of 1 s rest is 123 s → 2 min. Neither path can yield 0.
    expect(estimatedMinutes({ exercises: [{ target_sets: 3, rest_seconds: 1 }] })).toBeGreaterThan(0);
  });

  it('does not charge rest after the final set', () => {
    const withRest = { exercises: [{ target_sets: 3, rest_seconds: 600 }] };
    // 3×640 = 1920 s, less the 600 s trailing rest = 1320 s → 22 min.
    expect(estimatedMinutes(withRest)).toBe(22);
  });

  it('finds the trailing rest on the last exercise that has sets', () => {
    // The final entry carries no sets, so the deduction must come from
    // the Squat before it — not from the junk row.
    const r = { exercises: [
      { target_sets: 3, rest_seconds: 300 },
      { name: 'notes row, no sets' },
    ] };
    expect(estimatedMinutes(r)).toBe(Math.round((3 * 340 - 300) / 60));
  });
});

describe('regimenLoad', () => {
  it('returns the three fragments the card renders', () => {
    expect(regimenLoad(REAL['Back & Shoulders Builder']))
      .toEqual({ exercises: 8, sets: 28, minutes: 51 });
  });

  it('reports absent fragments as 0 / null so the card can drop them', () => {
    expect(regimenLoad({ exercises: [{ name: 'Squat' }] }))
      .toEqual({ exercises: 1, sets: 0, minutes: null });
    expect(regimenLoad(null)).toEqual({ exercises: 0, sets: 0, minutes: null });
  });
});
