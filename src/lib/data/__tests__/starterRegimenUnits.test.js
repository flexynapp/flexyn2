// Starter plan runs in the unit the person chose, and with the structure the
// display layer renders from (src/lib/starterPlanText.js).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/data/regimens', () => ({ list: vi.fn(), create: vi.fn() }));

import { buildStarterRegimen } from '@/lib/data/starterRegimen';

const runs = (input) => buildStarterRegimen(input).exercises.filter((e) => e.kind === 'cardio');
const base = { goals: ['speed', 'endurance'], level: 'consistent', daysCount: 5, cardioEvent: '5k' };

describe('starter plan units', () => {
  it('defaults to miles, as every plan before the choice existed', () => {
    const easy = runs(base).find((e) => e.session === 'easy');
    expect(easy.detail).toBe('2.5 mi · conversational pace');
    expect(easy.sessionParams).toEqual({ unit: 'mi', distance: 2.5, pace: null });
    expect(easy.target_distance_m).toBe(Math.round(2.5 * 1609.34));
  });

  it('writes kilometres and paces per km for a metric plan', () => {
    const all = runs({ ...base, units: 'metric', current5kSec: 1500 });
    const easy = all.find((e) => e.session === 'easy');
    // 2.5 mi is 4.02 km, rounded to the nearest half kilometre.
    expect(easy.sessionParams.unit).toBe('km');
    expect(easy.sessionParams.distance).toBe(4);
    expect(easy.target_distance_m).toBe(4000);
    expect(easy.detail).toMatch(/^4 km @ \d+:\d\d\/km · conversational pace$/);
    const tempo = all.find((e) => e.session === 'tempo');
    expect(tempo.detail).toMatch(/^15 min @ \d+:\d\d\/km · comfortably hard$/);
    const long = all.find((e) => e.session === 'long');
    expect(long.sessionParams.distance).toBe(6.5);
    expect(long.target_distance_m).toBe(6500);
    for (const e of all) expect(e.detail).not.toMatch(/\bmi\b/);
  });

  it('never gives a metric run under 1.5 km, and keeps half kilometre steps', () => {
    const all = runs({ goals: ['endurance'], level: 'newbie', daysCount: 4, cardioEvent: 'general', units: 'metric' });
    for (const e of all.filter((x) => x.sessionParams.distance != null)) {
      expect(e.sessionParams.distance).toBeGreaterThanOrEqual(1.5);
      expect(e.sessionParams.distance * 2).toBe(Math.round(e.sessionParams.distance * 2));
    }
  });

  it('a metric pace is the per km zone, not the per mile one relabelled', () => {
    const mi = runs({ ...base, current5kSec: 1500 }).find((e) => e.session === 'easy').sessionParams.pace;
    const km = runs({ ...base, current5kSec: 1500, units: 'metric' }).find((e) => e.session === 'easy').sessionParams.pace;
    const sec = (p) => Number(p.split(':')[0]) * 60 + Number(p.split(':')[1]);
    expect(sec(mi) / sec(km)).toBeCloseTo(1.609, 1);
  });
});

describe('structured run fields', () => {
  it('every run carries a stable session id and the English text beside it', () => {
    const all = runs({ ...base, current5kSec: 1500 });
    expect(all.map((e) => e.session)).toEqual(['easy', 'interval', 'tempo', 'long']);
    expect(all.map((e) => e.displayName)).toEqual(['Easy Run', 'Interval Run', 'Tempo Run', 'Long Run']);
    const interval = all.find((e) => e.session === 'interval');
    expect(interval.sessionParams).toMatchObject({ reps: 6, repMeters: 400 });
    expect(interval.sessionParams.repTime).toMatch(/^\d+:\d\d$/);
    expect(interval.detail).toMatch(/^6 × 400 m @ \d+:\d\d\/rep · full recovery$/);
  });

  it('an untargeted interval keeps its effort cue', () => {
    const interval = runs({ ...base, cardioEvent: 'half' }).find((e) => e.session === 'interval');
    expect(interval.sessionParams.repTime).toBeNull();
    expect(interval.detail).toBe('4 × 1 mi · hard efforts, full recovery');
    const metric = runs({ ...base, cardioEvent: 'half', units: 'metric' }).find((e) => e.session === 'interval');
    expect(metric.detail).toBe('4 × 1.6 km · hard efforts, full recovery');
  });

  it('trimming to training days still keeps the easy run, then the long run', () => {
    const all = runs({ ...base, cardioEvent: 'half', daysCount: 2, units: 'metric' });
    expect(all.map((e) => e.session)).toEqual(['easy', 'long']);
  });

  it('keeps the stored name prefix the Workout page detects', () => {
    expect(buildStarterRegimen({ ...base, units: 'metric' }).name).toBe('Your Starter Plan: Run Faster');
  });
});
