/**
 * Personal Records (PR) Detection for Cardio Sessions
 * 
 * Tracks and compares performance across standard distances:
 * 1K, 1 mile, 5K, 10K, half-marathon, marathon
 * 
 * Separated by activity family: running, walking, biking
 */

export const DISTANCE_PR_THRESHOLDS_M = {
  '1k': 1000,
  '1mi': 1609.344,
  '5k': 5000,
  '10k': 10000,
  'half_marathon': 21097.5,
  'marathon': 42195,
};

// Swimming gets its own ladder. It used to fall through `activityFamily`
// to 'other' and be measured against the FOOT ladder — so a 1 km pool swim
// registered a "1K" PR, and a strong swimmer was told they had never come
// close to a "Marathon". The distances below are the ones swimmers
// actually race: a pool 100, the 400 free, a kilometre, and the 1500 —
// plus 1900 m and 3800 m, which are the swim legs of a half and a full
// Ironman.
export const SWIM_PR_THRESHOLDS_M = {
  'swim_100': 100,
  'swim_400': 400,
  'swim_1k': 1000,
  'swim_1500': 1500,
  'swim_1900': 1900,
  'swim_3800': 3800,
};

export const PR_LABELS = {
  '1k': '1K',
  '1mi': '1 Mile',
  '5k': '5K',
  '10k': '10K',
  'half_marathon': 'Half Marathon',
  'marathon': 'Marathon',
  'swim_100': '100 m',
  'swim_400': '400 m',
  'swim_1k': '1 km',
  'swim_1500': '1500 m',
  'swim_1900': '1.9 km',
  'swim_3800': '3.8 km',
};

/** The distance ladder a family is measured against. */
export function thresholdsForFamily(family) {
  return family === 'swimming' ? SWIM_PR_THRESHOLDS_M : DISTANCE_PR_THRESHOLDS_M;
}

/**
 * Extract activity family from cardio log type
 * e.g., 'running_outside' → 'running', 'biking_stationary' → 'biking'
 */
export function activityFamily(type) {
  if (type?.startsWith('running')) return 'running';
  if (type?.startsWith('walking')) return 'walking';
  if (type?.startsWith('biking')) return 'biking';
  // Added 2026-08-11. Without this a swim fell to 'other' and was ranked
  // on the running ladder — see SWIM_PR_THRESHOLDS_M.
  if (type?.startsWith('swimming')) return 'swimming';
  return 'other';
}

/**
 * For a given log, compute the estimated time at each distance threshold
 * the log meets or exceeds.
 * 
 * Uses linear extrapolation: if the session covered X meters in Y seconds,
 * time at threshold T = Y * (T / X)
 */
export function thresholdTimesForLog(log) {
  const family = activityFamily(log.type);
  const out = [];
  
  // Range-check distance too — previously only duration was checked,
  // which let a 0-distance session produce `NaN` thresholds that
  // polluted the bests map. (Audit 16 F2.)
  if (!log.distance_meters || log.distance_meters <= 0 ||
      !log.duration_seconds || log.duration_seconds <= 0) {
    return out;
  }

  for (const [name, meters] of Object.entries(thresholdsForFamily(family))) {
    if (log.distance_meters >= meters) {
      const timeAtThreshold = log.duration_seconds * (meters / log.distance_meters);
      out.push({ family, distance: name, timeSeconds: timeAtThreshold });
    }
  }
  
  return out;
}

/**
 * Compute current best times across all prior logs by activity family & distance.
 * Returns: { family: { distance: timeSeconds, ... }, ... }
 */
export function currentBests(priorLogs) {
  const bests = {}; // bests[family][distance] = timeSeconds
  
  for (const log of priorLogs) {
    const triples = thresholdTimesForLog(log);
    for (const { family, distance, timeSeconds } of triples) {
      if (!bests[family]) bests[family] = {};
      if (bests[family][distance] == null || timeSeconds < bests[family][distance]) {
        bests[family][distance] = timeSeconds;
      }
    }
  }
  
  return bests;
}

/**
 * Detect newly broken PRs by comparing a new log against prior logs.
 * 
 * Returns array of { family, distance, oldTimeSeconds, newTimeSeconds }
 * (oldTimeSeconds is null for first-time records)
 */
export function detectNewPRs(newLog, priorLogs) {
  const bests = currentBests(priorLogs);
  const triples = thresholdTimesForLog(newLog);
  const broken = [];
  
  for (const { family, distance, timeSeconds } of triples) {
    const oldTime = bests[family]?.[distance];
    if (oldTime == null || timeSeconds < oldTime) {
      broken.push({
        family,
        distance,
        oldTimeSeconds: oldTime ?? null,
        newTimeSeconds: timeSeconds,
      });
    }
  }
  
  return broken;
}