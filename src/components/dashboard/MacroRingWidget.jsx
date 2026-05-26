// src/components/dashboard/MacroRingWidget.jsx
//
// Calories / Protein / Carbs / Fat donut chart for today's macros.
// Four concentric rings — one per macro — so the user sees at a glance
// how close they are on each category.
//
// Uses the same nutrition query + nutritionDefaults as CalorieProgressWidget.
// Designed to be shown alongside or instead of CalorieProgressWidget
// depending on layout.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '@/api/supabaseClient';
import { calculateDailyValues } from '@/lib/nutritionDefaults';

// `today` is computed inside the component (see CalorieProgressWidget
// for the rationale — overnight PWA stays open, date string would
// otherwise freeze at module-load time).

// SVG donut ring — a single arc showing pct [0–100]
function Ring({ r, strokeWidth, pct, color, dashOffset = 0 }) {
  const circumference = 2 * Math.PI * r;
  const arc = (pct / 100) * circumference;
  return (
    <>
      {/* Track */}
      <circle
        cx={60} cy={60} r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-secondary"
      />
      {/* Progress */}
      <circle
        cx={60} cy={60} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${arc} ${circumference}`}
        strokeDashoffset={dashOffset}
        transform="rotate(-90 60 60)"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </>
  );
}

const MACROS = [
  { key: 'calories',  label: 'Cal',  unit: 'kcal', color: '#F97316', goalKey: 'calories',  r: 50, sw: 9  },
  { key: 'protein_g', label: 'Pro',  unit: 'g',    color: '#EF4444', goalKey: 'protein_g', r: 40, sw: 8  },
  { key: 'carbs_g',   label: 'Carb', unit: 'g',    color: '#F59E0B', goalKey: 'carbs_g',   r: 30, sw: 7  },
  { key: 'fat_g',     label: 'Fat',  unit: 'g',    color: '#3B82F6', goalKey: 'fat_g',     r: 20, sw: 6  },
];

export default function MacroRingWidget({ userProfile = {} }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: todayLogs = [] } = useQuery({
    // Shared key with src/pages/Nutrition.jsx — see CalorieProgressWidget
    // for the rationale.
    queryKey: ['nutritionLogs', user?.email, today],
    queryFn: async () => {
      if (!user?.email) return [];
      const { data } = await supabase
        .from('nutrition_logs')
        .select('calories, protein_g, carbs_g, fat_g')
        .eq('created_by', user.email)
        .eq('date', today);
      return data || [];
    },
    enabled: !!user?.email,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const goals   = useMemo(() => calculateDailyValues(userProfile), [userProfile]);
  const totals  = useMemo(() => ({
    calories:  todayLogs.reduce((s, n) => s + (n.calories  || 0), 0),
    protein_g: todayLogs.reduce((s, n) => s + (n.protein_g || 0), 0),
    carbs_g:   todayLogs.reduce((s, n) => s + (n.carbs_g   || 0), 0),
    fat_g:     todayLogs.reduce((s, n) => s + (n.fat_g     || 0), 0),
  }), [todayLogs]);

  const defaultGoals = { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
    >
      <Card
        className="p-4 border-border/60 cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => navigate('/nutrition')}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Today's Macros</span>
        </div>

        <div className="flex items-center gap-4">
          {/* SVG rings */}
          <div className="shrink-0">
            <svg width="120" height="120" viewBox="0 0 120 120">
              {MACROS.map(m => {
                const goal = goals[m.goalKey] || defaultGoals[m.goalKey];
                const consumed = totals[m.key];
                const pct = goal > 0 ? Math.min((consumed / goal) * 100, 100) : 0;
                return (
                  <Ring
                    key={m.key}
                    r={m.r}
                    strokeWidth={m.sw}
                    pct={pct}
                    color={m.color}
                  />
                );
              })}
              {/* Center label. Scale the font down for 4+ digit
                  values so a heavy-eater's "3500" doesn't overflow
                  the 60-unit ring center. (Audit 08 #M-3.) */}
              <text
                x="60"
                y="57"
                textAnchor="middle"
                className="fill-foreground"
                style={{
                  fontSize: Math.round(totals.calories) >= 10000 ? 9 :
                             Math.round(totals.calories) >= 1000 ? 12 : 13,
                  fontWeight: 700,
                  fontFamily: 'var(--font-heading, sans-serif)',
                }}
              >
                {Math.round(totals.calories)}
              </text>
              <text x="60" y="70" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9 }}>
                kcal
              </text>
            </svg>
          </div>

          {/* Legend */}
          <div className="flex-1 space-y-2">
            {MACROS.map(m => {
              const goal = goals[m.goalKey] || defaultGoals[m.goalKey];
              const consumed = Math.round(totals[m.key]);
              const pct = goal > 0 ? Math.round((consumed / goal) * 100) : 0;
              return (
                <div key={m.key} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: m.color }} />
                  <span className="text-[11px] text-muted-foreground w-8">{m.label}</span>
                  <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(pct, 100)}%`, background: m.color }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold w-16 text-end tabular-nums">
                    {consumed}{m.unit !== 'kcal' ? `/${goal}${m.unit}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
