// MET-based calorie estimation, simplified from the 2011 Compendium of
// Physical Activities. Returns calories as an integer.

function metForActivity(type, speedKmh) {
  if (type.startsWith('running')) {
    if (speedKmh < 6.5)  return 6.0;
    if (speedKmh < 8)    return 8.3;
    if (speedKmh < 9.5)  return 9.8;
    if (speedKmh < 11)   return 11.0;
    if (speedKmh < 13)   return 12.8;
    if (speedKmh < 14.5) return 14.5;
    return 16.0;
  }
  if (type.startsWith('walking')) {
    if (speedKmh < 3) return 2.5;
    if (speedKmh < 4) return 3.0;
    if (speedKmh < 5) return 3.5;
    if (speedKmh < 6) return 5.0;
    return 6.3;
  }
  if (type.startsWith('biking')) {
    if (speedKmh < 16) return 4.0;
    if (speedKmh < 20) return 6.8;
    if (speedKmh < 24) return 8.0;
    if (speedKmh < 28) return 10.0;
    return 12.0;
  }
  // Swimming MET values (Compendium of Physical Activities 2011)
  if (type.startsWith('swimming')) {
    // speed-based proxy: recreational ~1-2 km/h, competitive ~4-8 km/h
    if (speedKmh < 1.5) return 5.0;  // leisurely
    if (speedKmh < 2.5) return 6.0;  // moderate
    if (speedKmh < 4.0) return 8.3;  // vigorous freestyle
    return 9.8;                        // competitive / sprint
  }
  return 6.0;
}

export function estimateCalories({ type, durationSeconds, distanceMeters,
                                   inclinePercent, weightKg }) {
  if (!durationSeconds || !weightKg) return 0;
  const hours = durationSeconds / 3600;
  const speedKmh = (distanceMeters || 0) / 1000 / hours;
  let met = metForActivity(type, speedKmh);
  if (type === 'running_treadmill' || type === 'walking_treadmill') {
    const inc = Math.min(Math.max(inclinePercent || 0, 0), 15);
    met += inc * 0.6;
  }
  return Math.round(met * weightKg * hours);
}

// Convert the user's stored weight (lbs) to kg for MET formulas.
// The user entity stores weight_lbs as canonical (verified in Onboarding.jsx).
export function userWeightKg(userProfile) {
  const lbs = userProfile?.weight_lbs;
  if (!lbs || lbs <= 0) return 70; // ~154 lbs fallback
  return lbs * 0.45359237;
}