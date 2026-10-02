import { describe, it, expect } from 'vitest';
import { fromLbs, toLbs, formatWeight, formatWeightNumber } from '../weightUnit';

describe('fromLbs — unit conversion', () => {
  it('returns lbs unchanged when unit is lbs', () => {
    expect(fromLbs(200, 'lbs')).toBe(200);
  });

  it('converts lbs → kg correctly', () => {
    expect(fromLbs(220.462, 'kg')).toBeCloseTo(100, 1);
  });

  it('converts lbs → stone correctly (14 lbs per stone)', () => {
    expect(fromLbs(140, 'stone')).toBeCloseTo(10, 4);
  });

  it('defaults to returning lbs when unit is unrecognised', () => {
    expect(fromLbs(100, 'furlongs')).toBe(100);
  });
});

describe('toLbs — reverse conversion', () => {
  it('round-trips lbs → kg → lbs within floating-point tolerance', () => {
    const original = 185;
    const kg = fromLbs(original, 'kg');
    const back = toLbs(kg, 'kg');
    expect(back).toBeCloseTo(original, 1);
  });

  it('round-trips lbs → stone → lbs', () => {
    const original = 168;
    const stone = fromLbs(original, 'stone');
    const back  = toLbs(stone, 'stone');
    expect(back).toBeCloseTo(original, 3);
  });

  it('returns the value unchanged for lbs unit', () => {
    expect(toLbs(100, 'lbs')).toBe(100);
  });
});

describe('formatWeight', () => {
  it('groups thousands so a volume reads like the XP beside it', () => {
    expect(formatWeight(18450, 'lbs')).toBe('18,450 lbs');
  });

  it('groups in the page language', () => {
    const was = document.documentElement.lang;
    document.documentElement.lang = 'es';
    try {
      expect(formatWeight(18450, 'lbs')).toBe('18.450 lbs');
    } finally {
      document.documentElement.lang = was;
    }
  });

  it('leaves formatWeightNumber ungrouped, because inputs parse it', () => {
    expect(formatWeightNumber(18450, 'lbs')).toBe('18450');
  });

  it('returns "—" for null', () => {
    expect(formatWeight(null, 'lbs')).toBe('—');
  });

  it('returns "—" for NaN', () => {
    expect(formatWeight(NaN, 'lbs')).toBe('—');
  });

  it('formats lbs with 0 decimal places by default', () => {
    expect(formatWeight(185, 'lbs')).toBe('185 lbs');
  });

  it('formats kg with 1 decimal place by default', () => {
    expect(formatWeight(220.462, 'kg')).toMatch(/100\.0 kg/);
  });

  it('respects custom decimal override', () => {
    expect(formatWeight(100, 'lbs', 2)).toBe('100.00 lbs');
  });
});

describe('formatWeightNumber', () => {
  it('returns empty string for null', () => {
    expect(formatWeightNumber(null, 'lbs')).toBe('');
  });

  it('returns a bare number string without unit suffix', () => {
    const result = formatWeightNumber(185, 'lbs');
    expect(result).not.toContain('lbs');
    expect(Number(result)).toBeCloseTo(185, 0);
  });
});
