// src/components/nutrition/HistoryCalendarSheet.jsx
//
// Month grid for jumping to a day in meal history. This is what the old
// "Pick day" TAB should have been: an action you reach for, not a third
// destination that renders one isolated day with none of its context.
//
// Cell language matches StreakCalendarGrid (Monday-start, hit / miss / future)
// so the two calendars in the app do not disagree about what an empty square
// means: a past day you never logged is HOLLOW, a future day is simply dim.

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths, getDay, isSameMonth, isValid,
} from 'date-fns';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { ADHERENCE, adherenceOf } from '@/lib/nutritionAdherence';

const KEY = 'yyyy-MM-dd';

function monthAnchor(dateStr) {
  if (dateStr) {
    const d = parseISO(dateStr);
    if (isValid(d)) return startOfMonth(d);
  }
  return startOfMonth(new Date());
}

export default function HistoryCalendarSheet({
  open,
  onClose,
  caloriesByDate,
  loggedDates,
  goal = 0,
  selectedDate = null,
  todayStr = '',
  earliestDate = null,
  truncated = false,
  onSelect,
}) {
  const { language, tFallback } = useLanguage();
  const locale = getDateLocale(language);
  const [month, setMonth] = useState(() => monthAnchor(selectedDate || todayStr));

  // 2024-01-01 is a Monday — anchor the localized initials off it so the visual
  // order stays Mon→Sun while the letters follow the user's language.
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(new Date(2024, 0, 1 + i), 'EEEEE', { locale })),
    [locale],
  );

  const cells = useMemo(() => {
    const start = startOfMonth(month);
    const days = eachDayOfInterval({ start, end: endOfMonth(month) });
    const lead = (getDay(start) + 6) % 7;          // Mon-start offset
    return [...Array.from({ length: lead }, () => null), ...days];
  }, [month]);

  const atCurrentMonth = isSameMonth(month, new Date());
  // A hollow cell claims "you logged nothing that day". We can only make that
  // claim about days inside the window we fetched, so paging stops at the
  // oldest row we hold rather than drawing empty months over unread history.
  const atEarliestMonth = !!earliestDate && startOfMonth(month) <= startOfMonth(parseISO(earliestDate));

  // Locks are reference-counted, so holding the page here as well as in the
  // history sheet behind us is safe — it stays held until the outer one closes.
  // Must sit above the early return: it is a hook.
  useBodyScrollLock(open);

  if (!open) return null;

  const pick = (dateStr) => {
    onSelect?.(dateStr);
    onClose?.();
  };

  return (
    <AnimatePresence>
      <motion.div
        key="history-calendar"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-end justify-center"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-label={tFallback("historyCalendarSheet.jumpToADay", "Jump to a day")}
          className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-card border-t sm:border border-border pb-5"
        >
          <div className="flex justify-center pt-2.5 pb-1">
            <span className="w-10 h-1 rounded-full bg-border" />
          </div>

          <div className="flex items-center justify-between px-4 pt-1 pb-3">
            <h3 className="font-heading font-bold text-lg tracking-tight">{tFallback("historyCalendarSheet.jumpToADay", "Jump to a day")}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label={tFallback("common.close", "Close")}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1 px-4 pb-2">
            <button
              type="button"
              onClick={() => setMonth(m => subMonths(m, 1))}
              disabled={atEarliestMonth}
              aria-label={tFallback("historyCalendarSheet.previousMonth", "Previous month")}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground disabled:opacity-25"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="flex-1 text-center text-xs font-bold uppercase tracking-[0.1em]">
              {format(month, 'MMMM yyyy', { locale })}
            </p>
            <button
              type="button"
              onClick={() => setMonth(m => addMonths(m, 1))}
              disabled={atCurrentMonth}
              aria-label={tFallback("historyCalendarSheet.nextMonth", "Next month")}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground disabled:opacity-25"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4">
            <div className="grid grid-cols-7 gap-1.5 mb-1">
              {weekdays.map((w, i) => (
                <span key={i} className="text-center text-micro font-bold tracking-wide text-muted-foreground">{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((day, i) => {
                if (!day) return <span key={`pad-${i}`} />;
                const key = format(day, KEY);
                const cal = caloriesByDate?.get?.(key) || 0;
                const tone = adherenceOf(cal, goal);
                // Logged, but nothing to colour by — a hollow ring here would
                // say "you logged nothing that day", which is false.
                const bare = !tone && !!loggedDates?.has?.(key);
                const future = key > todayStr;
                const isToday = key === todayStr;
                const isSelected = key === selectedDate;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={future}
                    onClick={() => pick(key)}
                    aria-label={`${format(day, 'EEEE, MMMM d', { locale })}${
                      tone ? ` — ${Math.round(cal)} cal` : bare ? ' — logged, no calories' : ''}`}
                    aria-pressed={isSelected}
                    className={`relative h-10 rounded-xl flex items-center justify-center text-[12.5px] tabular-nums ${
                      isSelected ? 'bg-primary text-primary-foreground font-bold'
                        : isToday ? 'ring-1 ring-foreground font-bold'
                        : bare ? 'bg-secondary text-foreground font-semibold'
                        : !future && !tone ? 'ring-1 ring-border' : ''
                    } ${isSelected ? '' : tone ? `${tone.text} font-semibold` : 'text-muted-foreground'} ${
                      future ? 'opacity-30' : ''
                    }`}
                  >
                    {/* tint as its own layer — a full-opacity tone fill would
                        swallow the number it is supposed to qualify */}
                    {tone && !isSelected && (
                      <span className="absolute inset-0 rounded-xl opacity-20" style={{ background: tone.css }} />
                    )}
                    <span className="relative">{format(day, 'd')}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 px-4 pt-4 pb-1 flex-wrap">
            {[ADHERENCE.on, ADHERENCE.under, ADHERENCE.over].map(t => (
              <span key={t.key} className="flex items-center gap-1.5 text-micro font-semibold text-muted-foreground">
                <span className="w-[7px] h-[7px] rounded-full" style={{ background: t.css }} />
                {t.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-micro font-semibold text-muted-foreground">
              <span className="w-[7px] h-[7px] rounded-full border border-muted-foreground" />
              Not logged
            </span>
          </div>

          {atEarliestMonth && (
            <p className="px-4 pt-3 text-micro text-muted-foreground">
              {truncated
                ? 'Earliest of your most recent 500 entries.'
                : 'This is as far back as your log goes.'}
            </p>
          )}

          <div className="px-4 pt-3">
            <button
              type="button"
              onClick={() => pick(todayStr)}
              className="w-full h-11 rounded-lg border border-border text-sm font-bold"
            >
              Jump to today
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
