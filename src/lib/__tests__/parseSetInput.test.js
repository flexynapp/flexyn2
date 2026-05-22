// Tests for src/lib/parseSetInput.js — the "smart paste" parser for
// the workout logger. Each shape the parser claims to support gets a
// passing case, plus a handful of negative cases (random text, bare
// numbers, malformed strings) to confirm the parser refuses bad input
// rather than guessing.

import { describe, it, expect } from 'vitest';
import { parseSetInput } from '../parseSetInput';

describe('parseSetInput', () => {
  describe('happy paths', () => {
    it('parses "225 x 8" (spaced)', () => {
      expect(parseSetInput('225 x 8')).toEqual({ weight: 225, reps: 8, unit: null });
    });

    it('parses "225x8" (no spaces)', () => {
      expect(parseSetInput('225x8')).toEqual({ weight: 225, reps: 8, unit: null });
    });

    it('parses "225 × 8" (Unicode multiplication sign)', () => {
      expect(parseSetInput('225 × 8')).toEqual({ weight: 225, reps: 8, unit: null });
    });

    it('parses "225 @ 8" (@ separator)', () => {
      expect(parseSetInput('225 @ 8')).toEqual({ weight: 225, reps: 8, unit: null });
    });

    it('parses "225 8 reps" (space + trailing reps)', () => {
      expect(parseSetInput('225 8 reps')).toEqual({ weight: 225, reps: 8, unit: null });
    });

    it('parses "225lb x 8" (lb unit hint)', () => {
      expect(parseSetInput('225lb x 8')).toEqual({ weight: 225, reps: 8, unit: 'lb' });
    });

    it('parses "100 kg x 12" (kg unit hint with spaces)', () => {
      expect(parseSetInput('100 kg x 12')).toEqual({ weight: 100, reps: 12, unit: 'kg' });
    });

    it('parses decimal weights ("100.5 x 5")', () => {
      expect(parseSetInput('100.5 x 5')).toEqual({ weight: 100.5, reps: 5, unit: null });
    });

    it('parses with surrounding whitespace and newlines', () => {
      expect(parseSetInput('  225 x 8  \n')).toEqual({ weight: 225, reps: 8, unit: null });
    });

    it('is case-insensitive on units and "reps" tail', () => {
      expect(parseSetInput('100KG X 12 REPS')).toEqual({ weight: 100, reps: 12, unit: 'kg' });
    });
  });

  describe('rejected inputs (returns null)', () => {
    it('refuses an empty string', () => {
      expect(parseSetInput('')).toBeNull();
    });

    it('refuses non-strings', () => {
      expect(parseSetInput(null)).toBeNull();
      expect(parseSetInput(undefined)).toBeNull();
      expect(parseSetInput(225)).toBeNull();
    });

    it('refuses bare numbers (no separator)', () => {
      expect(parseSetInput('225')).toBeNull();
    });

    it('refuses bare exercise names', () => {
      expect(parseSetInput('bench press')).toBeNull();
    });

    it('refuses obvious junk', () => {
      expect(parseSetInput('hello world')).toBeNull();
    });

    it('refuses negative numbers', () => {
      expect(parseSetInput('-225 x 8')).toBeNull();
    });

    it('refuses absurd rep counts (> 100)', () => {
      expect(parseSetInput('225 x 9999')).toBeNull();
    });
  });
});
