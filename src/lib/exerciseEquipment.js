// src/lib/exerciseEquipment.js
//
// Classifies an exercise into an equipment category from its NAME so
// the picker can filter by what the user actually has. Avoids re-
// tagging every entry in EXERCISE_LIBRARY (400+ items) — name regex
// is the cheapest correct approach and lines up with how users
// already think about their exercises.
//
// Categories returned:
//   • 'barbell'    — barbell rows, bench, squat, deadlift, OHP, …
//   • 'dumbbell'   — DB curls, DB bench, DB row, …
//   • 'cable'      — cable lat pull, cable fly, …
//   • 'machine'    — leg press, hack squat, smith, pec deck, …
//   • 'bodyweight' — pull-up, push-up, dip, plank, …
//   • 'kettlebell' — KB swing, KB clean, …
//   • 'band'       — band pull-apart, band-assisted, …
//   • 'cardio'     — run, bike, row, swim, jump rope (rare in main lib)
//   • 'other'      — fallback

// Order matters: kettlebell / dumbbell / cable patterns are checked
// BEFORE generic barbell-implying words so "Dumbbell Row" / "Cable
// Row" don't accidentally route to cardio. Cardio's "row" pattern
// requires "rowing" or "row machine" / "row erg" — bare "row" is
// usually a strength row.
const PATTERNS = [
  { kind: 'bodyweight', regex: /\b(pull[- ]?up|chin[- ]?up|push[- ]?up|dip|muscle[- ]?up|plank|burpee|pistol squat|handstand|air squat|sit[- ]?up|crunch|leg raise|hanging|inverted row)\b/i },
  { kind: 'kettlebell', regex: /\b(kettlebell|kb )\b/i },
  { kind: 'band',       regex: /\b(band|tube)\b/i },
  { kind: 'cable',      regex: /\b(cable|pulley)\b/i },
  { kind: 'machine',    regex: /\b(machine|smith|hack|leg press|leg curl|leg extension|seated row machine|pec deck|chest press machine|hammer strength|sled)\b/i },
  { kind: 'dumbbell',   regex: /\b(dumbbell|db )\b/i },
  { kind: 'barbell',    regex: /\b(barbell|bb |trap bar|ez[- ]?bar|olympic|deadlift|squat|bench press|overhead press|romanian|good morning|clean|snatch|jerk|front squat|back squat|sumo)\b/i },
  { kind: 'cardio',     regex: /(\b(jog(?:ging)?|sprint(?:ing)?|cycl(?:e|ing)|swim(?:ming)?|treadmill|elliptical)\b|\brun(?:ning)?\b|\browing\b|\brow (?:machine|erg)\b|\bjump rope\b)/i },
];

export function classifyEquipment(name) {
  const lc = String(name || '');
  for (const { kind, regex } of PATTERNS) {
    if (regex.test(lc)) return kind;
  }
  return 'other';
}

// Display metadata for the filter pill row. `label` is the English fallback
// for `exerciseEquip.filter.<id>`, resolved where the pills render.
export const EQUIPMENT_FILTERS = [
  { id: 'all',        label: 'All' },
  { id: 'barbell',    label: 'Barbell' },
  { id: 'dumbbell',   label: 'Dumbbell' },
  { id: 'machine',    label: 'Machine' },
  { id: 'cable',      label: 'Cable' },
  { id: 'bodyweight', label: 'Bodyweight' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'band',       label: 'Band' },
];

/** True when the exercise's classified kind matches the chosen filter. */
export function matchesEquipment(exerciseName, filterId) {
  if (!filterId || filterId === 'all') return true;
  return classifyEquipment(exerciseName) === filterId;
}
