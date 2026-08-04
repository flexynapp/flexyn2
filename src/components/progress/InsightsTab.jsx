/**
 * InsightsTab — advanced analytics panel containing:
 *   • Training Age indicator
 *   • TDEE estimate (BMR + activity + workout calories)
 *   • Projected goal completion date (body weight)
 *   • Muscle imbalance analysis (push/pull/legs ratio)
 *   • Data export (CSV)
 */
import React, { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Clock, Flame, Target, BarChart3, Download,
  TrendingDown, TrendingUp,
  Scale, Activity, Dumbbell, Info,
} from 'lucide-react';
import { format, differenceInDays, differenceInWeeks, addDays } from 'date-fns';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, formatWeight } from '@/lib/weightUnit';
import { toast } from '@/lib/toast';

// ── Push/pull/legs muscle categorization ──────────────────────────────────────

const PUSH_MUSCLES  = new Set(['chest', 'shoulders', 'triceps', 'anterior deltoid', 'pecs', 'pectorals']);
const PULL_MUSCLES  = new Set(['back', 'biceps', 'rear deltoid', 'lats', 'rhomboids', 'traps', 'trapezius']);
const LEG_MUSCLES   = new Set(['legs', 'quads', 'hamstrings', 'glutes', 'calves', 'hip flexors', 'adductors']);

