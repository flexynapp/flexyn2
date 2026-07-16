// src/components/nutrition/NutritionTrendsChart.jsx
//
// Eating-habit telemetry for the nutrition history view. A calorie bar chart
// (goal line + per-day adherence colouring + value labels), a summary strip
// (avg/day, on-target days, days logged, peak), and average-macro bars vs
// goal. Pure HTML/SVG + framer-motion — no chart library (keeps the bundle
// small; this only ever mounts inside the history modal).

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { format, subDays, parseISO } from 'date-fns';
import { calculateDailyValues } from '@/lib/nutritionDefaults';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';

function daysBack(n, now = new Date()) {
  const arr = [];
  for (let i = n - 1; i >= 0; i -= 1) arr.push(format(subDays(now, i), 'yyyy-MM-dd'));
  return arr;
}

function aggregate(entries, dateKeys) {
  const byDate = new Map(dateKeys.map(k => [k, { calories: 0, protein: 0, carbs: 0, fat: 0 }]));
  for (const e of entries) {
    const slot = byDate.get(e?.date);
    if (!slot) continue;
    slot.calories += Number(e.calories) || 0;
    slot.protein  += Number(e.protein_g ?? e.protein) || 0;
    slot.carbs    += Number(e.carbs_g   ?? e.carbs)   || 0;
    slot.fat      += Number(e.fat_g     ?? e.fat)     || 0;
  }
  return dateKeys.map(k => ({ date: k, ...byDate.get(k) }));
}

// Adherence colour for a day's calories vs the goal.
function calTone(cal, goal) {
  if (!cal) return { bar: 'linear-gradient(180deg, hsl(215 16% 65% / 0.35), hsl(215 16% 55% / 0.25))', text: 'text-muted-foreground/50' };
  const ratio = goal > 0 ? cal / goal : 1;
  if (ratio > 1.15) return { bar: 'linear-gradient(180deg, #fbbf24, #f59e0b)', text: 'text-amber-500' };   // over
  if (ratio < 0.7)  return { bar: 'linear-gradient(180deg, #7dd3fc, #38bdf8)', text: 'text-sky-500' };     // well under
  return { bar: 'linear-gradient(180deg, #34d399, #10b981)', text: 'text-emerald-500' };                   // on target
}

function Stat({ label, value, sub }) {
  return (
    <div className="text-center">
      <p className="font-heading font-bold text-base leading-none tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
      {sub && <p className="text-[9px] text-muted-foreground/70">{sub}</p>}
    </div>
  );
}

function MacroBar({ label, avg, goal, color }) {
  const pct = goal > 0 ? Math.min((avg / goal) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] font-semibold w-12 shrink-0" style={{ color }}>{label}</span>
      <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[11px] tabular-nums w-16 text-end shrink-0">
        <span className="font-bold">{Math.round(avg)}</span>
        <span className="text-muted-foreground">/{Math.round(goal)}g</span>
      </span>
    </div>
  );
}

export default function NutritionTrendsChart({ entries = [], userProfile = {}, days = 7 }) {
  const { language } = useLanguage();
  const dateLocale = getDateLocale(language);
  const dateKeys = useMemo(() => daysBack(days), [days]);
  const series = useMemo(() => aggregate(entries, dateKeys), [entries, dateKeys]);
  const dv = useMemo(() => calculateDailyValues(userProfile), [userProfile]);

  const goalCal = Math.round(dv?.calories || 2000);
  const cals = series.map(s => s.calories);
  const daysLogged = series.filter(s => s.calories > 0).length;
  const avgCal = Math.round(cals.reduce((s, v) => s + v, 0) / Math.max(1, days));
  const peakCal = Math.round(Math.max(0, ...cals));
  const onTarget = series.filter(s => s.calories > 0 && Math.abs(s.calories - goalCal) <= goalCal * 0.15).length;
  const delta = avgCal - goalCal;

  // Chart scale — headroom above the taller of goal / peak so bars never clip.
  const peak = Math.max(goalCal * 1.15, peakCal, 1);
  const goalPct = (goalCal / peak) * 100;

  const avgOf = (key) => series.reduce((s, v) => s + v[key], 0) / Math.max(1, days);

  return (
    <div className="space-y-3">
      {/* Calorie intake */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Calorie intake</p>
            <p className="font-heading font-bold text-2xl leading-none tabular-nums mt-1">
              {avgCal.toLocaleString()}
              <span className="text-xs font-semibold text-muted-foreground ms-1.5">avg/day</span>
            </p>
          </div>
          <div className="text-end">
            <p className="text-[10px] text-muted-foreground tabular-nums">goal {goalCal.toLocaleString()}</p>
            <p className={`text-xs font-bold tabular-nums ${delta > goalCal * 0.15 ? 'text-amber-500' : delta < -goalCal * 0.15 ? 'text-sky-500' : 'text-emerald-500'}`}>
              {delta >= 0 ? '+' : ''}{delta.toLocaleString()} cal
            </p>
          </div>
        </div>

        {/* Bar chart with goal line */}
        <div className="relative h-32 flex items-end justify-between gap-1.5">
          {/* Goal line */}
          <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ bottom: `${goalPct}%` }}>
            <div className="border-t border-dashed border-foreground/25" />
          </div>
          {series.map((s, i) => {
            const h = (s.calories / peak) * 100;
            const tone = calTone(s.calories, goalCal);
            return (
              <div key={s.date} className="flex-1 h-full flex flex-col items-center justify-end min-w-0">
                <span className={`text-[8px] font-semibold tabular-nums mb-0.5 ${tone.text}`}>
                  {s.calories > 0 ? Math.round(s.calories).toLocaleString() : ''}
                </span>
                <motion.div
                  className="w-full rounded-t-md"
                  style={{ background: tone.bar, minHeight: s.calories > 0 ? 3 : 0 }}
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut', delay: i * 0.04 }}
                />
              </div>
            );
          })}
        </div>
        {/* Day labels */}
        <div className="flex justify-between gap-1.5 mt-1.5">
          {series.map(s => (
            <span key={s.date} className="flex-1 text-center text-[9px] text-muted-foreground/70 tabular-nums">
              {(() => { try { return format(parseISO(s.date), 'EEE', { locale: dateLocale }); } catch { return ''; } })()}
            </span>
          ))}
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/60">
          <Stat label="On target" value={`${onTarget}/${days}`} sub="within 15% of goal" />
          <Stat label="Days logged" value={`${daysLogged}/${days}`} />
          <Stat label="Highest day" value={peakCal.toLocaleString()} sub="cal" />
        </div>
      </div>

      {/* Average macros */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-3">Avg macros / day</p>
        <div className="space-y-2.5">
          <MacroBar label="Protein" avg={avgOf('protein')} goal={dv?.protein_g || 150} color="#ef4444" />
          <MacroBar label="Carbs"   avg={avgOf('carbs')}   goal={dv?.carbs_g   || 200} color="#3b82f6" />
          <MacroBar label="Fat"     avg={avgOf('fat')}     goal={dv?.fat_g     || 65}  color="#eab308" />
        </div>
      </div>
    </div>
  );
}
