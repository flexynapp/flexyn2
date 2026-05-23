// src/components/nutrition/NutritionTrendsChart.jsx
//
// Weekly macros + calorie trend chart for the nutrition history view.
// Pure SVG — no chart library needed (we already have recharts but
// the bundle would balloon for a simple 7-bar chart).
//
// Aggregates entries by date string, picks the last N days (default
// 7), and renders four parallel mini-bar series: calories, protein,
// carbs, fat. Goal lines overlay for context.

import React, { useMemo } from 'react';
import { format, subDays, parseISO } from 'date-fns';
import { calculateDailyValues } from '@/lib/nutritionDefaults';

function daysBack(n, now = new Date()) {
  const arr = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    arr.push(format(subDays(now, i), 'yyyy-MM-dd'));
  }
  return arr;
}

function aggregate(entries, dateKeys) {
  const byDate = new Map(dateKeys.map(k => [k, { calories: 0, protein: 0, carbs: 0, fat: 0 }]));
  for (const e of entries) {
    const k = e?.date;
    const slot = byDate.get(k);
    if (!slot) continue;
    slot.calories += Number(e.calories) || 0;
    slot.protein  += Number(e.protein_g) || 0;
    slot.carbs    += Number(e.carbs_g)   || 0;
    slot.fat      += Number(e.fat_g)     || 0;
  }
  return dateKeys.map(k => ({ date: k, ...byDate.get(k) }));
}

function MiniSeries({ label, values, goal, color, unit = 'g' }) {
  const peak = Math.max(goal || 0, ...values.map(v => v.value), 1);
  const goalY = goal ? (1 - goal / peak) * 100 : null;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
        {goal != null && (
          <span className="text-[10px] text-muted-foreground tabular-nums">goal {goal} {unit}</span>
        )}
      </div>
      <svg viewBox="0 0 100 36" className="w-full h-9" role="img" aria-label={`${label} over time`}>
        {goalY != null && (
          <line
            x1="0" x2="100" y1={goalY * 0.36} y2={goalY * 0.36}
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeDasharray="2 2"
            strokeWidth="0.4"
          />
        )}
        {values.map((v, i) => {
          const x = (i / values.length) * 100;
          const w = 100 / values.length - 1.5;
          const h = peak ? (v.value / peak) * 36 : 0;
          return (
            <rect
              key={v.date}
              x={x}
              y={36 - h}
              width={w}
              height={h}
              fill={color}
              rx="1"
            />
          );
        })}
      </svg>
    </div>
  );
}

export default function NutritionTrendsChart({ entries = [], userProfile = {}, days = 7 }) {
  const dateKeys = useMemo(() => daysBack(days), [days]);
  const series = useMemo(() => aggregate(entries, dateKeys), [entries, dateKeys]);
  const dv = useMemo(() => calculateDailyValues(userProfile), [userProfile]);

  const cal     = series.map(s => ({ date: s.date, value: s.calories }));
  const protein = series.map(s => ({ date: s.date, value: s.protein  }));
  const carbs   = series.map(s => ({ date: s.date, value: s.carbs    }));
  const fat     = series.map(s => ({ date: s.date, value: s.fat      }));

  const avgCal = Math.round(cal.reduce((s, v) => s + v.value, 0) / Math.max(1, cal.length));
  const goalCal = Math.round(dv?.calories || 2000);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Last {days} days
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            avg <span className="font-bold text-foreground">{avgCal.toLocaleString()}</span> / {goalCal.toLocaleString()} cal
          </p>
        </div>
        <div className="text-orange-500"><MiniSeries label="Calories" values={cal}     goal={goalCal}             color="currentColor" unit="kcal" /></div>
        <div className="text-red-500 mt-3"><MiniSeries label="Protein"  values={protein} goal={dv?.protein_g || 0} color="currentColor" /></div>
        <div className="text-blue-500 mt-3"><MiniSeries label="Carbs"   values={carbs}   goal={dv?.carbs_g   || 0} color="currentColor" /></div>
        <div className="text-yellow-500 mt-3"><MiniSeries label="Fat"   values={fat}     goal={dv?.fat_g     || 0} color="currentColor" /></div>
        <div className="flex justify-between mt-2 px-0.5">
          {series.map(s => (
            <span key={s.date} className="text-[9px] text-muted-foreground/70 tabular-nums">
              {(() => { try { return format(parseISO(s.date), 'EEE'); } catch { return ''; } })()}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
