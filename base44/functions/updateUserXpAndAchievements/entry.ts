/*
 * WARNING: This list is duplicated between:
 *   - src/lib/achievementDefinitions.js (client)
 *   - base44/functions/updateUserXpAndAchievements/entry.ts (server)
 * Any change to achievements MUST be applied to BOTH files or they will drift.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ACHIEVEMENT_DEFINITIONS = [
  {
    achievement_id: 'first_regimen',
    name: 'Regimen Builder',
    description: 'Create your first workout regimen',
    icon: '🏗️',
    target: 1,
    category: 'regimen',
    xp_reward: 100,
  },
  {
    achievement_id: 'five_regimens',
    name: 'Playlist Master',
    description: 'Create 5 different workout regimens',
    icon: '📚',
    target: 5,
    category: 'regimen',
    xp_reward: 300,
  },
  {
    achievement_id: 'ten_regimens',
    name: 'Regimen Architect',
    description: 'Create 10 different workout regimens',
    icon: '🏢',
    target: 10,
    category: 'regimen',
    xp_reward: 750,
  },
  {
    achievement_id: 'first_workout',
    name: 'First Steps',
    description: 'Complete your first workout',
    icon: '🚀',
    target: 1,
    category: 'workout',
    xp_reward: 50,
  },
  {
    achievement_id: 'ten_workouts',
    name: 'Consistency Pays Off',
    description: 'Complete 10 workouts',
    icon: '💪',
    target: 10,
    category: 'workout',
    xp_reward: 250,
  },
  {
    achievement_id: 'fifty_workouts',
    name: 'Iron Warrior',
    description: 'Complete 50 workouts',
    icon: '⚔️',
    target: 50,
    category: 'workout',
    xp_reward: 1000,
  },
  {
    achievement_id: 'hundred_workouts',
    name: 'Legendary Grind',
    description: 'Complete 100 workouts',
    icon: '👑',
    target: 100,
    category: 'workout',
    xp_reward: 2500,
  },
  {
    achievement_id: 'five_goals',
    name: 'Goal Getter',
    description: 'Complete 5 fitness goals',
    icon: '🎯',
    target: 5,
    category: 'goal',
    xp_reward: 400,
  },
  {
    achievement_id: 'first_goal',
    name: 'Target Hit',
    description: 'Complete your first fitness goal',
    icon: '🎪',
    target: 1,
    category: 'goal',
    xp_reward: 100,
  },
  {
    achievement_id: 'five_workouts_month',
    name: 'Monthly Warrior',
    description: 'Log 5 workouts in a single month',
    icon: '📅',
    target: 5,
    category: 'milestone',
    xp_reward: 350,
  },
  {
    achievement_id: 'water_intake_week',
    name: 'Hydration Master',
    description: 'Log water intake for 7 consecutive days',
    icon: '💧',
    target: 7,
    category: 'nutrition',
    xp_reward: 200,
  },
  {
    achievement_id: 'one_ton_lifted',
    name: 'Half Ton Club',
    description: 'Lift 1000 lbs total volume in a single workout',
    icon: '🏋️',
    target: 1000,
    category: 'milestone',
    xp_reward: 500,
  },
  {
    achievement_id: 'five_ton_lifted',
    name: 'Five Ton Legend',
    description: 'Lift 5000 lbs total volume in a single workout',
    icon: '🔥',
    target: 5000,
    category: 'milestone',
    xp_reward: 1500,
  },
  {
    achievement_id: 'first_5k',
    name: 'First 5K',
    description: 'Complete a 5-kilometer run',
    icon: '🏃',
    target: 1,
    category: 'cardio',
    xp_reward: 200,
  },
  {
    achievement_id: 'first_10k',
    name: 'First 10K',
    description: 'Complete a 10-kilometer run',
    icon: '🏃‍♂️',
    target: 1,
    category: 'cardio',
    xp_reward: 400,
  },
  {
    achievement_id: 'first_half_marathon',
    name: 'Half Marathoner',
    description: 'Complete a 21.1 km / 13.1 mi run',
    icon: '🥇',
    target: 1,
    category: 'cardio',
    xp_reward: 1000,
  },
  {
    achievement_id: 'cardio_100km_lifetime',
    name: 'Century Club',
    description: 'Cover 100 km lifetime in cardio',
    icon: '💯',
    target: 100,
    category: 'cardio',
    xp_reward: 600,
  },
  {
    achievement_id: 'cardio_streak_7',
    name: 'Cardio Streak',
    description: 'Cardio sessions on 7 consecutive days',
    icon: '🔥',
    target: 7,
    category: 'cardio',
    xp_reward: 300,
  },
  {
    achievement_id: 'first_hour_ride',
    name: 'Hour in the Saddle',
    description: 'Complete a 60-minute bike ride',
    icon: '🚴',
    target: 1,
    category: 'cardio',
    xp_reward: 250,
  },
  {
    achievement_id: 'walking_marathon',
    name: 'Marathon Walker',
    description: 'Walk 42.2 km / 26.2 mi total',
    icon: '🚶',
    target: 42,
    category: 'cardio',
    xp_reward: 800,
  },
  {
    achievement_id: 'first_meal_logged',
    name: 'First Bite',
    description: 'Log your first meal',
    icon: '🥗',
    target: 1,
    category: 'nutrition',
    xp_reward: 50,
  },
  {
    achievement_id: 'fifty_meals_logged',
    name: 'Tracked Plate',
    description: 'Log 50 meals',
    icon: '🍽️',
    target: 50,
    category: 'nutrition',
    xp_reward: 400,
  },
  {
    achievement_id: 'meal_streak_14',
    name: 'Two-Week Streak',
    description: 'Log meals on 14 consecutive days',
    icon: '📆',
    target: 14,
    category: 'nutrition',
    xp_reward: 600,
  },
  {
    achievement_id: 'protein_day_hit',
    name: 'Protein Hit',
    description: 'Hit your daily protein goal',
    icon: '🥩',
    target: 1,
    category: 'nutrition',
    xp_reward: 200,
  },
  {
    achievement_id: 'barcode_scanner',
    name: 'Barcode Pro',
    description: 'Scan your first barcode',
    icon: '📷',
    target: 1,
    category: 'nutrition',
    xp_reward: 150,
  },
  {
    achievement_id: 'first_recipe',
    name: 'Home Cook',
    description: 'Save your first recipe',
    icon: '👩‍🍳',
    target: 1,
    category: 'nutrition',
    xp_reward: 150,
  },
  ];

Deno.serve(async (req) => {
  try {
    const base44Client = createClientFromRequest(req);
    const user = await base44Client.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { xp_gained, action_type, action_data } = await req.json();

    if (xp_gained === undefined || xp_gained === null || xp_gained < 0) {
      return Response.json({ error: 'Invalid XP amount' }, { status: 400 });
    }

    // Server-side XP caps per action — client cannot exceed these regardless of what it sends.
    const XP_CAPS: Record<string, number> = {
      workout_completed:  2000,
      cardio_completed:   1500,
      goal_completed:      500,
      regimen_created:     100,
      water_logged:         50,
    };
    const cap = XP_CAPS[action_type];
    if (cap !== undefined && xp_gained > cap) {
      return Response.json({ error: `XP for ${action_type} cannot exceed ${cap}` }, { status: 400 });
    }

    let adjustedXpGained = xp_gained;

    // Get or create user XP record
    const existingUser = await base44Client.auth.me();
    const currentXp = existingUser?.total_xp || 0;

    // Reset-aware helper — exclude records created before the user's last account reset
    const resetAt = user.account_reset_at
      ? new Date(user.account_reset_at).getTime()
      : 0;
    const isAfterReset = (rec) => {
      if (!resetAt) return true;
      if (!rec?.created_date) return true;
      return new Date(rec.created_date).getTime() >= resetAt;
    };

    // Fetch ALL achievements regardless of reset date — achievements are lifetime milestones
    // and should never be hidden or re-created just because of an account reset.
    const achievements = await base44Client.asServiceRole.entities.Achievement.filter(
      { created_by: user.email }
    );

    const achievementMap = {};
    achievements.forEach((a) => {
      achievementMap[a.achievement_id] = a;
    });

    // Define achievement update logic based on action type
    const updatesToMake = [];

    if (action_type === 'workout_completed' && action_data?.workout_date) {
      const workoutDate = new Date(action_data.workout_date);
      const now = new Date();
      const diffDays = (now - workoutDate) / (1000 * 60 * 60 * 24);
      if (diffDays > 7) {
        // Backdated workout: zero out XP but still fall through so achievements
        // (e.g. first_workout, workout counts) can still be checked and awarded.
        adjustedXpGained = 0;
      }
    }

    if (action_type === 'workout_completed') {
      // Workout-related achievements
      const workoutLogsRaw = await base44Client.asServiceRole.entities.WorkoutLog.filter(
        { created_by: user.email }
      );
      const workoutLogs = workoutLogsRaw.filter(isAfterReset);
      const workoutCount = workoutLogs.length;

      // First workout
      if (workoutCount >= 1 && !achievementMap['first_workout']?.unlocked) {
        updatesToMake.push({
          id: 'first_workout',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }

      // 10 workouts
      if (workoutCount >= 10 && !achievementMap['ten_workouts']?.unlocked) {
        updatesToMake.push({
          id: 'ten_workouts',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: workoutCount },
        });
      }

      // 50 workouts
      if (workoutCount >= 50 && !achievementMap['fifty_workouts']?.unlocked) {
        updatesToMake.push({
          id: 'fifty_workouts',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: workoutCount },
        });
      }

      // 100 workouts
      if (workoutCount >= 100 && !achievementMap['hundred_workouts']?.unlocked) {
        updatesToMake.push({
          id: 'hundred_workouts',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: workoutCount },
        });
      }

      // Update progress for workout achievements
      updatesToMake.push({
        id: 'ten_workouts',
        data: { progress: workoutCount },
      });
      updatesToMake.push({
        id: 'fifty_workouts',
        data: { progress: workoutCount },
      });
      updatesToMake.push({
        id: 'hundred_workouts',
        data: { progress: workoutCount },
      });

      // five_workouts_month: 5 workouts in the current calendar month
      const nowDate = new Date();
      const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).toISOString();
      const workoutsThisMonth = workoutLogs.filter((w) => {
        if (!w.created_date) return false;
        return w.created_date >= monthStart;
      });
      if (workoutsThisMonth.length >= 5 && !achievementMap['five_workouts_month']?.unlocked) {
        updatesToMake.push({
          id: 'five_workouts_month',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: workoutsThisMonth.length },
        });
      }
      updatesToMake.push({
        id: 'five_workouts_month',
        data: { progress: workoutsThisMonth.length },
      });

      // High volume workout
      if (action_data?.totalVolume >= 1000 && !achievementMap['one_ton_lifted']?.unlocked) {
        updatesToMake.push({
          id: 'one_ton_lifted',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }

      if (action_data?.totalVolume >= 5000 && !achievementMap['five_ton_lifted']?.unlocked) {
        updatesToMake.push({
          id: 'five_ton_lifted',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }
    }

    if (action_type === 'regimen_created') {
      const regimensRaw = await base44Client.asServiceRole.entities.Regimen.filter(
        { created_by: user.email }
      );
      const regimens = regimensRaw.filter(isAfterReset);
      const regimenCount = regimens.length;

      // Only award base regimen XP for the first 10 regimens ever created.
      // If user has more than 10, no base XP for additional regimens.
      if (regimenCount > 10) {
        adjustedXpGained = 0;
      }

      if (regimenCount >= 1 && !achievementMap['first_regimen']?.unlocked) {
        updatesToMake.push({
          id: 'first_regimen',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }

      if (regimenCount >= 5 && !achievementMap['five_regimens']?.unlocked) {
        updatesToMake.push({
          id: 'five_regimens',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: regimenCount },
        });
      }

      if (regimenCount >= 10 && !achievementMap['ten_regimens']?.unlocked) {
        updatesToMake.push({
          id: 'ten_regimens',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: regimenCount },
        });
      }

      updatesToMake.push({
        id: 'five_regimens',
        data: { progress: regimenCount },
      });
      updatesToMake.push({
        id: 'ten_regimens',
        data: { progress: regimenCount },
      });
    }

    if (action_type === 'goal_completed') {
      // Guard: if a specific goal_id was supplied, check it isn't already completed.
      // This prevents double-XP when both GoalsModal and GoalsAlmostComplete fire for the same goal.
      if (action_data?.goal_id) {
        const targetGoal = await base44Client.asServiceRole.entities.Goal.get(action_data.goal_id).catch(() => null);
        if (targetGoal?.status === 'completed') {
          // Goal was already completed — skip XP award entirely.
          return Response.json({ success: true, newTotalXp: currentXp, xpGained: 0, note: 'Goal already completed' });
        }
      }

      const goalsRaw = await base44Client.asServiceRole.entities.Goal.filter(
        { created_by: user.email, status: 'completed' },
      );
      const completedGoalCount = goalsRaw.filter(isAfterReset).length;

      if (completedGoalCount >= 1 && !achievementMap['first_goal']?.unlocked) {
        updatesToMake.push({
          id: 'first_goal',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }

      if (completedGoalCount >= 5 && !achievementMap['five_goals']?.unlocked) {
        updatesToMake.push({
          id: 'five_goals',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: completedGoalCount },
        });
      }

      updatesToMake.push({
        id: 'five_goals',
        data: { progress: completedGoalCount },
      });
    }

    if (action_type === 'water_logged') {
      // Rate-limit: only award water XP up to 5 times per calendar day.
      const todayStr = new Date().toISOString().split('T')[0];
      const todayWaterLogs = await base44Client.asServiceRole.entities.NutritionLog.filter({
        created_by: user.email,
        date: todayStr,
      });
      const waterLogsToday = todayWaterLogs.filter((l: any) => l.food_name === 'Water' && l.water_oz > 0);
      const DAILY_WATER_XP_LIMIT = 5;
      if (waterLogsToday.length > DAILY_WATER_XP_LIMIT) {
        // Already hit the daily cap — no XP awarded.
        adjustedXpGained = 0;
      }

      // Achievement: 7-day water streak
      if (action_data?.consecutiveDays >= 7 && !achievementMap['water_intake_week']?.unlocked) {
        updatesToMake.push({
          id: 'water_intake_week',
          data: {
            unlocked: true,
            unlocked_date: new Date().toISOString(),
            progress: action_data.consecutiveDays,
          },
        });
      }
    }

    if (action_type === 'meal_logged') {
      // Count all NutritionLog rows (excluding pure-water entries) that
      // post-date the user's account reset. Same isAfterReset pattern as
      // workouts. Meal logs include barcode scans, manual entries, and
      // saved-recipe re-logs.
      const allMealLogsRaw = await base44Client.asServiceRole.entities.NutritionLog.filter(
        { created_by: user.email }
      );
      const mealLogs = allMealLogsRaw
        .filter(isAfterReset)
        .filter((l: any) => l.food_name !== 'Water');
      const mealCount = mealLogs.length;

      // first_meal_logged
      if (mealCount >= 1 && !achievementMap['first_meal_logged']?.unlocked) {
        updatesToMake.push({
          id: 'first_meal_logged',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }

      // fifty_meals_logged + progress
      if (mealCount >= 50 && !achievementMap['fifty_meals_logged']?.unlocked) {
        updatesToMake.push({
          id: 'fifty_meals_logged',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: mealCount },
        });
      }
      updatesToMake.push({
        id: 'fifty_meals_logged',
        data: { progress: mealCount },
      });

      // meal_streak_14 — 14 consecutive calendar dates with at least
      // one non-water meal log.
      const dates = new Set(mealLogs.map((l: any) => l.date).filter((d: any) => !!d));
      const sorted: string[] = Array.from(dates).sort() as string[];
      let maxStreak = sorted.length > 0 ? 1 : 0;
      let current = sorted.length > 0 ? 1 : 0;
      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1]).getTime();
        const curr = new Date(sorted[i]).getTime();
        const days = (curr - prev) / (1000 * 60 * 60 * 24);
        if (Math.abs(days - 1) < 0.01) {
          current++;
          if (current > maxStreak) maxStreak = current;
        } else {
          current = 1;
        }
      }
      if (maxStreak >= 14 && !achievementMap['meal_streak_14']?.unlocked) {
        updatesToMake.push({
          id: 'meal_streak_14',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: maxStreak },
        });
      }
      updatesToMake.push({
        id: 'meal_streak_14',
        data: { progress: maxStreak },
      });

      // protein_day_hit — client signals via action_data.proteinGoalHit
      if (action_data?.proteinGoalHit && !achievementMap['protein_day_hit']?.unlocked) {
        updatesToMake.push({
          id: 'protein_day_hit',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }

      // barcode_scanner — client signals via action_data.viaBarcode
      if (action_data?.viaBarcode && !achievementMap['barcode_scanner']?.unlocked) {
        updatesToMake.push({
          id: 'barcode_scanner',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }
    }

    if (action_type === 'recipe_created') {
      if (!achievementMap['first_recipe']?.unlocked) {
        updatesToMake.push({
          id: 'first_recipe',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }
    }

    if (action_type === 'cardio_completed') {
      // Recalculate cardio XP server-side — ignore whatever the client sent.
      const durationSec = Number(action_data?.duration_seconds) || 0;
      const distanceMeters = Number(action_data?.distance_meters) || 0;
      const calories = Number(action_data?.calories) || 0;
      if (durationSec > 0) {
        const minutes = durationSec / 60;
        const baseXp    = minutes * 2;
        const distXp    = distanceMeters / 100;
        const calXp     = calories / 10;
        const rawCardioXp = baseXp + distXp + calXp;
        adjustedXpGained = Math.min(Math.round(rawCardioXp), 1500);
      }

      const cardioLogsRaw = await base44Client.asServiceRole.entities.CardioLog.filter(
        { created_by: user.email }
      );
      const cardioLogs = cardioLogsRaw.filter(isAfterReset);

      // first_5k: any single running log >= 5km
      const first5k = cardioLogs.find(c => c.type?.startsWith('running_') && c.distance_meters >= 5000);
      if (first5k && !achievementMap['first_5k']?.unlocked) {
        updatesToMake.push({
          id: 'first_5k',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }

      // first_10k: any single running log >= 10km
      const first10k = cardioLogs.find(c => c.type?.startsWith('running_') && c.distance_meters >= 10000);
      if (first10k && !achievementMap['first_10k']?.unlocked) {
        updatesToMake.push({
          id: 'first_10k',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }

      // first_half_marathon: any single running log >= 21.1km
      const firstHalf = cardioLogs.find(c => c.type?.startsWith('running_') && c.distance_meters >= 21097.5);
      if (firstHalf && !achievementMap['first_half_marathon']?.unlocked) {
        updatesToMake.push({
          id: 'first_half_marathon',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }

      // cardio_100km_lifetime: sum of all cardio >= 100km
      const totalCardioDistance = cardioLogs.reduce((sum, c) => sum + (c.distance_meters || 0), 0);
      if (totalCardioDistance >= 100000 && !achievementMap['cardio_100km_lifetime']?.unlocked) {
        updatesToMake.push({
          id: 'cardio_100km_lifetime',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: Math.round(totalCardioDistance / 1000) },
        });
      }
      updatesToMake.push({
        id: 'cardio_100km_lifetime',
        data: { progress: Math.round(totalCardioDistance / 1000) },
      });

      // cardio_streak_7: 7 consecutive calendar dates with at least one cardio log
      const dates = new Set(cardioLogs.map(c => c.date).filter(d => d));
      let maxStreak = 0;
      let currentStreak = 1;
      const sortedDates = Array.from(dates).sort();
      for (let i = 1; i < sortedDates.length; i++) {
        const prev = new Date(sortedDates[i - 1]);
        const curr = new Date(sortedDates[i]);
        const daysDiff = (curr - prev) / (1000 * 60 * 60 * 24);
        if (Math.abs(daysDiff - 1) < 0.01) {
          currentStreak++;
          maxStreak = Math.max(maxStreak, currentStreak);
        } else {
          currentStreak = 1;
        }
      }
      if (maxStreak >= 7 && !achievementMap['cardio_streak_7']?.unlocked) {
        updatesToMake.push({
          id: 'cardio_streak_7',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: maxStreak },
        });
      }
      updatesToMake.push({
        id: 'cardio_streak_7',
        data: { progress: maxStreak },
      });

      // first_hour_ride: any single biking log >= 3600 seconds
      const firstHourRide = cardioLogs.find(c => c.type?.startsWith('biking_') && c.duration_seconds >= 3600);
      if (firstHourRide && !achievementMap['first_hour_ride']?.unlocked) {
        updatesToMake.push({
          id: 'first_hour_ride',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: 1 },
        });
      }

      // walking_marathon: sum of all walking logs >= 42.195km
      const totalWalkingDistance = cardioLogs
        .filter(c => c.type?.startsWith('walking_'))
        .reduce((sum, c) => sum + (c.distance_meters || 0), 0);
      if (totalWalkingDistance >= 42195 && !achievementMap['walking_marathon']?.unlocked) {
        updatesToMake.push({
          id: 'walking_marathon',
          data: { unlocked: true, unlocked_date: new Date().toISOString(), progress: Math.round(totalWalkingDistance / 1000) },
        });
      }
      updatesToMake.push({
        id: 'walking_marathon',
        data: { progress: Math.round(totalWalkingDistance / 1000) },
      });
    }

    // Apply XP (after action blocks so adjustedXpGained may have been modified)
    const newTotalXp = currentXp + adjustedXpGained;
    await base44Client.auth.updateMe({ total_xp: newTotalXp });

    // Apply all achievement updates
    for (const update of updatesToMake) {
      const existingAch = achievementMap[update.id];
      if (existingAch) {
        await base44Client.asServiceRole.entities.Achievement.update(existingAch.id, update.data);
      } else {
        // Create new achievement record
        const def = ACHIEVEMENT_DEFINITIONS.find((a) => a.achievement_id === update.id);
        if (def) {
          await base44Client.asServiceRole.entities.Achievement.create({
            created_by: user.email,
            achievement_id: update.id,
            name: def.name,
            description: def.description,
            icon: def.icon,
            target: def.target,
            category: def.category,
            xp_reward: def.xp_reward,
            ...update.data,
          });
        }
      }
    }

    return Response.json({
      success: true,
      newTotalXp,
      xpGained: adjustedXpGained,
      achievementsUpdated: updatesToMake.length,
    });
  } catch (error) {
    console.error('Error updating XP and achievements:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});