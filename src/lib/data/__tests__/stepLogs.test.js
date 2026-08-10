// src/lib/data/__tests__/stepLogs.test.js
//
// How many steps a save may credit to the daily steps quest.
//
// step_logs is an upsert, so a correction is a second save of the same
// day and crediting the absolute figure would count the first entry
// twice. StepsLogCard already knew that and subtracted a base — but the
// base was `today?.steps`, a react-query snapshot, so a correction typed
// before the invalidate's refetch landed read the OLD count and credited
// the same steps again: 3,000 then 5,000 awarded 8,000 and completed a
// 5k quest off a 3k correction, which is exactly what the delta existed
// to prevent.
//
// Quest progress is economy state (CLAUDE.md: the client never computes
// XP, coins or achievements, and quest rows are immutable from the
// client), so over-crediting here is not a cosmetic bug — it is the one
// direction that pays out something the user did not earn.

import { describe, it, expect } from 'vitest';
import { creditableStepDelta } from '../stepLogs';

describe('creditableStepDelta', () => {
  it('credits the whole count on a first save', () => {
    expect(creditableStepDelta(3000, 0, 0)).toEqual({ delta: 3000, credited: 3000 });
  });

  it('credits only the increase on a correction', () => {
    expect(creditableStepDelta(5000, 3000, 3000)).toEqual({ delta: 2000, credited: 5000 });
  });

  it('does not re-credit when the snapshot is STALE — the whole point', () => {
    // serverValue still 0 because the refetch has not landed; the
    // synchronous mark is what stops the double-count.
    expect(creditableStepDelta(5000, 3000, 0)).toEqual({ delta: 2000, credited: 5000 });
  });

  it('takes the higher base, so neither a stale ref nor a stale snapshot widens the delta', () => {
    expect(creditableStepDelta(9000, 3000, 7000).delta).toBe(2000);
    expect(creditableStepDelta(9000, 7000, 3000).delta).toBe(2000);
  });

  it('credits nothing for revising a count DOWN, and keeps the mark', () => {
    // Those steps were already awarded and cannot be taken back.
    expect(creditableStepDelta(3000, 5000, 5000)).toEqual({ delta: 0, credited: 5000 });
  });

  it('credits nothing for saving the same number twice', () => {
    expect(creditableStepDelta(5000, 5000, 5000)).toEqual({ delta: 0, credited: 5000 });
  });

  it('walks a realistic edit session without ever over-crediting', () => {
    let credited = 0;
    let awarded = 0;
    for (const n of [3000, 5000, 4000, 5000, 8200]) {
      const r = creditableStepDelta(n, credited, 0);   // server never catches up
      awarded += r.delta;
      credited = r.credited;
    }
    // The user walked 8,200 steps. That is all they may be credited.
    expect(awarded).toBe(8200);
  });

  it('refuses nonsense without moving the mark backwards', () => {
    for (const bad of [NaN, -1, undefined, null, 'abc']) {
      expect(creditableStepDelta(bad, 4000, 4000)).toEqual({ delta: 0, credited: 4000 });
    }
  });

  it('starts from zero when nothing has been logged or credited', () => {
    expect(creditableStepDelta(1200)).toEqual({ delta: 1200, credited: 1200 });
  });
});
