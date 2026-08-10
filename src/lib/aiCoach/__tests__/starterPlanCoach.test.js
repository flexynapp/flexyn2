import { describe, it, expect, vi, beforeEach } from 'vitest';

const askCoachLLM = vi.fn();
vi.mock('@/lib/data/coachChat', () => ({
  askCoachLLM: (...args) => askCoachLLM(...args),
}));

const { askStarterPlanCoach, buildOnboardingContext } =
  await import('@/lib/aiCoach/starterPlanCoach');

const DRAFT = {
  goal: ['strength', 'mobility'],
  level: 'newbie',
  days: ['mon', 'wed', 'fri'],
  stats: { age: 34, gender: 'female', weightKg: 68, heightCm: 170 },
  onboardingInjuries: [
    { muscleGroup: 'Shoulders', severity: 'serious' },
    { muscleGroup: 'Legs', severity: 'mild' },
  ],
};

beforeEach(() => askCoachLLM.mockReset());

describe('buildOnboardingContext', () => {
  it('translates the onboarding answers into the digest the function reads', () => {
    const ctx = buildOnboardingContext(DRAFT);
    expect(ctx.profile).toMatchObject({
      sex: 'female',
      age: 34,
      skillLevel: 'newbie',
      trainingDaysPerWeek: 3,
    });
    expect(ctx.profile.goals).toEqual(['build strength', 'move better']);
    expect(ctx.profile.bodyweightLb).toBe(150); // 68 kg
  });

  it('lists every injury, because the plan now excludes every severity', () => {
    // This used to drop the mild ones: buildStarterRegimen kept a mild region
    // with a caution note, so naming it would have had the coach announce it
    // was avoiding work the card visibly contained. The plan excludes mild
    // now, and leaving the filter in would invert that bug — the coach would
    // talk about training a region the plan had just removed.
    expect(buildOnboardingContext(DRAFT).injuries.avoidMuscleGroups)
      .toEqual(['Shoulders', 'Legs']);
  });

  it('omits the injuries block entirely when there are none', () => {
    expect(buildOnboardingContext({ goal: ['lose'] }).injuries).toBeUndefined();
  });

  it('sends no training history, because a new user has none', () => {
    const ctx = buildOnboardingContext(DRAFT);
    expect(ctx.training).toBeUndefined();
    expect(ctx.topLifts).toBeUndefined();
    expect(ctx.streaks).toBeUndefined();
  });

  it('survives an empty draft', () => {
    expect(() => buildOnboardingContext()).not.toThrow();
    expect(() => buildOnboardingContext({})).not.toThrow();
  });
});

describe('askStarterPlanCoach', () => {
  it('asks as a build request, so the function takes the plan branch', async () => {
    askCoachLLM.mockResolvedValue({ ok: true, kind: 'plan', reply: 'Here is why.', model: 'claude-haiku-4-5' });
    await askStarterPlanCoach({ draft: DRAFT, language: 'es' });

    const [args] = askCoachLLM.mock.calls[0];
    expect(args.message).toMatch(/^Build me my starter training plan\./);
    expect(args.message).toContain('build strength and move better');
    expect(args.language).toBe('es');
    expect(args.history).toEqual([]);
  });

  it('returns the reply and the model that wrote it', async () => {
    askCoachLLM.mockResolvedValue({ ok: true, kind: 'plan', reply: '  Two sentences.  ', model: 'claude-haiku-4-5' });
    await expect(askStarterPlanCoach({ draft: DRAFT })).resolves.toEqual({
      ok: true, reply: 'Two sentences.', model: 'claude-haiku-4-5',
    });
  });

  it('refuses a kind="answer" reply, which is free to name lifts the card never generated', async () => {
    askCoachLLM.mockResolvedValue({
      ok: true, kind: 'answer', reply: 'Start with 5x5 back squats and bench.', model: 'claude-haiku-4-5',
    });
    await expect(askStarterPlanCoach({ draft: DRAFT })).resolves.toEqual({
      ok: false, error: 'NOT_A_PLAN',
    });
  });

  // Onboarding is the last screen of signup. None of these may throw, and
  // none may return something the reveal would render as a coach write-up.
  for (const error of ['PIPELINE_MISSING', 'SERVER_MISCONFIGURED', 'RATE_LIMIT', 'TIMEOUT', 'NETWORK', 'REFUSED']) {
    it(`fails soft on ${error}`, async () => {
      askCoachLLM.mockResolvedValue({ ok: false, error });
      await expect(askStarterPlanCoach({ draft: DRAFT })).resolves.toEqual({ ok: false, error });
    });
  }

  it('fails soft if askCoachLLM ever returns nothing at all', async () => {
    // Not a shape it produces today. It is here because the alternative — a
    // TypeError on `res.ok` — surfaces on the last screen of signup, where
    // the user is one tap from the dashboard and has nowhere to go.
    //
    // (The sibling case, askCoachLLM *throwing*, is handled by a try/catch in
    // the source but cannot be asserted here: Vitest fails a test on a mock's
    // own recorded throw regardless of whether the code under test catches
    // it, so that test would be measuring the harness.)
    askCoachLLM.mockResolvedValue(undefined);
    await expect(askStarterPlanCoach({ draft: DRAFT })).resolves.toEqual({ ok: false, error: 'EMPTY' });
  });

  it('rejects an empty reply rather than rendering a blank coach block', async () => {
    askCoachLLM.mockResolvedValue({ ok: true, kind: 'plan', reply: '   ', model: 'claude-haiku-4-5' });
    await expect(askStarterPlanCoach({ draft: DRAFT })).resolves.toEqual({
      ok: false, error: 'EMPTY_REPLY',
    });
  });

  it('gives the request a tighter budget than the chat, since onboarding is waiting on it', async () => {
    askCoachLLM.mockResolvedValue({ ok: true, kind: 'plan', reply: 'x', model: null });
    await askStarterPlanCoach({ draft: DRAFT });
    expect(askCoachLLM.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(8000);
  });
});
