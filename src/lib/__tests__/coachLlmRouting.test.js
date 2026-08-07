// src/lib/__tests__/coachLlmRouting.test.js
//
// The Coach's routing contract, now that a language model decides what a
// message is instead of a scored regex table.
//
// The headline case is the one that motivated the change: the regex router
// scores "I want to gain weight lean to get to 190, what should my nutrition
// plan be?" as GENERATE_PLAN at 12 (intents.js:196, the `i want to ... gain`
// pattern) and hands back a barbell program. The model has to be able to
// overrule that — and the test below asserts on the REAL detectIntent, not a
// mocked one, so it fails if that regex is ever "fixed" in a way that makes
// the assertion vacuous.
//
// The other half of the contract is that none of this is load-bearing: every
// failure path has to land on the rule-based answer the app shipped with.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/data/coachChat', () => ({
  askCoachLLM: vi.fn(),
}));
vi.mock('../aiCoach/responders', () => ({
  respond: vi.fn(async () => 'RULES_REPLY'),
  buildCoachContext: vi.fn(async () => ({})),
}));
vi.mock('../aiCoach/planBuilder', () => ({
  buildCoachPlan: vi.fn(async () => ({ reply: 'BUILDER_INTRO', plan: { kind: 'plan', title: 'Session' } })),
  GENERATE_PROMPTS: [],
}));

import { askCoach } from '../aiCoach/coach';
import { detectIntent, INTENTS } from '../aiCoach/intents';
import { askCoachLLM } from '@/lib/data/coachChat';
import { respond } from '../aiCoach/responders';
import { buildCoachPlan } from '../aiCoach/planBuilder';

const USER = { id: 'u1', email: 'a@b.c' };
const NUTRITION_Q = 'I want to gain weight lean to get to 190, what should my nutrition plan be?';

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but NOT implementations, so the
  // mockRejectedValue in the builder-throws case below would leak into every
  // test declared after it. Re-seed the happy path each time.
  respond.mockResolvedValue('RULES_REPLY');
  buildCoachPlan.mockResolvedValue({ reply: 'BUILDER_INTRO', plan: { kind: 'plan', title: 'Session' } });
});

