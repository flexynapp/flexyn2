import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO, subDays, isToday, isYesterday, isValid, differenceInCalendarDays } from 'date-fns';
import {
  X, UtensilsCrossed, Droplet, Calendar as CalendarIcon, Image as ImageIcon, Camera, Plus,
} from 'lucide-react';
import NutritionTrendsChart from './NutritionTrendsChart';
import PhotoMealResultModal from './PhotoMealResultModal';
import WeekCalorieStrip from './WeekCalorieStrip';
import HistoryCalendarSheet from './HistoryCalendarSheet';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { getDateLocale } from '@/lib/dateLocales';
import { db } from '@/api/db';
import * as nutritionData from '@/lib/data/nutrition';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import { filterAfterReset } from '@/lib/accountReset';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { splitWaterEntries, sumWaterOz } from '@/lib/waterEntries';
import { MEAL_TYPES } from '@/components/nutrition/MealTypePicker';
import { MACROS, MACRO_ORDER, macroValue } from '@/lib/macroColors';
import { calculateDailyValues } from '@/lib/nutritionDefaults';
import { adherenceOf, summarise } from '@/lib/nutritionAdherence';

const KEY = 'yyyy-MM-dd';
const WEEK = 7;
const FETCH_LIMIT = 500;

// meal_type is set on every meal the app writes (the picker defaults it from the
// clock) and history showed it nowhere. It is the one thing on the row that
// says what the meal WAS rather than when it was recorded — `created_at` is
// the log time, which can be hours after eating.
const MEAL_TYPE_LABEL = Object.fromEntries(MEAL_TYPES.map(m => [m.id, m.label]));

// Reconstruct a recognition-shaped result from a stored log row so the saved
// meal can be re-opened in the read-only detail view (photo + macros +, for
// photo meals, the ingredient breakdown). Manual entries have no ai_meta, so
// they show macros only.
function mealEntryToResult(entry) {
  const meta = entry?.ai_meta || {};
  return {
    food_name:        entry?.food_name || 'Meal',
    calories:         Number(entry?.calories) || 0,
    protein_g:        Number(entry?.protein_g ?? entry?.protein) || 0,
    carbs_g:          Number(entry?.carbs_g   ?? entry?.carbs)   || 0,
    fat_g:            Number(entry?.fat_g     ?? entry?.fat)     || 0,
    fiber_g:          Number(entry?.fiber_g   ?? entry?.fiber)   || 0,
    sugar_g:          Number(meta.sugar_g ?? entry?.sugar_g)     || 0,
    sodium_mg:        Number(entry?.sodium_mg ?? entry?.sodium)  || 0,
    items:            Array.isArray(meta.items) ? meta.items : [],
    portion_estimate: meta.portion_estimate || null,
    confidence:       meta.confidence || null,
    notes:            meta.notes || entry?.notes || null,
    logged_at:        entry?.created_at || null,
  };
}

