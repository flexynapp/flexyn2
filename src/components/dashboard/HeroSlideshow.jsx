// src/components/dashboard/HeroSlideshow.jsx
//
// Replaces the bare "N day streak" hero block with one of three
// adaptive modes:
//
//   1. ACHIEVEMENTS — auto-rotating carousel of the user's recent
//      wins (PRs, completed goals, level-ups, milestone capsules,
//      streak milestones). Triggered when the user has anything to
//      celebrate. Cycles every 6s, manual nav via dots.
//
//   2. PATH — calculated step ladder for brand-new users with no
//      activity yet. Pulls signals from onboarding (fitness_goals_arr,
//      fitness_level, weight_lbs vs target_weight_lbs, target_date)
//      to generate realistic milestones: "Log workout 1" →
//      "First-week complete" → "First PR (week 2)" →
//      "Goal: <their actual target>".
//
//   3. STREAK — falls back to the original streak hero (the existing
//      "0 day streak — start today" copy) for the narrow window
//      where neither achievements nor a path apply (e.g., a returning
//      user post-account-reset).
//
// All three modes preserve the same outer chrome (gradient mesh +
// grid texture + right-CTA column) — only the LEFT content slot
// swaps.
//
// Wired into Dashboard.jsx's HeroCard. The achievements + path slide
// arrays are derived from data that's already loaded into Dashboard
// (logs, cardioLogs, goals, profile, user) so this component adds
// ZERO extra network calls.

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flame, Trophy, TrendingUp, Award, Zap, Sparkles,
  Calendar, CheckCircle2, Dumbbell, Footprints, ChevronRight,
  Swords, Camera,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';

const ROTATE_MS = 8000;

/**
 * Count-up animation primitive — eases from 0 (or `from`) to `to`
 * over `durationMs`. Used inside slides so a "195 lb Bench Press"
 * appears with the number ticking up from 0 to 195 (a few ms per
 * frame, ~1.4s total). Re-keys on `to` change so flipping between
 * slides re-fires the animation.
 *
 * Pure DOM ticker (no framer-motion dependency for the number)
 * so we can format the displayed value as integer or decimal.
 */
// Helper — once per module, capture the user's reduced-motion
// preference. Browsers without window/matchMedia (SSR, very old)
// degrade to "motion allowed" since the worst case is the animation
// still plays — never silently broken.
const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};

function AnimatedNumber({ from = 0, to, durationMs = 1400, decimals = 0, suffix = '' }) {
  const safeFrom = Number.isFinite(from) ? from : 0;
  const [val, setVal] = useState(safeFrom);
  const startRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (!Number.isFinite(to)) { setVal(0); return; }
    // Honor reduced-motion: snap to the target value with no tween.
    // Also short-circuit no-op animations (from === to) so we don't
    // schedule ~84 frames of busywork for a 0 → 0 case (e.g. Path
    // Step 1 "0 logged" for a brand-new user).
    if (safeFrom === to || prefersReducedMotion()) { setVal(to); return; }
    startRef.current = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3); // ease-out cubic
    const tick = (now) => {
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const cur = safeFrom + (to - safeFrom) * ease(t);
      setVal(cur);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, durationMs, safeFrom]);

  const safeVal = Number.isFinite(val) ? val : 0;
  return <>{safeVal.toFixed(decimals)}{suffix}</>;
}

/**
 * Tiny inline sparkline — accepts an array of numeric Y values and
 * renders them as a smoothed SVG polyline. Used for per-exercise
 * weight-history visualization on PR slides ("here's how your bench
 * has progressed over the last 8 sessions"). Width is responsive;
 * height is fixed at 32px so it fits cleanly under the slide title
 * without crowding the gradient hero.
 *
 * The line animates IN via stroke-dasharray on mount — draws left-
 * to-right over 1s — so the user sees their progress emerge rather
 * than appear instantly.
 */
function Sparkline({ values, color = '#fff', height = 32 }) {
  const W = 140;
  const H = height;
  if (!Array.isArray(values) || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const trueRange = max - min;
  const stepX = W / (values.length - 1);
  const pad = 4;
  // When every value is identical (steady plateau — e.g. user has
  // bench-pressed 185 lb for 8 sessions in a row), the original
  // formula `(v-min)/range = 0` mapped every point to the BOTTOM
  // edge of the chart — visually implying a downward trend on what's
  // actually a flat line. Wave 59 code review caught this. Centerline
  // is the honest render of an all-identical series.
  const midY = H / 2;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = trueRange === 0
      ? midY
      : pad + (H - pad * 2) * (1 - (v - min) / trueRange);
    return [x, y];
  });
  // Smoothed path via per-segment quadratic curves (Catmull-Rom-ish
  // approximation — soft but cheap).
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    const [px, py] = points[i - 1];
    const cx = (px + x) / 2;
    d += ` Q ${cx} ${py} ${cx} ${(py + y) / 2} T ${x} ${y}`;
  }

  // Draw animation: stroke-dasharray with the path length, then
  // animate dashoffset from full-length down to 0 over 1s.
  // Reduced-motion: skip the draw-in and show the full path
  // immediately. Wave 59 caught this — accessibility users get the
  // info without the motion.
  const PATH_LEN = W * 1.6; // approximation — bigger than actual path so the draw fully completes
  const reduce = prefersReducedMotion();
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce
          ? { strokeDasharray: 'none', strokeDashoffset: 0, opacity: 1 }
          : { strokeDasharray: PATH_LEN, strokeDashoffset: PATH_LEN, opacity: 0.6 }}
        animate={reduce
          ? { strokeDashoffset: 0, opacity: 1 }
          : { strokeDashoffset: 0, opacity: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 1, ease: [0.22, 1, 0.36, 1] }}
      />
      {/* Endpoint dot — highlights the latest data point */}
      <motion.circle
        cx={points[points.length - 1][0]}
        cy={points[points.length - 1][1]}
        r="3"
        fill={color}
        initial={reduce ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.4, delay: 0.9 }}
      />
    </svg>
  );
}

