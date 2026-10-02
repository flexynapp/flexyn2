// src/components/dashboard/CalorieProgressWidget.jsx
//
// "Remaining calories for today" — the most-used MyFitnessPal widget.
// Shows: consumed / goal bar + remaining number.
// Macro breakdown row below the bar (protein / carbs / fat).
//
// Calorie goal is computed via nutritionDefaults.js — same formula
// used on the Nutrition page. No extra DB column needed.

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Flame, Apple } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '@/api/supabaseClient';
import { db } from '@/api/db';
import { useNutritionTargets } from '@/hooks/useNutritionTargets';

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
        <span className="kicker">{label}</span>
        <span className="text-micro font-bold text-foreground">{Math.round(consumed)}g</span>
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
  const { tFallback } = useLanguage();
  const navigate = useNavigate();
  // Re-derive on a 60s tick so a PWA left open across midnight rolls
  // the query key forward instead of forever showing yesterday's
  // totals. The previous render-time format(new Date()) only updated
  // when something else triggered a re-render, which can be never on
  // an idle dashboard.
  const [today, setToday] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  useEffect(() => {
    const id = setInterval(() => {
      const next = format(new Date(), 'yyyy-MM-dd');
      setToday(prev => (prev === next ? prev : next));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Resolve the identity that meals are logged under. Meals are written to
  // nutrition_logs.created_by using db.auth.me().email — which for a guest is
  // guest_<id>@flexyn.guest, and can differ from the raw auth context
  // user.email (empty for anonymous guests). Use db.auth.me() as the
  // authoritative source so the created_by filter always matches saved rows;
  // fall back to context/profile if it isn't available.
  const { data: authEmail = null } = useQuery({
    queryKey: ['authIdentityEmail'],
    queryFn: async () => { try { return (await db.auth.me())?.email || null; } catch { return null; } },
    staleTime: 5 * 60_000,
  });
  const logEmail = authEmail || user?.email || userProfile?.email || null;
  // Rows are read by owner id: an email can change (a guest linking an
  // address), and rows written after that carry the new one.
  const logUserId = user?.id || userProfile?.id || null;
  const { data: todayLogs = [] } = useQuery({
    // Share the SAME query key as src/pages/Nutrition.jsx so that logging a
    // meal on /nutrition invalidates this Dashboard widget too.
    queryKey: ['nutritionLogs', logEmail, today],
    queryFn: async () => {
      if (!logUserId) return [];
      const { data } = await supabase
        .from('nutrition_logs')
        // DB columns are protein/carbs/fat (no _g suffix). Selecting the
        // suffixed names 400'd the whole query, so this widget silently read
        // an empty set and always showed 0 — even after logging a meal.
        .select('calories, protein, carbs, fat, food_name')
        .eq('user_id', logUserId)
        .eq('date', today);
      return data || [];
    },
    enabled: !!logEmail && !!logUserId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const goals = useNutritionTargets(userProfile);

  const totals = useMemo(() => {
    const calories  = todayLogs.reduce((s, n) => s + (n.calories || 0), 0);
    const protein_g = todayLogs.reduce((s, n) => s + (n.protein  || 0), 0);
    const carbs_g   = todayLogs.reduce((s, n) => s + (n.carbs    || 0), 0);
    const fat_g     = todayLogs.reduce((s, n) => s + (n.fat      || 0), 0);
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
      transition={{ duration: 0.22 }}
    >
      <Card
        className="p-4 border-border/60 cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => navigate('/nutrition')}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Flame className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="kicker">{tFallback('calories.kicker', 'Calories')}</span>
          </div>
          <div className="flex items-center gap-1 text-micro text-muted-foreground">
            <Apple className="w-3 h-3" />
            {/* Exact-match check so "watermelon" / "Bottled water flavored"
                aren't excluded by an overly-broad /water/i regex.
                Matches the HydrationRing isWaterEntry contract. (Audit 08 #19.) */}
            <span>{todayLogs.filter(l => {
              const name = l.food_name || '';
              return name !== 'Water' && !name.startsWith('Water|');
            }).length} {tFallback('calories.logged', 'logged')}</span>
          </div>
        </div>

        {/* Big number */}
        <div className="flex items-baseline gap-1.5 mb-2">
          <span className="font-heading font-bold text-3xl leading-none tabular-nums">
            {overBudget ? '+' : ''}{overBudget ? Math.round(totals.calories - calorieGoal) : remaining}
          </span>
          <span className="text-sm text-muted-foreground">
            {overBudget ? tFallback('calories.overBudget', 'over budget') : tFallback('calories.remaining', 'cal remaining')}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-secondary overflow-hidden mb-1.5">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            // Three states, three meanings. This was red / amber / orange;
            // amber and orange both being brand-family collapsed the top
            // two into the same bar once they moved onto tokens, so
            // "closing in on your goal" looked identical to "plenty left".
            // success -> primary -> destructive is a real ramp and stays
            // inside the colour budget.
            className={`h-full rounded-full ${overBudget ? 'bg-destructive' : pct > 85 ? 'bg-primary' : 'bg-success'}`}
          />
        </div>
        <div className="flex justify-between text-micro text-muted-foreground mb-3">
          <span>{Math.round(totals.calories)} {tFallback('calories.eaten', 'eaten')}</span>
          <span>{calorieGoal} {tFallback('calories.goal', 'goal')}</span>
        </div>

        {/* Macro row */}
        <div className="flex gap-3">
          <MacroBar
            label={tFallback('macros.protein', 'Protein')}
            consumed={totals.protein_g}
            goal={goals.protein_g || 150}
            color="bg-destructive"
          />
          <MacroBar
            label={tFallback('macros.carbs', 'Carbs')}
            consumed={totals.carbs_g}
            goal={goals.carbs_g || 200}
            color="bg-primary"
          />
          <MacroBar
            label={tFallback('macros.fat', 'Fat')}
            consumed={totals.fat_g}
            goal={goals.fat_g || 65}
            color="bg-info"
          />
        </div>
      </Card>
    </motion.div>
  );
}
