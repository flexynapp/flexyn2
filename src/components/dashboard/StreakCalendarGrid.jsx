// src/components/dashboard/StreakCalendarGrid.jsx
//
// Visual month-grid showing which days the user hit their login
// streak. Inspired by Duolingo's calendar grid + GitHub's
// contribution graph. Day cells light up green when present in the
// streak record; faded when missed.
//
// We compute the cells locally from:
//   • last_login_date (always today on a live session)
//   • login_streak (consecutive days back from last_login_date)
//   • longest_login_streak (used to colorize a "best ever" tick)
//
// No new DB column — derives from existing user_profiles fields.

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, isToday, isFuture, addDays, startOfWeek, subDays, isValid } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';

// Cap streak iteration so a corrupt user_profiles row reading
// login_streak = 10_000_000 (or NaN coerced upstream) doesn't lock
// the UI thread building a 10M-entry hit Set. ~10 years is far past
// any realistic streak we'd render.
const STREAK_CAP = 3650;

// Mon-start convention matches the firstDayOffset math below. We keep
// the visual order fixed (Mon→Sun) but localize the letter via
// date-fns so Japanese / Russian / Arabic users see their own initials
// instead of hardcoded English. (Audit 08 #L-2.)
function buildWeekdayLetters(language) {
  const dateLocale = getDateLocale(language);
  // Pick any known Monday as the anchor — 2024-01-01 is a Monday.
  const monday = startOfWeek(new Date(2024, 0, 1), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) =>
    format(addDays(monday, i), 'EEEEE', { locale: dateLocale })
  );
}

/**
 * Build the cell map for a single month: { dateStr: 'hit' | 'miss' | 'future' }
 *
 * @param {object} opts
 * @param {Date}   opts.month        any date inside the month to render
 * @param {string} opts.lastLogin    last_login_date (ISO yyyy-mm-dd)
 * @param {number} opts.streak       consecutive-day count back from lastLogin
 */
export function buildCellMap({ month = new Date(), lastLogin, streak = 0 } = {}) {
  const map = new Map();
  if (!lastLogin || streak <= 0) {
    // Nothing to highlight — every past day in the month is a miss.
    for (const d of eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })) {
      map.set(format(d, 'yyyy-MM-dd'), isFuture(d) ? 'future' : 'miss');
    }
    return map;
  }
  // parseISO never throws — it returns Invalid Date. Use isValid()
  // to detect bad input instead of relying on a try/catch that the
  // call site never fires.
  let last = typeof lastLogin === 'string' ? parseISO(lastLogin) : lastLogin;
  if (!isValid(last)) last = new Date();
  const hit = new Set();
  const iterCount = Math.min(Math.max(0, Math.floor(streak)), STREAK_CAP);
  for (let i = 0; i < iterCount; i += 1) {
    // subDays is DST-safe — manual setDate() can shift by 23 or 25
    // hours across DST transitions and silently skip or duplicate a
    // day in the hit set.
    hit.add(format(subDays(last, i), 'yyyy-MM-dd'));
  }
  for (const d of eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })) {
    const k = format(d, 'yyyy-MM-dd');
    if (isFuture(d)) map.set(k, 'future');
    else if (hit.has(k)) map.set(k, 'hit');
    else map.set(k, 'miss');
  }
  return map;
}

export default function StreakCalendarGrid({ profile, month = new Date() }) {
  const { language, tFallback } = useLanguage();
  const weekdayLetters = useMemo(() => buildWeekdayLetters(language), [language]);
  const cells = useMemo(
    () => buildCellMap({
      month,
      lastLogin: profile?.last_login_date,
      streak: profile?.login_streak,
    }),
    [month, profile?.last_login_date, profile?.login_streak]
  );
  const days = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }),
    [month]
  );
  const firstDayOffset = (startOfMonth(month).getDay() + 6) % 7; // Mon-start
  const hitCount = Array.from(cells.values()).filter(v => v === 'hit').length;
  const dateLocale = getDateLocale(language);

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {format(month, 'MMMM', { locale: dateLocale })}
        </p>
        <p className="text-micro text-muted-foreground tabular-nums">
          <span className="font-bold text-foreground">{hitCount}</span> {tFallback('streakCalendar.daysHit', 'days hit')}
        </p>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekdayLetters.map((d, i) => (
          <span key={`wd-${i}-${d}`} className="text-micro text-center font-bold uppercase tracking-wide text-muted-foreground/70">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDayOffset }).map((_, i) => (
          <div key={`pad-${i}`} aria-hidden="true" />
        ))}
        {days.map(d => {
          const key = format(d, 'yyyy-MM-dd');
          const status = cells.get(key);
          const today = isToday(d);
          const cellClass =
            status === 'future' ? 'bg-secondary/20 text-muted-foreground/30' :
            status === 'hit'    ? 'bg-emerald-500/25 text-emerald-300' :
                                   'bg-secondary/40 text-muted-foreground/60';
          const statusLabel = tFallback(`streakCalendar.status.${status}`, status || 'miss');
          return (
            <motion.div
              key={key}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: d.getDate() * 0.012 }}
              className={`aspect-square rounded-md flex items-center justify-center text-micro font-bold tabular-nums ${cellClass} ${today ? 'ring-2 ring-primary' : ''}`}
              aria-label={`${format(d, 'MMMM d', { locale: dateLocale })}: ${statusLabel}`}
            >
              {d.getDate()}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
