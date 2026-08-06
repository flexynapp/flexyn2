import { describe, it, expect } from 'vitest';
import {
  parseHeightInput,
  resolveMeasurements,
  buildProfilePayload,
  PROFILE_RANGES,
  DB_CHECK_BOUNDS,
  MIN_USERNAME_LENGTH,
  canLeaveAboutStep,
} from '../onboardingProfile';

// First tests to cover any of onboarding's logic. The whole flow — 3,600 lines,
// the first screen every user sees — had none: the payload builder was inlined
// in a click handler reachable only by completing 14 steps against a live
// Supabase, so every defect below shipped and sat there. Each `regression`
// block is a bug that was real in production.

const NOW = '2026-08-05T12:00:00.000Z';

describe('parseHeightInput', () => {
  describe('ft·in — shapes people actually type', () => {
    it.each([
      ['70',      70, 'two digits above the floor are total inches'],
      ['5\'10',   70, 'apostrophe separator'],
      ['5 10',    70, 'space separator'],
      ['5.10',    70, 'dot separator — a legibility shortcut, not a decimal'],
      ['5\'10"',  70, 'both marks'],
      ['5',       60, 'a bare small number is feet'],
      ['6',       72, 'six feet, not six inches'],
      ['511',     71, "3-digit shorthand for 5'11\""],
      ['601',     73, "3-digit shorthand for 6'1\""],
      ['40',      40, 'a two-digit value at the low end stays total inches'],
    ])('parses %s → %i in (%s)', (input, expected) => {
      expect(parseHeightInput(input, 'in')).toBe(expected);
    });
  });

  describe('regression — audit 18 #9', () => {
    // The old regex matched (\d{1,2}) then (\d{0,2}), so "511" became 51 feet
    // 1 inch = 613 in, which the caller clamped to the 96 in ceiling. Someone
    // typing their height the way half the US writes it silently got 8'0".
    it("reads 511 as 5'11\", not 51 feet", () => {
      expect(parseHeightInput('511', 'in')).toBe(71);
      expect(parseHeightInput('511', 'in')).not.toBe(96);
    });

    // Same path: a cm value typed while the toggle still said ft·in parsed as
    // 18 feet 0 inches and clamped to 8'0" rather than being rejected.
    it('rejects 180 in ft·in mode instead of committing 8 feet', () => {
      expect(parseHeightInput('180', 'in')).toBeNull();
    });

    it.each(['190', '175', '160'])('rejects %s — inches ≥ 12 is not a height', (cmValue) => {
      expect(parseHeightInput(cmValue, 'in')).toBeNull();
    });
  });

  describe('unparseable input leaves the value alone', () => {
    it.each([['', 'cleared'], ['abc', 'letters'], ['   ', 'whitespace'], ['1234', 'four digits']])(
      'returns null for %s (%s)',
      (input) => {
        expect(parseHeightInput(input, 'in')).toBeNull();
      },
    );

    it('returns null for null and undefined', () => {
      expect(parseHeightInput(null, 'in')).toBeNull();
      expect(parseHeightInput(undefined, 'in')).toBeNull();
    });
  });

  describe('cm mode', () => {
    it('reads plain digits', () => {
      expect(parseHeightInput('178', 'cm')).toBe(178);
    });
    it('strips stray characters', () => {
      expect(parseHeightInput('178cm', 'cm')).toBe(178);
    });
    it('returns null when nothing numeric remains', () => {
      expect(parseHeightInput('cm', 'cm')).toBeNull();
    });
  });
});

describe('resolveMeasurements', () => {
  describe('regression — the metric-user signup blocker', () => {
    // A previous version multiplied kg by 0.453592 (the lb→kg factor) to get
    // pounds, so a 75 kg user submitted 34 lb. That failed the weight check,
    // both fallback tiers failed with it, and every metric user was stranded
    // on the reveal screen with "Could not save your profile."
    it('converts 75 kg to 165 lb, not 34', () => {
      const m = resolveMeasurements({ weightUnit: 'kg', weightKg: 75 });
      expect(m.weightLb).toBe(165);
      expect(m.weightLb).toBeGreaterThan(PROFILE_RANGES.weightLb.min);
    });

    it('round-trips a kg value back to roughly itself', () => {
      const m = resolveMeasurements({ weightUnit: 'kg', weightKg: 82 });
      expect(m.weightKg).toBe(82);
      expect(m.weightLb).toBe(181);
    });
  });

  it('fills the other unit when the user entered pounds', () => {
    const m = resolveMeasurements({ weightUnit: 'lb', weightLb: 200 });
    expect(m.weightLb).toBe(200);
    expect(m.weightKg).toBe(91);
  });

  it('fills the other unit for height in both directions', () => {
    expect(resolveMeasurements({ heightUnit: 'in', heightIn: 72 }).heightCm).toBe(183);
    expect(resolveMeasurements({ heightUnit: 'cm', heightCm: 183 }).heightIn).toBe(72);
  });

  describe('junk in a stale draft cannot produce a junk payload', () => {
    it.each([
      ['NaN',       NaN],
      ['a string',  'not-a-number'],
      ['null',      null],
      ['undefined', undefined],
    ])('falls back to the default when weight is %s', (_label, bad) => {
      const m = resolveMeasurements({ weightUnit: 'lb', weightLb: bad });
      expect(m.weightLb).toBe(165);
    });

    it('clamps absurd values into range rather than sending them', () => {
      const high = resolveMeasurements({ weightUnit: 'lb', weightLb: 99999 });
      expect(high.weightLb).toBe(PROFILE_RANGES.weightLb.max);
      const low = resolveMeasurements({ weightUnit: 'lb', weightLb: -50 });
      expect(low.weightLb).toBe(PROFILE_RANGES.weightLb.min);
    });

    it('clamps age at both ends', () => {
      expect(resolveMeasurements({ age: 5 }).age).toBe(PROFILE_RANGES.age.min);
      expect(resolveMeasurements({ age: 900 }).age).toBe(PROFILE_RANGES.age.max);
    });
  });

  it('treats an unknown unit as the imperial default', () => {
    const m = resolveMeasurements({ weightUnit: 'stone', weightLb: 150 });
    expect(m.weightUnit).toBe('lb');
    expect(m.weightLb).toBe(150);
  });
});

