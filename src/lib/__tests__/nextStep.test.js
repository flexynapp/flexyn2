import { describe, it, expect, beforeEach } from 'vitest';
import {
  pickNextStep,
  DISMISS_WINDOW_MS,
  readNextStepDismissed,
  markNextStepDismissed,
} from '@/lib/nextStep';

const NOW = Date.UTC(2026, 8, 27, 12);
const DAY = 24 * 60 * 60 * 1000;
const c = (id, priority = 1, eligible = true) => ({ id, priority, eligible });

describe('pickNextStep', () => {
  it('returns null with no candidates or none eligible', () => {
    expect(pickNextStep({ candidates: [], now: NOW })).toBeNull();
    expect(pickNextStep({ candidates: [c('a', 3, false)], now: NOW })).toBeNull();
    expect(pickNextStep({ now: NOW })).toBeNull();
    expect(pickNextStep()).toBeNull();
  });

  it('only considers eligible === true', () => {
    const pick = pickNextStep({ candidates: [c('a', 9, false), { id: 'b', priority: 9, eligible: 1 }, c('c', 1)], now: NOW });
    expect(pick.id).toBe('c');
  });

  it('takes the highest priority, and the first on a tie', () => {
    expect(pickNextStep({ candidates: [c('a', 1), c('b', 3), c('c', 2)], now: NOW }).id).toBe('b');
    expect(pickNextStep({ candidates: [c('a', 2), c('b', 2)], now: NOW }).id).toBe('a');
  });

  it('skips a candidate dismissed inside 7 days and offers it again after', () => {
    const candidates = [c('a', 3), c('b', 1)];
    expect(pickNextStep({ candidates, now: NOW, dismissed: { a: NOW - 6 * DAY } }).id).toBe('b');
    expect(pickNextStep({ candidates, now: NOW, dismissed: { a: NOW - DISMISS_WINDOW_MS - 1 } }).id).toBe('a');
  });

  it('returns null when every eligible candidate was dismissed', () => {
    expect(pickNextStep({ candidates: [c('a')], now: NOW, dismissed: { a: NOW - DAY } })).toBeNull();
  });

  it('treats a future or garbage timestamp as absent', () => {
    const candidates = [c('a', 3), c('b', 1)];
    expect(pickNextStep({ candidates, now: NOW, dismissed: { a: NOW + DAY } }).id).toBe('a');
    expect(pickNextStep({ candidates, now: NOW, dismissed: { a: 'soon' } }).id).toBe('a');
  });

  it('a dismissed PR does not silence a newer one, because the id carries the moment', () => {
    const candidates = [c('pr:Bench:2026-09-26', 3)];
    expect(pickNextStep({ candidates, now: NOW, dismissed: { 'pr:Bench:2026-09-20': NOW - DAY } }).id)
      .toBe('pr:Bench:2026-09-26');
  });
});

describe('dismiss storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips per user and prunes stale stamps', () => {
    localStorage.setItem('flexyn.nextStepDismissed.u1', JSON.stringify({ old: NOW - 30 * DAY }));
    markNextStepDismissed('u1', 'a', NOW);
    expect(readNextStepDismissed('u1')).toEqual({ a: NOW });
    expect(readNextStepDismissed('u2')).toEqual({});
  });

  it('ignores an empty id and survives corrupt storage', () => {
    markNextStepDismissed('u1', '', NOW);
    expect(readNextStepDismissed('u1')).toEqual({});
    localStorage.setItem('flexyn.nextStepDismissed.u1', '{nope');
    expect(readNextStepDismissed('u1')).toEqual({});
    localStorage.setItem('flexyn.nextStepDismissed.u1', '[1,2]');
    expect(readNextStepDismissed('u1')).toEqual({});
  });
});