/**
 * Linear progress bar with an animated fill width. Used on path
 * slides to show "current → target" state (e.g. current weight on
 * the journey to target). The fill ramps from 0% to its computed
 * pct on mount.
 */
function ProgressBar({ pct = 0, startLabel = '', endLabel = '', currentLabel, targetLabel }) {
  // Number.isFinite filters NaN/Infinity that would otherwise slip
  // through `pct || 0` (NaN is falsy → 0, but Infinity is truthy).
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const reduce = prefersReducedMotion();
  return (
    <div className="mt-2">
      <div className="relative h-1.5 rounded-full bg-white/15 overflow-hidden">
        <motion.div
          className="absolute inset-y-0 start-0 rounded-full bg-white"
          initial={reduce ? { width: `${safePct}%` } : { width: '0%' }}
          animate={{ width: `${safePct}%` }}
          transition={reduce ? { duration: 0 } : { duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        />
      </div>
      <div className="flex items-center justify-between mt-1 text-[10px] text-white/55">
        <span>{startLabel}{currentLabel != null && ` · ${currentLabel}`}</span>
        <span>{endLabel}{targetLabel != null && ` · ${targetLabel}`}</span>
      </div>
    </div>
  );
}

/**
 * Compute the list of achievement slides from already-loaded dashboard
 * data. Each slide is { id, icon, iconBg, kicker, title, sub, when }
 * — no React nodes, so this can be memoized cleanly.
 */
function buildAchievementSlides({ logs, cardioLogs, goals, profile }) {
  const slides = [];
  const now = Date.now();
  const RECENT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  // 1) Recent PRs from workout_logs. Per-exercise max-weight pass:
  //    for each exercise, find the heaviest single set and check if it
  //    landed in the last 30 days as a new high vs all prior sets.
  if (Array.isArray(logs) && logs.length > 1) {
    const byExercise = new Map(); // name -> [{date, weight, log}]
    for (const log of logs) {
      const exs = Array.isArray(log.exercises) ? log.exercises : [];
      for (const ex of exs) {
        const name = (ex.name || ex.exercise_name || '').trim();
        if (!name) continue;
        const sets = Array.isArray(ex.sets) ? ex.sets : [];
        let maxW = 0;
        for (const s of sets) {
          const w = Number(s.weight);
          if (Number.isFinite(w) && w > maxW) maxW = w;
        }
        if (maxW > 0) {
          if (!byExercise.has(name)) byExercise.set(name, []);
          byExercise.get(name).push({ date: log.date || log.created_date, weight: maxW });
        }
      }
    }
    for (const [name, entries] of byExercise) {
      // Sort by parsed timestamp — `localeCompare` on the raw strings
      // breaks when entries mix 'YYYY-MM-DD' (log.date) with full ISO
      // datetimes (log.created_date), because '2026-06-02' sorts AFTER
      // '2026-06-01T23:00:00Z' as text. Coercing to Date.getTime()
      // makes the ordering format-agnostic.
      entries.sort((a, b) => (new Date(a.date).getTime() || 0) - (new Date(b.date).getTime() || 0));
      let priorMax = 0;
      let recentPR = null;
      for (const e of entries) {
        if (e.weight > priorMax) {
          const when = e.date ? new Date(e.date).getTime() : 0;
          if (when && now - when <= RECENT_MS && priorMax > 0) {
            recentPR = { name, weight: e.weight, prev: priorMax, when };
          }
          priorMax = e.weight;
        }
      }
      if (recentPR) {
        // Build a compact weight-history series for the inline
        // sparkline — last 8 attempts on THIS exercise, deduped per
        // date. When a user does multiple sessions of the same
        // exercise on one day, keep the HEAVIEST (not the first) so
        // the sparkline endpoint reflects the PR rather than the
        // morning warmup. Wave 59 code review caught this — the
        // previous first-write-wins dedupe could make a 195 lb PR
        // slide show an endpoint dot at the morning's 135 lb light
        // set, misleading the user about where their PR landed.
        const maxByDate = new Map();
        for (const e of entries) {
          const dKey = String(e.date).slice(0, 10);
          const prev = maxByDate.get(dKey);
          if (prev == null || e.weight > prev) maxByDate.set(dKey, e.weight);
        }
        // Preserve chronological order (Map insertion order = sort
        // order since `entries` is already sorted ascending).
        const history = Array.from(maxByDate.values());
        const sparkSeries = history.slice(-8);
        slides.push({
          id: `pr:${name}:${recentPR.when}`,
          icon: Trophy, iconBg: 'bg-amber-400/20',
          kicker: 'Personal Record',
          // The title is now JUST the exercise name. The big number
          // (weight) renders separately so it can animate.
          title: name,
          metricValue: recentPR.weight,
          metricUnit: 'lb',
          metricUnitKey: 'hero.unit.lb',
          metricDelta: recentPR.weight - recentPR.prev,
          metricDeltaUnit: 'lb',
          metricDeltaUnitKey: 'hero.unit.lb',
          metricDeltaSuffix: ' from last best',
          metricDeltaSuffixKey: 'hero.deltaSuffix.fromLastBest',
          history: sparkSeries.length >= 2 ? sparkSeries : null,
          when: recentPR.when,
        });
      }
    }
  }

  // 2) Completed goals in the last 30 days.
  if (Array.isArray(goals)) {
    for (const g of goals) {
      if (g.status !== 'completed') continue;
      const when = g.completed_at ? new Date(g.completed_at).getTime() : 0;
      if (!when || now - when > RECENT_MS) continue;
      // If the goal had a numeric target (target_value), surface it
      // as the animated number — gives users a concrete win to
      // see-and-celebrate. Otherwise just show the goal title.
      const tv = Number(g.target_value);
      const slide = {
        id: `goal:${g.id}`,
        icon: CheckCircle2, iconBg: 'bg-emerald-400/20',
        kicker: 'Goal Completed',
        title: g.title || 'Goal hit',
        sub: g.description?.slice(0, 60) || 'Set the next one.',
        when,
      };
      if (Number.isFinite(tv) && tv > 0) {
        slide.metricValue = tv;
        slide.metricUnit = g.unit || '';
      }
      slides.push(slide);
    }
  }

  // 3) Level-up — surface the most recent level-up via profile.current_level
  //    and the level-up timestamp if available. We can only show this when
  //    profile.last_level_up_at is present.
  if (profile?.current_level > 1 && profile?.last_level_up_at) {
    const when = new Date(profile.last_level_up_at).getTime();
    if (when && now - when <= RECENT_MS) {
      slides.push({
        id: `level:${profile.current_level}:${when}`,
        icon: Award, iconBg: 'bg-violet-400/20',
        kicker: 'Level Up',
        title: 'You leveled up',
        // Animated level number — ticks from the PREVIOUS level to
        // the new one (e.g. 4 → 5) so the user sees the delta, not
        // "Level 0 → 1 → 2 → 3 → 4 → 5" from zero which feels off.
        // Wave 59 code review caught this.
        metricValue: profile.current_level,
        metricFrom: Math.max(0, profile.current_level - 1),
        metricUnit: '',
        metricPrefix: 'Level ',
        sub: `${(profile.total_xp ?? 0).toLocaleString()} XP earned overall`,
        when,
      });
    }
  }

  // 4) Streak milestones — 7, 14, 30, 60, 100 days
  const streak = Number(profile?.workout_streak) || 0;
  if ([7, 14, 30, 60, 100].includes(streak)) {
    slides.push({
      id: `streak:${streak}`,
      icon: Flame, iconBg: 'bg-orange-400/20',
      kicker: 'Streak Milestone',
      title: "You're on fire",
      metricValue: streak,
      metricUnit: ' day streak',
      sub: streak >= 30 ? 'Habit locked in.' : 'Keep the momentum.',
      when: now,
    });
  }

  // 5) Recent cardio milestone — only the HIGHEST tier they've hit.
  // Iterating high→low and breaking after the first match prevents the
  // same 11km run from generating both "First 5K" AND "First 10K"
  // slides (the user gets a "First 10K" — they've already accepted
  // they ran more than 5K when they ran 10).
  if (Array.isArray(cardioLogs) && cardioLogs.length) {
    const FIRSTS = [
      { meters: 21097, label: 'Half Marathon' },
      { meters: 10000, label: 'First 10K' },
      { meters: 5000,  label: 'First 5K' },
    ];
    for (const f of FIRSTS) {
      const hit = cardioLogs.find(l => Number(l.distance_meters) >= f.meters);
      if (!hit) continue;
      const when = hit.date ? new Date(hit.date).getTime() : 0;
      if (!when || now - when > RECENT_MS) continue;
      const km = Number(hit.distance_meters) / 1000;
      const sec = Number(hit.duration_seconds);
      const avgKmh = sec > 0 && Number.isFinite(km) ? km / (sec / 3600) : null;
      slides.push({
        id: `cardio:${f.meters}:${when}`,
        icon: Footprints, iconBg: 'bg-cyan-400/20',
        kicker: 'Distance Milestone',
        title: f.label,
        metricValue: km,
        metricUnit: ' km',
        metricDecimals: 1,
        // Guard avg km/h — without the Number.isFinite check a zero or
        // missing duration produced "NaN km/h" / "Infinity km/h" in
        // the subtitle. Falls back to the duration-only line when we
        // can't compute a finite pace.
        sub: sec > 0
          ? (avgKmh != null && Number.isFinite(avgKmh)
              ? `${Math.round(sec / 60)} min · avg ${avgKmh.toFixed(1)} km/h`
              : `${Math.round(sec / 60)} min`)
          : 'Distance logged',
        when,
      });
      break; // only the top-tier milestone per session
    }
  }

  // Sort newest first, cap at 6.
  return slides.sort((a, b) => (b.when || 0) - (a.when || 0)).slice(0, 6);
}

/**
 * Build the new-user calculated path. Driven entirely by onboarding
 * signals + the user's primary fitness goal. Each step carries
 * meaningful live metrics (current → target) so the slide isn't
 * just text — it animates with a count-up + progress bar showing
 * exactly where the user is on the journey.
 */
function buildPathSlides({ profile, user, logs }) {
  if (!profile && !user) return [];
  const p = profile || user || {};
  const goals = Array.isArray(p.fitness_goals_arr) ? p.fitness_goals_arr
              : typeof p.fitness_goals === 'string' && p.fitness_goals
                ? p.fitness_goals.split(',').map(s => s.trim()).filter(Boolean)
                : [];
  const primaryGoal = goals[0] || 'general_fitness';
  const level = p.fitness_level || 'beginner';
  const trainingDays = Array.isArray(p.training_days) ? p.training_days.length : 0;

  // Compute current week's workout count for the live "X of N this
  // week" progress on Step 2. Locks the week-start to the user's
  // current local Monday so the count doesn't jump when they cross
  // midnight UTC.
  const weekStart = (() => {
    const d = new Date();
    const day = d.getDay();          // 0=Sun, 1=Mon, ...
    const back = (day === 0 ? 6 : day - 1);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - back);
    return d.getTime();
  })();
  const workoutsThisWeek = Array.isArray(logs)
    ? logs.filter(l => {
        const t = l.date ? new Date(l.date).getTime() : 0;
        return t >= weekStart;
      }).length
    : 0;

  // Step 1: "Log your first workout" — universal anchor. Shows
  // animated 0 → totalLogs count as the metric so even mid-journey
  // returns to the path feel responsive.
  const totalLogs = Array.isArray(logs) ? logs.length : 0;
  const slides = [{
    id: 'path:1',
    icon: Dumbbell, iconBg: 'bg-primary/20',
    kicker: 'Step 1',
    title: 'Log your first workout',
    metricValue: totalLogs,
    metricUnit: ' logged',
    metricDecimals: 0,
    sub: 'Open the Workout tab and tap Start. Anything counts — even a 10-minute session.',
    cta: { label: 'Start workout', to: '/workout' },
  }];

  // Step 2 — weekly cadence based on training_days, with LIVE
  // progress bar showing this week's count vs the target.
  const weekTarget = Math.max(3, Math.min(trainingDays || 3, 6));
  slides.push({
    id: 'path:2',
    icon: Calendar, iconBg: 'bg-blue-400/20',
    kicker: 'Step 2',
    title: 'This week',
    metricValue: workoutsThisWeek,
    metricUnit: ` / ${weekTarget}`,
    progressPct: Math.min(100, (workoutsThisWeek / weekTarget) * 100),
    progressStartLabel: 'Mon',
    progressStartLabelKey: 'hero.dayShort.mon',
    progressEndLabel: 'Sun',
    progressEndLabelKey: 'hero.dayShort.sun',
    progressCurrentLabel: `${workoutsThisWeek} done`,
    progressCurrentLabelKey: 'hero.progress.done',
    progressCurrentLabelVars: { n: workoutsThisWeek },
    progressTargetLabel: `${weekTarget} target`,
    progressTargetLabelKey: 'hero.progress.target',
    progressTargetLabelVars: { n: weekTarget },
    sub: 'Three a week is the floor where strength builds. Six is the ceiling before recovery suffers.',
    cta: { label: 'Plan the week', to: '/workout' },
  });

  // Step 3 — first PR (timing depends on level)
  const prWeeks = level === 'beginner' ? 2 : level === 'intermediate' ? 4 : 6;
  slides.push({
    id: 'path:3',
    icon: Trophy, iconBg: 'bg-amber-400/20',
    kicker: 'Step 3',
    title: 'First PR target',
    metricValue: prWeeks,
    metricUnit: ' weeks',
    sub: level === 'beginner'
      ? 'Newbie gains are real. Beat any single previous lift = PR.'
      : 'Pick one lift to chase. We\'ll surface +5 lb progress automatically.',
  });

  // Step 4 — goal-specific anchor. Loaded with REAL numbers when
  // available so the user sees "you're 195 → 170, ~25 to go" as
  // an animated count + progress bar — not just a sentence.
  if (/lose|cut|fat|weight/i.test(primaryGoal)) {
    const startLbs = Number(p.weight_lbs);
    const targetLbs = Number(p.target_weight_lbs);
    if (Number.isFinite(startLbs) && Number.isFinite(targetLbs) && startLbs > targetLbs) {
      const delta = startLbs - targetLbs;
      const weeks = Math.min(Math.ceil(delta), 24);  // ~1 lb/week
      // Progress is 0% at start; will tick up as their logged weight
      // approaches target. For brand-new users it's 0.
      // Progress-bar dropped from this slide: an honest pct requires
      // the user's most recent body_metrics weight (not pulled here
      // — would mean another query, and brand-new users have no
      // body_metrics row anyway). The delta badge + start/end
      // bookends in the sub copy carry the visual without
      // promising a moving bar that never moves. Wave 59 caught this.
      slides.push({
        id: 'path:4-loss',
        icon: TrendingUp, iconBg: 'bg-emerald-400/20',
        kicker: 'Your goal',
        title: 'Target weight',
        metricValue: targetLbs,
        metricUnit: ' lb',
        metricDelta: -delta,
        metricDeltaUnit: ' lb',
        metricDeltaUnitKey: 'hero.unit.lbWithSpace',
        metricDeltaSuffix: ' to lose',
        metricDeltaSuffixKey: 'hero.deltaSuffix.toLose',
        sub: `${startLbs} lb today → ${targetLbs} lb by week ${weeks} · ~1 lb/week (sustainable).`,
        cta: { label: 'Log a meal', to: '/nutrition' },
      });
    } else {
      slides.push({
        id: 'path:4-loss-generic',
        icon: TrendingUp, iconBg: 'bg-emerald-400/20',
        kicker: 'Your goal',
        title: 'Track your meals',
        sub: 'Calorie awareness is the single highest-leverage move for fat loss.',
        cta: { label: 'Open Nutrition', to: '/nutrition' },
      });
    }
  } else if (/muscle|gain|bulk|strength|build/i.test(primaryGoal)) {
    slides.push({
      id: 'path:4-muscle',
      icon: Zap, iconBg: 'bg-orange-400/20',
      kicker: 'Your goal',
      title: 'Add to a main lift',
      metricValue: 10,
      metricUnit: ' lb',
      metricPrefix: '+',
      sub: 'Bench, squat, or deadlift — pick one and chase the next +5 every week.',
      cta: { label: 'Start tracking', to: '/workout' },
    });
  } else if (/endurance|cardio|run/i.test(primaryGoal)) {
    slides.push({
      id: 'path:4-endurance',
      icon: Footprints, iconBg: 'bg-cyan-400/20',
      kicker: 'Your goal',
      title: 'Build to a',
      metricValue: 5,
      metricUnit: 'K',
      sub: 'Run/walk intervals for 3 weeks → continuous 30-min jog by week 6.',
      // /cardio is not a real route — cardio is a section inside the
      // Workout page. Use the existing ?openCardio=1 deep-link handler
      // (src/pages/Workout.jsx) which opens the cardio panel and
      // strips the param so a reload doesn't re-fire.
      cta: { label: 'Log cardio', to: '/workout?openCardio=1' },
    });
  } else {
    slides.push({
      id: 'path:4-generic',
      icon: Sparkles, iconBg: 'bg-violet-400/20',
      kicker: 'Your goal',
      title: 'Day commit',
      metricValue: 30,
      metricUnit: '',
      sub: 'Show up 3× a week for a month. That\'s where every lasting habit starts.',
    });
  }

  return slides;
}

/**
 * Pick which mode to render. Achievements wins when there's anything
 * fresh to celebrate. New-user path wins when there's nothing
 * logged + the user has onboarding data. Streak is the narrow
 * fallback for everything else.
 */
function pickMode({ achievementSlides, pathSlides, profile, logs }) {
  if (achievementSlides.length > 0) return 'achievements';
  const totalActivity = (Array.isArray(logs) ? logs.length : 0)
                      + Number(profile?.workout_streak || 0);
  if (totalActivity === 0 && pathSlides.length > 0) return 'path';
  return 'streak';
}

const HeroSlideshow = forwardRef(function HeroSlideshow({
  logs, cardioLogs, goals, profile, user,
  streak, hasWorkedOutToday, daysSinceLast,
  onPrimary, onSlideCta, onSlidesCountChange, onSlideColorChange,
  t,
}, ref) {
  const { tFallback } = useLanguage();

  const achievementSlides = useMemo(
    () => buildAchievementSlides({ logs, cardioLogs, goals, profile }),
    [logs, cardioLogs, goals, profile]
  );
  const pathSlides = useMemo(
    () => buildPathSlides({ profile, user, logs }),
    [profile, user, logs]
  );

  const mode = pickMode({ achievementSlides, pathSlides, profile, logs });

  // Streak slide is ALWAYS the lead slide of the carousel when the user
  // isn't on the brand-new-user `path`. Achievements rotate behind it
  // every 10s. (Was previously a mutually-exclusive fallback layout —
  // a 5K milestone from 15 days ago would hide the streak entirely.)
  // Coerce streak to a finite number — a corrupt profile column or a
  // prop that drifts to undefined would otherwise render `NaN day
  // streak` in the lead slide.
  const safeStreak = Number.isFinite(Number(streak)) ? Number(streak) : 0;
  const streakSlide = mode !== 'path' ? {
    id: 'streak',
    kind: 'streak',
    color: '20 95% 55%', // warm orange — the brand
    streak: safeStreak,
    hasWorkedOutToday,
    daysSinceLast,
  } : null;

  // "Feature of the day" + "Feature of the week" — fixed promo slides
  // that always rotate in alongside the user's achievements. Loud
  // purple chrome so they read as marketplace-style nudges, not
  // achievement carryover. CTA on each routes the user to the
  // feature surface.
  const featureSlides = mode === 'path' ? [] : [
    {
      id: 'feature:duels',
      kind: 'feature',
      tier: 'day',
      color: '270 85% 60%', // purple — duels feature accent
      icon: Swords,
      kicker: 'Feature of the Day',
      title: 'Duels',
      sub: 'Challenge a friend to a head-to-head workout. First to finish wins XP + bragging rights.',
      cta: { label: 'Open a duel', to: '/workout' },
    },
    {
      id: 'feature:stories',
      kind: 'feature',
      tier: 'week',
      color: '330 80% 60%', // pink — stories feature accent
      icon: Camera,
      kicker: 'Feature of the Week',
      title: 'Stories',
      sub: 'Post a 24-hr workout selfie or PR moment. Friends react with fire emojis on the Hub.',
      cta: { label: 'Post a story', to: '/hub' },
    },
  ];

  const slides = mode === 'path'
    ? pathSlides
    : streakSlide
      ? [streakSlide, ...featureSlides, ...achievementSlides]
      : [...featureSlides, ...achievementSlides];

  const [idx, setIdx] = useState(0);
  // Reset to slide 0 if the slide set length shrinks below idx.
  useEffect(() => { if (idx >= slides.length) setIdx(0); }, [slides.length, idx]);

  // Auto-rotate. Pause via the `paused` state when user manually
  // navigates so they get a beat to read after tapping a dot.
  const [paused, setPaused] = useState(false);
  const pauseTimerRef = useRef(null);
  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const t = setTimeout(() => setIdx(i => (i + 1) % slides.length), ROTATE_MS);
    return () => clearTimeout(t);
  }, [idx, paused, slides.length]);

  const goTo = (i) => {
    setIdx(i);
    setPaused(true);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    // Resume auto-rotate after 12s of no manual interaction.
    pauseTimerRef.current = setTimeout(() => setPaused(false), 12_000);
  };
  // Guard slides.length === 0 — `% 0` returns NaN, and `slides[NaN]`
  // is undefined which crashes the render path that reads slide.id.
  const next = () => { if (slides.length > 0) goTo((idx + 1) % slides.length); };
  const prev = () => { if (slides.length > 0) goTo((idx - 1 + slides.length) % slides.length); };

  // Cleanup pause timer on unmount.
  useEffect(() => () => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
  }, []);

  // Expose next() so the parent HeroCard can render a chevron at the
  // OUTER rounded-card edge instead of inside the slideshow column
  // (which is constrained by the hero's p-6 padding).
  useImperativeHandle(ref, () => ({ next, prev }), [next, prev]);

  // Report slide-count changes up so the parent can show/hide the
  // chevron button reactively.
  useEffect(() => {
    onSlidesCountChange?.(slides.length);
  }, [slides.length, onSlidesCountChange]);

  // Per-slide color reporting — parent (HeroCard) paints the hero's
  // gradient mesh in the current slide's accent. Color falls back
  // from explicit slide.color → iconBg lookup → null (uses primary).
  useEffect(() => {
    const slide = slides[idx];
    if (!slide) { onSlideColorChange?.(null); return; }
    if (slide.color) { onSlideColorChange?.(slide.color); return; }
    const map = {
      'bg-amber-400/20':   '45 95% 55%',
      'bg-emerald-400/20': '160 80% 50%',
      'bg-violet-400/20':  '270 85% 60%',
      'bg-orange-400/20':  '25 90% 55%',
      'bg-cyan-400/20':    '190 85% 55%',
      'bg-blue-400/20':    '220 85% 60%',
    };
    onSlideColorChange?.(map[slide.iconBg] || null);
  }, [idx, slides, onSlideColorChange]);

  // ── Render slide — streak / achievement / path ─────────────────────
  const slide = slides[idx];
  if (!slide) return null;

  // STREAK slide renders with its own chrome (giant N + "day streak"
  // label) — visually distinct so the carousel doesn't blur achievements
  // and the streak into the same template. Keeps the pagination dots
  // shared so the user can swipe between streak and milestones.
  if (slide.kind === 'streak') {
    return (
      <div className="relative flex flex-col justify-between gap-5 min-w-0">
        {/* Decorative icon — right-centre, translucent */}
        <Flame aria-hidden="true" className="absolute pointer-events-none select-none"
          style={{ width: 110, height: 110, opacity: 0.12, color: 'white', right: 8, top: '50%', transform: 'translateY(-50%)' }} />
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
            <Flame className="w-4 h-4 text-primary/80" />
          </div>
          <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-white/70">
            {hasWorkedOutToday
              ? t('dashboard.hero.kicker.done')
              : streak > 0
                ? t('dashboard.hero.kicker.keepStreak')
                : daysSinceLast >= 2
                  ? t('dashboard.hero.kicker.comeback')
                  : t('dashboard.hero.kicker.fresh')}
          </span>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={`streak:${streak}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="min-w-0"
          >
            <div className="flex items-baseline gap-3">
              <span
                className="font-heading font-bold leading-none tracking-tight tabular-nums"
                style={{ fontSize: 'clamp(3.5rem, 12vw, 6.5rem)' }}
              >
                <AnimatedNumber from={0} to={streak} durationMs={1400} />
              </span>
              <span className="font-heading text-lg md:text-xl font-medium text-white/70 leading-tight pb-2">
                {streak === 1 ? t('dashboard.hero.daySingular') : t('dashboard.hero.dayPlural')}
              </span>
            </div>
            <p className="text-sm text-white/60 max-w-[28ch] leading-relaxed mt-3">
              {hasWorkedOutToday
                ? t('dashboard.hero.subtitle.done')
                : streak > 0
                  ? t('dashboard.hero.subtitle.keepGoing')
                  : t('dashboard.hero.subtitle.startToday')}
            </p>
          </motion.div>
        </AnimatePresence>
        {slides.length > 1 && (
          <div className="flex items-center gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={tFallback('dashboard.hero.slide', `Slide ${i + 1}`)}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? 'bg-white w-6' : 'bg-white/30 w-1.5 hover:bg-white/50'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── FEATURE-OF-THE-DAY / WEEK — purple promo card ─────────────────
  if (slide.kind === 'feature') {
    const FeatureIcon = slide.icon || Sparkles;
    return (
      <div className="relative flex flex-col justify-between gap-4 min-w-0">
        <FeatureIcon aria-hidden="true" className="absolute pointer-events-none select-none"
          style={{ width: 110, height: 110, opacity: 0.11, color: 'white', right: 8, top: '50%', transform: 'translateY(-50%)' }} />
        {/* Purple overlay that tints the slideshow column without
            touching the hero's primary chrome. */}
        <div
          aria-hidden="true"
          className="absolute -inset-3 rounded-2xl pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(168,85,247,0.20), rgba(217,70,239,0.10) 60%, transparent)',
          }}
        />
        <div className="relative flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-purple-500/25 backdrop-blur-sm flex items-center justify-center">
            <FeatureIcon className="w-4 h-4 text-purple-200" />
          </div>
          <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-purple-200">
            {slide.kicker}
          </span>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative min-w-0"
          >
            <h2
              className="font-heading font-bold leading-[1.05] tracking-tight text-white break-words"
              style={{ fontSize: 'clamp(1.6rem, 5vw, 2.5rem)' }}
            >
              {slide.title}
            </h2>
            <p className="text-sm text-white/75 max-w-[36ch] leading-relaxed mt-2">
              {slide.sub}
            </p>
            {slide.cta && (
              <button
                type="button"
                onClick={() => onSlideCta?.(slide.cta.to)}
                className="inline-flex items-center gap-1 mt-3 px-3 py-1.5 rounded-full bg-purple-500/30 hover:bg-purple-500/40 backdrop-blur-sm text-[12px] font-semibold text-white transition-colors"
              >
                {slide.cta.label}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </motion.div>
        </AnimatePresence>
        {slides.length > 1 && (
          <div className="relative flex items-center gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={tFallback('dashboard.hero.slide', `Slide ${i + 1}`)}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? 'bg-white w-6' : 'bg-white/30 w-1.5 hover:bg-white/50'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── ACHIEVEMENTS or PATH — shared slideshow layout ─────────────────
  const SlideIcon = slide.icon || Sparkles;

  const subKicker = mode === 'achievements'
    ? (slide.when ? formatDistanceToNowStrict(new Date(slide.when), { addSuffix: true }) : null)
    : null;

  return (
    <div className="relative flex flex-col justify-between gap-5 min-w-0">
      {/* Contextual icon — right-centre, translucent symbol not emoji */}
      {SlideIcon && <SlideIcon aria-hidden="true" className="absolute pointer-events-none select-none"
        style={{ width: 110, height: 110, opacity: 0.11, color: 'white', right: 8, top: '50%', transform: 'translateY(-50%)' }} />}
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-full backdrop-blur-sm flex items-center justify-center ${slide.iconBg || 'bg-white/10'}`}>
          <SlideIcon className="w-4 h-4 text-white" />
        </div>
        <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-white/70">
          {slide.kicker}
          {subKicker && <span className="text-white/40 normal-case tracking-normal font-normal ms-2">· {subKicker}</span>}
        </span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={slide.id}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="min-w-0"
        >
          {/* Slide title — for PR slides this is the EXERCISE name
              (small caps); the big number lives in the metric row
              below it. For non-metric slides this IS the headline. */}
          <h2
            className={
              slide.metricValue != null
                ? 'font-heading font-semibold text-white/85 break-words'
                : 'font-heading font-bold leading-[1.05] tracking-tight text-white break-words'
            }
            style={
              slide.metricValue != null
                ? { fontSize: 'clamp(0.95rem, 2.2vw, 1.15rem)' }
                : { fontSize: 'clamp(1.75rem, 5.5vw, 3rem)' }
            }
          >
            {slide.title}
          </h2>

          {/* Animated metric — count-up tween. The headline value
              for the slide; size matches the original streak hero
              so the visual rhythm is preserved. */}
          {slide.metricValue != null && (
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className="font-heading font-bold leading-none tracking-tight tabular-nums text-white"
                style={{ fontSize: 'clamp(3rem, 10vw, 5.25rem)' }}
              >
                {slide.metricPrefix}
                <AnimatedNumber
                  from={slide.metricFrom ?? 0}
                  to={slide.metricValue}
                  decimals={slide.metricDecimals ?? 0}
                />
                {slide.metricUnit}
              </span>
            </div>
          )}

          {/* Delta badge — "+10 lb from your last best". Animates
              in after the count-up so the user sees the headline
              number land first, then the context. */}
          {slide.metricDelta != null && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.9 }}
              className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full bg-white/12 text-[11px] font-bold text-white"
            >
              {slide.metricDelta > 0 ? '+' : ''}
              {slide.metricDelta}
              {slide.metricDeltaUnitKey
                ? tFallback(slide.metricDeltaUnitKey, slide.metricDeltaUnit || '')
                : (slide.metricDeltaUnit || '')}
              {slide.metricDeltaSuffix && (
                <span className="font-medium text-white/70">
                  {slide.metricDeltaSuffixKey
                    ? tFallback(slide.metricDeltaSuffixKey, slide.metricDeltaSuffix)
                    : slide.metricDeltaSuffix}
                </span>
              )}
            </motion.div>
          )}

          {/* Per-exercise weight-history sparkline (PR slides only).
              Draws left-to-right on slide enter so the user sees
              their progression curve emerge. */}
          {slide.history && (
            <div className="mt-3 max-w-[220px] opacity-90">
              <Sparkline values={slide.history} color="#ffffff" height={32} />
            </div>
          )}

          {/* Live progress bar (path slides with current → target
              state). The fill animates from 0% to the computed pct
              so the user feels the system actively tracking them. */}
          {slide.progressPct != null && (
            <ProgressBar
              pct={slide.progressPct}
              startLabel={slide.progressStartLabelKey
                ? tFallback(slide.progressStartLabelKey, slide.progressStartLabel || '')
                : slide.progressStartLabel}
              endLabel={slide.progressEndLabelKey
                ? tFallback(slide.progressEndLabelKey, slide.progressEndLabel || '')
                : slide.progressEndLabel}
              currentLabel={slide.progressCurrentLabelKey
                ? tFallback(slide.progressCurrentLabelKey, slide.progressCurrentLabel || '', slide.progressCurrentLabelVars)
                : slide.progressCurrentLabel}
              targetLabel={slide.progressTargetLabelKey
                ? tFallback(slide.progressTargetLabelKey, slide.progressTargetLabel || '', slide.progressTargetLabelVars)
                : slide.progressTargetLabel}
            />
          )}

          {/* Sub copy — context line. Always present. */}
          <p className="text-sm text-white/60 max-w-[36ch] leading-relaxed mt-3">
            {slide.sub}
          </p>

          {mode === 'path' && slide.cta && (
            <button
              type="button"
              onClick={() => onSlideCta?.(slide.cta.to)}
              className="inline-flex items-center gap-1 mt-3 text-[12px] font-semibold text-white/90 hover:text-white transition-colors"
            >
              {slide.cta.label}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Pagination dots */}
      {slides.length > 1 && (
        <div className="flex items-center gap-1.5">
          {slides.map((s, i) => (
            <button
              // Use slide.id (stable) instead of array index — when
              // slides shift order (e.g. a PR slide demotes itself by
              // age), index-keyed buttons retain stale DOM state and
              // animations played for the wrong destination dot.
              key={s?.id ?? `dot-${i}`}
              type="button"
              onClick={() => goTo(i)}
              aria-label={tFallback('dashboard.hero.slide', `Slide ${i + 1}`)}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? 'bg-white w-6' : 'bg-white/30 w-1.5 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default HeroSlideshow;