function macroTotals(meals = []) {
  return meals.reduce((acc, e) => ({
    calories: acc.calories + (Number(e.calories) || 0),
    protein:  acc.protein  + macroValue(e, MACROS.protein),
    carbs:    acc.carbs    + macroValue(e, MACROS.carbs),
    fat:      acc.fat      + macroValue(e, MACROS.fat),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function formatDateHeading(dateStr, locale) {
  const d = parseISO(dateStr);
  if (!isValid(d)) return dateStr;
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEE, MMM d', { locale });
}

function formatTime(stamp, locale) {
  if (!stamp) return null;
  const d = parseISO(stamp);
  return isValid(d) ? format(d, 'h:mm a', { locale }) : null;
}

/**
 * Per-day macro totals. These used to sit behind `hidden sm:flex`, so on a
 * mobile-only app they never rendered on a single real device.
 */
function MacroChips({ totals }) {
  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      {MACRO_ORDER.map(m => (
        <span
          key={m.key}
          className={`inline-flex items-center justify-center min-w-[46px] px-1.5 py-0.5 rounded-full text-micro font-bold ${m.chip}`}
        >
          {m.short} {Math.round(totals[m.key] || 0)}g
        </span>
      ))}
    </div>
  );
}

function WaterLine({ entries }) {
  if (!entries.length) return null;
  const oz = Math.round(sumWaterOz(entries));
  return (
    <div className="flex items-center gap-1.5 mt-2 mb-1 text-info">
      <Droplet className="w-3.5 h-3.5 shrink-0" />
      <span className="text-xs font-medium">
        {entries.length} glass{entries.length === 1 ? '' : 'es'}{oz > 0 ? ` · ${oz} oz` : ''}
      </span>
    </div>
  );
}

function MealThumb({ src }) {
  // A row keeps its image_url after the blob behind it is gone — the storage GC
  // documented in CLAUDE.md deletes orphans, and a signed URL can expire — so a
  // dead link is a normal state, not an exceptional one. Fall back to the
  // placeholder rather than rendering the browser's broken-image glyph.
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-11 h-11 rounded-lg object-cover bg-secondary/60 shrink-0"
      />
    );
  }
  return (
    <span className="w-11 h-11 rounded-lg bg-secondary/60 flex items-center justify-center shrink-0">
      <ImageIcon className="w-5 h-5 text-muted-foreground/60" />
    </span>
  );
}

function MealRow({ entry, locale, onSelect, index }) {
  const time = formatTime(entry.created_at, locale);
  const macros = MACRO_ORDER
    .map(m => { const v = macroValue(entry, m); return v > 0 ? `${Math.round(v)}${m.short}` : null; })
    .filter(Boolean);
  const meta = [MEAL_TYPE_LABEL[entry.meal_type], time, ...macros].filter(Boolean).join(' · ');

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index, 6) * 0.03, duration: 0.18 }}
      onClick={() => onSelect?.(entry)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(entry); } }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card border border-border/60 hover:border-primary/40 cursor-pointer transition-colors"
    >
      <MealThumb src={entry.image_url} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{entry.food_name}</p>
        {meta && <p className="text-xs text-muted-foreground truncate mt-0.5">{meta}</p>}
      </div>
      <div className="text-end shrink-0">
        <p className="font-heading font-bold text-[15px] leading-none tabular-nums">
          {Math.round(entry.calories || 0)}
        </p>
        <p className="text-micro text-muted-foreground mt-0.5">cal</p>
      </div>
    </motion.div>
  );
}

function DaySection({ dateStr, meals, water, locale, fmt, onSelect }) {
  const totals = useMemo(() => macroTotals(meals), [meals]);
  const hasMeals = meals.length > 0;

  return (
    <div className="mb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading font-bold text-[13px] uppercase tracking-wide truncate">
            {formatDateHeading(dateStr, locale)}
          </p>
          {hasMeals && <MacroChips totals={totals} />}
        </div>
        {hasMeals ? (
          <p className="font-heading font-bold text-[13px] tabular-nums shrink-0">
            {fmt(Math.round(totals.calories))} cal
          </p>
        ) : (
          // Not "0 cal". A day whose only rows were water did not have zero
          // calories — it had no meals logged, which is a different claim.
          <p className="text-xs text-muted-foreground shrink-0">No meals logged</p>
        )}
      </div>

      {hasMeals && (
        <div className="mt-2.5 space-y-1.5">
          {meals.map((entry, i) => (
            <MealRow key={entry.id} entry={entry} locale={locale} onSelect={onSelect} index={i} />
          ))}
        </div>
      )}
      <WaterLine entries={water} />
    </div>
  );
}

