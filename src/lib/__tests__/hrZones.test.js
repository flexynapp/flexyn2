// Tests for src/lib/hrZones.js — HR zone calculation + validation.

import { describe, it, expect } from 'vitest';
import {
  estimateMaxHr,
  bpmToZone,
  totalZoneMinutes,
  zoneBreakdown,
  validateZoneMinutes,
  ZONE_DEFINITIONS,
} from '../hrZones';

describe('estimateMaxHr', () => {
  it('returns 220 - age for valid inputs', () => {
    expect(estimateMaxHr(30)).toBe(190);
    expect(estimateMaxHr(50)).toBe(170);
  });
  it('returns null for invalid inputs', () => {
    expect(estimateMaxHr(0)).toBe(null);
    expect(estimateMaxHr(-5)).toBe(null);
    expect(estimateMaxHr(200)).toBe(null);
    expect(estimateMaxHr('hello')).toBe(null);
  });
});

describe('bpmToZone', () => {
  it('classifies bpms by percentage of max', () => {
    // Max = 200 → zones at 100/120/140/160/180
    expect(bpmToZone(90,  200)).toBe(0);  // < 50% → below zone 1
    expect(bpmToZone(110, 200)).toBe(1);  // 55%
    expect(bpmToZone(130, 200)).toBe(2);  // 65%
    expect(bpmToZone(150, 200)).toBe(3);  // 75%
    expect(bpmToZone(170, 200)).toBe(4);  // 85%
    expect(bpmToZone(190, 200)).toBe(5);  // 95%
    expect(bpmToZone(200, 200)).toBe(5);  // 100%
  });
  it('returns null on bad inputs', () => {
    expect(bpmToZone(null, 200)).toBe(null);
    expect(bpmToZone(150, 0)).toBe(null);
    expect(bpmToZone(150, null)).toBe(null);
  });
});

describe('totalZoneMinutes', () => {
  it('sums all five zones', () => {
    expect(totalZoneMinutes({
      hr_zone1_min: 5, hr_zone2_min: 10, hr_zone3_min: 15,
      hr_zone4_min: 5, hr_zone5_min: 2,
    })).toBe(37);
  });
  it('treats missing zones as 0', () => {
    expect(totalZoneMinutes({ hr_zone2_min: 20 })).toBe(20);
  });
  it('handles null log', () => {
    expect(totalZoneMinutes(null)).toBe(0);
    expect(totalZoneMinutes(undefined)).toBe(0);
  });
});

describe('zoneBreakdown', () => {
  it('returns one entry per zone with normalized pct', () => {
    const result = zoneBreakdown({
      hr_zone1_min: 10, hr_zone2_min: 30,
      hr_zone3_min: 10, hr_zone4_min: 0, hr_zone5_min: 0,
    });
    expect(result).toHaveLength(5);
    expect(result[0].pct).toBeCloseTo(0.2, 2);   // 10 / 50
    expect(result[1].pct).toBeCloseTo(0.6, 2);   // 30 / 50
    expect(result[2].pct).toBeCloseTo(0.2, 2);   // 10 / 50
    expect(result[3].pct).toBe(0);
    expect(result[4].pct).toBe(0);
  });
  it('returns a uniform 0-pct skeleton for empty totals', () => {
    const result = zoneBreakdown({});
    expect(result).toHaveLength(5);
    for (const r of result) expect(r.pct).toBe(0);
  });
});

describe('validateZoneMinutes', () => {
  it('passes when zone total ≤ duration', () => {
    expect(validateZoneMinutes({
      duration_min: 30,
      hr_zone1_min: 10, hr_zone2_min: 10, hr_zone3_min: 5,
    })).toEqual({ ok: true });
  });
  it('passes when duration is null', () => {
    expect(validateZoneMinutes({
      hr_zone1_min: 10, hr_zone2_min: 10,
    })).toEqual({ ok: true });
  });
  it('fails when zone total exceeds duration', () => {
    const res = validateZoneMinutes({
      duration_min: 30, hr_zone1_min: 20, hr_zone2_min: 20,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('zone_total_exceeds_duration');
  });
});

describe('ZONE_DEFINITIONS', () => {
  it('covers 5 zones in order with continuous pct ranges', () => {
    expect(ZONE_DEFINITIONS).toHaveLength(5);
    for (let i = 0; i < 4; i++) {
      expect(ZONE_DEFINITIONS[i].pctMax).toBe(ZONE_DEFINITIONS[i + 1].pctMin);
    }
    expect(ZONE_DEFINITIONS[0].pctMin).toBe(50);
    expect(ZONE_DEFINITIONS[4].pctMax).toBe(100);
  });
});
