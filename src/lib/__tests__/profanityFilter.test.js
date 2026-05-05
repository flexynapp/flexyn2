import { describe, it, expect } from 'vitest';
import { containsProfanity } from '../profanityFilter';

// ─── DM bypass ────────────────────────────────────────────────────────────────

describe('DM context bypass', () => {
  it('always returns false for any text in DM context', () => {
    const slurs = ['fuck', 'shit', 'ass', 'bitch'];
    slurs.forEach(word => {
      expect(containsProfanity(word, { context: 'dm' })).toBe(false);
    });
  });

  it('returns false for innocent text in DM context', () => {
    expect(containsProfanity('hello world', { context: 'dm' })).toBe(false);
  });
});

// ─── Clear profanity catches ───────────────────────────────────────────────────

describe('catches clear profanity in public context', () => {
  // Note: 'ass' is intentionally excluded — the filter skips it to avoid
  // false positives on words like 'class', 'bass', 'grass', 'passage', etc.
  const slurs = ['fuck', 'shit', 'bitch', 'cunt', 'cock'];
  slurs.forEach(word => {
    it(`flags "${word}"`, () => {
      expect(containsProfanity(word)).toBe(true);
    });
  });
});

// ─── False positive regression suite ─────────────────────────────────────────
// Every phrase here is an innocent English word/phrase that has historically
// caused false positives due to substring matching, reverse matching, or leet
// normalization. These MUST return false.

describe('false positive regressions — innocent words', () => {
  const innocent = [
    // Common words that contain suspicious substrings
    'classic',
    'passage',
    'a narrow passage',
    'basement',
    'assassin',
    'scunthorpe',
    'Scunthorpe',
    'cockburn street',
    'Cockburn Street',
    'clockwork',
    'clockwork orange',
    'a city block',
    'walking',
    'chalk',
    'talk',
    'stalk',
    'hawk',
    'block',
    // Geographic names
    'Middlesex',
    'Essex',
    'Sussex',
    'Penistone',
    'Lightwater',
    // Fitness-specific terms
    'muscle',
    'barbell',
    'dumbbell',
    'glutes',
    'squat',
    'deadlift',
    'press',
    'mass',
    'grass',
    'class',
    // Numbers and punctuation
    '100kg',
    'set 3',
    '5x5',
    // Common sentences
    'great workout today',
    'I crushed my deadlift PR',
    "let's go",
    'I need to work on my form',
    'finished my cardio session',
  ];

  innocent.forEach(phrase => {
    it(`does not flag "${phrase}"`, () => {
      expect(containsProfanity(phrase)).toBe(false);
    });
  });
});

// ─── Leet speak and obfuscation ───────────────────────────────────────────────

describe('catches leet-speak obfuscation', () => {
  it('flags f4ck (digit substitution)', () => {
    expect(containsProfanity('f4ck')).toBe(true);
  });

  it('flags sh!t (punctuation substitution)', () => {
    expect(containsProfanity('sh!t')).toBe(true);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('returns false for empty string', () => {
    expect(containsProfanity('')).toBe(false);
  });

  it('returns false for null / undefined', () => {
    expect(containsProfanity(null)).toBe(false);
    expect(containsProfanity(undefined)).toBe(false);
  });

  it('returns false for a string of only spaces', () => {
    expect(containsProfanity('     ')).toBe(false);
  });

  it('returns false for numbers', () => {
    expect(containsProfanity('12345')).toBe(false);
  });

  it('is case-insensitive — "FUCK" is caught the same as "fuck"', () => {
    expect(containsProfanity('FUCK')).toBe(true);
  });
});
