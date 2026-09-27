// src/hooks/useTodayFuel.js
//
// Today's calories and water against the day's targets. Read by the Today
// screen's glance and by the + sheet's water panel (navigation redesign,
// phases 3 and 4), so the number you see after tapping "+ glass" is the
// same number Today shows.
//
// The query key extends the Nutrition page's ['nutritionLogs', email, date]
// rather than reusing it. This selects four columns; sharing the exact key
// would hand the Nutrition page these partial rows from cache. The longer
// key still matches every invalidate that page issues, because react query
// matches keys by prefix, so logging a meal there refreshes this too.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/api/supabaseClient';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useNutritionTargets } from '@/hooks/useNutritionTargets';
import { isWaterEntry, waterEntryOz } from '@/lib/waterEntries';
import { filterAfterReset } from '@/lib/accountReset';
import { dailyWaterGoalOz } from '@/lib/waterGoal';

export const todayKey = () => format(new Date(), 'yyyy-MM-dd');

export function summariseFuel(entries = []) {
  let calories = 0;
  let waterOz = 0;
  for (const e of entries) {
    if (isWaterEntry(e)) waterOz += waterEntryOz(e);
    else calories += Number(e.calories) || 0;
  }
  return { calories: Math.round(calories), waterOz: Math.round(waterOz) };
}

export function useTodayFuel(userProfile = {}) {
  const { user } = useAuth();
  const [today, setToday] = useState(todayKey);
  useEffect(() => {
    const id = setInterval(() => {
      const next = todayKey();
      setToday((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Meals are written under db.auth.me().email, which for a guest differs
  // from the auth context's (empty) email. Same resolution as the Nutrition
  // page and CalorieProgressWidget.
  const { data: authEmail = null } = useQuery({
    queryKey: ['authIdentityEmail'],
    queryFn: async () => { try { return (await db.auth.me())?.email || null; } catch { return null; } },
    staleTime: 5 * 60_000,
  });
  const logEmail = authEmail || user?.email || userProfile?.email || null;
  // Rows are read by owner id: an email can change (a guest linking an
  // address), and rows written after that carry the new one.
  const logUserId = user?.id || userProfile?.id || null;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['nutritionLogs', logEmail, today, 'todayGlance'],
    queryFn: async () => {
      const { data } = await supabase
        .from('nutrition_logs')
        .select('calories, food_name, meal_type, created_at')
        .eq('user_id', logUserId)
        .eq('date', today);
      return data || [];
    },
    enabled: !!logEmail && !!logUserId,
    staleTime: 60_000,
  });

  const visible = useMemo(() => filterAfterReset(rows, userProfile), [rows, userProfile]);
  const { calories, waterOz } = useMemo(() => summariseFuel(visible), [visible]);
  const targets = useNutritionTargets(userProfile);
  return {
    today,
    logEmail,
    isLoading,
    visible,
    calories,
    waterOz,
    calorieGoal: Math.round(Number(targets?.calories) || 2000),
    waterGoal: dailyWaterGoalOz(userProfile),
  };
}
