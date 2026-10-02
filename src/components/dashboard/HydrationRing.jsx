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
//
// Hydration reads cool — the universal "water" semantic (a green
// hydration ring would read as fertility or money). It now draws that
// from --info, the app's one cool hue, rather than owning a private
// cyan: same meaning, one less hue on the screen.
//
// The old STROKE_HYDRATION constant was a literal '#06b6d4' that had to be
// hand-synced with the cyan-{400,500} utilities beside it — a comment
// asking future editors to update two places is a sync bug waiting to
// happen. Referencing the CSS var means the ring and its surrounding
// utilities can no longer drift, and it themes for free.
const STROKE_HYDRATION = 'hsl(var(--info))';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Droplet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Card } from '@/components/ui/card';
import * as nutritionData from '@/lib/data/nutrition';
import { format } from 'date-fns';

const DEFAULT_GOAL_OZ = 64;

// Same encoding as src/pages/Nutrition.jsx — keep the parser in sync
// if the storage format changes there.
function isWaterEntry(e) {
  return e?.food_name === 'Water' || e?.food_name?.startsWith?.('Water|') || e?.water_oz != null;
}
function waterEntryOz(e) {
  // Number.isFinite-based guards instead of `|| N` so a legitimate
  // zero-oz row doesn't get silently bumped to 8oz. (Audit 08 #18.)
  if (e?.water_oz != null) {
    const n = Number(e.water_oz);
    return Number.isFinite(n) ? n : 0;
  }
  if (e?.food_name?.startsWith?.('Water|')) {
    const n = Number(e.food_name.split('|')[1]);
    return Number.isFinite(n) && n > 0 ? n : 8;
  }
  return 8; // default cup size when only "Water" was logged
}

export default function HydrationRing({ goalOz = DEFAULT_GOAL_OZ }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: todaysLogs = [] } = useQuery({
    // Shared key with src/pages/Nutrition.jsx — logging a water entry
    // there invalidates ['nutritionLogs', email, date] which now also
    // covers this widget. The water entries are a subset of nutrition
    // logs (filtered by isWaterEntry below), so reading the same row
    // set is correct.
    queryKey: ['nutritionLogs', user?.email, today],
    queryFn: async () => {
      if (!user?.email) return [];
      try {
        const all = await nutritionData.listForDate(user.id, today, { newestFirst: true });
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

  // Belt-and-suspenders: ensure pct + dashOffset are always finite.
  // The goalOz>0 guard above protects the divide, but a corrupt
  // totalOz (NaN from a malformed water_oz row that slipped past
  // waterEntryOz) would still produce NaN dashOffset and a broken
  // SVG stroke-dasharray render.
  const rawPct = goalOz > 0 ? totalOz / goalOz : 0;
  const pct = Number.isFinite(rawPct) ? Math.max(0, Math.min(1, rawPct)) : 0;
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
      className="h-full"
    >
      <Card className="px-4 py-3 h-full flex items-center min-h-[104px] cursor-pointer hover:bg-secondary/30 active:bg-secondary/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => navigate('/nutrition')}
            role="button"
            tabIndex={0}
            aria-label={tFallback('hydration.openLabel', 'Hydration. Tap to open Nutrition')}
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
        <div className="flex items-center gap-3 w-full">
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
                stroke={STROKE_HYDRATION}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRC}
                initial={{ strokeDashoffset: CIRC }}
                animate={{ strokeDashoffset: dashOffset }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Droplet className="w-4 h-4 text-info" aria-hidden="true" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="kicker text-info">
              {tFallback('hydration.kicker', 'Hydration')}
            </p>
            <p className="text-sm font-heading font-bold leading-tight tabular-nums">
              {Math.round(totalOz)} / {goalOz} <span className="text-xs text-muted-foreground">{tFallback('hydration.unit.oz', 'oz')}</span>
            </p>
            <p className="text-micro text-muted-foreground mb-1.5">
              {tFallback('hydration.dailyGoal', '{pct}% of daily goal', { pct: pctLabel })}
            </p>
            {/* 8-cup progress dots — each dot = goalOz/8 oz */}
            <div
              className="flex gap-1"
              aria-label={tFallback(
                'hydration.cupsAria',
                '{filled} of 8 cups',
                { filled: goalOz > 0 ? Math.min(8, Math.round(totalOz / (goalOz / 8))) : 0 },
              )}
            >
              {Array.from({ length: 8 }, (_, i) => {
                const filled = totalOz >= (goalOz / 8) * (i + 1);
                return (
                  <motion.div
                    key={i}
                    className={`w-3 h-3 rounded-full transition-colors ${filled ? 'bg-info' : 'bg-secondary'}`}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: i * 0.04, duration: 0.2 }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
