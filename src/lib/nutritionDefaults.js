// src/lib/nutritionDefaults.js

// ---------- demographic helpers ----------
function ageFromProfile(userProfile = {}) {
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
  return userProfile.age || 30;
}

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  extra: 1.9,
};

// Mifflin-St Jeor BMR — the same formula Cronometer uses.
// Inputs in metric.
function mifflinStJeor({ weightKg, heightCm, age, gender }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (gender === 'female') return base - 161;
  if (gender === 'male') return base + 5;
  // 'other' / unspecified — average of the two sex-specific offsets
  return base - 78;
}

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

// ---------- main export ----------
export function calculateDailyValues(userProfile = {}) {
  const age = ageFromProfile(userProfile);
  const weightLbs = userProfile.weight_lbs || 180;
  const heightInches = userProfile.height_inches || 70;
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

  // No goal set → standard values (preserves prior behavior), but still
  // honor an explicit calorie-cycling override if the user configured one.
  if (!userProfile.nutrition_goal) {
    return applyCalorieCycling(standard, userProfile);
  }

  // ---------- goal-driven calorie & macro calculation ----------
  const bmr = mifflinStJeor({ weightKg, heightCm, age, gender });
  const activity = ACTIVITY_MULTIPLIERS[userProfile.activity_level] ?? ACTIVITY_MULTIPLIERS.moderate;
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

  const protein_g = Math.round(weightLbs * proteinPerLb);
  const proteinKcal = protein_g * 4;

  // Fat: 25% of calories (~0.35 g/lb floor for hormonal health).
  const fatKcal = calories * 0.25;
  const fatFloor_g = Math.round(weightLbs * 0.35);
  const fat_g = Math.max(Math.round(fatKcal / 9), fatFloor_g);
  const fatKcalFinal = fat_g * 9;

  // Carbs: whatever calories remain after protein and fat. Floor at 0.
  const carbsKcal = Math.max(calories - proteinKcal - fatKcalFinal, 0);
  const carbs_g = Math.round(carbsKcal / 4);

  return applyCalorieCycling({
    ...standard,
    calories,
    protein_g,
    carbs_g,
    fat_g,
  }, userProfile);
}