/** The payoff for focusing one day: how it sat against goal, and against you. */
function DayFocusCard({ meals, dv, weekAvg, fmt }) {
  const totals = macroTotals(meals);
  const goal = Math.round(dv?.calories || 2000);
  const pct = goal > 0 ? Math.round((totals.calories / goal) * 100) : 0;
  const tone = adherenceOf(totals.calories, goal);
  const delta = weekAvg > 0 ? Math.round(totals.calories - weekAvg) : null;
  const goals = {
    protein: dv?.protein_g || 150,
    carbs:   dv?.carbs_g   || 250,
    fat:     dv?.fat_g     || 67,
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 mb-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="font-heading font-bold text-2xl tabular-nums">{fmt(Math.round(totals.calories))}</span>
          <span className="text-xs font-medium text-muted-foreground truncate">/ {fmt(goal)} cal</span>
        </div>
        {tone && <span className={`text-xs font-bold shrink-0 ${tone.text}`}>{pct}% of goal</span>}
      </div>

      <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-3">
        <motion.div
          className="h-full rounded-full"
          style={{ background: tone ? tone.css : 'hsl(var(--muted-foreground))' }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(pct, 100)}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      <div className="space-y-2 mt-3.5">
        {MACRO_ORDER.map(m => {
          const value = totals[m.key] || 0;
          const target = goals[m.key];
          return (
            <div key={m.key} className="flex items-center gap-2.5">
              <span className="text-micro font-semibold w-12 shrink-0 text-muted-foreground">{m.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ background: m.css, width: `${Math.min((value / Math.max(target, 1)) * 100, 100)}%` }}
                />
              </div>
              <span className="text-micro tabular-nums w-[74px] text-end shrink-0">
                <span className="font-bold">{Math.round(value)}</span>
                <span className="text-muted-foreground"> / {Math.round(target)}g</span>
              </span>
            </div>
          );
        })}
      </div>

      {delta != null && (
        <div className="mt-3.5 pt-3 border-t border-border">
          <p className="text-micro font-bold uppercase tracking-[0.12em] text-muted-foreground">Vs your 7-day average</p>
          <p className={`font-heading font-bold text-base tabular-nums mt-1 ${
            delta > 0 ? 'text-primary' : delta < 0 ? 'text-info' : 'text-muted-foreground'
          }`}>
            {delta > 0 ? '+' : ''}{fmt(delta)} cal
          </p>
          <p className="text-micro text-muted-foreground mt-0.5">
            you averaged {fmt(Math.round(weekAvg))}/day over that window
          </p>
        </div>
      )}
    </div>
  );
}

