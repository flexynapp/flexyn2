/**
 * The five defects the Cardio audit turned up, pinned.
 *
 * Each block names what was wrong rather than only what is right, because
 * three of the five were invisible: they produced a plausible number, or a
 * plausible silence, rather than an error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  activityFamily, thresholdsForFamily, thresholdTimesForLog, detectNewPRs,
  PR_LABELS, SWIM_PR_THRESHOLDS_M, DISTANCE_PR_THRESHOLDS_M,
} from '@/lib/cardioPRs';
import { bestVO2max, vo2maxFromHR, vo2maxFromSpeed } from '@/lib/cardioVO2max';
import { snapshot, readSnapshot, clearSnapshot, thinTrack } from '@/lib/cardioSession';

// ── Swim PRs ────────────────────────────────────────────────────────────
describe('swimming has its own PR ladder', () => {
  it('is its own family, not "other"', () => {
    expect(activityFamily('swimming_pool')).toBe('swimming');
    expect(activityFamily('swimming_openwater')).toBe('swimming');
  });

  it('leaves the foot and wheel families alone', () => {
    expect(activityFamily('running_outside')).toBe('running');
    expect(activityFamily('walking_treadmill')).toBe('walking');
    expect(activityFamily('biking_stationary')).toBe('biking');
    expect(activityFamily('rowing_erg')).toBe('other');
  });

  it('measures a swim against swim distances', () => {
    expect(thresholdsForFamily('swimming')).toBe(SWIM_PR_THRESHOLDS_M);
    expect(thresholdsForFamily('running')).toBe(DISTANCE_PR_THRESHOLDS_M);
  });

  // The defect: a 1 km pool swim used to clear the RUNNING 1K threshold and
  // be announced as a "1K" PR, on the same ladder that tops out at a
  // marathon.
  it('a 1 km swim earns swim records, not a running 1K', () => {
    const swim = { type: 'swimming_pool', distance_meters: 1000, duration_seconds: 1200 };
    const names = thresholdTimesForLog(swim).map(t => t.distance);
    expect(names).toContain('swim_1k');
    expect(names).toContain('swim_400');
    expect(names).not.toContain('1k');
    expect(names).not.toContain('marathon');
    expect(thresholdTimesForLog(swim).every(t => t.family === 'swimming')).toBe(true);
  });

  it('labels every swim distance it can award', () => {
    for (const k of Object.keys(SWIM_PR_THRESHOLDS_M)) {
      expect(PR_LABELS[k], `${k} has no label`).toBeTruthy();
    }
  });

  it('does not let a run and a swim contend for the same record', () => {
    const priorRun = [{ type: 'running_outside', distance_meters: 1000, duration_seconds: 240 }];
    const swim = { type: 'swimming_pool', distance_meters: 1000, duration_seconds: 1200 };
    // A 20-minute kilometre is a fine swim and a dreadful run. Before the
    // split it was compared against the run and never recorded.
    const prs = detectNewPRs(swim, priorRun);
    expect(prs.map(p => p.distance)).toContain('swim_1k');
  });
});

// ── VO2max ordering ─────────────────────────────────────────────────────
describe('VO2max prefers the estimate that varies with the session', () => {
  const RUN = { mode: 'running', distanceMeters: 8047, durationSeconds: 2660 };

  it('HR-based is a profile constant — same answer for any two sessions', () => {
    const a = vo2maxFromHR(120, 60, 30);
    const b = vo2maxFromHR(185, 60, 30);
    expect(a).toBe(b);          // avgHr does not enter the formula
    expect(a).not.toBeNull();
  });

  // The defect: bestVO2max tried HR first, so the moment a resting HR
  // existed, every run reported that constant and the session-specific
  // figure was thrown away.
  it('uses the speed estimate for a run even when HR data is present', () => {
    const withHr = bestVO2max({ ...RUN, avgHr: 155, restHr: 60, age: 30 });
    const speedOnly = vo2maxFromSpeed(RUN.distanceMeters, RUN.durationSeconds);
    expect(withHr).toBe(speedOnly);
    expect(withHr).not.toBe(vo2maxFromHR(155, 60, 30));
  });

  it('two different runs give two different numbers', () => {
    const slow = bestVO2max({ mode: 'running', distanceMeters: 5000, durationSeconds: 1800, avgHr: 150, restHr: 60, age: 30 });
    const fast = bestVO2max({ mode: 'running', distanceMeters: 5000, durationSeconds: 1200, avgHr: 150, restHr: 60, age: 30 });
    expect(slow).not.toBe(fast);
    expect(fast).toBeGreaterThan(slow);
  });

  it('still falls back to HR where there is no speed model', () => {
    // A ride has no validated ACSM speed equation here, so HR is all there is.
    const ride = bestVO2max({ mode: 'biking', distanceMeters: 20000, durationSeconds: 3600, avgHr: 150, restHr: 60, age: 30 });
    expect(ride).toBe(vo2maxFromHR(150, 60, 30));
  });

  it('falls back to HR for a run outside the speed model’s range', () => {
    const shuffle = bestVO2max({ mode: 'running', distanceMeters: 300, durationSeconds: 600, avgHr: 150, restHr: 60, age: 30 });
    expect(vo2maxFromSpeed(300, 600)).toBeNull();
    expect(shuffle).toBe(vo2maxFromHR(150, 60, 30));
  });

  it('returns null rather than inventing one with neither input', () => {
    expect(bestVO2max({ mode: 'biking', distanceMeters: 20000, durationSeconds: 3600 })).toBeNull();
  });
});

// ── Crash-recovery snapshot ─────────────────────────────────────────────
describe('the recovery snapshot survives a long run', () => {
  const KEY = 'flexyn.cardioActiveSession.u1';
  const pt = (i) => ({ lat: 40 + i / 1e5, lng: -74 - i / 1e5, timestamp_ms: 1000 + i, accuracy_m: 5 });

  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('thins a long track but pins both ends', () => {
    const track = Array.from({ length: 9000 }, (_, i) => pt(i));
    const out = thinTrack(track, 1500);
    expect(out).toHaveLength(1500);
    expect(out[0]).toEqual(track[0]);
    // The last fix is what resume compares against; dropping it would
    // restart distance accumulation from an older point and double-count.
    expect(out[out.length - 1]).toEqual(track[track.length - 1]);
  });

  it('leaves a short track exactly as it is', () => {
    const track = Array.from({ length: 60 }, (_, i) => pt(i));
    expect(thinTrack(track, 1500)).toBe(track);
  });

  it('reports that it thinned, rather than doing it silently', () => {
    const track = Array.from({ length: 5000 }, (_, i) => pt(i));
    expect(snapshot('u1', { kind: 'outside', mode: 'running', track, distanceMeters: 12345 })).toBe('thinned');
    expect(readSnapshot('u1').track).toHaveLength(1500);
    expect(readSnapshot('u1').distanceMeters).toBe(12345);
  });

  // The defect: a QuotaExceededError was caught and discarded, so on a long
  // run the snapshot silently stopped being written — recovery failed on
  // exactly the sessions worth recovering.
  it('drops the route rather than the session when storage is full', () => {
    // Spy on the localStorage OBJECT, not Storage.prototype — this runner
    // provides a localStorage that is not a Storage instance, so a
    // prototype spy never fires and the test silently passes on 'ok'.
    const real = localStorage.setItem.bind(localStorage);
    let calls = 0;
    vi.spyOn(localStorage, 'setItem').mockImplementation((k, v) => {
      calls += 1;
      // Fail the first (track-bearing) write, accept the retry.
      if (calls === 1) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      return real(k, v);
    });

    const track = Array.from({ length: 200 }, (_, i) => pt(i));
    const result = snapshot('u1', {
      kind: 'outside', mode: 'running', track,
      distanceMeters: 42195, startedAt: 111, pausedTotalMs: 0,
    });

    expect(result).toBe('dropped-track');
    const back = JSON.parse(localStorage.getItem(KEY));
    // The numbers recovery actually needs all survived.
    expect(back.distanceMeters).toBe(42195);
    expect(back.startedAt).toBe(111);
    expect(back.track).toEqual([]);
    expect(back.trackDropped).toBe(true);
  });

  it('says so when even the numbers will not fit', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
    });
    expect(snapshot('u1', { kind: 'outside', track: [] })).toBe('failed');
  });

  it('still keys per user', () => {
    snapshot('u1', { kind: 'outside', distanceMeters: 1 });
    expect(readSnapshot('u2')).toBeNull();
    clearSnapshot('u1');
    expect(readSnapshot('u1')).toBeNull();
  });
});
