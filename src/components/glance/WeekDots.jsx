// src/components/glance/WeekDots.jsx
//
// Monday to Sunday under the Progress ring. Trained days are filled, today
// is outlined in --primary (the page's one acting accent), days still to
// come are dashed, and days that passed without a session are a plain
// hairline: no red, no cross. A missed Tuesday is not a warning.
//
// `days` comes from weekSummary() in src/lib/focalGoal.js.

import React from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { useDateFormatter } from '@/lib/intl';

function dotClass(day) {
  if (day.today && day.done) return 'bg-foreground border-2 border-primary';
  if (day.done) return 'bg-foreground';
  if (day.today) return 'border-2 border-primary';
  if (day.future) return 'border border-dashed border-border';
  return 'border border-border';
}

export default function WeekDots({ days = [] }) {
  const { tFallback } = useLanguage();
  const fmtDate = useDateFormatter();
  return (
    <ol className="flex justify-between" aria-label={tFallback('progress.focal.dots.label', 'This week, Monday to Sunday')}>
      {days.map((day) => {
        const long = fmtDate(day.date, { weekday: 'long' });
        const state = day.done
          ? tFallback('progress.focal.dots.trained', 'trained')
          : day.future
            ? tFallback('progress.focal.dots.ahead', 'still ahead')
            : day.today
              ? tFallback('progress.focal.dots.today', 'today')
              : tFallback('progress.focal.dots.rest', 'no session');
        return (
          <li key={day.key} className="flex flex-col items-center gap-1" aria-label={`${long}, ${state}`}>
            <span className={`w-7 h-7 rounded-full box-border ${dotClass(day)}`} aria-hidden="true" />
            <span
              className={`text-micro ${day.today ? 'font-bold text-foreground' : day.done ? 'text-foreground' : 'text-muted-foreground'}`}
              aria-hidden="true"
            >
              {fmtDate(day.date, { weekday: 'narrow' })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