export default function MealHistoryModal({ open, onClose, userProfile, onLogPhoto, onLogManual }) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const locale = getDateLocale(language);
  const fmt = useNumberFormatter();
  const queryClient = useQueryClient();

  // 'meals' (day list) vs 'trends'. "Pick day" is no longer a tab — choosing a
  // date is a filter on this surface, driven by the week strip or the calendar.
  const [tab, setTab] = useState('meals');
  const [selectedDate, setSelectedDate] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  useBodyScrollLock(open);

  const todayStr = format(new Date(), KEY);

  const { data: rawLogs = [], isLoading } = useQuery({
    queryKey: ['nutritionHistory', user?.email],
    // Newest-logged first (created_at, not just date) so today's latest meal
    // is at the top and the user doesn't have to scroll to their latest entry.
    queryFn: () => db.entities.NutritionLog.filter({ created_by: user.email }, '-created_at', FETCH_LIMIT),
    enabled: !!user?.email && open,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => nutritionData.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutritionHistory', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['nutritionLogs'] });
      setDetail(null);
      toast.success('Meal removed');
    },
    onError: (err) => {
      reportError(err, { feature: 'nutrition.history.delete', userEmail: user?.email });
      toast.error("Couldn't remove that meal");
    },
  });

  const rows = useMemo(() => filterAfterReset(rawLogs, userProfile), [rawLogs, userProfile]);

  // Water is not a meal, but it is also not nothing — it gets one line per day
  // instead of N zero-calorie rows in the meal list.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const entry of rows) {
      const key = entry.date || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }
    return Array.from(map.entries())
      .map(([date, entries]) => ({ date, ...splitWaterEntries(entries) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [rows]);

  const mealDays = useMemo(() => grouped.filter(d => d.meals.length > 0), [grouped]);
  const mealCount = useMemo(() => mealDays.reduce((n, d) => n + d.meals.length, 0), [mealDays]);

  // Days that carry at least one meal, whatever it totalled. Distinct from
  // caloriesByDate: a 0-calorie meal is a logged day with nothing to colour.
  const loggedDates = useMemo(
    () => new Set(grouped.filter(d => d.meals.length > 0).map(d => d.date)),
    [grouped],
  );

  const caloriesByDate = useMemo(() => {
    const map = new Map();
    for (const day of grouped) {
      const total = day.meals.reduce((s, e) => s + (Number(e.calories) || 0), 0);
      if (total > 0) map.set(day.date, total);
    }
    return map;
  }, [grouped]);

  const dv = useMemo(() => calculateDailyValues(userProfile), [userProfile]);
  const goalCal = Math.round(dv?.calories || 2000);

  // The strip window: the trailing 7 days, shifted by whole weeks. Trailing
  // rather than calendar-week so today is always the rightmost bar and the
  // chart is never four-sevenths empty future.
  const weekSeries = useMemo(() => {
    const end = subDays(new Date(), weekOffset * WEEK);
    return Array.from({ length: WEEK }, (_, i) => {
      const date = format(subDays(end, WEEK - 1 - i), KEY);
      return { date, calories: caloriesByDate.get(date) || 0, logged: loggedDates.has(date) };
    });
  }, [caloriesByDate, loggedDates, weekOffset]);

  const weekAvg = useMemo(() => summarise(weekSeries, goalCal).avg, [weekSeries, goalCal]);

  // We only ever fetch the newest FETCH_LIMIT rows, so anything older than the
  // oldest row we hold is UNKNOWN, not unlogged. Both the strip and the
  // calendar stop there rather than drawing empty days over a history we did
  // not read — a hollow cell is a claim, and this is the one place it would be
  // a false one.
  const earliestDate = grouped.length ? grouped[grouped.length - 1].date : todayStr;
  const truncated = rawLogs.length >= FETCH_LIMIT;
  const canGoBack = (weekSeries[0]?.date || todayStr) > earliestDate;

  const visibleDays = useMemo(
    () => (selectedDate ? grouped.filter(d => d.date === selectedDate) : grouped),
    [grouped, selectedDate],
  );

  const openDetail = (entry) =>
    setDetail({ id: entry.id, imageUrl: entry?.image_url || null, result: mealEntryToResult(entry) });

  // Scroll the strip to whichever week contains `date`, so a day picked out of
  // the calendar is never selected off-screen in a window you cannot see.
  const focusWeekOn = (date) => {
    const daysAgo = differenceInCalendarDays(new Date(), parseISO(date));
    if (Number.isFinite(daysAgo)) setWeekOffset(Math.max(0, Math.floor(daysAgo / WEEK)));
  };

  // Tapping the day you are already scoped to clears the filter — the same
  // control both selects and deselects, so there is never a stuck state.
  const toggleDate = (date) => {
    setTab('meals');
    setSelectedDate(prev => (prev === date ? null : date));
  };

  // The calendar always selects: you opened it to go somewhere.
  const selectDate = (date) => {
    setTab('meals');
    setSelectedDate(date);
    focusWeekOn(date);
  };

  const shiftWeek = (delta) => setWeekOffset(prev => Math.max(0, prev - delta));

  if (!open) return null;

  const showChrome = !isLoading && mealCount > 0;

  return (
    <>
      {/* Only the sheet itself belongs inside AnimatePresence. The calendar and
          the meal detail manage their own presence and return null when closed
          — as direct AnimatePresence children that reads as "exiting", and it
          kept the calendar's last render mounted after you picked a day. */}
      <AnimatePresence>
      <motion.div
        key="history-sheet"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          onClick={e => e.stopPropagation()}
          className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-background border border-border flex flex-col"
          style={{ maxHeight: '92vh' }}
        >
          {/* Header — ✕ and swipe-to-dismiss are the close affordances. The
              full-width orange Close button that used to sit in a footer was
              the loudest control on the screen and did nothing but dismiss. */}
          <div className="shrink-0">
            <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
              <span className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex items-center justify-between px-4 pt-2 pb-3">
              <h2 className="font-heading font-bold text-xl tracking-tight">History</h2>
              <div className="flex items-center gap-2">
                {showChrome && (
                  <button
                    type="button"
                    onClick={() => setCalendarOpen(true)}
                    aria-label="Jump to a day"
                    className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground active:bg-secondary/70"
                  >
                    <CalendarIcon className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground active:bg-secondary/70"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {showChrome && (
            <div className="px-4 pb-3 shrink-0 space-y-3">
              <WeekCalorieStrip
                series={weekSeries}
                goal={goalCal}
                selectedDate={selectedDate}
                todayStr={todayStr}
                onSelect={toggleDate}
                onShift={shiftWeek}
                canGoForward={weekOffset > 0}
                canGoBack={canGoBack}
              />
              <div className="flex p-1 rounded-xl bg-secondary/60">
                {[{ id: 'meals', label: 'Meals' }, { id: 'trends', label: 'Trends' }].map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    aria-pressed={tab === t.id}
                    className={`flex-1 h-8 rounded-lg text-[13px] font-semibold transition-colors ${
                      tab === t.id ? 'bg-secondary text-foreground shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 pb-5">
            {isLoading ? (
              <div className="space-y-3 pt-1">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-secondary/40 animate-pulse" />
                ))}
              </div>
            ) : mealCount === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center mb-5">
                  <UtensilsCrossed className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="font-heading font-bold text-lg">No meals logged yet</p>
                <p className="text-sm text-muted-foreground mt-1.5 max-w-[19rem]">
                  Log a meal and it shows up here — grouped by day, with your macros and how that day
                  tracked against your goal.
                </p>
                {(onLogPhoto || onLogManual) && (
                  <div className="w-full mt-6 space-y-2.5">
                    {onLogPhoto && (
                      <button
                        type="button"
                        onClick={() => { onClose?.(); onLogPhoto(); }}
                        className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-heading font-bold text-sm flex items-center justify-center gap-2"
                      >
                        <Camera className="w-4 h-4" /> Log with a photo
                      </button>
                    )}
                    {onLogManual && (
                      <button
                        type="button"
                        onClick={() => { onClose?.(); onLogManual(); }}
                        className="w-full h-12 rounded-lg border border-border font-semibold text-sm flex items-center justify-center gap-2"
                      >
                        <Plus className="w-4 h-4" /> Enter it manually
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : tab === 'trends' ? (
              <NutritionTrendsChart entries={rows} userProfile={userProfile} />
            ) : (
              <>
                {selectedDate && (
                  <div className="flex items-center justify-between gap-3 pb-3">
                    <button
                      type="button"
                      onClick={() => setSelectedDate(null)}
                      className="inline-flex items-center gap-1.5 h-8 ps-3 pe-2.5 rounded-full bg-primary/15 border border-primary/45 text-primary text-xs font-bold uppercase tracking-wide"
                    >
                      {formatDateHeading(selectedDate, locale)}
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(null)}
                      className="text-xs font-semibold text-muted-foreground shrink-0"
                    >
                      Show all days
                    </button>
                  </div>
                )}

                {selectedDate && visibleDays[0]?.meals.length > 0 && (
                  <DayFocusCard meals={visibleDays[0].meals} dv={dv} weekAvg={weekAvg} fmt={fmt} />
                )}

                {visibleDays.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">
                    No meals logged on {formatDateHeading(selectedDate, locale)}.
                  </p>
                ) : (
                  visibleDays.map(day => (
                    <DaySection
                      key={day.date}
                      dateStr={day.date}
                      meals={day.meals}
                      water={day.water}
                      locale={locale}
                      fmt={fmt}
                      onSelect={openDetail}
                    />
                  ))
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
      </AnimatePresence>

      <HistoryCalendarSheet
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        caloriesByDate={caloriesByDate}
        loggedDates={loggedDates}
        goal={goalCal}
        selectedDate={selectedDate}
        todayStr={todayStr}
        earliestDate={earliestDate}
        truncated={truncated}
        onSelect={selectDate}
      />

      {/* Read-only detail for a tapped saved meal (portals above this modal). */}
      <PhotoMealResultModal
        open={!!detail}
        readOnly
        imageUrl={detail?.imageUrl}
        result={detail?.result}
        onClose={() => setDetail(null)}
        onDelete={detail?.id ? () => deleteMutation.mutate(detail.id) : undefined}
      />
    </>
  );
}
