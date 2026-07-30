// src/lib/cyclePhase.js
//
// Pure helpers for cycle-phase math. No I/O. Tested via __tests__.
//
// Given a list of period START dates and an optional cycle length
// (default 28), returns:
//   • current phase (menstrual / follicular / ovulation / luteal)
//   • day-of-cycle (1-based — day 1 = period start day)
//   • days until next predicted period
//
// Phase boundaries (relative to a 28-day cycle, scaled when the user
// has overridden `cycle_length_days`):
//   • Menstrual:    days 1-5     (~18%)
//   • Follicular:   days 6-13    (~28%)
//   • Ovulation:    days 14-16   (~11%)
//   • Luteal:       days 17-end  (~43%)
//
// Workout adaptation suggestion mapping:
//   • Menstrual:  light / recovery — lower volume, foam rolling
//   • Follicular: peak strength — bias toward heavier compound sets
//   • Ovulation:  high intensity — sprint / power work
//   • Luteal:     volume tolerance — moderate intensity, longer sets

const DEFAULT_LEN = 28;

export const PHASE = {
  menstrual:  { id: 'menstrual',  label: 'Menstrual',  color: '#dc2626', emoji: '🌸' },
  follicular: { id: 'follicular', label: 'Follicular', color: '#10b981', emoji: '🌱' },
  ovulation:  { id: 'ovulation',  label: 'Ovulation',  color: '#f59e0b', emoji: '⚡' },
  luteal:     { id: 'luteal',     label: 'Luteal',     color: '#7c3aed', emoji: '🌙' },
};

// Phase hints, deliberately hedged.
//
// These used to read as instructions ("Peak strength window — go heavy",
// "Energy is highest here"). That overstates the evidence: a 2023 systematic
// review found no reliable effect of cycle phase on strength performance or
// on training adaptation, and the between-person variation inside a phase is
// larger than the average difference between phases. ACSM's guidance is to
// adapt to symptoms, not to the calendar.
//
// So they now describe a tendency and defer to how the user actually feels.
// The ovulation note is the least hedged of the four because connective-
// tissue laxity around the oestrogen peak has real mechanistic support and a
// documented association with ACL injury risk.
const TRAINING_HINT = {
  menstrual:  'Train as normal if you feel good. If cramps or fatigue hit, lighter cardio and mobility still count.',
  follicular: 'Many people feel strong here — a good week to chase a heavy set, if the warm-up says so.',
  ovulation:  'Ligaments sit a little laxer around now. Warm up thoroughly and stay strict on knee tracking.',
  luteal:     'Effort can run higher for the same weight. Judge sessions by effort, and take the longer rest.',
};

/**
 * Compute the current cycle state.
 * @param {string[]} startDates  ISO date strings (oldest → newest)
 * @param {number}   [cycleLen]  user-overridden cycle length (default 28)
 * @param {Date}     [now]       reference point (default = today)
 * @returns {{ phase: string, dayOfCycle: number, daysUntilNext: number,
 *            phaseMeta: object, hint: string } | null}
 */
export function computeCycleState(startDates, cycleLen = DEFAULT_LEN, now = new Date()) {
  if (!Array.isArray(startDates) || startDates.length === 0) return null;
  const sorted = [...startDates].sort();
  const lastStart = sorted[sorted.length - 1];
  const lastTs   = Date.parse(lastStart);
  if (!Number.isFinite(lastTs)) return null;

  // Day-of-cycle: 1-based. Day 1 = lastStart.
  const ms = now.getTime() - lastTs;
  const dayRaw = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  const len = Math.max(20, Math.min(45, Number(cycleLen) || DEFAULT_LEN));

  // Wrap into the current cycle so a long gap doesn't say "day 73".
  const dayOfCycle = ((dayRaw - 1) % len) + 1;
  const daysUntilNext = Math.max(0, len - dayOfCycle + 1);

  // Phase boundaries scaled to user's cycle length.
  const menstrualEnd  = Math.round(len * 5 / 28);
  const follicularEnd = Math.round(len * 13 / 28);
  const ovulationEnd  = Math.round(len * 16 / 28);

  let phase = 'luteal';
  if (dayOfCycle <= menstrualEnd) phase = 'menstrual';
  else if (dayOfCycle <= follicularEnd) phase = 'follicular';
  else if (dayOfCycle <= ovulationEnd) phase = 'ovulation';

  return {
    phase,
    dayOfCycle,
    daysUntilNext,
    phaseMeta: PHASE[phase],
    hint: TRAINING_HINT[phase],
  };
}
