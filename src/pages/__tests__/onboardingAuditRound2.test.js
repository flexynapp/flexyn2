// Second onboarding audit, 2026-09-30. Each of these lost or misread
// something the user entered. Source-level because the steps are private to
// Onboarding.jsx and the behaviour under test is a handful of state updates.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync('src/pages/Onboarding.jsx', 'utf8');
const between = (a, b) => {
  const s = SOURCE.indexOf(a);
  const e = SOURCE.indexOf(b, s + a.length);
  expect(s).toBeGreaterThan(-1);
  expect(e).toBeGreaterThan(s);
  return SOURCE.slice(s, e);
};

describe('onboarding audit round two', () => {
  it('starts the run time over when the event changes its distance', () => {
    // 25:00 typed for a 5K was read as a 10K time after switching events.
    const fn = between('const pickEvent = ', 'const timeDistance =');
    expect(fn).toContain('distance === cur.distance ? cur : { distance }');
  });

  it('keeps the earlier gym when a second pick is cancelled before joining', () => {
    const step = between('function HomeGymStep(', 'STEP 6: LOADING');
    expect(step).toContain('if (sheetJoined) onChange(null)');
    expect(step).not.toContain('onCancel={() => { setCandidate(null); onChange(null); }}');
    // A second join replaces the first rather than adding a membership.
    expect(step).toMatch(/onJoined=\{\(gymId\) => \{\s*replaceJoined\(gymId\)/);
    expect(step).toMatch(/replaceJoined\(id\);\s*const gym = await getGym/);
  });

  it('reports a leave that did not happen', () => {
    const fn = between('function leaveJoinedGym(', 'function HomeGymStep(');
    expect(fn).toContain('!res?.ok');
  });

  it('logs one injury per muscle', () => {
    const step = between('function InjuryHistoryStep(', 'return (');
    expect(step).toContain('value.filter(e => e.muscleGroup !== pendingMuscle)');
    expect(step).not.toContain('onChange([...value, { muscleGroup: pendingMuscle');
  });

  it('switches height and weight units without rebuilding the value', () => {
    expect(SOURCE).toContain('heightCm: stats.heightCm ?? cmFromIn(stats.heightIn)');
    expect(SOURCE).toContain('weightKg: stats.weightKg ?? kgFromLb(stats.weightLb)');
  });

  it('lets the weight be set without a pointer', () => {
    const step = between('function WeightStep(', 'STEP');
    expect(step).toContain('role="slider"');
    expect(step).toContain('onKeyDown={onGaugeKey}');
    expect(step).toContain('aria-valuenow={value}');
  });

  it('asks the Coach again when the plan inputs change', () => {
    const fn = between('const requestCoachIntro = useCallback(', '}, [data, planLevel, language, starterInputs]);');
    expect(fn).toContain('JSON.stringify(starterInputs)');
    expect(fn).toContain('coachAsked.current === key');
  });
});
