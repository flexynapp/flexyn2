// src/components/crews/CrewStatsPanel.jsx
//
// Shows crew-wide stats for the current week:
//   - Total volume lifted (lbs)
//   - Top performer (most volume)
//   - Best crew PR (highest estimated 1RM, any exercise)

import React from 'react';
import { motion } from 'framer-motion';
import { X, BarChart3, Trophy, Dumbbell, Loader2, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getCrewStats } from '@/lib/data/crews';
import { useNumberFormatter } from '@/lib/intl';

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-secondary/50 border border-border/50">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'hsl(var(--primary) / 0.12)' }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm font-bold text-foreground truncate">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
      </div>
    </div>
  );
}

export default function CrewStatsPanel({ crewId, onClose }) {
  const fmt = useNumberFormatter();
  const { data: stats, isLoading } = useQuery({
    queryKey: ['crewStats', crewId],
    queryFn:  () => getCrewStats(crewId),
    enabled:  !!crewId,
    staleTime: 60_000,
  });

  const fmtVolume = (lbs) => {
    if (!lbs) return `${fmt(0)} lbs`;
    if (lbs >= 1000) return `${fmt(lbs / 1000, { maximumFractionDigits: 1 })}k lbs`;
    return `${fmt(Math.round(lbs))} lbs`;
  };

  const topName = stats?.topPerformer?.profile?.username
    || stats?.topPerformer?.profile?.email?.split('@')[0]
    || '—';
  const topVolume = stats?.topPerformer?.volume
    ? fmtVolume(stats.topPerformer.volume)
    : '0 lbs';

  const prName = stats?.bestPr?.profile?.username
    || stats?.bestPr?.profile?.email?.split('@')[0]
    || '—';
  const prDesc = stats?.bestPr
    ? `${stats.bestPr.exercise} — ${stats.bestPr.weight} lbs × ${stats.bestPr.reps}`
    : '—';

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="absolute inset-0 bg-background z-20 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: 'hsl(var(--primary))' }} />
          <h3 className="font-heading font-bold text-base">Crew Stats</h3>
          <span className="text-[10px] text-muted-foreground">(this week)</span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <StatCard
              icon={<Dumbbell className="w-4 h-4" style={{ color: 'hsl(var(--primary))' }} />}
              label="Total Crew Volume"
              value={fmtVolume(stats?.totalVolumeLbs)}
              sub="combined this week"
            />
            <StatCard
              icon={<Trophy className="w-4 h-4 text-yellow-500" />}
              label="Top Performer"
              value={`@${topName}`}
              sub={topVolume}
            />
            <StatCard
              icon={<Dumbbell className="w-4 h-4 text-rose-500" />}
              label="Best Crew PR"
              value={stats?.bestPr ? `@${prName}` : '—'}
              sub={prDesc}
            />

            {/* Per-member breakdown */}
            {stats?.memberStats?.length > 0 && (
              <div className="pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Users className="w-3 h-3" />
                  Member Breakdown
                </p>
                <div className="space-y-1.5">
                  {[...stats.memberStats]
                    .sort((a, b) => b.volume - a.volume)
                    .map((ms, i) => {
                      const name = ms.profile?.username || ms.profile?.email?.split('@')[0] || ms.userId.slice(0, 8);
                      return (
                        <div key={ms.userId} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/30">
                          <span className="text-[10px] font-bold text-muted-foreground w-4">{i + 1}</span>
                          <span className="flex-1 text-xs font-semibold text-foreground truncate">@{name}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">{fmtVolume(ms.volume)}</span>
                        </div>
                      );
                    })
                  }
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
