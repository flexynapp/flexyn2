// src/lib/barInventory.js
//
// User-configurable barbell inventory. Different gyms stock different
// bars (Olympic 45lb, women's Olympic 35lb, EZ-curl 25lb, trap bar
// 60lb, training 15lb, etc.) and a plate calculator that assumes 45lb
// is wrong for ~30% of training contexts.
//
// V1 storage: localStorage per device. The user picks a default bar
// from a preset list (or types a custom weight); the active bar is
// used by SetRow.jsx's plate calculator.
//
// V2 enhancement (future migration): per-gym bar profiles on the
// user_profiles row so a multi-gym user can switch quickly.

const STORAGE_KEY = 'flexyn.activeBarLbs';

export const BAR_PRESETS = [
  { id: 'olympic_45',  label: "Men's Olympic",   lbs: 45 },
  { id: 'olympic_35',  label: "Women's Olympic", lbs: 35 },
  { id: 'ez_curl',     label: 'EZ Curl bar',     lbs: 25 },
  { id: 'training_15', label: 'Training bar',    lbs: 15 },
  { id: 'safety_25',   label: 'Safety squat',    lbs: 25 },
  { id: 'trap_60',     label: 'Trap bar',        lbs: 60 },
  { id: 'dumbbell',    label: 'Dumbbell (none)', lbs: 0  },
];

const DEFAULT_LBS = 45;

export function getActiveBarLbs() {
  try {
    const v = parseFloat(localStorage.getItem(STORAGE_KEY) || '');
    if (Number.isFinite(v) && v >= 0 && v <= 200) return v;
  } catch { /* ignore */ }
  return DEFAULT_LBS;
}

export function setActiveBarLbs(lbs) {
  try {
    if (!Number.isFinite(lbs) || lbs < 0 || lbs > 200) return;
    localStorage.setItem(STORAGE_KEY, String(lbs));
  } catch { /* best-effort */ }
}

/**
 * Compute per-side plate breakdown for a target lift weight. Greedy
 * fill from heaviest plate down. Returns null when target is below
 * the bar weight (no plates needed).
 *
 * @param {number} targetLbs   total target weight including bar
 * @param {number} barLbs      bar weight (defaults to active bar)
 * @param {number[]} plates    plate inventory in lbs (defaults to standard)
 * @returns {Array<{plate, count}> | null}
 */
export function platesPerSide(targetLbs, barLbs = getActiveBarLbs(), plates = [45, 35, 25, 10, 5, 2.5]) {
  if (!Number.isFinite(targetLbs) || targetLbs <= 0) return null;
  if (!Number.isFinite(barLbs) || barLbs < 0) return null;
  if (targetLbs < barLbs) return null;
  let perSide = (targetLbs - barLbs) / 2;
  if (perSide <= 0) return [];
  const result = [];
  for (const plate of plates) {
    if (perSide >= plate) {
      const count = Math.floor(perSide / plate);
      if (count > 0) {
        result.push({ plate, count });
        perSide = Math.round((perSide - count * plate) * 100) / 100;
      }
    }
  }
  return result;
}
