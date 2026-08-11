/**
 * InsightsTab — advanced analytics panel containing:
 *   • Training Age indicator
 *   • TDEE estimate (Mifflin-St Jeor BMR × activity multiplier)
 *   • Projected goal completion date (body weight)
 *   • Muscle imbalance analysis (push/pull/legs share)
 *   • Data export (CSV)
 *
 * Audit 21 (2026-08-10) rewrote most of this file. The findings worth
 * carrying forward, because each one was invisible from the screen:
 *
 *   • **Every date was parsed as UTC.** `new Date('2026-08-07')` is UTC
 *     midnight, which is Aug 6 20:00 in US Eastern — so the card read
 *     "Training since August 6" for a workout logged on the 7th, and the
 *     week buckets were shifted a day, splitting one calendar week's
 *     weekend across two "active weeks". `parseLocalDate` exists in
 *     src/lib/dateUtils.js for exactly this; use it for any `date` column.
 *
 * AUDIT 11 STATUS — all six findings against this file are closed, and the
 * two that are closed by DELETION are recorded here because there is no
 * longer any code for the annotation to sit next to. A grep for the number
 * has to land somewhere or the finding gets re-reported forever, which
 * nearly happened to #7 and #23.
 *
 *   #7  fixed — `useEffect([weightUnit, userId])`, see the comment there.
 *   #22 fixed — 92 keys in `i18n-insights.js`, every string via tFallback.
 *   #23 fixed — `directionMismatch`, see the comment there.
 *   #24 OBSOLETE — the arm-asymmetry block it wanted a `created_at`
 *       tiebreak on is gone; see below. There is nothing left to tiebreak.
 *   #25 fixed — `fmtDate` from `src/lib/intl.js` rather than the audit's
 *       suggested `{ locale: dateLocale }`. CLAUDE.md prefers `Intl` over
 *       importing date-fns locales, so this closes it a different way than
 *       the suggested-fix column says.
 *   #26 OBSOLETE — same removed block as #24.
 *
 *   • **An arm-asymmetry block read columns that do not exist.**
 *     `left_arm_in` / `right_arm_in` / `chest_in` / `waist_in` / `hips_in`
 *     / `*_thigh_in` are not on `body_metrics` and never have been — the
 *     real columns are `waist_cm`, `chest_cm`, `hip_cm`. This file was the
 *     only place in src/ referencing the `_in` names, so the block had
 *     never rendered once and the CSV shipped seven permanently-blank
 *     columns while omitting the three real ones. Verify a column against
 *     the schema before reading it; `select('*')` turns a typo into
 *     `undefined`, which renders as "no data" rather than as an error.
 *
 *   • **`weight_lbs` is `numeric`, so PostgREST can return it as a
 *     STRING.** The regression summed those with `+`, which concatenates.
 *     Coerce with `Number()` before any arithmetic — same trap
 *     `fromLbs` documents in src/lib/weightUnit.js.
 *
 *   • **TDEE double-counted training.** The activity multiplier already
 *     accounts for exercise, and workout + cardio calories were then
 *     added on top of it. Meanwhile sessions/week divided by a fixed 4.3
 *     weeks regardless of how long the account had existed, so a user
 *     four days in with three sessions read 0.7/wk and got the
 *     "lightly active" band. The two errors pointed in opposite
 *     directions and partially cancelled — fixing either one alone moves
 *     the number by roughly a thousand calories.
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/lib/LanguageContext';
import { useDateFormatter, useListFormatter, useNumberFormatter } from '@/lib/intl';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Clock, Flame, Target, BarChart3, Download,
  TrendingDown, TrendingUp,
  Scale, Activity, Dumbbell, Info,
} from 'lucide-react';
import { differenceInDays, addDays, format } from 'date-fns';
import { parseLocalDate } from '@/lib/dateUtils';
import { calcBMR, isKnownSex, activityMultiplier, observedSessionsPerWeek, TDEE_WINDOW_DAYS } from '@/lib/tdee';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, toLbs, formatWeight } from '@/lib/weightUnit';
import { downloadCsv } from '@/lib/downloadCsv';
import { workoutTitle } from '@/lib/workoutTitle';
import { toast } from '@/lib/toast';

// ── Push/pull/legs muscle categorization ──────────────────────────────────────

const PUSH_MUSCLES  = new Set(['chest', 'shoulders', 'triceps', 'anterior deltoid', 'pecs', 'pectorals']);
const PULL_MUSCLES  = new Set(['back', 'biceps', 'rear deltoid', 'lats', 'rhomboids', 'traps', 'trapezius']);
const LEG_MUSCLES   = new Set(['legs', 'quads', 'hamstrings', 'glutes', 'calves', 'hip flexors', 'adductors']);

function categorizeExercise(ex) {
  const groups = [
    ...(ex.muscle_groups || []),
    ...(ex.muscle_group ? [ex.muscle_group] : []),
  ].map(g => String(g).toLowerCase().trim());

  for (const g of groups) {
    if (PUSH_MUSCLES.has(g)) return 'push';
    if (PULL_MUSCLES.has(g)) return 'pull';
    if (LEG_MUSCLES.has(g))  return 'legs';
    // Partial match
    if (g.includes('chest') || g.includes('tricep') || g.includes('shoulder')) return 'push';
    if (g.includes('back')  || g.includes('bicep')  || g.includes('lat'))      return 'pull';
    if (g.includes('leg')   || g.includes('quad')   || g.includes('glute') || g.includes('hamstring')) return 'legs';
  }
  return 'other';
}

// ── TDEE helpers ──────────────────────────────────────────────────────────────

// TDEE_WINDOW_DAYS, TDEE_MIN_WINDOW_DAYS, BMR_SEX_TERM, calcBMR,
// activityMultiplier and observedSessionsPerWeek now live in
// src/lib/tdee.js. They used to be defined here and re-derived, with
// different inputs, inside nutritionDefaults.js — so this card and the
// Nutrition page reported different maintenance figures for the same user
// on the same day. One definition, imported by both. (Audit 21.)

// ── Training age ──────────────────────────────────────────────────────────────

/** Local midnight of the Sunday that starts `d`'s week. */
function startOfLocalWeek(d) {
  const s = new Date(d);
  s.setDate(d.getDate() - d.getDay());
  s.setHours(0, 0, 0, 0);
  return s;
}

