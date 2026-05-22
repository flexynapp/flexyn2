// Tests for src/lib/textCase — title-casing with stop-word + acronym
// handling. Tests cover the documented rules: title-case words,
// lowercase mid-string stop words, preserve all-caps acronyms,
// respect explicitly-uppercase input, and trim/collapse whitespace.

import { describe, it, expect } from 'vitest';
import { titleCase } from '../textCase';

describe('titleCase', () => {
  describe('basic capitalization', () => {
    it('capitalizes the first letter of each word', () => {
      expect(titleCase('bench press')).toBe('Bench Press');
    });

    it('preserves an already title-cased string', () => {
      expect(titleCase('Bench Press')).toBe('Bench Press');
    });

    it('lowercases everything-uppercase that\'s NOT mostly-upper', () => {
      // "P" alone wouldn't trip the mostly-upper rule; "PUSH day" might.
      expect(titleCase('push day')).toBe('Push Day');
    });
  });

  describe('stop words', () => {
    it('lowercases stop words mid-string', () => {
      expect(titleCase('squat of the day')).toBe('Squat of the Day');
    });

    it('still capitalizes a stop word when it\'s the FIRST word', () => {
      expect(titleCase('the rock routine')).toBe('The Rock Routine');
    });
  });

  describe('acronyms', () => {
    it('preserves known lifting acronyms (BCAA, RDL, OHP)', () => {
      expect(titleCase('bcaa stack')).toBe('BCAA Stack');
      expect(titleCase('rdl progression')).toBe('RDL Progression');
      expect(titleCase('ohp work')).toBe('OHP Work');
    });

    it('preserves explicit ALL-CAPS tokens >= 2 chars', () => {
      expect(titleCase('XYZ method')).toBe('XYZ Method');
    });

    it('does NOT capitalize 1-letter tokens as acronyms', () => {
      // Single letters shouldn't trip the preserve-acronym rule.
      expect(titleCase('a quick warmup')).toBe('A Quick Warmup');
    });
  });

  describe('hyphenated words', () => {
    it('title-cases each hyphen-segment', () => {
      expect(titleCase('pull-up day')).toBe('Pull-Up Day');
    });

    it('preserves acronyms inside hyphens', () => {
      expect(titleCase('pre-pr ritual')).toBe('Pre-PR Ritual');
    });
  });

  describe('whitespace', () => {
    it('trims leading + trailing whitespace', () => {
      expect(titleCase('  bench press  ')).toBe('Bench Press');
    });

    it('collapses runs of whitespace', () => {
      expect(titleCase('bench   press')).toBe('Bench Press');
    });
  });

  describe('respect-user-intent', () => {
    it('leaves explicitly mostly-uppercase strings alone', () => {
      // "PUSH DAY" — more than 50% of letters uppercase → user means it.
      expect(titleCase('PUSH DAY')).toBe('PUSH DAY');
    });
  });

  describe('edge cases', () => {
    it('returns non-string input unchanged', () => {
      expect(titleCase(undefined)).toBe(undefined);
      expect(titleCase(null)).toBe(null);
      expect(titleCase(123)).toBe(123);
    });

    it('returns empty string unchanged', () => {
      expect(titleCase('')).toBe('');
    });
  });
});
