// src/lib/nutritionDefaults.js

import { calcBMR, activityMultiplier } from '@/lib/tdee';

// ---------- demographic helpers ----------
/** The user's age, or null when neither `birthday` nor `age` is set. */
function ageOrNull(userProfile = {}) {
  if (userProfile.birthday) {
    const birth = new Date(userProfile.birthday);
    if (!isNaN(birth.getTime())) {
      const now = new Date();
      let years = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
      return years;
    }
  }
  return userProfile.age || null;
}

// 30 is a placeholder for the RDA rows, which need *some* age to pick a
// band. It must never reach a calorie figure — see the guard in
// maintenanceCalories().
function ageFromProfile(userProfile = {}) {
  return ageOrNull(userProfile) ?? 30;
}

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  extra: 1.9,
};

// BMR is `calcBMR` from src/lib/tdee.js — the same one the Progress →
// Insights card uses, so the two screens cannot report different
// maintenance figures for the same person. The local copy that used to
// live here had an identical formula and an unreachable "'other' /
// unspecified" branch: `gender` was normalised to 'male' at the top of
// calculateDailyValues before it ever got here, so every profile without a
// stated gender took the male term.

// Compute weekly rate (lbs/week) from current weight, target weight, and target date.
// Returns negative for loss, positive for gain, 0 for maintain or invalid input.
function computeWeeklyRate({ goal, currentLbs, targetLbs, targetDate }) {
  if (goal === 'maintain') return 0;
  if (!targetLbs || !targetDate || !currentLbs) return 0;
  const target = new Date(targetDate);
  if (isNaN(target.getTime())) return 0;
  const now = new Date();
  const weeks = (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 7);
  if (weeks <= 0) return 0;
  return (targetLbs - currentLbs) / weeks;
}

// Clamp weekly rate to safe ranges, preserving sign.
// Cut:  up to 1% bodyweight per week, hard cap 2.0 lb/wk
// Bulk: 0.25–1.0 lb/wk recommended, hard cap 1.5 lb/wk
function clampWeeklyRate(rate, currentLbs) {
  if (rate === 0) return 0;
  if (rate < 0) {
    const onePct = currentLbs ? -(currentLbs * 0.01) : -2.0;
    const safeFloor = Math.max(onePct, -2.0); // most negative allowed
    return Math.max(rate, safeFloor); // rate is negative, don't go below floor
  }
  return Math.min(rate, 1.5);
}

