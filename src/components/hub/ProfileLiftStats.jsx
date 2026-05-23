// src/components/hub/ProfileLiftStats.jsx
//
// Top-3 lifts + total tonnage + longest streak on the Hub profile.
// Pure-client aggregation from the user's existing workout-log query.
// No new schema or queries — just visual polish over the data we
// already cache.

import React, { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Trophy, Activity, Flame, Share2 } from 'lucide-react';
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
      {/* Tonnage + longest-streak row */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-2xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Activity className="w-3 h-3 text-emerald-500" aria-hidden="true" />
            {tFallback('profileLifts.tonnage', 'Total tonnage')}
          </div>
          <TapToCopy
            value={`${tonnageDisplay} ${unitSuffix}`}
            label="tonnage"
          >
            <p className="font-heading font-black text-lg tabular-nums mt-0.5">
              {tonnageDisplay} <span className="text-xs text-muted-foreground">{unitSuffix}</span>
            </p>
          </TapToCopy>
        </div>
        <div className="rounded-2xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Flame className="w-3 h-3 text-orange-500" aria-hidden="true" />
            {tFallback('profileLifts.longestStreak', 'Longest streak')}
          </div>
          <TapToCopy
            value={longestStreak ? `${longestStreak} day streak` : '—'}
            label="streak"
          >
            <p className="font-heading font-black text-lg tabular-nums mt-0.5">
              {longestStreak ?? '—'} <span className="text-xs text-muted-foreground">{tFallback('profileLifts.days', 'days')}</span>
            </p>
          </TapToCopy>
        </div>
      </div>

      {/* Top 3 lifts */}
      {topLifts.length > 0 && (
        <div className="rounded-2xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            <Trophy className="w-3 h-3 text-amber-500" aria-hidden="true" />
            {tFallback('profileLifts.topLifts', 'Top lifts')}
          </div>
          <div className="space-y-1">
            {topLifts.map((lift, i) => {
              const displayName = lift.name.split(' ').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
              const rmDisplay = `${Math.round(fromLbs(lift.rm, weightUnit))} ${unitSuffix}`;
              return (
                <TapToCopy
                  key={lift.name}
                  value={`${displayName} 1RM: ${rmDisplay}`}
                  label="PR"
                  className="block"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">
                      <span className="text-muted-foreground tabular-nums mr-1.5">#{i + 1}</span>
                      {displayName}
                    </span>
                    <span className="text-xs font-bold tabular-nums">{rmDisplay}</span>
                  </div>
                </TapToCopy>
              );
            })}
          </div>
        </div>
      )}

      {/* Share-your-stats CTA — own profile only. Lazy-mounts the
          1080×1080 canvas card on demand so the module only ships
          when a user actually taps. */}
      {isOwn && (
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border bg-card hover:bg-secondary/50 transition-colors text-xs font-bold uppercase tracking-wider text-foreground"
        >
          <Share2 className="w-3.5 h-3.5" />
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
