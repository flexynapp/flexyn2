// src/lib/hrZones.js
//
// Heart-rate zone helpers. Standard 5-zone model:
//
//   Zone 1  50-60%  recovery     gray-blue
//   Zone 2  60-70%  aerobic      blue
//   Zone 3  70-80%  tempo        green
//   Zone 4  80-90%  threshold    amber
//   Zone 5  90-100% VO2max       rose
//
// Used by the cardio log entry UI to validate inputs, the saved-log
// view to color-code time in zone, and (optionally) the dashboard
// to show weekly zone distribution.

export const ZONE_DEFINITIONS = [
  { id: 1, label: 'Recovery',  pctMin: 50, pctMax: 60, hex: '#60a5fa', tw: 'text-blue-400'   },
  { id: 2, label: 'Aerobic',   pctMin: 60, pctMax: 70, hex: '#3b82f6', tw: 'text-blue-500'   },
  { id: 3, label: 'Tempo',     pctMin: 70, pctMax: 80, hex: '#10b981', tw: 'text-emerald-500' },
  { id: 4, label: 'Threshold', pctMin: 80, pctMax: 90, hex: '#f59e0b', tw: 'text-amber-500'  },
  { id: 5, label: 'VO2max',    pctMin: 90, pctMax: 100, hex: '#f43f5e', tw: 'text-rose-500'  },
];

/**
 * Default max HR estimate from age. Tanaka formula (208 − 0.7 × age)
 * is more accurate than 220 − age but the difference is small enough
 * we use the simpler form. Returns null when age is invalid so the
 * UI falls back to asking the user to enter their max directly.
 */
export function estimateMaxHr(ageYears) {
  if (typeof ageYears !== 'number' || ageYears <= 0 || ageYears > 120) return null;
  return Math.round(220 - ageYears);
}

/**
 * Classify a bpm into a zone id 1-5 given the user's max HR.
 * Returns null when input is unknown.
 */
export function bpmToZone(bpm, maxHr) {
  if (typeof bpm !== 'number' || typeof maxHr !== 'number' || maxHr <= 0) return null;
  const pct = (bpm / maxHr) * 100;
  if (pct < 50)  return 0;  // below zone 1
  if (pct < 60)  return 1;
  if (pct < 70)  return 2;
  if (pct < 80)  return 3;
  if (pct < 90)  return 4;
  return 5;
}

/**
 * Sum minutes across all 5 zones. Used to validate that the user's
 * zone allocations don't exceed the workout's total duration.
 */
export function totalZoneMinutes(log) {
  if (!log) return 0;
  return (Number(log.hr_zone1_min) || 0) +
         (Number(log.hr_zone2_min) || 0) +
         (Number(log.hr_zone3_min) || 0) +
         (Number(log.hr_zone4_min) || 0) +
         (Number(log.hr_zone5_min) || 0);
}

/**
 * Returns a normalized 0-1 percentage breakdown by zone for charting.
 *   [{ zone: 1, min: 5, pct: 0.25 }, ...]
 *
 * Zero-total returns the zone definitions with min=0, pct=0 — gives
 * a uniform skeleton that the chart can still render.
 */
export function zoneBreakdown(log) {
  const total = totalZoneMinutes(log);
  return ZONE_DEFINITIONS.map((z) => {
    const min = Number(log?.[`hr_zone${z.id}_min`]) || 0;
    return {
      ...z,
      min,
      pct: total > 0 ? min / total : 0,
    };
  });
}

/**
 * Validate proposed zone-minutes inputs against a session duration.
 * Returns { ok, error? }. The session duration cap matters because
 * a user entering 30 minutes total but allocating 60 minutes across
 * zones would inflate weekly stats.
 */
export function validateZoneMinutes({ duration_min, hr_zone1_min, hr_zone2_min, hr_zone3_min, hr_zone4_min, hr_zone5_min }) {
  const total = (Number(hr_zone1_min) || 0) +
                (Number(hr_zone2_min) || 0) +
                (Number(hr_zone3_min) || 0) +
                (Number(hr_zone4_min) || 0) +
                (Number(hr_zone5_min) || 0);
  if (duration_min == null) return { ok: true };
  if (total > Number(duration_min)) {
    return { ok: false, error: 'zone_total_exceeds_duration' };
  }
  return { ok: true };
}