describe('askCoach — the model routes, the rules ground', () => {
  it('answers a plain question with the model reply', async () => {
    askCoachLLM.mockResolvedValue({ ok: true, kind: 'answer', reply: 'LLM_REPLY', goal: '' });

    const res = await askCoach(USER, 'am I recovered enough to squat heavy?');

    expect(res.source).toBe('llm');
    expect(res.reply).toBe('LLM_REPLY');
    expect(res.plan).toBeUndefined();
    expect(buildCoachPlan).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('does NOT build a workout for a nutrition question the regex router misroutes', async () => {
    // Guard the premise: if this stops being true the regression is gone and
    // the assertion below would pass for the wrong reason.
    expect(detectIntent(NUTRITION_Q).id).toBe(INTENTS.GENERATE_PLAN);

    askCoachLLM.mockResolvedValue({
      ok: true,
      kind: 'answer',
      reply: 'Aim for roughly 2,900 kcal and 165 g protein…',
      goal: '',
    });

    const res = await askCoach(USER, NUTRITION_Q);

    expect(res.source).toBe('llm');
    expect(res.reply).toMatch(/protein/);
    expect(res.plan).toBeUndefined();
    expect(buildCoachPlan).not.toHaveBeenCalled();
  });

  it('hands a genuine build-me-a-session request to the deterministic builder', async () => {
    askCoachLLM.mockResolvedValue({
      ok: true,
      kind: 'plan',
      reply: 'Here is a 45-minute dumbbell push day.',
      goal: 'upper body push, 45 minutes, dumbbells only',
    });

    const res = await askCoach(USER, 'give me a push day I can do with dumbbells in 45 min', {
      profile: { level: 'consistent' },
      excludeMuscleGroups: ['shoulders'],
    });

    expect(res.source).toBe('plan');
    expect(res.plan).toEqual({ kind: 'plan', title: 'Session' });
    // The model's intro is what the user reads; the builder's template copy is
    // discarded. Two intros for one card would read as the app talking twice.
    expect(res.reply).toBe('Here is a 45-minute dumbbell push day.');
    // The builder gets the model's restated goal, and the caller's real
    // personalization context — not just the raw message.
    expect(buildCoachPlan).toHaveBeenCalledWith(expect.objectContaining({
      message: 'upper body push, 45 minutes, dumbbells only',
      profile: { level: 'consistent' },
      excludeMuscleGroups: ['shoulders'],
    }));
  });

  it('keeps the model intro when the builder throws, rather than showing an error', async () => {
    askCoachLLM.mockResolvedValue({
      ok: true, kind: 'plan', reply: 'Let us build that 5K block.', goal: 'faster 5K',
    });
    buildCoachPlan.mockRejectedValue(new Error('catalog unavailable'));

    const res = await askCoach(USER, 'train me for a faster 5K');

    expect(res.reply).toBe('Let us build that 5K block.');
    expect(res.source).toBe('llm');
    expect(res.plan).toBeUndefined();
  });

  it('builds from the raw message when the model omits a goal', async () => {
    // The Edge Function downgrades a goal-less plan handoff to a plain answer
    // before it reaches here, so this is the belt-and-braces path: if one ever
    // arrives, the user's own words are a better generator input than an
    // empty string, which would produce an unrelated default session.
    askCoachLLM.mockResolvedValue({ ok: true, kind: 'plan', reply: 'Sure.', goal: '' });

    const res = await askCoach(USER, 'build me something');

    expect(buildCoachPlan).toHaveBeenCalledWith(expect.objectContaining({
      message: 'build me something',
    }));
    expect(res.source).toBe('plan');
  });
});

describe('askCoach — every failure lands on the rules engine', () => {
  it.each([
    ['PIPELINE_MISSING'],
    ['SERVER_MISCONFIGURED'],
    ['NETWORK'],
    ['TIMEOUT'],
    ['REFUSED'],
    ['TRUNCATED'],
    ['PARSE_ERROR'],
  ])('falls back to the rule-based reply on %s', async (error) => {
    askCoachLLM.mockResolvedValue({ ok: false, error });

    const res = await askCoach(USER, 'how am I doing this week?');

    expect(res.source).toBe('rules');
    expect(res.reply).toBe('RULES_REPLY');
    expect(res.capped).toBeUndefined();
    expect(respond).toHaveBeenCalled();
  });

  it('still builds a plan through the rules path when the model is unavailable', async () => {
    askCoachLLM.mockResolvedValue({ ok: false, error: 'NETWORK' });

    const res = await askCoach(USER, 'make me a workout for today');

    expect(res.source).toBe('plan');
    expect(res.reply).toBe('BUILDER_INTRO');
    expect(res.plan).toEqual({ kind: 'plan', title: 'Session' });
  });

  it('flags the daily cap so the UI can say why the coach got simpler', async () => {
    askCoachLLM.mockResolvedValue({ ok: false, error: 'RATE_LIMIT' });

    const res = await askCoach(USER, 'how am I doing this week?');

    expect(res.capped).toBe(true);
    expect(res.source).toBe('rules');
    expect(res.reply).toBe('RULES_REPLY');
  });

  it('never calls the model when the caller opts out', async () => {
    const res = await askCoach(USER, 'how am I doing this week?', { llm: false });

    expect(askCoachLLM).not.toHaveBeenCalled();
    expect(res.source).toBe('rules');
  });
});

describe('askCoach — what the model is given', () => {
  it('forwards the thread, the training digest and the language', async () => {
    askCoachLLM.mockResolvedValue({ ok: true, kind: 'answer', reply: 'ok', goal: '' });

    await askCoach(USER, 'why?', {
      history: [{ role: 'user', text: 'earlier' }],
      coachContext: { units: 'kg' },
      language: 'es',
    });

    expect(askCoachLLM).toHaveBeenCalledWith(expect.objectContaining({
      message: 'why?',
      history: [{ role: 'user', text: 'earlier' }],
      context: { units: 'kg' },
      language: 'es',
    }));
  });

  it('defaults to English and an empty digest rather than sending undefined', async () => {
    askCoachLLM.mockResolvedValue({ ok: true, kind: 'answer', reply: 'ok', goal: '' });

    await askCoach(USER, 'hi');

    expect(askCoachLLM).toHaveBeenCalledWith(expect.objectContaining({
      history: [],
      context: {},
      language: 'en',
    }));
  });
});
