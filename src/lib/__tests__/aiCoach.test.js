import { describe, it, expect } from 'vitest';
import { detectIntent, INTENTS } from '../aiCoach/intents';

describe('detectIntent — common phrasings', () => {
  it('returns UNKNOWN for empty / null input', () => {
    expect(detectIntent('').id).toBe(INTENTS.UNKNOWN);
    expect(detectIntent(null).id).toBe(INTENTS.UNKNOWN);
    expect(detectIntent(undefined).id).toBe(INTENTS.UNKNOWN);
  });

  it('detects "what should I train today" variants', () => {
    [
      'what should I train today',
      'What do I train today?',
      'What to train',
      'today\'s workout',
      'workout suggestion',
    ].forEach(q => {
      expect(detectIntent(q).id, q).toBe(INTENTS.WHAT_TO_TRAIN);
    });
  });

  it('detects progress check', () => {
    [
      'how am I doing',
      'how is my training going',
      'weekly recap',
      'monthly summary',
    ].forEach(q => {
      expect(detectIntent(q).id, q).toBe(INTENTS.PROGRESS_CHECK);
    });
  });

  it('detects should-increase-weight', () => {
    [
      'should I increase the weight',
      'time to add weight',
      'am I ready to go heavier',
      'how much should I lift',
      'ready for more weight',
    ].forEach(q => {
      expect(detectIntent(q).id, q).toBe(INTENTS.SHOULD_INCREASE);
    });
  });

  it('detects soreness', () => {
    [
      "I'm sore",
      'I am sore',
      'feeling tight',
      'muscle soreness',
      'DOMS',
    ].forEach(q => {
      expect(detectIntent(q).id, q).toBe(INTENTS.SORENESS);
    });
  });

  it('detects PR queries', () => {
    [
      'what are my PRs',
      'my personal records',
      'best lifts',
    ].forEach(q => {
      expect(detectIntent(q).id, q).toBe(INTENTS.PRS);
    });
  });

  it('detects weak-area queries', () => {
    [
      'what muscles am I neglecting',
      'weakest area',
      'undertrained spots',
      'I keep skipping leg day',
    ].forEach(q => {
      expect(detectIntent(q).id, q).toBe(INTENTS.WEAK_AREAS);
    });
  });

  it('detects greetings', () => {
    [
      'hi',
      'hey',
      'hello',
      'hi coach',
      'good morning',
    ].forEach(q => {
      expect(detectIntent(q).id, q).toBe(INTENTS.GREETING);
    });
  });

  it('detects rest day question', () => {
    expect(detectIntent('should I rest today').id).toBe(INTENTS.REST_DAY);
    expect(detectIntent('rest day?').id).toBe(INTENTS.REST_DAY);
  });

  it('detects plateau', () => {
    expect(detectIntent('I have plateaued').id).toBe(INTENTS.PLATEAU);
    expect(detectIntent("I'm stuck on bench").id).toBe(INTENTS.PLATEAU);
    expect(detectIntent("can't break my squat PR").id).toBe(INTENTS.PLATEAU);
  });

  it('detects streak question', () => {
    expect(detectIntent('how is my streak').id).toBe(INTENTS.STREAK_STATUS);
  });

  it('detects hydration question', () => {
    expect(detectIntent('how much water should I drink').id).toBe(INTENTS.HYDRATION);
  });

  it('detects help / capabilities', () => {
    expect(detectIntent('what can you do').id).toBe(INTENTS.HELP);
    expect(detectIntent('?').id).toBe(INTENTS.HELP);
  });

  it('falls through to UNKNOWN for genuinely unrelated text', () => {
    expect(detectIntent('the weather is nice').id).toBe(INTENTS.UNKNOWN);
    expect(detectIntent('asdf jklj').id).toBe(INTENTS.UNKNOWN);
  });

  it('preserves the raw message in params for unknown intents', () => {
    const result = detectIntent('some random thing');
    expect(result.params.raw).toBe('some random thing');
  });
});

describe('detectIntent — confidence scoring', () => {
  it('higher-confidence intents win when multiple regexes match', () => {
    // "should I increase weight" matches both should_increase (score 9) and
    // help (regex `should|how do`) — should_increase should win
    const result = detectIntent('should I increase my squat weight');
    expect(result.id).toBe(INTENTS.SHOULD_INCREASE);
  });
});
