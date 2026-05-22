// Tests for src/lib/voiceInput.js — the parseVoiceSet phrase parser.
// The SpeechRecognition wrapper itself is browser-only and hard to
// unit-test without a fake; the parse function is pure and worth
// covering thoroughly.

import { describe, it, expect } from 'vitest';
import { parseVoiceSet, isVoiceInputSupported } from '../voiceInput';

describe('parseVoiceSet', () => {
  it('handles "N by M" notation', () => {
    expect(parseVoiceSet('100 by 5')).toEqual({ weight: 100, reps: 5 });
    expect(parseVoiceSet('225 by 8')).toEqual({ weight: 225, reps: 8 });
  });

  it('handles "N for M" notation', () => {
    expect(parseVoiceSet('100 for 5')).toEqual({ weight: 100, reps: 5 });
  });

  it('handles "N x M" notation', () => {
    expect(parseVoiceSet('100 x 5')).toEqual({ weight: 100, reps: 5 });
  });

  it('handles explicit "reps" keyword', () => {
    expect(parseVoiceSet('100 pounds 8 reps')).toEqual({ weight: 100, reps: 8 });
    expect(parseVoiceSet('five reps')).toEqual({ weight: null, reps: 5 });
  });

  it('handles explicit "pounds" / "kg" keyword', () => {
    expect(parseVoiceSet('100 pounds')).toEqual({ weight: 100, reps: null });
    expect(parseVoiceSet('80 kg')).toEqual({ weight: 80, reps: null });
    expect(parseVoiceSet('80 kilos')).toEqual({ weight: 80, reps: null });
  });

  it('handles spelled-out numbers', () => {
    expect(parseVoiceSet('one hundred by five')).toEqual({ weight: 100, reps: 5 });
    expect(parseVoiceSet('two hundred and twenty five by 3')).toEqual({ weight: 225, reps: 3 });
  });

  it('handles "weight 100" syntax', () => {
    expect(parseVoiceSet('weight 100')).toEqual({ weight: 100, reps: null });
  });

  it('caps unreasonable reps (range 1-50)', () => {
    const r = parseVoiceSet('100 by 100');
    expect(r.reps).toBe(null);
    expect(r.weight).toBe(100);
  });

  it('caps unreasonable weights (max 2000)', () => {
    const r = parseVoiceSet('5000 by 5');
    expect(r.weight).toBe(null);
    expect(r.reps).toBe(5);
  });

  it('returns nulls on empty / nonsense input', () => {
    expect(parseVoiceSet('')).toEqual({ weight: null, reps: null });
    expect(parseVoiceSet('hello world')).toEqual({ weight: null, reps: null });
    expect(parseVoiceSet(null)).toEqual({ weight: null, reps: null });
    expect(parseVoiceSet(undefined)).toEqual({ weight: null, reps: null });
  });

  it('is case-insensitive', () => {
    expect(parseVoiceSet('100 BY 5')).toEqual({ weight: 100, reps: 5 });
    expect(parseVoiceSet('One Hundred By Five')).toEqual({ weight: 100, reps: 5 });
  });

  it('handles decimal weights', () => {
    expect(parseVoiceSet('22.5 by 10')).toEqual({ weight: 22.5, reps: 10 });
  });

  it('isVoiceInputSupported returns a boolean', () => {
    expect(typeof isVoiceInputSupported()).toBe('boolean');
  });
});
