// src/components/dashboard/CalorieProgressWidget.jsx
//
// "Remaining calories for today" — the most-used MyFitnessPal widget.
// Shows: consumed / goal bar + remaining number.
// Macro breakdown row below the bar (protein / carbs / fat).
//
// Calorie goal is computed via nutritionDefaults.js — same formula
// used on the Nutrition page. No extra DB column needed.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Flame, Apple } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '@/api/supabaseClient';
import { calculateDailyValues } from '@/lib/nutritionDefaults';

// NOTE: `today` is computed INSIDE the component (not at module load)
// so a PWA left open overnight transitions to the new day. Otherwise
// `format(new Date(), 'yyyy-MM-dd')` evaluated once at JS-eval time
// would freeze the date string, the query key would never advance, and
// any food logged on day-N+1 would silently miss the cache.

function MacroBar({ label, consumed, goal, color }) {
  const pct = goal > 0 ? Math.min((consumed / goal) * 100, 100) : 0;
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className="text-[10px] font-bold text-foreground">{Math.round(consumed)}g</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function CalorieProgressWidget({ userProfile = {} }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');

  // Today's nutrition logs
  const { data: todayLogs = [] } = useQuery({
    queryKey: ['nutritionToday', user?.email, today],
    queryFn: async () => {
      if (!user?.email) return [];
      const { data } = await supabase
        .from('nutrition_logs')
        .select('calories, protein_g, carbs_g, fat_g, food_name')
        .eq('created_by', user.email)
        .eq('date', today);
      return data || [];
    },
    enabled: !!user?.email,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const goals = useMemo(() => calculateDailyValues(userProfile), [userProfile]);

  const totals = useMemo(() => {
    const calories  = todayLogs.reduce((s, n) => s + (n.calories  || 0), 0);
    const protein_g = todayLogs.reduce((s, n) => s + (n.protein_g || 0), 0);
    const carbs_g   = todayLogs.reduce((s, n) => s + (n.carbs_g   || 0), 0);
    const fat_g     = todayLogs.reduce((s, n) => s + (n.fat_g     || 0), 0);
    return { calories, protein_g, carbs_g, fat_g };
  }, [todayLogs]);

  const calorieGoal  = goals.calories  || 2000;
  const remaining    = Math.max(calorieGoal - Math.round(totals.calories), 0);
  const overBudget   = totals.calories > calorieGoal;
  const pct          = Math.min((totals.calories / calorieGoal) * 100, 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card
        className="p-4 border-border/60 cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => navigate('/nutrition')}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Flame className="w-3.5 h-3.5 text-orange-500" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Calories</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Apple className="w-3 h-3" />
            <span>{todayLogs.filter(l => !/water/i.test(l.food_name || '')).length} logged</span>
          </div>
        </div>

        {/* Big number */}
        <div className="flex items-baseline gap-1.5 mb-2">
          <span className="font-heading font-bold text-3xl leading-none tabular-nums">
            {overBudget ? '+' : ''}{overBudget ? Math.round(totals.calories - calorieGoal) : remaining}
          </span>
          <span className="text-sm text-muted-foreground">
            {overBudget ? 'over budget' : 'kcal remaining'}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-secondary overflow-hidden mb-1.5">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className={`h-full rounded-full ${overBudget ? 'bg-red-500' : pct > 85 ? 'bg-amber-500' : 'bg-orange-500'}`}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mb-3">
          <span>{Math.round(totals.calories)} eaten</span>
          <span>{calorieGoal} goal</span>
        </div>

        {/* Macro row */}
        <div className="flex gap-3">
          <MacroBar
            label="Protein"
            consumed={totals.protein_g}
            goal={goals.protein_g || 150}
            color="bg-red-500"
          />
          <MacroBar
            label="Carbs"
            consumed={totals.carbs_g}
            goal={goals.carbs_g || 200}
            color="bg-amber-500"
          />
          <MacroBar
            label="Fat"
            consumed={totals.fat_g}
            goal={goals.fat_g || 65}
            color="bg-blue-500"
          />
        </div>
      </Card>
    </motion.div>
  );
}
