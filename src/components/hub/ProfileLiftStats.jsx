// src/components/hub/ProfileLiftStats.jsx
//
// Top-3 lifts + total tonnage + longest streak on the Hub profile.
// Pure-client aggregation from the user's existing workout-log query.
// No new schema or queries — just visual polish over the data we
// already cache.

import React, { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Share2 } from 'lucide-react';
import { db } from '@/api/db';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { useNumberFormatter } from '@/lib/intl';
import { buildPRIndex } from '@/lib/data/personalRecords';
import TapToCopy from '@/components/TapToCopy';

const ProfileShareCard = lazy(() => import('./ProfileShareCard'));

export default function ProfileLiftStats({ userEmail, longestStreak, isOwn, username }) {
  const [shareOpen, setShareOpen] = useState(false);
  const { tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const fmt = useNumberFormatter();

  const { data: logs = [] } = useQuery({
    queryKey: ['profileLifts', userEmail],
    queryFn: async () => {
      if (!userEmail) return [];
      try {
        return await db.entities.WorkoutLog.filter({ created_by: userEmail }, '-date', 500);
      } catch { return []; }
    },
    enabled: !!userEmail,
    staleTime: 5 * 60_000,
  });

  const { topLifts, totalVolumeLbs } = useMemo(() => {
    // Build the all-time PR index, then take top 3 by 1RM estimate.
    const idx = buildPRIndex(logs);
    const ranked = Object.entries(idx)
      .filter(([, rm]) => rm > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, rm]) => ({ name, rm }));

    let total = 0;
    for (const log of logs) {
      for (const ex of log?.exercises || []) {
        for (const s of ex?.sets || []) {
          if (s?.is_warmup) continue; // exclude warmups from "tonnage"
          total += (Number(s?.weight) || 0) * (Number(s?.reps) || 0);
        }
      }
    }
    return { topLifts: ranked, totalVolumeLbs: total };
  }, [logs]);

  // Hide entirely on cold profiles — better than three empty stat boxes.
  if (logs.length === 0) return null;

  const tonnageDisplay = (() => {
    const converted = Math.round(fromLbs(totalVolumeLbs, weightUnit));
    if (converted >= 1_000_000) return `${(converted / 1_000_000).toFixed(1)}M`;
    if (converted >= 1_000) return `${(converted / 1000).toFixed(0)}k`;
    return fmt(converted);
  })();
  const unitSuffix = weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lb';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-4"
    >
      {/* Key figures. These were two bordered, filled cards in a 2-up grid —
          a fill AND a border AND a radius doing work that whitespace and
          font weight already do. Three plain numbers read faster and leave
          room for the workout count, which we already had and weren't
          showing. */}
      <div className="flex gap-6 mb-5">
        <TapToCopy value={`${tonnageDisplay} ${unitSuffix}`} label="tonnage">
          <div>
            <p className="font-heading font-bold text-xl tabular-nums leading-none">
              {tonnageDisplay}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {unitSuffix} {tFallback('profileLifts.lifted', 'lifted')}
            </p>
          </div>
        </TapToCopy>
        <TapToCopy value={longestStreak ? `${longestStreak} day streak` : '—'} label="streak">
          <div>
            <p className="font-heading font-bold text-xl tabular-nums leading-none">
              {longestStreak ?? '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {/* "longest", not "day streak". The hero now shows the CURRENT
                  streak, and this is the all-time best — dropping the
                  qualifier in the de-chrome pass left the two reading as the
                  same number disagreeing with itself ("0 day streak" under a
                  "3 days" chip). Different metrics need different words. */}
              {tFallback('profileLifts.longestStreak', 'longest streak')}
            </p>
          </div>
        </TapToCopy>
        <div>
          <p className="font-heading font-bold text-xl tabular-nums leading-none">
            {fmt(logs.length)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {tFallback('profileLifts.workouts', 'workouts')}
          </p>
        </div>
      </div>

      {/* Top 3 lifts. The bar is proportional to the strongest of the three,
          so the shape of someone's training is legible at a glance — a
          bench-dominant lifter and a deadlift-dominant one no longer render
          as the same three rows of text. */}
      {topLifts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {tFallback('profileLifts.topLifts', 'Best lifts')}
            </span>
            <span className="text-xs text-muted-foreground">
              {tFallback('profileLifts.estimated1rm', 'Est. 1RM')}
            </span>
          </div>
          {topLifts.map((lift) => {
            const displayName = lift.name.split(' ').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
            const rmDisplay = `${Math.round(fromLbs(lift.rm, weightUnit))} ${unitSuffix}`;
            // Relative to the top lift, floored so the smallest bar still
            // reads as a bar rather than a dot.
            const pct = Math.max(8, Math.round((lift.rm / topLifts[0].rm) * 100));
            return (
              <TapToCopy
                key={lift.name}
                value={`${displayName} 1RM: ${rmDisplay}`}
                label="PR"
                className="block"
              >
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm truncate">{displayName}</span>
                    <span className="font-heading font-bold text-base tabular-nums shrink-0">
                      {Math.round(fromLbs(lift.rm, weightUnit))}
                      <span className="text-xs font-semibold text-muted-foreground ms-0.5">{unitSuffix}</span>
                    </span>
                  </div>
                  <div className="h-0.5 rounded-full bg-border mt-1.5 overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </TapToCopy>
            );
          })}
        </div>
      )}

      {/* Share-your-stats CTA — own profile only. Lazy-mounts the
          1080×1080 canvas card on demand so the module only ships
          when a user actually taps. */}
      {isOwn && (
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="mt-5 inline-flex items-center gap-1.5 px-4 h-9 rounded-full border border-border hover:bg-secondary transition-colors text-sm font-semibold text-foreground"
        >
          <Share2 className="w-3.5 h-3.5 text-muted-foreground" />
          {tFallback('profileLifts.share', 'Share my stats')}
        </button>
      )}
      {shareOpen && (
        <Suspense fallback={null}>
          <ProfileShareCard
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            profile={{
              username,
              topLifts: topLifts.map(l => ({
                name: l.name.split(' ').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' '),
                value: fromLbs(l.rm, weightUnit),
              })),
              tonnage: fromLbs(totalVolumeLbs, weightUnit),
              streak: longestStreak || 0,
              recentWorkouts: logs.slice(0, 3).map(l => ({
                title: l.regimen_name || 'Workout',
                date:  l.date ? new Date(l.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
              })),
              unit: unitSuffix,
            }}
          />
        </Suspense>
      )}
    </motion.div>
  );
}
