// src/components/debrief/WeeklyDebriefCard.jsx
//
// Visually-rich debrief card. Two modes:
//   normal  — themed card inside the app (respects dark/light mode)
//   export  — force-dark isolated div suitable for html2canvas PNG capture
//
// The `exportRef` prop is a React ref you attach to a wrapper div if you
// want to capture the card with html2canvas. Pass `forExport={true}` to
// switch to the dark-fixed export theme.

import React from 'react';
import { Flame, Zap, TrendingUp, TrendingDown, Trophy, Dumbbell, Utensils, Star, Minus } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(val) {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function fmt(n, decimals = 0) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: decimals });
}

function VolumeChange({ val }) {
  const n = pct(val);
  if (n === null) return <span className="text-xs opacity-60">first week</span>;
  if (n === 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
      <Minus className="w-3 h-3" /> same as last week
    </span>
  );
  const up = n > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? '+' : ''}{n}% vs last week
    </span>
  );
}

function StatPill({ icon: Icon, label, value, color = 'text-primary' }) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-white/5 min-w-0 flex-1">
      <Icon className={`w-4 h-4 ${color} shrink-0`} />
      <span className="text-lg font-heading font-bold tabular-nums leading-none">{value}</span>
      <span className="text-[10px] text-white/50 text-center leading-tight">{label}</span>
    </div>
  );
}

function MuscleGroupGrid({ trained = [], neglected = [] }) {
  const all = [
    'Chest','Back','Shoulders','Biceps','Triceps','Legs','Glutes','Core',
  ];
  const trainedSet = new Set(trained.map(m => m.toLowerCase()));
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map(group => {
        const hit = trainedSet.has(group.toLowerCase());
        return (
          <span
            key={group}
            className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
              hit
                ? 'bg-primary/20 border-primary/40 text-primary'
                : 'bg-white/5 border-white/10 text-white/35'
            }`}
          >
            {group}
          </span>
        );
      })}
    </div>
  );
}

// ── Main Card ─────────────────────────────────────────────────────────────────

export default function WeeklyDebriefCard({ debrief, forExport = false, exportRef }) {
  if (!debrief) return null;

  const d = debrief.data || {};
  const weekLabel  = debrief.week_label || `Week ${debrief.week_number}, ${debrief.year}`;
  const epochLabel = debrief.epoch_name || null;

  const volLbs         = fmt(d.volume_lbs);
  const changePct      = pct(d.volume_change_pct);
  const topLiftName    = d.top_lift_name    || null;
  const topLiftWeight  = d.top_lift_weight  || null;
  const topLiftReps    = d.top_lift_reps    || null;
  const topLiftIsPr    = !!d.top_lift_is_pr;
  const workoutStreak  = d.workout_streak   ?? 0;
  const workoutsCount  = d.workouts_count   ?? 0;
  const macroAdh       = d.macro_adherence_pct ?? 0;
  const macroDays      = d.macro_days_tracked  ?? 0;
  const aiInsight      = d.ai_insight || '';
  const xpEarned       = d.xp_earned          ?? 0;
  const levelStart     = d.level_start         ?? null;
  const levelEnd       = d.level_end           ?? null;
  const trained        = d.muscle_groups_trained   || [];

  const levelUp = levelEnd !== null && levelStart !== null && levelEnd > levelStart;

  // Export mode uses a hard-coded dark palette so html2canvas captures correctly
  const cardCls = forExport
    ? 'w-full max-w-sm mx-auto rounded-2xl overflow-hidden text-white select-none'
    : 'w-full rounded-2xl overflow-hidden text-white select-none';

  const bgStyle = forExport
    ? { background: 'linear-gradient(160deg, #0f0f14 0%, #141824 60%, #0a0d18 100%)' }
    : { background: 'linear-gradient(160deg, #0f0f14 0%, #141824 60%, #0a0d18 100%)' };

  return (
    <div ref={exportRef} className={cardCls} style={bgStyle}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-white/10">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-heading font-black text-base tracking-tight text-white">FLEXYN</span>
            <span className="text-[10px] font-semibold text-primary/80 uppercase tracking-widest">Debrief</span>
          </div>
          {epochLabel && (
            <span className="text-[10px] text-primary/60 font-medium">{epochLabel}</span>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-white">{weekLabel}</p>
          {d.week_start && d.week_end && (
            <p className="text-[10px] text-white/40">
              {d.week_start} → {d.week_end}
            </p>
          )}
        </div>
      </div>

      {/* ── Volume Hero ──────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3">
        <p className="text-[11px] text-white/40 uppercase tracking-widest font-semibold mb-0.5">Total Volume</p>
        <div className="flex items-end gap-3">
          <span className="text-4xl font-heading font-black tabular-nums leading-none text-white">
            {volLbs}
          </span>
          <span className="text-sm text-white/50 mb-1">lbs</span>
        </div>
        <div className="mt-1">
          <VolumeChange val={changePct} />
        </div>
      </div>

      {/* ── Top Lift ─────────────────────────────────────────────────────── */}
      {topLiftName && (
        <div className="mx-4 mb-3 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold mb-0.5">Top Lift</p>
              <p className="text-sm font-bold text-white truncate">{topLiftName}</p>
              <p className="text-xs text-white/50">
                {fmt(topLiftWeight)} lbs × {topLiftReps} reps
              </p>
            </div>
            {topLiftIsPr && (
              <div className="flex flex-col items-center shrink-0">
                <Trophy className="w-6 h-6 text-yellow-400" />
                <span className="text-[9px] font-black text-yellow-400 uppercase tracking-wider">PR!</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 3-Stat Row ───────────────────────────────────────────────────── */}
      <div className="flex gap-2 px-4 mb-3">
        <StatPill icon={Flame}    label="Streak"   value={workoutStreak}          color="text-orange-400" />
        <StatPill icon={Dumbbell} label="Workouts" value={workoutsCount}           color="text-blue-400" />
        <StatPill icon={Utensils} label="Nutrition" value={`${macroAdh}%`}        color="text-emerald-400" />
      </div>

      {/* ── Muscle Group Grid ────────────────────────────────────────────── */}
      <div className="px-4 mb-3">
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold mb-2">Muscle Groups</p>
        <MuscleGroupGrid trained={trained} />
        {trained.length === 0 && (
          <p className="text-xs text-white/30 italic">No exercises logged this week</p>
        )}
      </div>

      {/* ── AI Insight ───────────────────────────────────────────────────── */}
      {aiInsight && (
        <div className="mx-4 mb-3 px-3 py-2.5 rounded-xl border border-amber-500/30"
          style={{ background: 'rgba(245, 158, 11, 0.08)' }}>
          <div className="flex items-start gap-2">
            <Star className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-white/80 leading-relaxed">{aiInsight}</p>
          </div>
        </div>
      )}

      {/* ── XP / Level Footer ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-3 pb-4 border-t border-white/10">
        <div className="flex items-center gap-1.5">
          <Zap className="w-4 h-4 text-yellow-400" />
          <span className="text-sm font-bold tabular-nums text-white">+{fmt(xpEarned)} XP</span>
          <span className="text-xs text-white/40">this week</span>
        </div>
        {levelEnd !== null && (
          <div className="flex items-center gap-1.5">
            {levelUp && <Star className="w-3.5 h-3.5 text-yellow-400" />}
            <span className="text-xs text-white/50">
              {levelUp ? (
                <span className="text-yellow-400 font-semibold">Level {levelEnd} ↑</span>
              ) : (
                `Level ${levelEnd}`
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
