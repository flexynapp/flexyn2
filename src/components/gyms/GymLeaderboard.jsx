// src/components/gyms/GymLeaderboard.jsx
//
// Community Gym-vs-Gym leaderboard.
//
// Ranks active gyms WITH AT LEAST FIVE MEMBERS by 7-day workout
// activity:
//   score = workout_count × LOG(active_members + 1)
//
// This rewards gyms where many DIFFERENT members are training, not just
// one person logging dozens of sessions. LOG-damping prevents giants
// from running away from smaller-but-active gyms.
//
// The five-member floor is a privacy boundary, not a quality bar (mig
// 301, applied here by mig 327): below it, a gym's weekly activity is
// one identifiable person's attendance, because the roster is visible
// to members and the rest comes out by subtraction.
//
// Data: get_gym_vs_gym_leaderboard() RPC (migrations 142 / 327).
// TanStack Query staleTime: 15 minutes — leaderboard positions don't
// need to be real-time; a 15-min cache keeps RPCs cheap.
//
// Props:
//   onGymPress(gymId) — called when a row is tapped (for auth'd users
//                       who want to navigate to the gym hub).
//   isAuthed          — boolean; toggles the "Enter Hub" affordance.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Trophy, Users, Dumbbell, Building2, Loader2,
  ChevronRight, TrendingUp,
} from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useLanguage } from '@/lib/LanguageContext';

// ── Data fetcher ────────────────────────────────────────────────────
async function fetchLeaderboard() {
  const { data, error } = await supabase.rpc('get_gym_vs_gym_leaderboard', { p_limit: 25 });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// ── Trophy badge for top 3 ──────────────────────────────────────────
function RankBadge({ rank }) {
  if (rank === 1) return <span className="text-xl leading-none" title="1st">🥇</span>;
  if (rank === 2) return <span className="text-xl leading-none" title="2nd">🥈</span>;
  if (rank === 3) return <span className="text-xl leading-none" title="3rd">🥉</span>;
  return (
    <span className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-xs font-bold tabular-nums text-muted-foreground">
      {rank}
    </span>
  );
}

// ── Score display ───────────────────────────────────────────────────
function ScoreBar({ score, maxScore }) {
  const pct = maxScore > 0 ? Math.min(100, (Number(score) / Number(maxScore)) * 100) : 0;
  return (
    <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
      <div
        className="h-full rounded-full bg-primary transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Individual row ──────────────────────────────────────────────────
function LeaderboardRow({ entry, maxScore, isAuthed, onGymPress, delay }) {
  const rank = Number(entry.rank);
  const isTopThree = rank <= 3;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 ${
        isTopThree ? 'bg-primary/5' : ''
      }`}
    >
      {/* Rank */}
      <div className="w-8 flex justify-center shrink-0">
        <RankBadge rank={rank} />
      </div>

      {/* Logo */}
      <div className="w-10 h-10 rounded-xl overflow-hidden bg-muted shrink-0 flex items-center justify-center">
        {entry.logo_url ? (
          <img loading="lazy" src={entry.logo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <Building2 className="w-5 h-5 text-muted-foreground" />
        )}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <p className={`font-heading font-bold text-sm truncate ${isTopThree ? 'text-foreground' : ''}`}>
          {entry.gym_name}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {[entry.city, entry.state_code].filter(Boolean).join(', ')}
        </p>
        {/* Score bar */}
        <div className="mt-1.5 flex items-center gap-2">
          <ScoreBar score={entry.score} maxScore={maxScore} />
          <span className="text-micro text-muted-foreground tabular-nums shrink-0">
            {Number(entry.score).toFixed(1)}
          </span>
        </div>
        {/* Stat chips */}
        <div className="flex items-center gap-3 mt-1">
          <span className="flex items-center gap-0.5 text-micro text-muted-foreground">
            <Users className="w-2.5 h-2.5" />
            {entry.active_members} active
          </span>
          <span className="flex items-center gap-0.5 text-micro text-muted-foreground">
            <Dumbbell className="w-2.5 h-2.5" />
            {entry.workout_count} workout{entry.workout_count === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* CTA arrow (auth'd only) */}
      {isAuthed && onGymPress && (
        <button
          type="button"
          onClick={() => onGymPress(entry.gym_id)}
          className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0"
          aria-label={`Open ${entry.gym_name}`}
        >
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      )}
    </motion.div>
  );
}

// ── Main export ─────────────────────────────────────────────────────
export default function GymLeaderboard({ isAuthed = false, onGymPress }) {
  const { tFallback } = useLanguage();
  const { data: rows = [], isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['gymVsGymLeaderboard'],
    queryFn: fetchLeaderboard,
    staleTime: 1000 * 60 * 15, // 15 minutes
    retry: 2,
  });

  const maxScore = rows.length > 0 ? Math.max(...rows.map(r => Number(r.score))) : 1;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
        <TrendingUp className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{tFallback('gymLeaderboard.unavailable', 'Leaderboard unavailable right now.')}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
        <Trophy className="w-10 h-10 text-muted-foreground/50" />
        <div>
          <p className="font-heading font-bold">{tFallback("gymLeaderboard.noGymsRankedYet", "No gyms ranked yet")}</p>
          <p className="text-sm text-muted-foreground mt-1">
            A gym joins the board once five of its members are on Flexyn — that&apos;s
            the point where a week of training says something about the gym rather
            than about one person.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-yellow-500" />
          <div>
            <p className="font-heading font-bold text-sm">{tFallback("gymLeaderboard.gymLeaderboard", "Gym Leaderboard")}</p>
            <p className="text-micro text-muted-foreground">Last 7 days · {rows.length} gyms ranked</p>
          </div>
        </div>
        {lastUpdated && (
          <p className="text-micro text-muted-foreground">Updated {lastUpdated}</p>
        )}
      </div>

      {/* Scoring explainer */}
      <div className="px-4 py-2 bg-primary/5 border-b border-border">
        <p className="text-micro text-muted-foreground text-center">
          Score = workout sessions × log(active members + 1) · rewards participation breadth
        </p>
      </div>

      {/* Rows */}
      <div>
        {rows.map((entry, i) => (
          <LeaderboardRow
            key={entry.gym_id}
            entry={entry}
            maxScore={maxScore}
            isAuthed={isAuthed}
            onGymPress={onGymPress}
            delay={i * 0.03}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-4 text-center">
        <p className="text-xs text-muted-foreground">
          Rankings refresh every 15 minutes · Scores reset weekly
        </p>
      </div>
    </div>
  );
}
