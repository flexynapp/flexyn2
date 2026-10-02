// src/components/nutrition/NutritionTrendsChart.jsx
//
// Eating-habit telemetry for the nutrition history view. Pure HTML/SVG +
// framer-motion — no chart library (keeps the bundle small; this only ever
// mounts inside the history sheet).
//
// The rework splits two questions the old version answered as one. "How much
// did you eat on the days you logged" and "how often do you log" are different
// measurements, and averaging over calendar days silently mixed them: an
// unlogged day entered the mean as a zero, so sparse logging read as
// undereating. Averages here divide by LOGGED days and print the denominator;
// the consistency card owns the other question.

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { format, subDays, parseISO } from 'date-fns';
import { calculateDailyValues } from '@/lib/nutritionDefaults';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getDateLocale } from '@/lib/dateLocales';
import { isWaterEntry } from '@/lib/waterEntries';
import { MACRO_ORDER } from '@/lib/macroColors';
import { adherenceOf, summarise, longestStreak } from '@/lib/nutritionAdherence';

const RANGES = [7, 30, 90];
const PLOT_H = 112;   // px — bars animate in pixels, see the chart comment below
const KEY = 'yyyy-MM-dd';

function daysBack(n, now = new Date()) {
  const arr = [];
  for (let i = n - 1; i >= 0; i -= 1) arr.push(format(subDays(now, i), KEY));
  return arr;
}

function aggregate(entries, dateKeys) {
  const byDate = new Map(dateKeys.map(k => [k, { calories: 0, protein: 0, carbs: 0, fat: 0, logged: false }]));
  for (const e of entries) {
    if (isWaterEntry(e)) continue;
    const slot = byDate.get(e?.date);
    if (!slot) continue;
    slot.logged = true;
    slot.calories += Number(e.calories) || 0;
    slot.protein  += Number(e.protein_g ?? e.protein) || 0;
    slot.carbs    += Number(e.carbs_g   ?? e.carbs)   || 0;
    slot.fat      += Number(e.fat_g     ?? e.fat)     || 0;
  }
  return dateKeys.map(k => ({ date: k, ...byDate.get(k) }));
}

function Card({ label, meta, children }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="kicker">{label}</p>
        {meta && <p className="text-micro text-muted-foreground shrink-0">{meta}</p>}
      </div>
      {children}
    </div>
  );
}

