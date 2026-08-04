// src/components/hub/FriendLeaderboardPanel.jsx
//
// Weekly friend leaderboard scoped to mutual follows (migration 093).
// Three sort modes via toggle: XP / Volume / Sessions. The caller's
// row is highlighted and always present even if they wouldn't make
// the cutoff — seeing your own rank is the whole point.

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Crown, Flame, Activity, Calendar as CalendarIcon, Users, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { useNumberFormatter } from '@/lib/intl';
import { getFriendLeaderboard } from '@/lib/data/friendLeaderboard';

const MODES = [
  { id: 'weekly_xp',       label: 'XP',       icon: Flame    },
  { id: 'weekly_volume',   label: 'Volume',   icon: Activity },
  { id: 'weekly_sessions', label: 'Sessions', icon: CalendarIcon },
];

function rankAccent(rank, isSelf) {
  if (isSelf) return 'bg-primary/10 border-primary/30';
  if (rank === 1) return 'bg-primary/10 border-primary/30';
  if (rank === 2) return 'bg-slate-400/10 border-slate-400/30';
  if (rank === 3) return 'bg-primary/10 border-primary/30';
  return 'bg-secondary/40 border-transparent';
}

function rankColor(rank) {
  if (rank === 1) return 'text-primary';
  if (rank === 2) return 'text-slate-400';
  if (rank === 3) return 'text-primary';
  return 'text-muted-foreground';
}

function ScoreCell({ row, mode, weightUnit, fmt }) {
  if (mode === 'weekly_xp') {
    return <span className="tabular-nums">{fmt(row.weekly_xp)} XP</span>;
  }
  if (mode === 'weekly_sessions') {
    return <span className="tabular-nums">{row.weekly_sessions}</span>;
  }
  // weekly_volume — convert from lbs to user's unit
  const vol = Math.round(fromLbs(Number(row.weekly_volume) || 0, weightUnit));
  const unitSuffix = weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lb';
  return <span className="tabular-nums">{fmt(vol)} {unitSuffix}</span>;
}

export default function FriendLeaderboardPanel() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const fmt = useNumberFormatter();
  const [mode, setMode] = useState('weekly_xp');
  // Default-collapsed per user feedback — the leaderboard sits below
  // Stories, and showing the top-4 by default is too tall on mobile.
  // Tap the header to expand; mode toggles only render when expanded.
  const [expanded, setExpanded] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['friendLeaderboard', user?.id, mode],
    queryFn:  () => getFriendLeaderboard({ mode, limit: 20 }),
    enabled:  !!user?.id && expanded,   // don't fetch until the user expands
    staleTime: 5 * 60_000,
  });

  if (!user?.id) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-border bg-card overflow-hidden mb-4"
    >
      {/* Header is a clickable div (not a <button>) so the mode-toggle buttons
          can nest inside it without invalid button-in-button DOM. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
        aria-expanded={expanded}
        className={`w-full px-4 py-2 flex items-center justify-between text-start cursor-pointer select-none ${expanded ? 'border-b border-border' : ''}`}
      >
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          <h3 className="font-heading font-bold text-xs tracking-wide">
            {tFallback('friendLeaderboard.title', 'Friend Leaderboard This Week')}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {expanded && MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={(e) => { e.stopPropagation(); setMode(id); }}
              aria-pressed={mode === id}
              className={[
                'px-2 py-1 rounded-md text-micro font-bold uppercase tracking-wider transition-colors flex items-center gap-1',
                mode === id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              <Icon className="w-3 h-3" aria-hidden="true" />
              {tFallback(`friendLeaderboard.mode.${id}`, label)}
            </button>
          ))}
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </div>
      </div>

      {expanded && (
      <div className="px-3 py-2">
        {isLoading && (
          <div className="py-6 text-center text-micro text-muted-foreground">
            {tFallback('friendLeaderboard.loading', 'Loading…')}
          </div>
        )}
        {!isLoading && rows.length === 0 && (
          <div className="py-6 text-center text-micro text-muted-foreground">
            {tFallback('friendLeaderboard.empty', 'Follow people back to start a leaderboard.')}
          </div>
        )}
        {!isLoading && rows.length > 0 && (
          <AnimatePresence initial={false}>
            <div className="space-y-1">
              {rows.map((row, idx) => {
                const rank = idx + 1;
                const initial = (row.username || '?').slice(0, 1).toUpperCase();
                return (
                  <motion.div
                    key={row.user_id}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(idx, 6) * 0.03 }}
                    className={[
                      'flex items-center gap-3 px-2 py-1.5 rounded-lg border',
                      rankAccent(rank, row.is_self),
                    ].join(' ')}
                  >
                    <span className={`text-xs font-black min-w-5 px-0.5 text-center tabular-nums ${rankColor(rank)}`}>
                      {rank === 1 ? <Crown className="w-3.5 h-3.5 inline" /> : rank}
                    </span>
                    {row.avatar_url ? (
                      <img
                        src={row.avatar_url}
                        alt=""
                        className="w-7 h-7 rounded-full object-cover bg-secondary shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold shrink-0">
                        {initial}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">
                        {row.is_self ? (
                          <>
                            {row.username}
                            <span className="ms-1.5 text-micro font-bold uppercase tracking-wider text-primary/80">
                              {tFallback('friendLeaderboard.you', 'You')}
                            </span>
                          </>
                        ) : row.username}
                      </p>
                    </div>
                    <span className="text-xs font-bold text-foreground/90 shrink-0">
                      <ScoreCell row={row} mode={mode} weightUnit={weightUnit} fmt={fmt} />
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </AnimatePresence>
        )}
      </div>
      )}
    </motion.div>
  );
}
