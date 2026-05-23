// src/components/dashboard/HydrationRing.jsx
//
// Apple-Watch-style radial progress ring for today's water intake.
// Reads from nutrition_logs (water entries, same encoding as
// Nutrition.jsx — food_name "Water" or "Water|N" with N oz). Tap →
// /nutrition for quick-add.
//
// Default daily goal: 64 oz (~8 cups). Future enhancement: per-user
// goal stored on user_profiles. For now, the goal is hardcoded — a
// universal-recommendation starting point that 95% of users won't
// argue with.

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Droplet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Card } from '@/components/ui/card';
import { db } from '@/api/db';
import { format } from 'date-fns';

const DEFAULT_GOAL_OZ = 64;

// Same encoding as src/pages/Nutrition.jsx — keep the parser in sync
// if the storage format changes there.
function isWaterEntry(e) {
  return e?.food_name === 'Water' || e?.food_name?.startsWith?.('Water|') || e?.water_oz != null;
}
function waterEntryOz(e) {
  if (e?.water_oz != null) return Number(e.water_oz) || 0;
  if (e?.food_name?.startsWith?.('Water|')) {
    return Number(e.food_name.split('|')[1]) || 8;
  }
  return 8; // default cup size when only "Water" was logged
}

export default function HydrationRing({ goalOz = DEFAULT_GOAL_OZ }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: todaysLogs = [] } = useQuery({
    queryKey: ['hydrationToday', user?.email, today],
    queryFn: async () => {
      if (!user?.email) return [];
      try {
        const all = await db.entities.NutritionLog.filter(
          { created_by: user.email, date: today }, '-created_date', 100
        );
        return all || [];
      } catch (err) {
        // Don't crash render; report so observability catches a real
        // network/RLS regression instead of silently showing 0 oz.
        // Bare `catch { return []; }` previously masked all failures.
        try {
          const { reportError } = await import('@/lib/reportError');
          reportError(err, { feature: 'hydration.fetch', level: 'warning' });
        } catch { /* reportError unavailable — non-critical */ }
        return [];
      }
    },
    enabled: !!user?.email,
    staleTime: 30_000,
  });

  const totalOz = useMemo(
    () => todaysLogs.filter(isWaterEntry).reduce((sum, e) => sum + waterEntryOz(e), 0),
    [todaysLogs]
  );

  const pct = Math.max(0, Math.min(1, totalOz / goalOz));
  const pctLabel = Math.round(pct * 100);

  // Ring geometry — same proportions as the strea/league flames.
  const SIZE = 56;
  const STROKE = 5;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * RADIUS;
  const dashOffset = CIRC * (1 - pct);

  if (!user?.email) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="px-4 py-3 cursor-pointer hover:bg-secondary/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => navigate('/nutrition')}
            role="button"
            tabIndex={0}
            aria-label={tFallback('hydration.openLabel', 'Hydration — tap to open Nutrition')}
            // Accept Space in addition to Enter; the role=button ARIA
            // contract activates on both keys. The bare 'if Enter' check
            // would skip Space, which screen-reader + keyboard users
            // expect to also activate a button.
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate('/nutrition');
              }
            }}
      >
        <div className="flex items-center gap-3">
          <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
            <svg width={SIZE} height={SIZE} className="-rotate-90">
              <circle
                cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
                fill="none"
                stroke="hsl(var(--secondary))"
                strokeWidth={STROKE}
              />
              <motion.circle
                cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
                fill="none"
                stroke="#06b6d4"
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRC}
                initial={{ strokeDashoffset: CIRC }}
                animate={{ strokeDashoffset: dashOffset }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Droplet className="w-4 h-4 text-cyan-500" aria-hidden="true" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-500">
              {tFallback('hydration.kicker', 'Hydration')}
            </p>
            <p className="text-sm font-heading font-bold leading-tight tabular-nums">
              {Math.round(totalOz)} / {goalOz} <span className="text-xs text-muted-foreground">oz</span>
            </p>
            <p className="text-[10px] text-muted-foreground">{pctLabel}% of daily goal</p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