function categorizeExercise(ex) {
  const groups = [
    ...(ex.muscle_groups || []),
    ...(ex.muscle_group ? [ex.muscle_group] : []),
  ].map(g => g.toLowerCase().trim());

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

/** Mifflin-St Jeor BMR */
function calcBMR({ weightKg, heightCm, age, sex }) {
  if (!weightKg || !heightCm || !age) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

/** Activity multiplier based on workouts/week */
function activityMultiplier(sessionsPerWeek) {
  if (sessionsPerWeek <= 0) return 1.2;
  if (sessionsPerWeek <= 2) return 1.375;
  if (sessionsPerWeek <= 4) return 1.55;
  if (sessionsPerWeek <= 6) return 1.725;
  return 1.9;
}

// ── Training age ──────────────────────────────────────────────────────────────

function calcTrainingAge(logs) {
  if (!logs?.length) return null;
  const sorted = [...logs].filter(l => l.date).sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;

  const firstDate = new Date(sorted[0].date);
  const totalDays = differenceInDays(new Date(), firstDate);
  const totalWeeks = Math.max(1, differenceInWeeks(new Date(), firstDate));

  // Count weeks with at least one workout
  const weekSet = new Set();
  for (const log of sorted) {
    const d = new Date(log.date);
    // ISO week key
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    weekSet.add(weekStart.toISOString().slice(0, 10));
  }
  const activeWeeks = weekSet.size;
  const consistencyPct = Math.min(100, Math.round((activeWeeks / totalWeeks) * 100));

  return {
    firstDate,
    totalDays,
    totalWeeks,
    activeWeeks,
    consistencyPct,
    label: totalDays < 30
      ? `${totalDays} days`
      : totalDays < 365
        ? `${Math.round(totalDays / 30.4)} months`
        : `${(totalDays / 365).toFixed(1)} years`,
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
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// ── GOAL STORAGE ──────────────────────────────────────────────────────────────
const GOAL_KEY = 'flexyn_goal_weight_lbs';
function loadGoalWeight() { try { return parseFloat(localStorage.getItem(GOAL_KEY)) || ''; } catch { return ''; } }
function saveGoalWeight(v) { try { localStorage.setItem(GOAL_KEY, v); } catch {} }

// ── DATA EXPORT ───────────────────────────────────────────────────────────────

function exportWorkoutsCSV(logs, weightUnit) {
  const rows = [['Date', 'Workout', 'Exercise', 'Set', `Weight (${weightUnit})`, 'Reps', 'Volume']];
  for (const log of logs) {
    for (const ex of log.exercises || []) {
      (ex.sets || []).forEach((s, si) => {
        const w = Math.round(fromLbs(s.weight || 0, weightUnit) * 10) / 10;
        rows.push([
          log.date || '',
          log.regimen_name || 'Freestyle',
          ex.name || '',
          si + 1,
          w,
          s.reps || 0,
          Math.round(w * (s.reps || 0) * 10) / 10,
        ]);
      });
    }
  }
  downloadCSV(rows, 'flexyn-workouts.csv');
}

function exportBodyMetricsCSV(bodyMetrics, weightUnit) {
  const rows = [['Date', `Weight (${weightUnit})`, 'Body Fat %', 'Chest (in)', 'Waist (in)', 'Hips (in)', 'L Arm (in)', 'R Arm (in)', 'L Thigh (in)', 'R Thigh (in)', 'Notes']];
  for (const m of bodyMetrics) {
    rows.push([
      m.date || '',
      m.weight_lbs != null ? Math.round(fromLbs(m.weight_lbs, weightUnit) * 10) / 10 : '',
      m.body_fat_pct != null ? m.body_fat_pct : '',
      m.chest_in || '', m.waist_in || '', m.hips_in || '',
      m.left_arm_in || '', m.right_arm_in || '',
      m.left_thigh_in || '', m.right_thigh_in || '',
      (m.notes || '').replace(/,/g, ' '),
    ]);
  }
  downloadCSV(rows, 'flexyn-body-metrics.csv');
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function InsightSection({ icon: Icon, title, color, bg, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
    >
      <Card className="p-5 border-none shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 mb-4">
          <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
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
  const { language } = useLanguage();
  const dateLocale = getDateLocale(language);
  const [goalWeightInput, setGoalWeightInput] = useState(() => {
    const stored = loadGoalWeight();
    return stored ? String(Math.round(fromLbs(stored, weightUnit) * 10) / 10) : '';
  });

  // If the user flips lb ↔ kg after opening Insights, re-format the
  // input from the stored lbs value so the displayed goal matches the
  // current unit. Without this, input box and "Goal" pill below
  // disagreed for the rest of the session. (Audit 11 #7.)
  useEffect(() => {
    const stored = loadGoalWeight();
    if (stored) {
      setGoalWeightInput(String(Math.round(fromLbs(stored, weightUnit) * 10) / 10));
    }
  }, [weightUnit]);

  // ── Training Age ───────────────────────────────────────────────────────────
  const trainingAge = useMemo(() => calcTrainingAge(logs), [logs]);

  // ── Muscle Imbalance ───────────────────────────────────────────────────────
  const muscleImbalance = useMemo(() => {
    const vol = { push: 0, pull: 0, legs: 0, other: 0 };
    for (const log of logs) {
      for (const ex of log.exercises || []) {
        const cat = categorizeExercise(ex);
        const v = (ex.sets || []).reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0);
        vol[cat] += v;
      }
    }
    const total = vol.push + vol.pull + vol.legs + vol.other;
    if (total === 0) return null;
    const pPush = Math.round((vol.push / total) * 100);
    const pPull = Math.round((vol.pull / total) * 100);
    const pLegs = Math.round((vol.legs / total) * 100);
    const ratio = vol.pull > 0 ? Math.round((vol.push / vol.pull) * 100) / 100 : null;
    const balanced = ratio !== null && ratio >= 0.8 && ratio <= 1.2;
    return { vol, total, pPush, pPull, pLegs, ratio, balanced };
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

    const bmr = calcBMR({ weightKg, heightCm, age, sex: sex === 'female' ? 'female' : 'male' });
    if (!bmr) return null;

    // Weekly sessions from last 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const recentLogs   = logs.filter(l => l.date && new Date(l.date) >= cutoff);
    const recentCardio = cardioLogs.filter(l => l.date && new Date(l.date) >= cutoff);
    const sessionsPerWeek = (recentLogs.length + recentCardio.length) / 4.3;
    const multiplier = activityMultiplier(sessionsPerWeek);

    const baseTDEE = Math.round(bmr * multiplier);

    // Extra calories from recent workouts (~4–6 kcal / set)
    const workoutCalsPerDay = recentLogs.reduce((sum, log) => {
      const sets = (log.exercises || []).reduce((s, ex) => s + (ex.sets?.length || 0), 0);
      return sum + sets * 5;
    }, 0) / 30;

    const cardioCalsPerDay = recentCardio.reduce((sum, l) => sum + (l.calories || 0), 0) / 30;

    const totalTDEE = Math.round(baseTDEE + workoutCalsPerDay + cardioCalsPerDay);

    return {
      bmr: Math.round(bmr),
      baseTDEE,
      totalTDEE,
      sessionsPerWeek: Math.round(sessionsPerWeek * 10) / 10,
      multiplier,
      hasData: true,
      missingFields: [
        !weightKg && 'body weight',
        !heightCm && 'height',
        !age      && 'age',
      ].filter(Boolean),
    };
  }, [logs, cardioLogs, userProfile]);

  // ── Projected goal ─────────────────────────────────────────────────────────
  const projection = useMemo(() => {
    const sortedMetrics = [...(bodyMetrics || [])]
      .filter(m => m.weight_lbs != null && m.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (sortedMetrics.length < 2) return null;

    const firstDate = new Date(sortedMetrics[0].date);
    const points = sortedMetrics.map(m => ({
      x: differenceInDays(new Date(m.date), firstDate),
      y: m.weight_lbs,
    }));
    const reg = linearRegression(points);
    if (!reg || Math.abs(reg.slope) < 0.001) return null;

    const currentWeightLbs = sortedMetrics[sortedMetrics.length - 1].weight_lbs;
    const storedGoalLbs    = loadGoalWeight();
    if (!storedGoalLbs) return { needsGoal: true, currentWeightLbs, reg, firstDate };

    // Detect direction mismatch: if the trend slope is positive (gaining)
    // but the user's goal is below current weight (or vice versa), the
    // projection date math produces a date in the past, which the old
    // code mis-labeled as "Already reached 🎉". Now we flag the trend
    // as trending-away-from-goal so the user sees "Trending the wrong
    // direction" instead of a false celebration. (Audit 11 #23.)
    const goalDirection = Math.sign(storedGoalLbs - currentWeightLbs); // +1 = need to gain, -1 = need to lose
    const slopeDirection = Math.sign(reg.slope);
    const directionMismatch = goalDirection !== 0 && slopeDirection !== 0 && goalDirection !== slopeDirection;

    const daysToGoal = (storedGoalLbs - reg.intercept) / reg.slope;
    const projectedDate = addDays(firstDate, Math.round(daysToGoal));
    const daysFromNow   = differenceInDays(projectedDate, new Date());

    return {
      currentWeightLbs,
      goalLbs: storedGoalLbs,
      projectedDate,
      daysFromNow,
      ratePerWeek: Math.abs(reg.slope * 7),
      losing: reg.slope < 0,
      directionMismatch,
      reg,
      firstDate,
      needsGoal: false,
    };
  }, [bodyMetrics, goalWeightInput]); // goalWeightInput dep refreshes when user sets goal

  const handleSetGoal = () => {
    const inDisplayUnit = parseFloat(goalWeightInput);
    if (!inDisplayUnit || isNaN(inDisplayUnit)) return;
    const inLbs = weightUnit === 'lbs' ? inDisplayUnit : inDisplayUnit / 0.453592;
    saveGoalWeight(inLbs);
    // trigger re-compute by forcing a re-render
    setGoalWeightInput(String(Math.round(fromLbs(inLbs, weightUnit) * 10) / 10));
    toast.success('Goal weight saved!');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const empty = !logs?.length;

  return (
    <div className="space-y-4">

      {/* ── Training Age ────────────────────────────────────────────────── */}
      <InsightSection icon={Clock} title="Training Age" color="text-primary" bg="bg-primary/10">
        {!trainingAge ? (
          <p className="text-sm text-muted-foreground">Log your first workout to see your training age.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <div>
                <p className="font-heading font-black text-3xl text-primary">{trainingAge.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Training since {format(trainingAge.firstDate, 'MMMM d, yyyy', { locale: dateLocale })}
                </p>
              </div>
              <div className="ml-auto text-end pb-1">
                <p className="font-heading font-bold text-xl text-foreground">{trainingAge.consistencyPct}%</p>
                <p className="text-xs text-muted-foreground">consistent</p>
              </div>
            </div>

            {/* Consistency bar */}
            <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${trainingAge.consistencyPct}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{trainingAge.activeWeeks} active weeks</span>
              <span>{trainingAge.totalWeeks} total weeks</span>
            </div>

            {/* Experience badge */}
            <div className="mt-1">
              {trainingAge.totalDays < 90 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-success/10 text-success">
                  🌱 Beginner — building the habit
                </span>
              )}
              {trainingAge.totalDays >= 90 && trainingAge.totalDays < 365 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-info/10 text-info">
                  💪 Intermediate — forming real strength
                </span>
              )}
              {trainingAge.totalDays >= 365 && trainingAge.totalDays < 730 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                  🔥 Advanced — 1+ year dedicated athlete
                </span>
              )}
              {trainingAge.totalDays >= 730 && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                  ⚡ Elite — 2+ years of consistent training
                </span>
              )}
            </div>
          </div>
        )}
      </InsightSection>

      {/* ── TDEE ────────────────────────────────────────────────────────── */}
      <InsightSection icon={Flame} title="TDEE Estimate" color="text-primary" bg="bg-primary/10">
        {!tdee ? (
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Complete your profile to get a TDEE estimate.
            </p>
            <div className="flex gap-2 flex-wrap">
              {['body weight', 'height', 'age'].map(f => (
                <span key={f} className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                  {f} needed
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {tdee.missingFields.length > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-primary/10 border border-primary/20">
                <Info className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-primary dark:text-primary">
                  Partial estimate — add {tdee.missingFields.join(', ')} in your profile for accuracy.
                </p>
              </div>
            )}

            <div className="flex items-end gap-3">
              <div>
                <p className="font-heading font-black text-3xl text-primary">{tdee.totalTDEE.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-0.5">cal / day estimated</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'BMR',        value: tdee.bmr.toLocaleString(),       note: 'at rest' },
                { label: 'Base TDEE',  value: tdee.baseTDEE.toLocaleString(),  note: `×${tdee.multiplier} activity` },
                { label: 'Sessions/wk', value: tdee.sessionsPerWeek,           note: 'last 30 days' },
              ].map(row => (
                <div key={row.label} className="bg-secondary/50 rounded-lg p-2.5 text-center">
                  <p className="font-heading font-bold text-sm text-foreground">{row.value}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">{row.label}</p>
                  <p className="text-[9px] text-muted-foreground/60">{row.note}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50">
              <div className="text-center">
                <p className="text-xs font-semibold text-foreground">{Math.round(tdee.totalTDEE * 0.85).toLocaleString()} cal</p>
                <p className="text-[10px] text-muted-foreground">Cut (−15%)</p>
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-foreground">{Math.round(tdee.totalTDEE * 1.1).toLocaleString()} cal</p>
                <p className="text-[10px] text-muted-foreground">Bulk (+10%)</p>
              </div>
            </div>
          </div>
        )}
      </InsightSection>

      {/* ── Projected Goal ───────────────────────────────────────────────── */}
      <InsightSection icon={Target} title="Projected Goal Date" color="text-success" bg="bg-success/10">
        {!bodyMetrics?.length || bodyMetrics.filter(m => m.weight_lbs != null).length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Log at least 2 body weight entries in the Body tab to see a projection.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Goal weight input */}
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">Your goal weight</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder={`Goal in ${weightUnit}`}
                  value={goalWeightInput}
                  onChange={(e) => setGoalWeightInput(e.target.value)}
                  className="flex-1 h-9 text-sm"
                />
                <Button size="sm" onClick={handleSetGoal} className="h-9 px-4 shrink-0">
                  Set
                </Button>
              </div>
            </div>

            {projection && !projection.needsGoal && (
              <div className="space-y-3">
                <div className="flex items-end gap-3">
                  <div>
                    <p className={`font-heading font-black text-2xl ${projection.directionMismatch ? 'text-primary' : 'text-success'}`}>
                      {projection.directionMismatch
                        ? 'Trending wrong way'
                        : projection.daysFromNow > 0
                          ? format(projection.projectedDate, 'MMM d, yyyy', { locale: dateLocale })
                          : 'Already reached! 🎉'}
                    </p>
                    {projection.directionMismatch ? (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Your weight is moving away from your goal at {formatWeight(projection.ratePerWeek, weightUnit)}/week.
                      </p>
                    ) : projection.daysFromNow > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {projection.daysFromNow} days away ·{' '}
                        {formatWeight(projection.ratePerWeek, weightUnit)}/week pace
                      </p>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-1.5 pb-1">
                    {projection.losing
                      ? <TrendingDown className="w-4 h-4 text-success" />
                      : <TrendingUp   className="w-4 h-4 text-primary" />
                    }
                    <span className="text-xs text-muted-foreground">
                      {projection.losing ? 'losing' : 'gaining'} weight
                    </span>
                  </div>
                </div>

                {/* Current vs goal */}
                <div className="flex gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Current</p>
                    <p className="text-sm font-bold">{formatWeight(projection.currentWeightLbs, weightUnit)}</p>
                  </div>
                  <div className="w-px bg-border" />
                  <div>
                    <p className="text-xs text-muted-foreground">Goal</p>
                    <p className="text-sm font-bold text-success">{formatWeight(projection.goalLbs, weightUnit)}</p>
                  </div>
                  <div className="w-px bg-border" />
                  <div>
                    <p className="text-xs text-muted-foreground">Remaining</p>
                    <p className="text-sm font-bold">
                      {formatWeight(Math.abs(projection.currentWeightLbs - projection.goalLbs), weightUnit)}
                    </p>
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground">
                  Based on your logged weight trend. Actual results vary with diet and training changes.
                </p>
              </div>
            )}
          </div>
        )}
      </InsightSection>

      {/* ── Muscle Imbalance ─────────────────────────────────────────────── */}
      <InsightSection icon={BarChart3} title="Muscle Imbalance" color="text-info" bg="bg-info/10">
        {!muscleImbalance ? (
          <p className="text-sm text-muted-foreground">
            Log workouts with muscle groups assigned to see your push/pull balance.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Push/pull ratio indicator */}
            {muscleImbalance.ratio !== null && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Push / Pull ratio</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    muscleImbalance.balanced
                      ? 'bg-success/10 text-success'
                      : 'bg-primary/10 text-primary'
                  }`}>
                    {muscleImbalance.balanced ? '✓ Balanced' : muscleImbalance.ratio > 1.2 ? '↑ Push-dominant' : '↑ Pull-dominant'}
                  </span>
                </div>
                <div className="text-center mb-2">
                  <p className="font-heading font-black text-2xl text-foreground">{muscleImbalance.ratio}:1</p>
                  <p className="text-xs text-muted-foreground">
                    Ideal is ~1:1 · yours is {muscleImbalance.ratio > 1 ? 'more push' : 'more pull'}
                  </p>
                </div>
              </div>
            )}

            {/* Volume breakdown bars */}
            {[
              { key: 'push', label: 'Push (chest/shoulders/triceps)', pct: muscleImbalance.pPush, color: 'bg-info' },
              { key: 'pull', label: 'Pull (back/biceps)',              pct: muscleImbalance.pPull, color: 'bg-success' },
              { key: 'legs', label: 'Legs (quads/hamstrings/glutes)', pct: muscleImbalance.pLegs, color: 'bg-primary' },
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

            {/* Left/right arm asymmetry from body metrics if available */}
            {bodyMetrics?.length > 0 && (() => {
              // Tiebreak on created_at desc so two same-day entries
              // pick the more-recently-logged one, not whichever the
              // server returned first. (Audit 11 #24.)
              const latest = [...bodyMetrics]
                .filter(m => m.left_arm_in && m.right_arm_in)
                .sort((a, b) => {
                  const dCmp = (b.date || '').localeCompare(a.date || '');
                  if (dCmp !== 0) return dCmp;
                  return (b.created_at || '').localeCompare(a.created_at || '');
                })[0];
              if (!latest) return null;
              const diff = Math.abs(latest.left_arm_in - latest.right_arm_in);
              if (diff < 0.1) return null;
              const dominant = latest.right_arm_in > latest.left_arm_in ? 'Right' : 'Left';
              return (
                <div className="mt-2 p-3 rounded-xl bg-secondary/50">
                  <p className="text-xs font-semibold mb-0.5">Arm circumference asymmetry</p>
                  <p className="text-xs text-muted-foreground">
                    {dominant} arm is {diff.toFixed(1)}" larger · as of {format(new Date(latest.date), 'MMM d, yyyy', { locale: dateLocale })}
                  </p>
                </div>
              );
            })()}
          </div>
        )}
      </InsightSection>

      {/* ── Data Export ──────────────────────────────────────────────────── */}
      <InsightSection icon={Download} title="Export My Data" color="text-slate-500" bg="bg-slate-500/10">
        <p className="text-sm text-muted-foreground mb-4">
          Download your data as CSV files, compatible with Excel, Google Sheets, and Apple Health apps.
        </p>
        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-3"
            onClick={() => {
              if (!logs?.length) { toast.error('No workout data to export.'); return; }
              exportWorkoutsCSV(logs, weightUnit);
              toast.success(`Exported ${logs.length} workout${logs.length === 1 ? '' : 's'}`);
            }}
          >
            <Dumbbell className="w-4 h-4 text-primary shrink-0" />
            <div className="text-start">
              <p className="text-sm font-semibold">Workout Logs</p>
              <p className="text-xs text-muted-foreground">{logs?.length || 0} sessions · all exercises & sets</p>
            </div>
            <Download className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start gap-3"
            onClick={() => {
              if (!bodyMetrics?.length) { toast.error('No body metric entries to export.'); return; }
              exportBodyMetricsCSV(bodyMetrics, weightUnit);
              toast.success(`Exported ${bodyMetrics.length} body metric entries`);
            }}
          >
            <Scale className="w-4 h-4 text-success shrink-0" />
            <div className="text-start">
              <p className="text-sm font-semibold">Body Metrics</p>
              <p className="text-xs text-muted-foreground">{bodyMetrics?.length || 0} entr{(bodyMetrics?.length || 0) === 1 ? 'y' : 'ies'} · weight, measurements</p>
            </div>
            <Download className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start gap-3"
            onClick={() => {
              if (!cardioLogs?.length) { toast.error('No cardio data to export.'); return; }
              const rows = [['Date', 'Activity', 'Distance (m)', 'Duration (s)', 'Calories', 'Avg HR', 'Notes']];
              for (const l of cardioLogs) {
                rows.push([l.date || '', l.activity_type || '', l.distance_meters || 0, l.duration_seconds || 0, l.calories || 0, l.avg_heart_rate || '', (l.notes || '').replace(/,/g, ' ')]);
              }
              downloadCSV(rows, 'flexyn-cardio.csv');
              toast.success(`Exported ${cardioLogs.length} cardio sessions`);
            }}
          >
            <Activity className="w-4 h-4 text-destructive shrink-0" />
            <div className="text-start">
              <p className="text-sm font-semibold">Cardio Logs</p>
              <p className="text-xs text-muted-foreground">{cardioLogs?.length || 0} sessions · runs, cycling, etc.</p>
            </div>
            <Download className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
          </Button>
        </div>
      </InsightSection>
    </div>
  );
}
