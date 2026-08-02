import { describe, it, expect, vi, beforeEach } from 'vitest';

// buildCoachPlan's single-session path reads workout history.
vi.mock('@/api/db', () => ({
  db: {
    entities: {
      WorkoutLog: { filter: vi.fn(() => Promise.resolve([])) },
    },
  },
}));

import { followUpsFor } from '../followUps';
import { parseWorkoutGoal, buildCoachPlan } from '../planBuilder';
import { detectIntent, INTENTS } from '../intents';

beforeEach(() => vi.clearAllMocks());

const PROFILE = { weight_lbs: 190, gender: 'male', birthday: '1995-01-01' };
const USER = { email: 'a@b.c' };

/** Build a real plan the way the chat does, so chips are derived from real shapes. */
const planFor = (message) => buildCoachPlan({ user: USER, message, profile: PROFILE })
  .then(r => r.plan);

describe('followUpsFor', () => {
  it('returns nothing without a plan, so the caller falls back to static prompts', () => {
    expect(followUpsFor(null)).toEqual([]);
    expect(followUpsFor({})).toEqual([]);
    expect(followUpsFor({ kind: 'session' })).toEqual([]); // no parsed descriptor
  });

  it('offers duration, equipment and plan follow-ups after a session', async () => {
    const chips = followUpsFor(await planFor('give me a quick full-body workout today'));
    const ids = chips.map(c => c.id);
    expect(ids.some(id => id.startsWith('dur_'))).toBe(true);
    expect(ids).toContain('equip_dumbbells');
    expect(ids).toContain('equip_bodyweight');
    expect(chips.every(c => c.text && c.send)).toBe(true);
  });

  it("offers today's workout after a weekly plan", async () => {
    const chips = followUpsFor(await planFor('I want to train for a faster 5k'));
    expect(chips.map(c => c.id)).toEqual(['today']);
  });

  it('offers the gym back when the session was equipment-limited', async () => {
    const chips = followUpsFor(await planFor('give me a bodyweight workout today'));
    const ids = chips.map(c => c.id);
    expect(ids).toContain('equip_gym');
    expect(ids).not.toContain('equip_bodyweight'); // already there
  });

  it('never offers the duration the session already is', async () => {
    const plan = await planFor('give me a 60 minute full-body workout today');
    const chips = followUpsFor(plan);
    expect(chips.map(c => c.id)).not.toContain('dur_60');
  });

  it('offers one shorter and one longer, and clamps at the ends of the range', async () => {
    const short = followUpsFor(await planFor('give me a quick workout today')); // 30 min
    expect(short.filter(c => c.id.startsWith('dur_')).map(c => c.id)).toEqual(['dur_45']);
  });
});

// The whole design rests on this: a chip's `send` string must survive the
// intent router AND the goal parser, or tapping it silently degrades into an
// unrelated answer. Every chip the module can emit is round-tripped here.
describe('every follow-up round-trips through the coach pipeline', () => {
  const SOURCES = [
    'give me a quick full-body workout today',
    'give me a 60 minute workout today',
    'give me a bodyweight workout today',
    'I want to PR my bench press today',
    'max points against my rival / crew war',
    'build muscle — upper body',
    'a fat-loss plan I can stick to',
    'I want to train for a faster 5k',
  ];

  it.each(SOURCES)('chips generated after "%s" all reach the plan builder', async (msg) => {
    const chips = followUpsFor(await planFor(msg));
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(detectIntent(chip.send).id, `intent for chip "${chip.text}"`)
        .toBe(INTENTS.GENERATE_PLAN);
    }
  });

  it.each(SOURCES)('duration chips after "%s" actually change the duration', async (msg) => {
    const chips = followUpsFor(await planFor(msg));
    for (const chip of chips.filter(c => c.id.startsWith('dur_'))) {
      const want = Number(chip.id.slice(4));
      const p = parseWorkoutGoal(chip.send);
      expect(p.durationMinutes, `duration for chip "${chip.text}"`).toBe(want);
      expect(p.durationStated).toBe(true);
      expect(p.wantsPlan, 'a duration chip must stay a session').toBe(false);
    }
  });

  it.each(SOURCES)('equipment chips after "%s" actually change the equipment', async (msg) => {
    const chips = followUpsFor(await planFor(msg));
    for (const chip of chips.filter(c => c.id.startsWith('equip_'))) {
      const want = chip.id.slice(6);
      const p = parseWorkoutGoal(chip.send);
      expect(p.equipment, `equipment for chip "${chip.text}"`).toBe(want);
      expect(p.wantsPlan, 'an equipment chip must stay a session').toBe(false);
    }
  });

  it('the "make it a weekly plan" chip returns a plan, not a session', async () => {
    const chips = followUpsFor(await planFor('give me a quick full-body workout today'));
    const asPlan = chips.find(c => c.id === 'as_plan');
    expect(parseWorkoutGoal(asPlan.send).wantsPlan).toBe(true);
    expect((await buildCoachPlan({ user: USER, message: asPlan.send, profile: PROFILE })).plan.kind)
      .toBe('plan');
  });

  it("the \"just today's workout\" chip returns a session, not a plan", async () => {
    const chips = followUpsFor(await planFor('I want to train for a faster 5k'));
    const today = chips.find(c => c.id === 'today');
    expect((await buildCoachPlan({ user: USER, message: today.send, profile: PROFILE })).plan.kind)
      .toBe('session');
  });

  it('preserves the goal across a follow-up', async () => {
    const chips = followUpsFor(await planFor('max points against my rival / crew war'));
    for (const chip of chips) {
      expect(parseWorkoutGoal(chip.send).goal, `goal for chip "${chip.text}"`).toBe('compete');
    }
  });

  it('preserves the specific lift across a follow-up', async () => {
    const chips = followUpsFor(await planFor('I want to PR my bench press today'));
    for (const chip of chips.filter(c => c.id !== 'as_plan')) {
      expect(parseWorkoutGoal(chip.send).lift).toBe('Bench Press');
    }
  });

  it('a competition duration chip resizes the session it built', async () => {
    const chips = followUpsFor(await planFor('max points against my rival / crew war'));
    const dur = chips.find(c => c.id.startsWith('dur_'));
    const { plan } = await buildCoachPlan({ user: USER, message: dur.send, profile: PROFILE });
    // Competition mode sizes itself unless told a length — the chip tells it.
    expect(plan.workout.duration_minutes).toBe(Number(dur.id.slice(4)));
  });
});
