// src/components/nutrition/WeekCalorieStrip.jsx
//
// Seven days of calories against the goal, doubling as the day scrubber for
// meal history. This one control replaces three things the old sheet spent
// ~130px of chrome on: the "Days logged / Meals logged / Avg cal/day" stat bar,
// the "Pick day" tab, and the entry point into Trends.
//
// The rule that shapes it: a day you never logged draws a DASH on the baseline,
// not a zero-height bar. A zero-height bar says "you ate nothing"; the dash says
// "nothing here", which is what an unlogged day actually means. The caption
// prints the denominator for the same reason.

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getDateLocale } from '@/lib/dateLocales';
import { adherenceOf, summarise } from '@/lib/nutritionAdherence';

const PLOT_H = 52;
const LETTER_H = 20;

function safeFormat(dateStr, pattern, locale) {
  try { return format(parseISO(dateStr), pattern, { locale }); } catch { return ''; }
}

export default function WeekCalorieStrip({
  series = [],
  goal = 0,
  selectedDate = null,
  todayStr = '',
  onSelect,
  onShift,
  canGoForward = false,
  canGoBack = true,
}) {
  const { language } = useLanguage();
  const locale = getDateLocale(language);
  const fmt = useNumberFormatter();

  const stats = useMemo(() => summarise(series, goal), [series, goal]);
  // Headroom above the taller of goal / peak so a big day never clips and the
  // goal line still sits high enough to read as a target.
  const scale = Math.max(goal * 1.3, stats.peak, 1);
  const goalOffset = goal > 0 ? Math.min((goal / scale) * PLOT_H, PLOT_H) : 0;

  const first = series[0]?.date;
  const last = series[series.length - 1]?.date;
  const isCurrent = last === todayStr;
  const rangeLabel = first && last
    ? `${isCurrent ? 'LAST 7 DAYS · ' : ''}${safeFormat(first, 'MMM d', locale)} – ${safeFormat(last, 'MMM d', locale)}`.toUpperCase()
    : '';

  return (
    <div className="rounded-2xl border border-border bg-card">
      {/* Range + week paging */}
      <div className="flex items-center gap-1 px-2 pt-2.5">
        <button
          type="button"
          onClick={() => onShift?.(-1)}
          disabled={!canGoBack}
          aria-label="Previous week"
          className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground active:bg-secondary/60 disabled:opacity-25"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="flex-1 min-w-0 text-center text-micro font-bold tracking-[0.07em] truncate">
          {rangeLabel}
        </p>
        <button
          type="button"
          onClick={() => onShift?.(1)}
          disabled={!canGoForward}
          aria-label="Next week"
          className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground active:bg-secondary/60 disabled:opacity-25"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Plot */}
      <div className="relative px-3.5 pt-3">
        <div
          className="absolute left-3.5 right-3.5 border-t border-dashed border-muted-foreground/40 pointer-events-none"
          style={{ bottom: LETTER_H + goalOffset }}
        />
        <div className="absolute left-3.5 right-3.5 border-t border-border pointer-events-none" style={{ bottom: LETTER_H }} />
        <div className="relative flex items-stretch gap-1">
          {series.map((day, i) => {
            const tone = adherenceOf(day.calories, goal);
            const scoped = selectedDate ? day.date === selectedDate : day.date === todayStr;
            const isToday = day.date === todayStr;
            const barH = tone ? Math.max(3, Math.round((day.calories / scale) * PLOT_H)) : 0;
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => onSelect?.(day.date)}
                aria-label={`${safeFormat(day.date, 'EEEE, MMMM d', locale)} — ${tone ? `${Math.round(day.calories)} cal` : 'no meals logged'}`}
                aria-pressed={selectedDate === day.date}
                className="relative flex-1 min-w-0 flex flex-col items-center rounded-lg"
                style={{ height: PLOT_H + LETTER_H }}
              >
                {scoped && (
                  <span className={`absolute inset-0 rounded-lg bg-primary/10 ${selectedDate ? 'ring-1 ring-primary/45' : ''}`} />
                )}
                <span className="relative flex-1 w-full flex items-end justify-center">
                  {tone ? (
                    <motion.span
                      className="w-full max-w-[30px] rounded-t"
                      style={{ background: tone.css }}
                      initial={{ height: 0 }}
                      animate={{ height: barH }}
                      transition={{ duration: 0.45, ease: 'easeOut', delay: i * 0.03 }}
                    />
                  ) : (
                    <span className="w-[18px] h-0.5 rounded-full bg-muted-foreground/70" />
                  )}
                </span>
                <span
                  className={`relative text-micro leading-5 ${
                    scoped || isToday ? 'font-bold text-foreground' : `font-semibold text-muted-foreground${tone ? '' : '/50'}`
                  }`}
                >
                  {safeFormat(day.date, 'EEEEE', locale)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Caption — the denominator is the point */}
      <div className="mx-3.5 mt-2 pt-2 border-t border-border flex items-baseline justify-between gap-2 pb-2.5">
        <p className="text-micro font-medium text-muted-foreground truncate">
          {stats.logged > 0
            ? `${fmt(stats.avg)} avg on ${stats.logged} of ${stats.total} days`
            : `No days logged in these ${stats.total}`}
        </p>
        {goal > 0 && (
          <p className="text-micro font-medium text-muted-foreground shrink-0">goal {fmt(goal)}</p>
        )}
      </div>
    </div>
  );
}