// Local calendar date as 'yyyy-MM-dd' — matches how last_workout_date is
// stored (advance_workout_streak writes format(new Date(), 'yyyy-MM-dd')).
function localTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Apply per-day-type calorie cycling on top of the computed base targets.
// Config lives on user_profiles.calorie_cycling as
//   { training: { calories, protein_g, carbs_g, fat_g }, rest: {…} }
// A "training day" = the user logged a workout today. last_workout_date is
// maintained by advance_workout_streak on every workout save, so we read it
// straight off the profile — no extra query, no prop threading, so every
// consumer of calculateDailyValues (CalorieTopBar, MacroNutrientBox,
// MineralsVitaminsBox) reflects the cycled target automatically. Only the
// macro/calorie keys the user actually set override; micros and unset
// macros keep their computed value. Mirrors resolveToday() in
// src/lib/data/calorieCycling.js (kept inline to keep this module
// dependency-free — it's imported widely).
const CYCLE_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g'];
function applyCalorieCycling(base, userProfile) {
  const cycling = userProfile.calorie_cycling;
  if (!cycling || (cycling.training == null && cycling.rest == null)) return base;
  const hadWorkoutToday = !!userProfile.last_workout_date &&
    userProfile.last_workout_date === localTodayStr();
  const branch = hadWorkoutToday ? cycling.training : cycling.rest;
  if (!branch) return base;
  const out = { ...base };
  for (const k of CYCLE_KEYS) {
    const v = branch[k];
    if (v != null && v !== '' && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}

// Split calories into macros. Protein is per-bodyweight, fat is 25% of
// intake with a 0.35 g/lb floor for hormonal health, carbs take what's
// left. Factored out so the goal-driven and maintenance branches cannot
// derive the same split two different ways.
function macrosFor({ calories, weightLbs, proteinPerLb }) {
  const protein_g = Math.round(weightLbs * proteinPerLb);
  const fatFloor_g = Math.round(weightLbs * 0.35);
  const fat_g = Math.max(Math.round((calories * 0.25) / 9), fatFloor_g);
  const carbsKcal = Math.max(calories - protein_g * 4 - fat_g * 9, 0);
  return { protein_g, fat_g, carbs_g: Math.round(carbsKcal / 4) };
}

/**
 * Maintenance calories from measured demographics and observed training,
 * or null when we do not have enough to say.
 *
 * The null is the point. `calculateDailyValues` fills missing demographics
 * with 180 lb / 70 in / 30 yr so the RDA rows have something to branch on,
 * and those placeholders must never reach a calorie figure — a TDEE
 * computed from them is indistinguishable on screen from a real one, which
 * is strictly worse than the honest 2000 kcal default. So this reads the
 * profile directly rather than the defaulted locals, and bails if any of
 * the three is absent.
 *
 * `sessionsPerWeek` comes from the caller because this module is imported
 * by eight components and is deliberately dependency-free. Absent it, we
 * have no activity term and fall back the same way.
 */
function maintenanceCalories({ userProfile, sessionsPerWeek }) {
  if (!Number.isFinite(sessionsPerWeek)) return null;
  const age = ageOrNull(userProfile);
  const weightLbs = userProfile.weight_lbs;
  const heightInches = userProfile.height_inches;
  if (!age || !weightLbs || !heightInches) return null;

  const bmr = calcBMR({
    weightKg: weightLbs * 0.453592,
    heightCm: heightInches * 2.54,
    age,
    sex: (userProfile.gender || '').toLowerCase(),
  });
  if (!bmr) return null;

  return Math.round(bmr * activityMultiplier(sessionsPerWeek));
}

// ---------- main export ----------
/**
 * @param userProfile  the user_profiles row
 * @param options.sessionsPerWeek  observed sessions/week over the trailing
 *   window (see observedSessionsPerWeek in src/lib/tdee.js). Optional: when
 *   omitted, a profile with no nutrition goal keeps the flat 2000 kcal
 *   default, which is exactly the behaviour every caller had before.
 */
export function calculateDailyValues(userProfile = {}, { sessionsPerWeek } = {}) {
  const age = ageFromProfile(userProfile);
  const weightLbs = userProfile.weight_lbs || 180;
  const heightInches = userProfile.height_inches || 70;
  // `gender` drives the RDA rows below, which are `=== 'female'` tests, and
  // keeps its long-standing male default: moving the unknown case there
  // would quietly shift iron, magnesium and vitamin C targets, which is a
  // separate question from how many calories someone burns.
  //
  // The BMR path does NOT use it. Mifflin-St Jeor's sex term is passed
  // through raw so calcBMR's midpoint branch is reachable — collapsing
  // unknown into male here is what made it dead code.
  const gender = userProfile.gender || 'male';

  const weightKg = weightLbs * 0.453592;
  const heightCm = heightInches * 2.54;

  // Standard FDA Daily Values — unchanged from previous implementation.
  // Used for vitamins/minerals and as fallback when no nutrition goal is set.
  const standard = {
    calories: 2000,
    protein_g: Math.round(weightLbs * 0.8),
    carbs_g: 300,
    fat_g: 78,
    sodium_mg: 2300,
    fiber_g: 25,
    sugar_g: 50,
    cholesterol_mg: 300,
    iron_mg: gender === 'female' && age < 51 ? 18 : 8,
    magnesium_mg: gender === 'female' ? 310 : 400,
    calcium_mg: age < 51 ? 1000 : 1200,
    potassium_mg: 3500,
    vitamin_a_iu: 5000,
    vitamin_c_mg: gender === 'female' ? 75 : 90,
    vitamin_d_iu: 600,
    vitamin_b12_mcg: 2.4,
  };

  // No goal set. Nutrition onboarding has a 0% completion rate (audit 21),
  // so this is the branch essentially every account takes — it is the
  // product, not a fallback.
  //
  // If we can measure the user, do: maintenance from their own BMR and
  // their own training frequency, which is the same figure Progress →
  // Insights already shows them. Otherwise keep the flat 2000, which is at
  // least honestly generic rather than a guess wearing a real number's
  // clothes. Either way an explicit calorie-cycling override still wins.
  if (!userProfile.nutrition_goal) {
    const maintenance = maintenanceCalories({ userProfile, sessionsPerWeek });
    if (maintenance == null) return applyCalorieCycling(standard, userProfile);
    return applyCalorieCycling({
      ...standard,
      calories: maintenance,
      // Same 0.8 g/lb the 'maintain' goal uses — no deficit, no surplus,
      // so there is no reason for the split to differ from it.
      ...macrosFor({ calories: maintenance, weightLbs, proteinPerLb: 0.8 }),
    }, userProfile);
  }

  // ---------- goal-driven calorie & macro calculation ----------
  // Raw sex, not the male-defaulted `gender` — see the note where `gender`
  // is declared.
  const bmr = calcBMR({
    weightKg, heightCm, age,
    sex: (userProfile.gender || '').toLowerCase(),
  });
  // A stated activity_level still wins here: someone who set a goal told us
  // what they do, and their own answer outranks our inference. Observed
  // training is the fallback, and the old blanket `moderate` is the last
  // resort rather than the usual outcome.
  const activity = ACTIVITY_MULTIPLIERS[userProfile.activity_level]
    ?? (Number.isFinite(sessionsPerWeek) ? activityMultiplier(sessionsPerWeek) : null)
    ?? ACTIVITY_MULTIPLIERS.moderate;
  const tdee = bmr * activity;

  // Determine weekly rate: prefer explicit weekly_rate_lbs if stored,
  // otherwise derive from target weight + target date.
  let weeklyRate;
  if (typeof userProfile.weekly_rate_lbs === 'number') {
    weeklyRate = userProfile.weekly_rate_lbs;
  } else {
    weeklyRate = computeWeeklyRate({
      goal: userProfile.nutrition_goal,
      currentLbs: weightLbs,
      targetLbs: userProfile.target_weight_lbs,
      targetDate: userProfile.target_date,
    });
  }
  weeklyRate = clampWeeklyRate(weeklyRate, weightLbs);

  // 3500 kcal ≈ 1 lb of bodyweight. Daily delta = weeklyRate * 3500 / 7.
  const dailyDelta = (weeklyRate * 3500) / 7;
  let calories = Math.round(tdee + dailyDelta);

  // Safety floors so dangerous deficits aren't shown as targets.
  const minCalories = gender === 'female' ? 1200 : 1500;
  if (calories < minCalories) calories = minCalories;

  // Macro splits tuned for goal:
  //   cut:      higher protein to preserve muscle in deficit
  //   bulk:     elevated protein for growth, more carbs for training
  //   maintain: standard 0.8 g/lb
  const proteinPerLb =
    userProfile.nutrition_goal === 'lose' ? 1.0 :
    userProfile.nutrition_goal === 'gain' ? 0.9 :
    0.8;

  return applyCalorieCycling({
    ...standard,
    calories,
    ...macrosFor({ calories, weightLbs, proteinPerLb }),
  }, userProfile);
}