function calcTrainingAge(logs) {
  const dated = (logs || [])
    .map(l => parseLocalDate(l?.date))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!dated.length) return null;

  const now = new Date();
  const firstDate = dated[0];
  const totalDays = Math.max(0, differenceInDays(now, firstDate));

  // Count distinct calendar weeks with at least one workout. The key is
  // built with date-fns `format`, not `toISOString` — the latter converts
  // to UTC, which shifts the bucket for anyone west of Greenwich. This is
  // output-as-KEY, which CLAUDE.md's i18n section exempts from the
  // locale-aware formatter.
  const weekSet = new Set(dated.map(d => format(startOfLocalWeek(d), 'yyyy-MM-dd')));
  const activeWeeks = weekSet.size;

  // Total weeks SPANNED, inclusive of the first and current week, so it
  // is measured the same way activeWeeks is and the ratio can never
  // exceed 1. (`differenceInWeeks` truncates, which used to let a
  // two-calendar-week account report a denominator of 1.)
  const totalWeeks = Math.max(
    1,
    Math.round(differenceInDays(startOfLocalWeek(now), startOfLocalWeek(firstDate)) / 7) + 1,
  );
  const consistencyPct = Math.min(100, Math.round((activeWeeks / totalWeeks) * 100));

  return {
    firstDate,
    totalDays,
    totalWeeks,
    activeWeeks,
    consistencyPct,
    // "100% consistent" after a single week is praise nobody earned, and
    // a denominator of 1 makes it unavoidable. Hold the stat until there
    // is a second week for it to be a ratio OF.
    showConsistency: totalWeeks >= 2,
    // Returned structured rather than pre-formatted so the component can
    // pick the singular or plural key. The old code interpolated straight
    // into `${n} days` and rendered "1 days" / "1 months".
    age: totalDays < 30
      ? { unit: 'days',   n: Math.max(1, totalDays) }
      : totalDays < 365
        ? { unit: 'months', n: Math.round(totalDays / 30.4) }
        : { unit: 'years',  n: Math.round(totalDays / 36.5) / 10 },
  };
}

// ── Linear regression ─────────────────────────────────────────────────────────

