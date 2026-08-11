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
import { db } from '@/api/db';
import { useNutritionTargets } from '@/hooks/useNutritionTargets';

// `today` is computed inside the component (see CalorieProgressWidget
// for the rationale — overnight PWA stays open, date string would
// otherwise freeze at module-load time).

// SVG donut ring — a single arc showing pct [0–100]. The progress arc
// sweeps in from empty on mount (framer-motion strokeDashoffset tween),
// staggered per ring, so the macros "draw" beautifully rather than
// snapping to their final fill. Re-keys on pct via `animate` so a new
// meal log re-animates the delta.
function Ring({ r, strokeWidth, pct, color, delay = 0 }) {
  const circumference = 2 * Math.PI * r;
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const target = circumference * (1 - safePct / 100);
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
      {/* Progress — sweeps from empty to `safePct` */}
      <motion.circle
        cx={60} cy={60} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        transform="rotate(-90 60 60)"
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: target }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay }}
      />
    </>
  );
}

const MACROS = [
  { key: 'calories',  label: 'Cal',  unit: 'cal', color: '#F97316', goalKey: 'calories',  r: 50, sw: 9  },
  { key: 'protein_g', label: 'Pro',  unit: 'g',    color: '#EF4444', goalKey: 'protein_g', r: 40, sw: 8  },
  { key: 'carbs_g',   label: 'Carb', unit: 'g',    color: '#F59E0B', goalKey: 'carbs_g',   r: 30, sw: 7  },
  { key: 'fat_g',     label: 'Fat',  unit: 'g',    color: '#3B82F6', goalKey: 'fat_g',     r: 20, sw: 6  },
];

export default function MacroRingWidget({ userProfile = {} }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');

  // Authoritative logging identity (db.auth.me().email) — for a guest this is
  // guest_<id>@flexyn.guest, which the raw auth user.email may not carry. This
  // matches what /nutrition writes to nutrition_logs.created_by.
  const { data: authEmail = null } = useQuery({
    queryKey: ['authIdentityEmail'],
    queryFn: async () => { try { return (await db.auth.me())?.email || null; } catch { return null; } },
    staleTime: 5 * 60_000,
  });
  const logEmail = authEmail || user?.email || userProfile?.email || null;

  const { data: todayLogs = [] } = useQuery({
    // Shared key with src/pages/Nutrition.jsx + CalorieProgressWidget so all
    // three read the same cache. DB columns are protein/carbs/fat (no _g) —
    // selecting the suffixed names 400'd the whole query and read as empty.
    queryKey: ['nutritionLogs', logEmail, today],
    queryFn: async () => {
      if (!logEmail) return [];
      const { data } = await supabase
        .from('nutrition_logs')
        .select('calories, protein, carbs, fat')
        .eq('created_by', logEmail)
        .eq('date', today);
      return data || [];
    },
    enabled: !!logEmail,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const goals   = useNutritionTargets(userProfile);
  const totals  = useMemo(() => ({
    calories:  todayLogs.reduce((s, n) => s + (n.calories || 0), 0),
    protein_g: todayLogs.reduce((s, n) => s + (n.protein  || 0), 0),
    carbs_g:   todayLogs.reduce((s, n) => s + (n.carbs    || 0), 0),
    fat_g:     todayLogs.reduce((s, n) => s + (n.fat      || 0), 0),
  }), [todayLogs]);

  const defaultGoals = { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 65 };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: 0.05 }}
    >
      <Card
        className="p-4 border-border/60 cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => navigate('/nutrition')}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-micro font-bold tracking-[0.04em] text-muted-foreground">Today's Macros</span>
        </div>

        <div className="flex items-center gap-4">
          {/* SVG rings */}
          <div className="shrink-0">
            <svg width="120" height="120" viewBox="0 0 120 120">
              {MACROS.map((m, i) => {
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
                    delay={i * 0.08}
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
              {/* 11px is the floor everywhere else on this screen; an SVG
                  <text> shouldn't get an exemption just because its size is
                  an attribute instead of a class. */}
              <text x="60" y="71" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>
                cal
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
                  <span className="text-micro text-muted-foreground w-8">{m.label}</span>
                  <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(pct, 100)}%`, background: m.color }}
                    />
                  </div>
                  <span className="text-micro font-semibold w-16 text-end tabular-nums">
                    {consumed}{m.unit !== 'cal' ? `/${goal}${m.unit}` : ''}
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