describe('every reachable UI value stays inside the real CHECK constraints', () => {
  // The property the clamps exist for. The code used to claim it was
  // defending against `age 13–120`, `height_inches 36–96` and
  // `weight_lbs 50–800` from migration 073; none of those three is real.
  // This asserts against the constraints that ARE on the table, so if either
  // side moves, the mismatch surfaces here rather than as a 23514 during a
  // stranger's signup. (Audit 18 #13.)
  const pairs = [
    ['heightIn', 'height_inches'],
    ['heightCm', 'height_cm'],
    ['weightLb', 'weight_lbs'],
    ['weightKg', 'weight_kg'],
  ];

  it.each(pairs)('%s stays within %s', (rangeKey, dbKey) => {
    const range = PROFILE_RANGES[rangeKey];
    const bound = DB_CHECK_BOUNDS[dbKey];
    expect(range.min).toBeGreaterThan(bound.min);   // every constraint is exclusive-zero
    expect(range.max).toBeLessThanOrEqual(bound.max);
  });

  it.each(pairs)('a payload at either extreme of %s satisfies %s', (rangeKey, dbKey) => {
    const bound = DB_CHECK_BOUNDS[dbKey];
    const unitKey = rangeKey.startsWith('height') ? 'heightUnit' : 'weightUnit';
    const unit = rangeKey.endsWith('Cm') ? 'cm' : rangeKey.endsWith('Kg') ? 'kg' : rangeKey.endsWith('In') ? 'in' : 'lb';
    for (const extreme of [PROFILE_RANGES[rangeKey].min, PROFILE_RANGES[rangeKey].max]) {
      const m = resolveMeasurements({ [unitKey]: unit, [rangeKey]: extreme });
      for (const v of [m.heightIn, m.heightCm, m.weightLb, m.weightKg]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(m[rangeKey]).toBeGreaterThan(bound.min);
      expect(m[rangeKey]).toBeLessThanOrEqual(bound.max);
    }
  });
});

describe('buildProfilePayload', () => {
  const draft = {
    username: '  jordan_lifts  ',
    goal: ['strength', 'muscle'],
    level: 'consistent',
    days: [0, 2, 4],
    preferredTime: ['morning', 'late_night'],
    assessment: { bench_bw: 'yes' },
    stats: { age: 31, heightUnit: 'in', heightIn: 71, weightUnit: 'lb', weightLb: 180, gender: 'female' },
  };

  it('trims the username and sets both completion flags', () => {
    const { core } = buildProfilePayload({ data: draft, nowIso: NOW });
    expect(core).toEqual({
      username: 'jordan_lifts',
      onboarding_complete: true,
      onboarding_completed: true,
      onboarding_completed_at: NOW,
    });
  });

  describe('regression — audit 18 #14: numeric columns get numbers', () => {
    // height_cm, height_inches, weight_kg and weight_lbs are `numeric`. The
    // client wrapped them in String(), a leftover from when they were TEXT.
    // Postgres accepted the quoted form via an implicit cast, so it worked —
    // but any non-numeric string would raise 22P02 and fall through to the
    // tier-2 and tier-3 fallbacks instead of failing where the mistake was.
    it.each(['height_cm', 'height_inches', 'weight_kg', 'weight_lbs', 'age'])(
      '%s is a number',
      (col) => {
        const { detail } = buildProfilePayload({ data: draft, nowIso: NOW });
        expect(typeof detail[col]).toBe('number');
      },
    );
  });

  it('persists training times as stable ids, not display labels', () => {
    const { detail } = buildProfilePayload({ data: draft, nowIso: NOW });
    expect(detail.preferred_workout_time).toBe('morning,late_night');
  });

  it('records the unit the user actually chose', () => {
    const { detail } = buildProfilePayload({ data: draft, nowIso: NOW });
    expect(detail.height_unit).toBe('imperial');
    expect(detail.weight_unit).toBe('lbs');

    const metric = buildProfilePayload({
      data: { ...draft, stats: { ...draft.stats, heightUnit: 'cm', weightUnit: 'kg' } },
      nowIso: NOW,
    });
    expect(metric.detail.height_unit).toBe('metric');
    expect(metric.detail.weight_unit).toBe('kg');
  });

  it('keeps goals in both the joined and array columns', () => {
    const { detail } = buildProfilePayload({ data: draft, nowIso: NOW });
    expect(detail.fitness_goals).toBe('strength,muscle');
    expect(detail.fitness_goals_arr).toEqual(['strength', 'muscle']);
  });

  it('sends null rather than a guess when sex is unset', () => {
    const { detail } = buildProfilePayload({
      data: { ...draft, stats: { ...draft.stats, gender: undefined } },
      nowIso: NOW,
    });
    expect(detail.gender).toBeNull();
  });

  describe('the three save tiers', () => {
    it('tier 1 carries the assessment, tier 2 drops it', () => {
      const { full, minimal } = buildProfilePayload({ data: draft, nowIso: NOW });
      expect(full.fitness_assessment).toEqual({ bench_bw: 'yes' });
      expect(minimal).not.toHaveProperty('fitness_assessment');
    });

    it('tier 3 is a strict subset of tier 2, which is a strict subset of tier 1', () => {
      const { core, minimal, full } = buildProfilePayload({ data: draft, nowIso: NOW });
      for (const k of Object.keys(core)) expect(minimal).toHaveProperty(k);
      for (const k of Object.keys(minimal)) expect(full).toHaveProperty(k);
      expect(Object.keys(full).length).toBeGreaterThan(Object.keys(minimal).length);
      expect(Object.keys(minimal).length).toBeGreaterThan(Object.keys(core).length);
    });

    it('every tier still marks onboarding complete — that is the point of the fallback', () => {
      const { core, minimal, full } = buildProfilePayload({ data: draft, nowIso: NOW });
      for (const tier of [core, minimal, full]) {
        expect(tier.onboarding_complete).toBe(true);
        expect(tier.username).toBe('jordan_lifts');
      }
    });
  });

  describe('an empty draft still produces a valid payload', () => {
    it('does not throw on {} and fills the defaults', () => {
      const { full } = buildProfilePayload({ data: {}, nowIso: NOW });
      expect(full.username).toBe('');
      expect(full.age).toBe(26);
      expect(full.weight_lbs).toBe(165);
      expect(full.fitness_goals).toBe('');
      expect(full.training_days).toEqual([]);
    });

    it('does not throw when data itself is missing', () => {
      expect(() => buildProfilePayload({ nowIso: NOW })).not.toThrow();
    });
  });

  describe('canLeaveAboutStep — all three answers are required', () => {
    const ok = { username: 'jordan', usernameError: null, gender: 'female' };

    it('regression: sex could be skipped entirely', () => {
      // The gate was `username.length >= MIN && !usernameError`. Sex was not in
      // it, so the three buttons could be left untouched and Continue went
      // through. Nothing downstream complained — _demographicScale and BMR
      // take a conservative middle for an unset value — so the user simply got
      // a plan calibrated on a guess, with no error to notice.
      expect(canLeaveAboutStep({ ...ok, gender: null })).toBe(false);
      expect(canLeaveAboutStep({ ...ok, gender: undefined })).toBe(false);
      expect(canLeaveAboutStep({ ...ok, gender: '' })).toBe(false);
    });

    it('accepts every sex the step actually offers, declining included', () => {
      // Requiring an answer is only fair because "Prefer not to say" is one of
      // them. It records its own value — distinct from 'other', which states
      // something about the user's sex rather than declining to — and must
      // pass the gate like any other choice. This asks for a decision, not a
      // disclosure.
      for (const gender of ['female', 'male', 'other', 'prefer_not_to_say']) {
        expect(canLeaveAboutStep({ ...ok, gender })).toBe(true);
      }
    });

    it('still enforces the username rules it always did', () => {
      expect(canLeaveAboutStep({ ...ok, username: '' })).toBe(false);
      expect(canLeaveAboutStep({ ...ok, username: 'a' })).toBe(false);
      expect(canLeaveAboutStep({ ...ok, username: '   ' })).toBe(false);
      expect(canLeaveAboutStep({ ...ok, usernameError: 'taken' })).toBe(false);
      // Exactly at the threshold passes — the boundary the two call sites
      // used to disagree about.
      expect(canLeaveAboutStep({ ...ok, username: 'a'.repeat(MIN_USERNAME_LENGTH) })).toBe(true);
    });

    it('is total — no argument shape throws', () => {
      // It runs on every keystroke of the username field.
      expect(() => canLeaveAboutStep()).not.toThrow();
      expect(canLeaveAboutStep()).toBe(false);
      expect(canLeaveAboutStep({})).toBe(false);
      expect(canLeaveAboutStep({ username: 12345, gender: 'male' })).toBe(true);
    });
  });
});