function linearRegression(points) {
  // points: [{x, y}] where x is day-number, y is value
  const n = points.length;
  if (n < 2) return null;
  const sumX  = points.reduce((s, p) => s + p.x, 0);
  const sumY  = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  // Every entry logged on the same day gives zero x-variance and a
  // slope of ±Infinity, which propagated into an "Invalid Date".
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// ── GOAL STORAGE ──────────────────────────────────────────────────────────────
// Namespaced per user, per the `flexyn.<feature>.<userId>` convention.
// The old key was a bare `flexyn_goal_weight_lbs` shared by every account
// that had ever signed in on the device, so switching accounts showed you
// someone else's goal.
const GOAL_KEY_LEGACY = 'flexyn_goal_weight_lbs';
const goalKey = (userId) => `flexyn.goalWeightLbs.${userId}`;

function loadGoalWeight(userId) {
  if (!userId) return '';
  try {
    const scoped = localStorage.getItem(goalKey(userId));
    if (scoped != null) return parseFloat(scoped) || '';
    // One-time migration off the unscoped key. Whoever opens Insights
    // first inherits it, which is imperfect — but silently dropping a
    // goal someone deliberately set is worse, and the key is removed
    // afterwards so the second account starts clean.
    const legacy = localStorage.getItem(GOAL_KEY_LEGACY);
    if (legacy != null) {
      const n = parseFloat(legacy);
      localStorage.removeItem(GOAL_KEY_LEGACY);
      if (Number.isFinite(n) && n > 0) {
        localStorage.setItem(goalKey(userId), String(n));
        return n;
      }
    }
    return '';
  } catch { return ''; }
}
function saveGoalWeight(userId, v) {
  if (!userId) return;
  try { localStorage.setItem(goalKey(userId), String(v)); } catch { /* private mode */ }
}
function clearGoalWeight(userId) {
  if (!userId) return;
  try { localStorage.removeItem(goalKey(userId)); } catch { /* private mode */ }
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function InsightSection({ icon: Icon, title, color, bg, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
    >
      {/* Resting elevation is a hairline border and no shadow — the two
          levels documented in CLAUDE.md. This carried `border-none
          shadow-sm`, which is the one combination the rule calls out as
          adding nothing a hairline doesn't. */}
      <Card className="p-5 border-border/60 shadow-none overflow-hidden">
        <div className="flex items-center gap-2 mb-2">
          {/* `rounded-sm` is the inner-chrome radius (icon tiles, chips)
              per the radius rhythm in tailwind.config.js. `rounded-xl` is
              a compatibility alias that new code must not reach for. */}
          <div className={`w-8 h-8 rounded-sm ${bg} flex items-center justify-center shrink-0`}>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
          <h3 className="font-heading font-bold text-sm">{title}</h3>
        </div>
        {children}
      </Card>
    </motion.div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function InsightsTab({ logs, cardioLogs, bodyMetrics, userProfile }) {
  const { weightUnit } = useWeightUnit();
  const { tFallback } = useLanguage();
  const fmtDate = useDateFormatter();
  const fmtNum  = useNumberFormatter();
  const fmtList = useListFormatter();
  const navigate = useNavigate();
  const userId = userProfile?.id;

  /** Count-aware lookup: picks the `.one` / `.other` variant. */
  const tCount = useCallback((base, n, oneEn, otherEn, vars) => (
    tFallback(
      `${base}.${n === 1 ? 'one' : 'other'}`,
      n === 1 ? oneEn : otherEn,
      { n: fmtNum(n), ...vars },
    )
  ), [tFallback, fmtNum]);

  const [goalWeightInput, setGoalWeightInput] = useState('');
  // Bumped on save/clear so the projection memo re-reads localStorage.
  // The old code depended on `goalWeightInput`, which recomputed the whole
  // projection on every keystroke while still reading the OLD stored value.
  const [goalRevision, setGoalRevision] = useState(0);

  // Re-format the input from the stored lbs value whenever the user or
  // the unit changes. Without the unit half, flipping lb ↔ kg left the
  // input box and the "Goal" pill below disagreeing for the rest of the
  // session. (Audit 11 #7.)
  useEffect(() => {
    const stored = loadGoalWeight(userId);
    setGoalWeightInput(stored ? String(Math.round(fromLbs(stored, weightUnit) * 10) / 10) : '');
  }, [weightUnit, userId]);

  // ── Training Age ───────────────────────────────────────────────────────────
  const trainingAge = useMemo(() => calcTrainingAge(logs), [logs]);

  // ── Muscle Imbalance ───────────────────────────────────────────────────────
  const muscleImbalance = useMemo(() => {
    const vol = { push: 0, pull: 0, legs: 0, other: 0 };
    for (const log of logs || []) {
      for (const ex of log.exercises || []) {
        const cat = categorizeExercise(ex);
        const v = (ex.sets || []).reduce(
          (s, set) => s + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0,
        );
        vol[cat] += v;
      }
    }
    const categorized = vol.push + vol.pull + vol.legs;
    // Volume with no muscle group assigned tells us nothing about push/pull
    // balance. It used to sit in the DENOMINATOR while having no bar, so
    // the three percentages silently failed to sum to 100 — and a user
    // whose every exercise was uncategorized got three 0% bars instead of
    // the empty state, which is the "must not render as zeros" case.
    if (categorized === 0) return null;

    const total = categorized + vol.other;
    const pct = v => Math.round((v / categorized) * 100);
    const ratio = vol.push > 0 && vol.pull > 0
      ? Math.round((vol.push / vol.pull) * 100) / 100
      : null;

    return {
      vol,
      pPush: pct(vol.push),
      pPull: pct(vol.pull),
      pLegs: pct(vol.legs),
      uncategorizedPct: Math.round((vol.other / total) * 100),
      ratio,
      balanced: ratio !== null && ratio >= 0.8 && ratio <= 1.2,
      // An infinite imbalance used to render as nothing at all: `ratio`
      // was null whenever pull was 0, and the whole indicator was hidden
      // behind a `ratio !== null` guard — so the one user the feature
      // exists for saw no warning.
      pushOnly: vol.push > 0 && vol.pull === 0,
      pullOnly: vol.pull > 0 && vol.push === 0,
    };
  }, [logs]);

  // ── TDEE ───────────────────────────────────────────────────────────────────
  const tdee = useMemo(() => {
    const weightKg = userProfile?.weight_kg
      ? parseFloat(userProfile.weight_kg)
      : userProfile?.weight_lbs
        ? parseFloat(userProfile.weight_lbs) * 0.453592
        : null;
    const heightCm = userProfile?.height_cm
      ? parseFloat(userProfile.height_cm)
      : userProfile?.height_inches
        ? parseFloat(userProfile.height_inches) * 2.54
        : null;
    const age  = userProfile?.age ? parseInt(userProfile.age) : null;
    const sex  = (userProfile?.gender || '').toLowerCase();

    // Computed BEFORE the bail-out. It used to be assembled only on the
    // success path, where all three inputs are present by construction —
    // so the "Partial estimate — add X" banner could never render, and
    // the empty state listed all three fields as missing even when two
    // were on file.
    const missingFields = [
      !weightKg && 'weight',
      !heightCm && 'height',
      !age      && 'age',
    ].filter(Boolean);

    // Pass the value through rather than collapsing everything that is not
    // 'female' into 'male'. calcBMR owns the unknown case.
    const knownSex = isKnownSex(sex);
    const bmr = calcBMR({ weightKg, heightCm, age, sex });
    if (!bmr) return { hasData: false, missingFields };

    const { sessionsPerWeek, windowDays } = observedSessionsPerWeek({ logs, cardioLogs });
    const multiplier = activityMultiplier(sessionsPerWeek);

    // The activity multiplier IS the exercise term — Mifflin-St Jeor's
    // bands are defined by training frequency. Adding measured workout
    // and cardio calories on top of it counted training twice.
    const totalTDEE = Math.round(bmr * multiplier);

    return {
      hasData: true,
      bmr: Math.round(bmr),
      totalTDEE,
      sessionsPerWeek: Math.round(sessionsPerWeek * 10) / 10,
      multiplier,
      windowDays,
      missingFields,
      // Surfaced, not folded into missingFields — that list gates the
      // "cannot compute" state, and an unknown sex still yields a usable
      // estimate. This one narrows the estimate rather than blocking it,
      // so it renders as a note beside the number.
      sexAssumed: !knownSex,
    };
  }, [logs, cardioLogs, userProfile]);

  // ── Projected goal ─────────────────────────────────────────────────────────
  const weighIns = useMemo(() => (
    (bodyMetrics || [])
      .filter(m => m?.weight_lbs != null && m?.date)
      .map(m => ({ d: parseLocalDate(m.date), w: Number(m.weight_lbs) }))
      // `weight_lbs` is a numeric column, which PostgREST can hand back
      // as a string. `sumY` then concatenated instead of adding.
      .filter(m => m.d && Number.isFinite(m.w))
      .sort((a, b) => a.d - b.d)
  ), [bodyMetrics]);

  // Drives the Clear button. Read separately from `projection` because a
  // goal can be stored while the projection is null (a flat trend, or
  // every weigh-in on one day), and Clear has to stay reachable there.
  // `goalRevision` reads as unnecessary to exhaustive-deps because the
  // value it invalidates lives in localStorage, which the rule cannot
  // see. It is the whole mechanism: bumping it on save/clear is what
  // makes these two memos re-read storage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hasStoredGoal = useMemo(() => !!loadGoalWeight(userId), [userId, goalRevision]);

  const projection = useMemo(() => {
    if (weighIns.length < 2) return null;

    const firstDate = weighIns[0].d;
    const reg = linearRegression(weighIns.map(m => ({
      x: differenceInDays(m.d, firstDate),
      y: m.w,
    })));
    if (!reg || Math.abs(reg.slope) < 0.001) return null;

    const currentWeightLbs = weighIns[weighIns.length - 1].w;
    const storedGoalLbs    = loadGoalWeight(userId);
    if (!storedGoalLbs) return { needsGoal: true, currentWeightLbs };

    // Detect direction mismatch: if the trend slope is positive (gaining)
    // but the user's goal is below current weight (or vice versa), the
    // projection date math produces a date in the past, which the old
    // code mis-labeled as "Already reached 🎉". (Audit 11 #23.)
    const goalDirection = Math.sign(storedGoalLbs - currentWeightLbs); // +1 = need to gain, -1 = need to lose
    const slopeDirection = Math.sign(reg.slope);
    const directionMismatch = goalDirection !== 0 && slopeDirection !== 0 && goalDirection !== slopeDirection;

    const daysToGoal = (storedGoalLbs - reg.intercept) / reg.slope;
    const projectedDate = Number.isFinite(daysToGoal) ? addDays(firstDate, Math.round(daysToGoal)) : null;
    const daysFromNow   = projectedDate ? differenceInDays(projectedDate, new Date()) : 0;

    return {
      currentWeightLbs,
      goalLbs: storedGoalLbs,
      projectedDate,
      daysFromNow,
      ratePerWeek: Math.abs(reg.slope * 7),
      losing: reg.slope < 0,
      directionMismatch,
      needsGoal: false,
    };
    // goalRevision: see the note on hasStoredGoal above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weighIns, userId, goalRevision]);

  const handleSetGoal = () => {
    const inDisplayUnit = parseFloat(goalWeightInput);
    if (!Number.isFinite(inDisplayUnit) || inDisplayUnit <= 0) {
      // Silently returning here made the Set button look dead.
      toast.error(tFallback('insights.goal.invalid', 'Enter a goal weight above 0 first.'));
      return;
    }
    // `toLbs` handles all three units. This used to divide by 0.453592
    // unconditionally, which is the kg factor — so a 12 st goal was
    // stored as 26.5 lb and read back as 1.9 st. Stone is selectable in
    // Settings, so this was reachable, not theoretical.
    const inLbs = toLbs(inDisplayUnit, weightUnit);
    saveGoalWeight(userId, inLbs);
    setGoalWeightInput(String(Math.round(fromLbs(inLbs, weightUnit) * 10) / 10));
    setGoalRevision(r => r + 1);
    toast.success(tFallback('insights.goal.saved', 'Goal weight saved'));
  };

  const handleClearGoal = () => {
    clearGoalWeight(userId);
    setGoalWeightInput('');
    setGoalRevision(r => r + 1);
    toast.success(tFallback('insights.goal.cleared', 'Goal weight cleared'));
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  // Headers stay English on purpose — a CSV is an interchange file, and a
  // localized header breaks whatever script or sheet the user pipes it into.

  const runExport = async (rows, filename, emptyMsg) => {
    // rows[0] is the header, so a 1-length array means nothing matched.
    if (rows.length <= 1) { toast.error(emptyMsg); return; }
    const res = await downloadCsv(rows, filename);
    if (!res.ok) {
      toast.error(tFallback('insights.export.failed', 'Could not export that file.'));
      return;
    }
    if (res.cancelled) return;
    toast.success(tCount('insights.export.done', rows.length - 1, 'Exported {n} row', 'Exported {n} rows'));
  };

  const exportWorkouts = () => {
    // `workout_logs` has no `regimen_name` column and never has — the client
    // wrote it on every save, db.js's strip-and-retry dropped it, and the row
    // persisted without it. So this read was `undefined` for every log ever
    // written and the fallback was doing 100% of the work. `workoutTitle`
    // owns the real column (`title`) and still tolerates `regimen_name` for
    // the Coach's in-memory shape. Fixed on the write side in b5043ac5.
    //
    // The fallback IS localized even though the headers above are not: a
    // header is schema, and translating it breaks whatever script the file
    // is piped into, but this cell is a human-readable label the app made up
    // about the user's own session. `progress.lastWorkout.freestyle` already
    // names this exact concept — don't add a second key for it.
    const freestyle = tFallback('progress.lastWorkout.freestyle', 'Freestyle Session');
    const rows = [['Date', 'Workout', 'Exercise', 'Set', `Weight (${weightUnit})`, 'Reps', 'Volume']];
    for (const log of logs || []) {
      for (const ex of log.exercises || []) {
        (ex.sets || []).forEach((s, si) => {
          const w = Math.round(fromLbs(s.weight || 0, weightUnit) * 10) / 10;
          const reps = Number(s.reps) || 0;
          rows.push([
            log.date || '',
            workoutTitle(log) || freestyle,
            ex.name || '',
            si + 1,
            w,
            reps,
            Math.round(w * reps * 10) / 10,
          ]);
        });
      }
    }
    return runExport(rows, 'flexyn-workouts.csv',
      tFallback('insights.export.noWorkouts', 'No workout data to export.'));
  };

  const exportBodyMetrics = () => {
    // These are the columns `body_metrics` actually has. The previous
    // header promised chest/waist/hips/arms/thighs in INCHES — none of
    // which exist — and omitted the three real centimetre columns, so
    // every row was blank past the body-fat column.
    const rows = [['Date', `Weight (${weightUnit})`, 'Body Fat %', 'Waist (cm)', 'Chest (cm)', 'Hip (cm)', 'Notes']];
    for (const m of bodyMetrics || []) {
      rows.push([
        m.date || '',
        m.weight_lbs != null ? Math.round(fromLbs(m.weight_lbs, weightUnit) * 10) / 10 : '',
        m.body_fat_pct != null ? m.body_fat_pct : '',
        m.waist_cm ?? '',
        m.chest_cm ?? '',
        m.hip_cm ?? '',
        m.notes || '',
      ]);
    }
    return runExport(rows, 'flexyn-body-metrics.csv',
      tFallback('insights.export.noBody', 'No body metric entries to export.'));
  };

  const exportCardio = () => {
    const rows = [['Date', 'Activity', 'Distance (m)', 'Duration (s)', 'Calories', 'Avg HR', 'Notes']];
    for (const l of cardioLogs || []) {
      rows.push([
        l.date || '', l.activity_type || '', l.distance_meters || 0,
        l.duration_seconds || 0, l.calories || 0, l.avg_heart_rate ?? '', l.notes || '',
      ]);
    }
    return runExport(rows, 'flexyn-cardio.csv',
      tFallback('insights.export.noCardio', 'No cardio data to export.'));
  };

  const workoutCount = logs?.length || 0;
  const bodyCount    = bodyMetrics?.length || 0;
  const cardioCount  = cardioLogs?.length || 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  // `--fluid-section` rather than a typed `space-y-4`: Progress is a
  // converted surface (see the fluid-scale section of CLAUDE.md) and 16px
  // is in the banned middle register when hand-typed.
  return (
    <div className="flex flex-col" style={{ gap: 'var(--fluid-section)' }}>

      {/* ── Training Age ────────────────────────────────────────────────── */}
      <InsightSection
        icon={Clock}
        title={tFallback('insights.trainingAge.title', 'Training Age')}
        color="text-primary"
        bg="bg-primary/10"
      >
        {!trainingAge ? (
          <p className="text-sm text-muted-foreground">
            {tFallback('insights.trainingAge.empty', 'Log your first workout to see your training age.')}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <div>
                <p className="font-heading font-black text-3xl text-primary">
                  {tCount(
                    `insights.trainingAge.${trainingAge.age.unit}`,
                    trainingAge.age.n,
                    `{n} ${trainingAge.age.unit.slice(0, -1)}`,
                    `{n} ${trainingAge.age.unit}`,
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {/* `fmtDate` is language-bound; date-fns `format` binds no
                      locale, so this rendered English month names under a
                      fully-translated screen. (Audit 11 #25.) */}
                  {tFallback('insights.trainingAge.since', 'Training since {date}', {
                    date: fmtDate(trainingAge.firstDate, { dateStyle: 'long' }),
                  })}
                </p>
              </div>
              {trainingAge.showConsistency && (
                <div className="ms-auto text-end pb-1">
                  <p className="font-heading font-bold text-xl text-foreground">{trainingAge.consistencyPct}%</p>
                  <p className="text-xs text-muted-foreground">
                    {tFallback('insights.trainingAge.consistent', 'consistent')}
                  </p>
                </div>
              )}
            </div>

            {trainingAge.showConsistency ? (
              <>
                {/* Consistency bar */}
                <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${trainingAge.consistencyPct}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
                <div className="flex justify-between text-micro text-muted-foreground">
                  <span>{tCount('insights.trainingAge.activeWeeks', trainingAge.activeWeeks, '{n} active week', '{n} active weeks')}</span>
                  <span>{tCount('insights.trainingAge.totalWeeks', trainingAge.totalWeeks, '{n} total week', '{n} total weeks')}</span>
                </div>
              </>
            ) : (
              <p className="text-micro text-muted-foreground">
                {tFallback('insights.trainingAge.tooEarly', 'Consistency unlocks after two weeks of training.')}
              </p>
            )}

            {/* Experience badge */}
            <div>
              {trainingAge.totalDays < 90 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-success/10 text-success">
                  {tFallback('insights.trainingAge.beginner', '🌱 Beginner — building the habit')}
                </span>
              )}
              {trainingAge.totalDays >= 90 && trainingAge.totalDays < 365 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-info/10 text-info">
                  {tFallback('insights.trainingAge.intermediate', '💪 Intermediate — forming real strength')}
                </span>
              )}
              {trainingAge.totalDays >= 365 && trainingAge.totalDays < 730 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                  {tFallback('insights.trainingAge.advanced', '🔥 Advanced — 1+ year dedicated athlete')}
                </span>
              )}
              {trainingAge.totalDays >= 730 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                  {tFallback('insights.trainingAge.elite', '⚡ Elite — 2+ years of consistent training')}
                </span>
              )}
            </div>
          </div>
        )}
      </InsightSection>

      {/* ── TDEE ────────────────────────────────────────────────────────── */}
      <InsightSection
        icon={Flame}
        title={tFallback('insights.tdee.title', 'TDEE Estimate')}
        color="text-primary"
        bg="bg-primary/10"
      >
        {!tdee.hasData ? (
          <div className="flex flex-col gap-2 items-start">
            <p className="text-sm text-muted-foreground">
              {/* `fmtList`, not `.join(', ')` — the separator is locale
                  data. Arabic joins with `و` and Japanese with `、`, and
                  English gets the "and" a join cannot produce. The last
                  hardcoded piece of copy in this file. (Audit 11 #22.) */}
              {tFallback('insights.tdee.incomplete', 'Add your {fields} in Settings to get a TDEE estimate.', {
                fields: fmtList(tdee.missingFields
                  .map(f => tFallback(`insights.tdee.field.${f}`, f === 'weight' ? 'body weight' : f))),
              })}
            </p>
            <Button size="sm" variant="outline" onClick={() => navigate('/settings')}>
              {tFallback('insights.tdee.openSettings', 'Open Settings')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tdee.windowDays < TDEE_WINDOW_DAYS && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-primary/10 border border-primary/20">
                <Info className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-primary">
                  {tFallback(
                    'insights.tdee.earlyEstimate',
                    'Early estimate — based on {n} days of training. It will sharpen as you log more.',
                    { n: fmtNum(tdee.windowDays) },
                  )}
                </p>
              </div>
            )}

            {/* Says the estimate is assuming, in the same banner the
                short-window case uses. Without it the card rendered a
                confident figure built on a coin-flip for 83% of users —
                and it is the number the Cut / Bulk targets below are
                derived from. */}
            {tdee.sexAssumed && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-secondary/50 border border-border">
                <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  {tFallback(
                    'insights.tdee.sexAssumed',
                    'Estimated between the male and female formulas. Add your gender in Settings to sharpen it.',
                  )}
                </p>
              </div>
            )}

            <div>
              <p className="font-heading font-black text-3xl text-primary">{fmtNum(tdee.totalTDEE)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tFallback('insights.tdee.perDay', 'cal / day estimated')}
              </p>
            </div>

            {/* Fixed count of three — a grid is correct here; tileRow() is
                for collections whose count comes from data. */}
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  label: tFallback('insights.tdee.bmr', 'BMR'),
                  value: fmtNum(tdee.bmr),
                  note:  tFallback('insights.tdee.bmrNote', 'at rest'),
                },
                {
                  label: tFallback('insights.tdee.sessions', 'Sessions/wk'),
                  value: fmtNum(tdee.sessionsPerWeek, { maximumFractionDigits: 1 }),
                  note:  tFallback('insights.tdee.sessionsNote', 'last {n} days', { n: fmtNum(tdee.windowDays) }),
                },
                {
                  label: tFallback('insights.tdee.multiplier', 'Activity'),
                  value: `×${fmtNum(tdee.multiplier, { maximumFractionDigits: 3 })}`,
                  note:  tFallback('insights.tdee.multiplierNote', 'multiplier'),
                },
              ].map(row => (
                <div key={row.label} className="bg-secondary/50 rounded-lg p-2.5 text-center">
                  <p className="font-heading font-bold text-sm text-foreground">{row.value}</p>
                  <p className="text-micro text-muted-foreground font-medium">{row.label}</p>
                  <p className="text-micro text-muted-foreground/60">{row.note}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50">
              <div className="text-center">
                <p className="text-xs font-semibold text-foreground">
                  {tFallback('insights.tdee.cal', '{n} cal', { n: fmtNum(Math.round(tdee.totalTDEE * 0.85)) })}
                </p>
                <p className="text-micro text-muted-foreground">{tFallback('insights.tdee.cut', 'Cut (−15%)')}</p>
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-foreground">
                  {tFallback('insights.tdee.cal', '{n} cal', { n: fmtNum(Math.round(tdee.totalTDEE * 1.1)) })}
                </p>
                <p className="text-micro text-muted-foreground">{tFallback('insights.tdee.bulk', 'Bulk (+10%)')}</p>
              </div>
            </div>
          </div>
        )}
      </InsightSection>

      {/* ── Projected Goal ───────────────────────────────────────────────── */}
      <InsightSection
        icon={Target}
        title={tFallback('insights.goal.title', 'Projected Goal Date')}
        color="text-success"
        bg="bg-success/10"
      >
        {weighIns.length < 2 ? (
          // The old copy said "in the Body tab". Body-metric logging was
          // removed from that tab (see BodyMetricsTab.jsx) and the only
          // writer of a BodyMetric row is LogWeightModal on Dashboard — so
          // this told the user to do something that could not be done.
          <div className="flex flex-col gap-2 items-start">
            <p className="text-sm text-muted-foreground">
              {tFallback('insights.goal.empty', 'Log at least 2 body weight entries to see a projection.')}
            </p>
            <Button size="sm" variant="outline" onClick={() => navigate('/dashboard?logWeight=1')}>
              <Scale className="w-4 h-4 me-2" />
              {tFallback('insights.goal.emptyCta', 'Log your weight')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Goal weight input */}
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">
                {tFallback('insights.goal.yourGoal', 'Your goal weight')}
              </p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={tFallback('insights.goal.placeholder', 'Goal in {unit}', { unit: weightUnit })}
                  value={goalWeightInput}
                  onChange={(e) => setGoalWeightInput(e.target.value)}
                  className="flex-1 h-9 text-sm"
                />
                <Button size="sm" onClick={handleSetGoal} className="h-9 px-4 shrink-0">
                  {tFallback('insights.goal.set', 'Set')}
                </Button>
                {/* Without this there was no way to unset a goal once
                    saved — clearing the field and pressing Set did nothing. */}
                {hasStoredGoal && (
                  <Button size="sm" variant="ghost" onClick={handleClearGoal} className="h-9 px-3 shrink-0">
                    {tFallback('insights.goal.clear', 'Clear')}
                  </Button>
                )}
              </div>
            </div>

            {projection && !projection.needsGoal && (
              <div className="flex flex-col gap-2">
                <div className="flex items-end gap-2">
                  <div>
                    <p className={`font-heading font-black text-2xl ${projection.directionMismatch ? 'text-primary' : 'text-success'}`}>
                      {projection.directionMismatch
                        ? tFallback('insights.goal.wrongWay', 'Trending wrong way')
                        : projection.daysFromNow > 0 && projection.projectedDate
                          ? fmtDate(projection.projectedDate, { dateStyle: 'medium' })
                          : tFallback('insights.goal.reached', 'Already reached! 🎉')}
                    </p>
                    {projection.directionMismatch ? (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {tFallback(
                          'insights.goal.wrongWayNote',
                          'Your weight is moving away from your goal at {rate}/week.',
                          { rate: formatWeight(projection.ratePerWeek, weightUnit, 1) },
                        )}
                      </p>
                    ) : projection.daysFromNow > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {tCount(
                          'insights.goal.daysAway', projection.daysFromNow,
                          '{n} day away · {rate}/week pace', '{n} days away · {rate}/week pace',
                          { rate: formatWeight(projection.ratePerWeek, weightUnit, 1) },
                        )}
                      </p>
                    )}
                  </div>
                  <div className="ms-auto flex items-center gap-1.5 pb-1">
                    {projection.losing
                      ? <TrendingDown className="w-4 h-4 text-success" />
                      : <TrendingUp   className="w-4 h-4 text-primary" />
                    }
                    <span className="text-xs text-muted-foreground">
                      {projection.losing
                        ? tFallback('insights.goal.losing', 'losing weight')
                        : tFallback('insights.goal.gaining', 'gaining weight')}
                    </span>
                  </div>
                </div>

                {/* Current vs goal */}
                <div className="flex gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{tFallback('insights.goal.current', 'Current')}</p>
                    <p className="text-sm font-bold">{formatWeight(projection.currentWeightLbs, weightUnit)}</p>
                  </div>
                  <div className="w-px bg-border" />
                  <div>
                    <p className="text-xs text-muted-foreground">{tFallback('insights.goal.goal', 'Goal')}</p>
                    <p className="text-sm font-bold text-success">{formatWeight(projection.goalLbs, weightUnit)}</p>
                  </div>
                  <div className="w-px bg-border" />
                  <div>
                    <p className="text-xs text-muted-foreground">{tFallback('insights.goal.remaining', 'Remaining')}</p>
                    <p className="text-sm font-bold">
                      {formatWeight(Math.abs(projection.currentWeightLbs - projection.goalLbs), weightUnit)}
                    </p>
                  </div>
                </div>

                <p className="text-micro text-muted-foreground">
                  {tFallback('insights.goal.disclaimer', 'Based on your logged weight trend. Actual results vary with diet and training changes.')}
                </p>
              </div>
            )}
          </div>
        )}
      </InsightSection>

      {/* ── Muscle Imbalance ─────────────────────────────────────────────── */}
      <InsightSection
        icon={BarChart3}
        title={tFallback('insights.balance.title', 'Muscle Imbalance')}
        color="text-info"
        bg="bg-info/10"
      >
        {!muscleImbalance ? (
          <p className="text-sm text-muted-foreground">
            {tFallback('insights.balance.empty', 'Log workouts with muscle groups assigned to see your push/pull balance.')}
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Push/pull ratio indicator */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {tFallback('insights.balance.ratioLabel', 'Push / Pull ratio')}
                </span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  muscleImbalance.balanced ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
                }`}>
                  {muscleImbalance.pushOnly
                    ? tFallback('insights.balance.pushOnly', 'No pull volume')
                    : muscleImbalance.pullOnly
                      ? tFallback('insights.balance.pullOnly', 'No push volume')
                      : muscleImbalance.balanced
                        ? tFallback('insights.balance.balanced', '✓ Balanced')
                        : muscleImbalance.ratio > 1.2
                          ? tFallback('insights.balance.pushDominant', '↑ Push-dominant')
                          : tFallback('insights.balance.pullDominant', '↑ Pull-dominant')}
                </span>
              </div>
              {muscleImbalance.ratio !== null ? (
                <div className="text-center mb-2">
                  <p className="font-heading font-black text-2xl text-foreground">
                    {fmtNum(muscleImbalance.ratio, { maximumFractionDigits: 2 })}:1
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tFallback('insights.balance.ideal', 'Ideal is ~1:1 · yours is {side}', {
                      side: muscleImbalance.ratio > 1
                        ? tFallback('insights.balance.morePush', 'more push')
                        : tFallback('insights.balance.morePull', 'more pull'),
                    })}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {muscleImbalance.pushOnly
                    ? tFallback('insights.balance.pushOnlyNote', 'All your logged volume is push. Add rows or pulldowns to balance your shoulders out.')
                    : tFallback('insights.balance.pullOnlyNote', 'All your logged volume is pull. Add presses to balance it out.')}
                </p>
              )}
            </div>

            {/* Volume breakdown bars — shares of CATEGORIZED volume, so
                they sum to 100. Uncategorized volume is called out below
                rather than silently eating a slice of the denominator. */}
            <div className="flex flex-col gap-2">
              {[
                { key: 'push', label: tFallback('insights.balance.push', 'Push (chest/shoulders/triceps)'), pct: muscleImbalance.pPush, color: 'bg-info' },
                { key: 'pull', label: tFallback('insights.balance.pull', 'Pull (back/biceps)'),             pct: muscleImbalance.pPull, color: 'bg-success' },
                { key: 'legs', label: tFallback('insights.balance.legs', 'Legs (quads/hamstrings/glutes)'), pct: muscleImbalance.pLegs, color: 'bg-primary' },
              ].map(row => (
                <div key={row.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground font-medium">{row.label}</span>
                    <span className="font-bold">{row.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${row.color}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${row.pct}%` }}
                      transition={{ duration: 0.7, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              ))}
              <p className="text-micro text-muted-foreground">
                {tFallback('insights.balance.shareNote', 'Share of volume with a muscle group assigned.')}
                {muscleImbalance.uncategorizedPct > 0 && (
                  <> {tFallback(
                    'insights.balance.uncategorized',
                    '{n}% of your volume has no muscle group assigned and is not counted here.',
                    { n: fmtNum(muscleImbalance.uncategorizedPct) },
                  )}</>
                )}
              </p>
            </div>
          </div>
        )}
      </InsightSection>

      {/* ── Data Export ──────────────────────────────────────────────────── */}
      {/* Neutral chrome, not `text-slate-500` — a raw Tailwind hue sits
          outside the four-hue system and doesn't move with the theme. */}
      <InsightSection
        icon={Download}
        title={tFallback('insights.export.title', 'Export My Data')}
        color="text-muted-foreground"
        bg="bg-secondary"
      >
        <p className="text-sm text-muted-foreground mb-6">
          {tFallback('insights.export.desc', 'Download your data as CSV files, compatible with Excel, Google Sheets, and Apple Health apps.')}
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="outline" className="w-full justify-start gap-2" onClick={exportWorkouts}>
            <Dumbbell className="w-4 h-4 text-primary shrink-0" />
            <div className="text-start">
              <p className="text-sm font-semibold">{tFallback('insights.export.workouts', 'Workout Logs')}</p>
              <p className="text-xs text-muted-foreground">
                {tCount('insights.export.workoutsSub', workoutCount, '{n} session · all exercises & sets', '{n} sessions · all exercises & sets')}
              </p>
            </div>
            <Download className="w-3.5 h-3.5 text-muted-foreground ms-auto" />
          </Button>

          <Button variant="outline" className="w-full justify-start gap-2" onClick={exportBodyMetrics}>
            <Scale className="w-4 h-4 text-success shrink-0" />
            <div className="text-start">
              <p className="text-sm font-semibold">{tFallback('insights.export.body', 'Body Metrics')}</p>
              <p className="text-xs text-muted-foreground">
                {tCount('insights.export.bodySub', bodyCount, '{n} entry · weight, body fat, measurements', '{n} entries · weight, body fat, measurements')}
              </p>
            </div>
            <Download className="w-3.5 h-3.5 text-muted-foreground ms-auto" />
          </Button>

          <Button variant="outline" className="w-full justify-start gap-2" onClick={exportCardio}>
            <Activity className="w-4 h-4 text-destructive shrink-0" />
            <div className="text-start">
              <p className="text-sm font-semibold">{tFallback('insights.export.cardio', 'Cardio Logs')}</p>
              <p className="text-xs text-muted-foreground">
                {tCount('insights.export.cardioSub', cardioCount, '{n} session · runs, cycling, etc.', '{n} sessions · runs, cycling, etc.')}
              </p>
            </div>
            <Download className="w-3.5 h-3.5 text-muted-foreground ms-auto" />
          </Button>
        </div>
      </InsightSection>
    </div>
  );
}