export default function NutritionTrendsChart({ entries = [], userProfile = {} }) {
  const { language, tFallback } = useLanguage();
  const locale = getDateLocale(language);
  const fmt = useNumberFormatter();
  const [days, setDays] = useState(30);

  const dateKeys = useMemo(() => daysBack(days), [days]);
  const series = useMemo(() => aggregate(entries, dateKeys), [entries, dateKeys]);
  const dv = useMemo(() => calculateDailyValues(userProfile), [userProfile]);

  const goalCal = Math.round(dv?.calories || 2000);
  const stats = useMemo(() => summarise(series, goalCal), [series, goalCal]);
  const streak = useMemo(() => longestStreak(series), [series]);
  const delta = stats.logged ? stats.avg - goalCal : 0;
  const deltaTone = adherenceOf(stats.avg, goalCal);

  // Headroom above the taller of goal / peak so bars never clip.
  const peak = Math.max(goalCal * 1.15, stats.peak, 1);
  const goalPct = (goalCal / peak) * 100;

  // Averages over LOGGED days — the whole point of the rework.
  const avgOf = (key) => {
    const logged = series.filter(s => s.calories > 0);
    if (!logged.length) return 0;
    return logged.reduce((s, v) => s + v[key], 0) / logged.length;
  };

  const macroGoals = { protein: dv?.protein_g || 150, carbs: dv?.carbs_g || 250, fat: dv?.fat_g || 67 };
  const gridCols = days === 7 ? 7 : 15;
  const barGap = days > 30 ? 'gap-px' : days > 7 ? 'gap-0.5' : 'gap-1.5';

  return (
    <div className="space-y-3">
      {/* Range */}
      <div className="flex gap-2">
        {RANGES.map(n => (
          <button
            key={n}
            type="button"
            onClick={() => setDays(n)}
            aria-pressed={days === n}
            className={`h-8 px-3.5 rounded-full text-[11px] font-bold transition-colors ${
              days === n
                ? 'bg-primary/15 border border-primary/45 text-primary'
                : 'bg-secondary/60 text-muted-foreground'
            }`}
          >
            {n}D
          </button>
        ))}
      </div>

      {/* Calorie intake */}
      <Card label="Calorie intake">
        <div className="flex items-end justify-between gap-2 mt-1.5">
          <div className="min-w-0">
            <p className="font-heading font-bold text-2xl leading-none tabular-nums">
              {fmt(stats.avg)}
              <span className="text-xs font-semibold text-muted-foreground ms-1.5">avg/day</span>
            </p>
            <p className="text-micro text-muted-foreground mt-1.5">
              {/* NOT "days you logged" — the consistency card below counts those,
                  and a 0-calorie meal makes the two numbers legitimately differ. */}
              {stats.logged > 0
                ? `on the ${stats.logged} day${stats.logged === 1 ? '' : 's'} with calories`
                : 'nothing logged in this range'}
            </p>
          </div>
          <div className="text-end shrink-0">
            <p className="text-micro text-muted-foreground tabular-nums">goal {fmt(goalCal)}</p>
            {stats.logged > 0 && (
              <p className={`text-sm font-bold tabular-nums ${deltaTone ? deltaTone.text : 'text-muted-foreground'}`}>
                {delta >= 0 ? '+' : ''}{fmt(delta)} cal
              </p>
            )}
          </div>
        </div>

        {/* Heights animate in PIXELS against a fixed plot, matching
            WeekCalorieStrip — one bar-sizing idiom across the two charts that
            sit two taps apart, and no percentage resolving against a parent
            whose own height is set by a utility class. */}
        <div className={`relative flex items-end justify-between mt-4 ${barGap}`} style={{ height: PLOT_H }}>
          <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ bottom: `${goalPct}%` }}>
            <div className="border-t border-dashed border-foreground/25" />
          </div>
          {series.map((s, i) => {
            const tone = adherenceOf(s.calories, goalCal);
            return (
              <div key={s.date} className="flex-1 h-full flex flex-col items-center justify-end min-w-0">
                {tone ? (
                  <motion.div
                    className="w-full rounded-t-sm"
                    style={{ background: tone.css }}
                    initial={{ height: 0 }}
                    animate={{ height: Math.max(3, Math.round((s.calories / peak) * PLOT_H)) }}
                    transition={{ duration: 0.5, ease: 'easeOut', delay: Math.min(i, 20) * 0.02 }}
                  />
                ) : (
                  // Never logged — a dash on the baseline, not a bar of height 0.
                  <div className="w-full max-w-[18px] h-0.5 rounded-full bg-muted-foreground/60" />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-micro text-muted-foreground">
            {format(parseISO(dateKeys[0]), 'MMM d', { locale })}
          </span>
          <span className="text-micro text-muted-foreground">
            {format(parseISO(dateKeys[dateKeys.length - 1]), 'MMM d', { locale })}
          </span>
        </div>
        <p className="text-micro text-muted-foreground mt-3 pt-3 border-t border-border/60">
          {stats.counts.over} over · {stats.counts.on} on target · {stats.counts.under} under
        </p>
      </Card>

      {/* Logging consistency — the question the average was quietly answering */}
      <Card label="Logging consistency">
        <div className="flex items-baseline justify-between gap-2 mt-1.5">
          <p className="font-heading font-bold text-xl leading-none tabular-nums">
            {stats.recorded} of {stats.total} days
          </p>
          <p className="font-heading font-bold text-lg text-primary tabular-nums shrink-0">
            {Math.round((stats.recorded / Math.max(stats.total, 1)) * 100)}%
          </p>
        </div>
        <div className="grid gap-1 mt-3.5" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
          {series.map(s => {
            const tone = adherenceOf(s.calories, goalCal);
            return (
              <span
                key={s.date}
                className="h-3.5 rounded-[3px]"
                style={tone ? { background: tone.css, opacity: 0.85 }
                     : s.logged ? { background: 'hsl(var(--muted-foreground))', opacity: 0.55 }
                     : { background: 'hsl(var(--secondary))' }}
              />
            );
          })}
        </div>
        <p className="text-micro text-muted-foreground mt-3">
          Longest streak: {streak} day{streak === 1 ? '' : 's'}
        </p>
      </Card>

      {/* Average macros */}
      <Card label="Average macros" meta="per logged day">
        <div className="space-y-2.5 mt-3">
          {MACRO_ORDER.map(m => {
            const avg = avgOf(m.key);
            const goal = macroGoals[m.key];
            return (
              <div key={m.key} className="flex items-center gap-2.5">
                <span className="text-micro font-semibold w-12 shrink-0 text-muted-foreground">{tFallback(`nutrient.${m.key}`, m.label)}</span>
                <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: m.css }}
                    initial={{ width: 0 }}
                    animate={{ width: `${goal > 0 ? Math.min((avg / goal) * 100, 100) : 0}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
                <span className="text-micro tabular-nums w-16 text-end shrink-0">
                  <span className="font-bold">{Math.round(avg)}</span>
                  <span className="text-muted-foreground">/{Math.round(goal)}g</span>
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <p className="text-micro text-muted-foreground leading-relaxed px-1">
        Averages count only the {stats.logged} day{stats.logged === 1 ? '' : 's'} that carry calories. The{' '}
        {stats.total - stats.recorded} day{stats.total - stats.recorded === 1 ? '' : 's'} you logged nothing
        {stats.total - stats.recorded === 1 ? ' is' : ' are'} shown as gaps, not as zero-calorie days.
      </p>
    </div>
  );
}
