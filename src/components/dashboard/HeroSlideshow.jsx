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

import React, { forwardRef, useCallback, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  Flame, Trophy, TrendingUp, Award, Zap, Sparkles,
  Calendar, CheckCircle2, Dumbbell, Footprints, ChevronRight,
  Swords, Camera, Bell, UserPlus, ClipboardList, Share2, Gift,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';
import { usePushSubscription } from '@/lib/usePushSubscription';
import { supabase } from '@/api/supabaseClient';
import AnimatedNumber from '@/components/AnimatedNumber';
import HeroPager from '@/components/HeroPager';
import { prefersReducedMotion } from '@/lib/reducedMotion';
// The chrome — watermark geometry, the chevron gutter and the accent
// lookup — is shared with the Progress and Nutrition carousels so all
// three read as the same object. See src/lib/heroChrome.js.
import {
  HERO_SLIDE_GUTTER,
  heroWatermarkStyle,
  heroSlideAccent,
} from '@/lib/heroChrome';

const ROTATE_MS = 8000;

// The count-up on the hero slides used to be a private copy of
// AnimatedNumber declared right here — same ease-out cubic, same rAF
// loop, same reduced-motion guard, different prop names. The shared
// component now takes `from`, which was the only thing this copy could
// do that it couldn't, so the fork has no reason to exist.
//
// Slide count-ups run at 1.4s rather than the shared 800ms default: a
// hero number is the thing the user is looking at, so it gets a longer
// roll than a stat that changes underneath them.
const HERO_COUNT_MS = 1400;

/* The watermark geometry and the chevron gutter that used to be declared
 * here now live in src/lib/heroChrome.js, with the measurements that
 * produced them, because Progress and Nutrition paint the same slide and
 * had drifted to their own sizes. Imported at the top of this file. */

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
function Sparkline({ values, color = 'hsl(var(--primary))', height = 32 }) {
  const W = 140;
  const H = height;
  // Filter to finite values BEFORE the length check — a corrupt PR
  // history with embedded NaN would otherwise make min/max NaN,
  // turn trueRange into NaN, and propagate NaN through every point's
  // y coordinate. Length must STILL be ≥2 after filtering for the
  // line to be meaningful.
  const finiteValues = Array.isArray(values) ? values.filter(v => Number.isFinite(v)) : [];
  if (finiteValues.length < 2) return null;
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const trueRange = max - min;
  // values.length - 1 is guaranteed ≥ 1 by the filter above; stepX
  // stays finite. Belt-and-suspenders: clamp to W if the divisor
  // somehow degenerates to 0 in a future refactor.
  const stepX = finiteValues.length > 1 ? W / (finiteValues.length - 1) : W;
  const pad = 4;
  // When every value is identical (steady plateau — e.g. user has
  // bench-pressed 185 lb for 8 sessions in a row), the original
  // formula `(v-min)/range = 0` mapped every point to the BOTTOM
  // edge of the chart — visually implying a downward trend on what's
  // actually a flat line. Wave 59 code review caught this. Centerline
  // is the honest render of an all-identical series.
  const midY = H / 2;
  // Map the filtered (finite-only) value set so the point coordinates
  // stay aligned to the actual rendered line.
  const points = finiteValues.map((v, i) => {
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
        transition={reduce ? { duration: 0 } : { duration: 0.22, delay: 0.9 }}
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
      <div className="relative h-1.5 rounded-full bg-secondary overflow-hidden">
        <motion.div
          className="absolute inset-y-0 start-0 rounded-full bg-primary"
          initial={reduce ? { width: `${safePct}%` } : { width: '0%' }}
          animate={{ width: `${safePct}%` }}
          transition={reduce ? { duration: 0 } : { duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        />
      </div>
      <div className="flex items-center justify-between mt-1 text-micro text-foreground/55">
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
          icon: Trophy, iconBg: 'bg-primary/20',
          kicker: 'Personal Record',
          kickerKey: 'hero.pr.kicker',
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
        icon: CheckCircle2, iconBg: 'bg-success/20',
        kicker: 'Goal Completed',
        kickerKey: 'hero.goal.kicker',
        // The goal's own title and description are USER DATA and stay as
        // they are — only the two fallbacks below are app copy.
        title: g.title || 'Goal hit',
        titleKey: g.title ? null : 'hero.goal.titleFallback',
        sub: g.description?.slice(0, 60) || 'Set the next one.',
        subKey: g.description ? null : 'hero.goal.subFallback',
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
        icon: Award, iconBg: 'bg-primary/20',
        kicker: 'Level Up',
        kickerKey: 'hero.level.kicker',
        title: 'You leveled up',
        titleKey: 'hero.level.title',
        // Animated level number — ticks from the PREVIOUS level to
        // the new one (e.g. 4 → 5) so the user sees the delta, not
        // "Level 0 → 1 → 2 → 3 → 4 → 5" from zero which feels off.
        // Wave 59 code review caught this.
        metricValue: profile.current_level,
        metricFrom: Math.max(0, profile.current_level - 1),
        metricUnit: '',
        metricPrefix: 'Level ',
        metricPrefixKey: 'hero.metricPrefix.level',
        sub: '{xp} XP earned overall',
        subKey: 'hero.level.sub',
        subVars: { xp: (profile.total_xp ?? 0).toLocaleString() },
        when,
      });
    }
  }

  // 4) Streak milestones — 7, 14, 30, 60, 100 days
  const streak = Number(profile?.workout_streak) || 0;
  if ([7, 14, 30, 60, 100].includes(streak)) {
    slides.push({
      id: `streak:${streak}`,
      icon: Flame, iconBg: 'bg-primary/20',
      kicker: 'Streak Milestone',
      kickerKey: 'hero.streak.kicker',
      title: "You're on fire",
      titleKey: 'hero.streak.title',
      metricValue: streak,
      metricUnit: ' day streak',
      metricUnitKey: 'hero.unit.dayStreak',
      sub: streak >= 30 ? 'Habit locked in.' : 'Keep the momentum.',
      subKey: streak >= 30 ? 'hero.streak.sub.locked' : 'hero.streak.sub.momentum',
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
      { meters: 21097, label: 'Half Marathon', labelKey: 'hero.cardio.halfMarathon' },
      { meters: 10000, label: 'First 10K', labelKey: 'hero.cardio.first10k' },
      { meters: 5000,  label: 'First 5K', labelKey: 'hero.cardio.first5k' },
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
        icon: Footprints, iconBg: 'bg-info/20',
        kicker: 'Distance Milestone',
        kickerKey: 'hero.cardio.kicker',
        title: f.label,
        titleKey: f.labelKey,
        metricValue: km,
        metricUnit: ' km',
        metricDecimals: 1,
        // Guard avg km/h — without the Number.isFinite check a zero or
        // missing duration produced "NaN km/h" / "Infinity km/h" in
        // the subtitle. Falls back to the duration-only line when we
        // can't compute a finite pace.
        sub: sec > 0
          ? (avgKmh != null && Number.isFinite(avgKmh)
              ? '{min} min · avg {kmh} km/h'
              : '{min} min')
          : 'Distance logged',
        subKey: sec > 0
          ? (avgKmh != null && Number.isFinite(avgKmh) ? 'hero.cardio.sub.pace' : 'hero.cardio.sub.time')
          : 'hero.cardio.sub.logged',
        subVars: { min: Math.round(sec / 60), kmh: avgKmh != null && Number.isFinite(avgKmh) ? avgKmh.toFixed(1) : '' },
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
    kickerKey: 'hero.path.step1.kicker',
    title: 'Log your first workout',
    titleKey: 'hero.path.step1.title',
    metricValue: totalLogs,
    metricUnit: ' logged',
    metricUnitKey: 'hero.unit.logged',
    metricDecimals: 0,
    sub: 'Open the Workout tab and tap Start. Anything counts, even a 10-minute session.',
    subKey: 'hero.path.step1.sub',
    cta: { label: 'Start workout', labelKey: 'hero.cta.startWorkout', to: '/workout?freestyle=1' },
  }];

  // Step 2 — weekly cadence based on training_days, with LIVE
  // progress bar showing this week's count vs the target.
  const weekTarget = Math.max(3, Math.min(trainingDays || 3, 6));
  slides.push({
    id: 'path:2',
    icon: Calendar, iconBg: 'bg-info/20',
    kicker: 'Step 2',
    kickerKey: 'hero.path.step2.kicker',
    title: 'This week',
    titleKey: 'hero.kicker.thisWeek',
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
    subKey: 'hero.path.step2.sub',
    cta: { label: 'Plan the week', labelKey: 'hero.cta.planWeek', action: 'planWeek' },
  });

  // Step 3 — first PR (timing depends on level)
  const prWeeks = level === 'beginner' ? 2 : level === 'intermediate' ? 4 : 6;
  slides.push({
    id: 'path:3',
    icon: Trophy, iconBg: 'bg-primary/20',
    kicker: 'Step 3',
    kickerKey: 'hero.path.step3.kicker',
    title: 'First PR target',
    titleKey: 'hero.path.step3.title',
    metricValue: prWeeks,
    metricUnit: ' weeks',
    metricUnitKey: 'hero.unit.weeks',
    sub: level === 'beginner'
      ? 'Newbie gains are real. Beat any single previous lift = PR.'
      : 'Pick one lift to chase. We\'ll surface +5 lb progress automatically.',
    subKey: level === 'beginner' ? 'hero.path.step3.sub.beginner' : 'hero.path.step3.sub.other',
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
        icon: TrendingUp, iconBg: 'bg-success/20',
        kicker: 'Your goal',
        kickerKey: 'hero.path.goal.kicker',
        title: 'Target weight',
        titleKey: 'hero.path.loss.title',
        metricValue: targetLbs,
        metricUnit: ' lb',
        metricDelta: -delta,
        metricDeltaUnit: ' lb',
        metricDeltaUnitKey: 'hero.unit.lbWithSpace',
        metricDeltaSuffix: ' to lose',
        metricDeltaSuffixKey: 'hero.deltaSuffix.toLose',
        sub: '{start} lb today → {target} lb by week {weeks} · ~1 lb/week (sustainable).',
        subKey: 'hero.path.loss.sub',
        subVars: { start: startLbs, target: targetLbs, weeks },
        cta: { label: 'Log a meal', labelKey: 'hero.cta.logMeal', to: '/nutrition' },
      });
    } else {
      slides.push({
        id: 'path:4-loss-generic',
        icon: TrendingUp, iconBg: 'bg-success/20',
        kicker: 'Your goal',
        kickerKey: 'hero.path.goal.kicker',
        title: 'Track your meals',
        titleKey: 'hero.path.lossGeneric.title',
        sub: 'Calorie awareness is the single highest-leverage move for fat loss.',
        subKey: 'hero.path.lossGeneric.sub',
        cta: { label: 'Open Nutrition', labelKey: 'hero.cta.openNutrition', to: '/nutrition' },
      });
    }
  } else if (/muscle|gain|bulk|strength|build/i.test(primaryGoal)) {
    slides.push({
      id: 'path:4-muscle',
      icon: Zap, iconBg: 'bg-primary/20',
      kicker: 'Your goal',
      kickerKey: 'hero.path.goal.kicker',
      title: 'Add to a main lift',
      titleKey: 'hero.path.muscle.title',
      metricValue: 10,
      metricUnit: ' lb',
      metricUnitKey: 'hero.unit.lbWithSpace',
      metricPrefix: '+',
      sub: 'Bench, squat, or deadlift. Pick one and chase the next +5 every week.',
      subKey: 'hero.path.muscle.sub',
      cta: { label: 'Start tracking', labelKey: 'hero.cta.startTracking', to: '/workout?freestyle=1' },
    });
  } else if (/endurance|cardio|run/i.test(primaryGoal)) {
    slides.push({
      id: 'path:4-endurance',
      icon: Footprints, iconBg: 'bg-info/20',
      kicker: 'Your goal',
      kickerKey: 'hero.path.goal.kicker',
      title: 'Build to a',
      titleKey: 'hero.path.endurance.title',
      metricValue: 5,
      metricUnit: 'K',
      sub: 'Run/walk intervals for 3 weeks → continuous 30-min jog by week 6.',
      subKey: 'hero.path.endurance.sub',
      // /cardio is not a real route — cardio is a section inside the
      // Workout page. Use the existing ?openCardio=1 deep-link handler
      // (src/pages/Workout.jsx) which opens the cardio panel and
      // strips the param so a reload doesn't re-fire.
      cta: { label: 'Log cardio', labelKey: 'hero.cta.logCardio', to: '/workout?openCardio=1' },
    });
  } else {
    slides.push({
      id: 'path:4-generic',
      icon: Sparkles, iconBg: 'bg-primary/20',
      kicker: 'Your goal',
      kickerKey: 'hero.path.goal.kicker',
      title: 'Day commit',
      titleKey: 'hero.path.generic.title',
      metricValue: 30,
      metricUnit: '',
      sub: 'Show up 3× a week for a month. That\'s where every lasting habit starts.',
      subKey: 'hero.path.generic.sub',
    });
  }

  return slides;
}

// Local-Monday week start (ms) — shared by telemetry + week cadence.
function mondayStartMs() {
  const d = new Date();
  const day = d.getDay();            // 0=Sun..6=Sat
  const back = day === 0 ? 6 : day - 1;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - back);
  return d.getTime();
}

// Sum weight × reps across every set in a set of workout logs.
function sumVolume(logsSubset) {
  let vol = 0;
  for (const log of logsSubset) {
    const exs = Array.isArray(log.exercises) ? log.exercises : [];
    for (const ex of exs) {
      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      for (const s of sets) {
        const w = Number(s.weight);
        const r = Number(s.reps);
        if (Number.isFinite(w) && Number.isFinite(r)) vol += w * r;
      }
    }
  }
  return Math.round(vol);
}

/**
 * Personal-telemetry slides — always-on stats derived from data already
 * in the dashboard cache (ZERO extra network calls). These render even
 * when the values are 0, so a fresh account sees the metrics it will
 * grow into ("Workouts logged 0 — log your first"), and they light up
 * automatically as the user records more. Deliberately excludes the
 * streak (which now lives in its own pill under the carousel).
 */
function buildTelemetrySlides({ logs, cardioLogs, profile }) {
  const all = Array.isArray(logs) ? logs : [];
  const weekStart = mondayStartMs();
  const inWeek = (row) => (row?.date ? new Date(row.date).getTime() : 0) >= weekStart;
  const weekLogs = all.filter(inWeek);

  const totalLogs = all.length;
  const workoutsThisWeek = weekLogs.length;
  const weeklyVolume = sumVolume(weekLogs);
  const level = Number(profile?.current_level) || 1;
  const xp = Number(profile?.total_xp) || 0;
  const trainingDays = Array.isArray(profile?.training_days) ? profile.training_days.length : 0;
  const weekTarget = Math.max(3, Math.min(trainingDays || 3, 6));

  const slides = [
    {
      id: 'tele:week', kind: 'telemetry',
      icon: Calendar, iconBg: 'bg-info/20', kicker: 'This week', kickerKey: 'hero.kicker.thisWeek',
      title: 'Workouts', titleKey: 'hero.tele.week.title',
      metricValue: workoutsThisWeek, metricUnit: ` / ${weekTarget}`,
      progressPct: Math.min(100, (workoutsThisWeek / weekTarget) * 100),
      progressStartLabel: 'Mon', progressStartLabelKey: 'hero.dayShort.mon',
      progressEndLabel: 'Sun', progressEndLabelKey: 'hero.dayShort.sun',
      progressCurrentLabel: '{n} done',
      progressCurrentLabelKey: 'hero.progress.done',
      progressCurrentLabelVars: { n: workoutsThisWeek },
      progressTargetLabel: '{n} target',
      progressTargetLabelKey: 'hero.progress.target',
      progressTargetLabelVars: { n: weekTarget },
      sub: workoutsThisWeek > 0 ? 'Keep the week rolling.' : 'Three a week is where strength builds.',
      subKey: workoutsThisWeek > 0 ? 'hero.tele.week.sub.rolling' : 'hero.tele.week.sub.floor',
      cta: { label: 'Plan the week', labelKey: 'hero.cta.planWeek', action: 'planWeek' },
    },
    {
      id: 'tele:volume', kind: 'telemetry',
      icon: TrendingUp, iconBg: 'bg-success/20', kicker: 'This week', kickerKey: 'hero.kicker.thisWeek',
      title: 'Volume lifted', titleKey: 'hero.tele.volume.title',
      metricValue: weeklyVolume, metricUnit: ' lb', metricUnitKey: 'hero.unit.lbWithSpace',
      sub: weeklyVolume > 0 ? 'Total weight × reps across every set.' : 'Log sets and this fills in automatically.',
      subKey: weeklyVolume > 0 ? 'hero.tele.volume.sub.has' : 'hero.tele.volume.sub.none',
    },
    {
      id: 'tele:total', kind: 'telemetry',
      icon: Dumbbell, iconBg: 'bg-primary/20', kicker: 'All time', kickerKey: 'hero.kicker.allTime',
      title: 'Workouts logged', titleKey: 'hero.tele.total.title',
      metricValue: totalLogs, metricUnit: '',
      sub: totalLogs > 0 ? 'Consistency compounds. Keep stacking sessions.' : 'Log your first to start the count.',
      subKey: totalLogs > 0 ? 'hero.tele.total.sub.has' : 'hero.tele.total.sub.none',
      cta: totalLogs > 0 ? null : { label: 'Start a workout', labelKey: 'hero.cta.startAWorkout', to: '/workout?freestyle=1' },
    },
    {
      id: 'tele:level', kind: 'telemetry',
      icon: Award, iconBg: 'bg-primary/20', kicker: 'Your level', kickerKey: 'hero.kicker.yourLevel',
      title: 'Standing', titleKey: 'hero.tele.level.title',
      metricValue: level, metricPrefix: 'Lv ', metricPrefixKey: 'levelBar.level', metricUnit: '',
      sub: '{xp} XP earned overall',
      subKey: 'hero.level.sub',
      subVars: { xp: xp.toLocaleString() },
    },
  ];

  // Cardio distance this week — only when there's something to show.
  const cardio = Array.isArray(cardioLogs) ? cardioLogs : [];
  const cardioMeters = cardio.filter(inWeek).reduce((s, l) => s + (Number(l.distance_meters) || 0), 0);
  if (cardioMeters > 0) {
    slides.push({
      id: 'tele:cardio', kind: 'telemetry',
      icon: Footprints, iconBg: 'bg-info/20', kicker: 'This week', kickerKey: 'hero.kicker.thisWeek',
      title: 'Distance', titleKey: 'hero.tele.distance.title',
      metricValue: cardioMeters / 1000, metricUnit: ' km', metricDecimals: 1,
      sub: 'Cardio logged this week.',
      subKey: 'hero.tele.distance.sub',
      cta: { label: 'Log cardio', labelKey: 'hero.cta.logCardio', to: '/workout?openCardio=1' },
    });
  }

  return slides;
}

/**
 * Suggestion slides — the old dashboard onboarding nudges, now folded
 * into the hero rotation (and the standalone nudge cards removed). Each
 * gates on live state so a suggestion drops out the moment it's done
 * (followed someone → follow slide gone; logged a workout → first-workout
 * slide gone). `cta.action` slides run an in-app handler instead of a
 * route (enable push, jump to the share card).
 */
function buildSuggestionSlides({ logs, followsCount, push }) {
  const hasWorkouts = Array.isArray(logs) && logs.length > 0;
  const s = [];

  if (!hasWorkouts) {
    s.push({
      id: 'sug:first_workout', kind: 'suggestion',
      icon: Dumbbell, iconBg: 'bg-success/20', kicker: 'Get started', kickerKey: 'hero.sug.firstWorkout.kicker',
      title: 'Log your first workout', titleKey: 'hero.path.step1.title',
      sub: 'Two minutes. Just one set. The streak starts today.',
      subKey: 'hero.sug.firstWorkout.sub',
      cta: { label: 'Start', labelKey: 'hero.cta.start', to: '/workout?freestyle=1' },
    });
  }
  if (push && push.isSupported && !push.isSubscribed && push.permission !== 'denied') {
    s.push({
      id: 'sug:push', kind: 'suggestion',
      icon: Bell, iconBg: 'bg-primary/20', kicker: 'Stay in it', kickerKey: 'hero.sug.push.kicker',
      title: 'Turn on notifications', titleKey: 'hero.sug.push.title',
      sub: 'Gym Rival moves, crew wars, at-risk streaks. The moment they happen.',
      subKey: 'hero.sug.push.sub',
      cta: { label: 'Enable', labelKey: 'hero.cta.enable', action: 'enablePush' },
    });
  }
  if (followsCount === 0) {
    s.push({
      id: 'sug:follow', kind: 'suggestion',
      icon: UserPlus, iconBg: 'bg-info/20', kicker: 'Find your people', kickerKey: 'hero.sug.follow.kicker',
      title: 'Follow your first friend', titleKey: 'hero.sug.follow.title',
      sub: 'Their workouts show up in your feed. Yours show up in theirs.',
      subKey: 'hero.sug.follow.sub',
      cta: { label: 'Find people', labelKey: 'hero.cta.findPeople', to: '/hub?search=open' },
    });
  }
  s.push({
    id: 'sug:regimen', kind: 'suggestion',
    icon: ClipboardList, iconBg: 'bg-primary/20', kicker: 'Train smarter', kickerKey: 'hero.sug.regimen.kicker',
    title: 'Try a regimen', titleKey: 'hero.sug.regimen.title',
    sub: 'Pre-built routines for legs, push, pull. No more guessing what to lift.',
    subKey: 'hero.sug.regimen.sub',
    cta: { label: 'Browse', labelKey: 'hero.cta.browse', to: '/workout' },
  });
  if (hasWorkouts) {
    s.push({
      id: 'sug:share', kind: 'suggestion',
      icon: Share2, iconBg: 'bg-destructive/20', kicker: 'Show it off', kickerKey: 'hero.sug.share.kicker',
      title: 'Share your week', titleKey: 'hero.sug.share.title',
      sub: 'A polished card of your stats. Post to Stories, it counts.',
      subKey: 'hero.sug.share.sub',
      cta: { label: 'See it', labelKey: 'hero.cta.seeIt', action: 'shareWeek' },
    });
  }
  s.push({
    id: 'sug:invite', kind: 'suggestion',
    icon: Gift, iconBg: 'bg-primary/20', kicker: 'Bring a friend', kickerKey: 'hero.sug.invite.kicker',
    title: 'Invite a friend', titleKey: 'hero.sug.invite.title',
    sub: 'You both get 200 coins + an Elite capsule. Use your code.',
    subKey: 'hero.sug.invite.sub',
    cta: { label: 'Open', labelKey: 'hero.cta.open', to: '/profile' },
  });

  return s;
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

// The iconBg → accent lookup moved to src/lib/heroChrome.js as
// `heroSlideAccent(slide)` — the pager needs it for the dots and the band
// needs it for the tint, so it could not stay private to this file.

const HeroSlideshow = forwardRef(function HeroSlideshow({
  logs, cardioLogs, goals, profile, user,
  streak, hasWorkedOutToday, daysSinceLast,
  onPrimary, onSlideCta, onPlanWeek, onSlidesCountChange, onSlideColorChange,
  t,
}, ref) {
  const { tFallback } = useLanguage();
  // Slide copy is built by module-scope functions with no React context, so
  // each slide carries <field>Key beside its English — the same shape this
  // file already used for metricUnitKey and the progress labels. A field with
  // NO key is user data (a goal title, an exercise name) and renders as-is.
  const tr = (key, val, vars) => (key ? tFallback(key, val, vars) : val);

  // Push + follows drive two of the suggestion slides. Follows is a
  // cheap head-count; both are shared React Query caches.
  const push = usePushSubscription();
  const { data: followsCount = 0 } = useQuery({
    queryKey: ['heroFollowsCount', user?.email],
    queryFn: async () => {
      if (!user?.email) return 0;
      const { count } = await supabase
        .from('hub_follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_email', user.email);
      return count ?? 0;
    },
    enabled: !!user?.email,
    staleTime: 5 * 60_000,
  });

  const achievementSlides = useMemo(
    () => buildAchievementSlides({ logs, cardioLogs, goals, profile }),
    [logs, cardioLogs, goals, profile]
  );
  const pathSlides = useMemo(
    () => buildPathSlides({ profile, user, logs }),
    [profile, user, logs]
  );
  const telemetrySlides = useMemo(
    () => buildTelemetrySlides({ logs, cardioLogs, profile }),
    [logs, cardioLogs, profile]
  );
  const suggestionSlides = useMemo(
    () => buildSuggestionSlides({ logs, followsCount, push }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logs, followsCount, push.isSupported, push.isSubscribed, push.permission]
  );

  const mode = pickMode({ achievementSlides, pathSlides, profile, logs });

  // CTA dispatch — most slides route; a couple run an in-app action
  // (enable push, scroll to the weekly-recap share card, open My Week).
  const handleCta = (cta) => {
    if (!cta) return;
    if (cta.action === 'enablePush') { push.subscribe?.(); return; }
    // "Plan the week" opens the SAME My Week calendar the quick-action
    // tile opens, not /workout. It used to route to the Workout page,
    // which is where you log a session — not where you lay a week out.
    if (cta.action === 'planWeek') { onPlanWeek?.(); return; }
    if (cta.action === 'shareWeek') {
      const el = typeof document !== 'undefined' && document.querySelector('[data-recap-card]');
      if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (cta.to) onSlideCta?.(cta.to);
  };

  // Streak slide is ALWAYS the lead slide of the carousel when the user
  // isn't on the brand-new-user `path`. Achievements rotate behind it
  // every 10s. (Was previously a mutually-exclusive fallback layout —
  // a 5K milestone from 15 days ago would hide the streak entirely.)
  // Streak is no longer a hero slide — it moved to a compact pill BENEATH
  // the carousel in the same hero card (rendered by HeroCard via
  // LoginStreakBanner), so it's not duplicated inside the rotation.
  const streakSlide = null;

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
      // Was a private purple. Feature slides use the brand accent — the
      // slide is the feature, the hue doesn't need to be.
      color: 'var(--primary)',
      icon: Swords,
      kicker: 'Feature of the Day',
      kickerKey: 'hero.feature.dayKicker',
      title: 'Duels',
      titleKey: 'duels.title',
      sub: 'Challenge a friend to a head-to-head workout. First to finish wins XP + bragging rights.',
      subKey: 'hero.feature.duels.sub',
      cta: { label: 'Open a duel', labelKey: 'hero.cta.openDuel', to: '/duels' },
    },
    {
      id: 'feature:stories',
      kind: 'feature',
      tier: 'week',
      color: 'var(--info)',
      icon: Camera,
      kicker: 'Feature of the Week',
      kickerKey: 'hero.feature.weekKicker',
      title: 'Stories',
      titleKey: 'stories.title',
      sub: 'Post a 24-hr workout selfie or PR moment. Friends react with fire emojis on the Hub.',
      subKey: 'hero.feature.stories.sub',
      cta: { label: 'Post a story', labelKey: 'hero.cta.postStory', to: '/hub' },
    },
  ];

  // Non-path rotation = promo features + the user's personal telemetry +
  // actionable suggestions + recent achievements. Deduped by id and
  // capped so the carousel stays a scannable 5–9 slides rather than an
  // endless scroll. Achievements lead (freshest wins) when present.
  const slides = useMemo(() => {
    if (mode === 'path') return pathSlides;
    const combined = [
      ...(streakSlide ? [streakSlide] : []),
      ...featureSlides,
      ...telemetrySlides,
      ...suggestionSlides,
      ...achievementSlides,
    ];
    const seen = new Set();
    const deduped = [];
    for (const s of combined) {
      if (!s || seen.has(s.id)) continue;
      seen.add(s.id);
      deduped.push(s);
    }
    return deduped.slice(0, 9);
    // featureSlides/streakSlide are recomputed each render (cheap literals);
    // depend on the array pieces that actually carry data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pathSlides, telemetrySlides, suggestionSlides, achievementSlides]);

  /* The pager — track, gesture, settle spring, auto-rotation and dots —
     is HeroPager (src/components/HeroPager.jsx). It used to be ~200 lines
     inline here, and while it was, Progress and Nutrition ran the older
     fade-in-place carousel instead: same dots, completely different
     gesture. Sharing the engine is what keeps the three in step. */

  // Report slide-count changes up so the parent can show/hide the
  // chevron button reactively.
  useEffect(() => {
    onSlidesCountChange?.(slides.length);
  }, [slides.length, onSlidesCountChange]);

  // Per-slide colour reporting — the parent (HeroCard) paints the band's
  // tint and its 2px identity rule in the current slide's accent, and the
  // pager paints its dots the same way. HeroPager hands the live slide
  // back through onIndexChange; heroSlideAccent resolves explicit
  // slide.color → iconBg lookup → the brand token.
  //
  // useCallback, not an inline arrow: HeroPager re-runs its reporting
  // effect when this identity changes, and a fresh function every render
  // would fire it on every render of this component.
  const handleIndexChange = useCallback((_i, slide) => {
    onSlideColorChange?.(slide ? heroSlideAccent(slide) : null);
  }, [onSlideColorChange]);

  /* renderBody — one slide's layout, for ANY slide rather than only the
     current one.

     That signature change is the whole refactor. The paged track below
     renders prev / current / next at once so the neighbour is already on
     screen, partly visible, while the finger is still down — which is
     impossible while the render path can only draw `slides[idx]`.

     The three pagination-dot rows that used to live one-per-branch are
     gone from here and hoisted to a single row outside the track. A dot
     row inside a slide travels WITH that slide, so on a paged carousel
     you would watch the dots slide off the screen with the page they
     belong to. */
  const renderBody = (slide, { count = 1 } = {}) => {
  // STREAK slide renders with its own chrome (giant N + "day streak"
  // label) — visually distinct so the carousel doesn't blur achievements
  // and the streak into the same template. Keeps the pagination dots
  // shared so the user can swipe between streak and milestones.
  if (slide.kind === 'streak') {
    return (
      <div className={`relative flex flex-col justify-between gap-5 min-w-0 ${count > 1 ? HERO_SLIDE_GUTTER : ''}`}>
        {/* Decorative icon — right-centre, translucent */}
        <Flame aria-hidden="true" className="absolute pointer-events-none select-none"
          style={heroWatermarkStyle(0.12)} />
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Flame className="w-4 h-4 text-primary/80" />
          </div>
          <span className="text-micro font-semibold tracking-[0.04em] text-foreground/70">
            {hasWorkedOutToday
              ? t('dashboard.hero.kicker.done')
              : streak > 0
                ? t('dashboard.hero.kicker.keepStreak')
                : daysSinceLast >= 2
                  ? t('dashboard.hero.kicker.comeback')
                  : t('dashboard.hero.kicker.fresh')}
          </span>
        </div>
        {/* Plain div, not an AnimatePresence swap. This used to fade the
            body out and the next one in, because swapping content in place
            WAS the transition. The track provides the transition now, and a
            page that also cross-fades its own contents while sliding reads
            as two animations disagreeing. Worse with `mode="wait"`: exit
            finishes before enter starts, so the page renders empty for a
            beat — mid-slide, in full view of the page beside it. */}
        <div className="min-w-0">
            <div className="flex items-baseline gap-3">
              <span
                className="font-heading font-bold leading-none tracking-tight tabular-nums"
                style={{ fontSize: 'clamp(3.5rem, 12vw, 6.5rem)' }}
              >
                <AnimatedNumber from={0} value={streak} duration={HERO_COUNT_MS} />
              </span>
              <span className="font-heading text-lg md:text-xl font-medium text-foreground/70 leading-tight pb-2">
                {streak === 1 ? t('dashboard.hero.daySingular') : t('dashboard.hero.dayPlural')}
              </span>
            </div>
            <p className="text-sm text-foreground/60 max-w-[28ch] leading-relaxed mt-3">
              {hasWorkedOutToday
                ? t('dashboard.hero.subtitle.done')
                : streak > 0
                  ? t('dashboard.hero.subtitle.keepGoing')
                  : t('dashboard.hero.subtitle.startToday')}
            </p>
        </div>
      </div>
    );
  }

  // ── FEATURE-OF-THE-DAY / WEEK — purple promo card ─────────────────
  if (slide.kind === 'feature') {
    const FeatureIcon = slide.icon || Sparkles;
    return (
      <div className={`relative flex flex-col justify-between gap-4 min-w-0 ${count > 1 ? HERO_SLIDE_GUTTER : ''}`}>
        <FeatureIcon aria-hidden="true" className="absolute pointer-events-none select-none"
          style={heroWatermarkStyle()} />
        {/* The tint overlay that used to sit here is GONE, not softened.
            It was a `-inset-3 rounded-2xl` box painted with
            `linear-gradient(135deg, primary/0.22, primary/0.08 60%,
            transparent)`, and on a phone it read as an orange rectangle
            floating on the band.

            Softening it does not work, which is worth writing down so
            nobody re-adds a "fixed" version. A gradient has no visible
            edge only if its alpha reaches zero before EVERY boundary of
            the element. A 135deg linear ramp fades along one axis, so
            the two sides it starts from are painted at full strength
            right up against the box — the element's own shape, drawn in
            colour. Re-anchoring it as a radial from the top-left corner
            moves the problem rather than solving it: peak alpha then
            sits exactly on the top and left edges. The only geometry
            that works is a falloff centred well inside the box, which is
            a blob in the middle of the slide, not a corner wash.

            It also ended at the `transparent` keyword — rgba(0,0,0,0) —
            so the ramp interpolated orange toward transparent BLACK and
            picked up muddy darkened tones on the way, which is the grey
            cast along the fade.

            Removing it is what CLAUDE.md's composition rules already
            call for: "No gradient as decoration." The hero band made
            exactly this call once before — see the comment in
            Dashboard.jsx above `slideColor`, where an animated radial
            mesh was replaced by a 2px solid rule for the same reason.
            This overlay was the piece that pass missed.

            The slide keeps plenty of identity without it: the accent
            icon chip, the accent kicker, the accent pagination dots, and
            the band's own 2px rule, which already paints this slide's
            colour along the top edge. */}
        <div className="relative flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/25 flex items-center justify-center">
            <FeatureIcon className="w-4 h-4 text-primary" />
          </div>
          <span className="text-micro font-semibold tracking-[0.04em] text-primary">
            {tr(slide.kickerKey, slide.kicker)}
          </span>
        </div>
        {/* No AnimatePresence — the track is the transition. See the note
            on the streak branch. */}
        <div className="relative min-w-0">
            <h2
              // pe-20 reserves the watermark's column — see the note on the
              // shared branch's title.
              className="font-heading font-bold leading-[1.05] tracking-tight text-foreground break-words pe-20"
              style={{ fontSize: 'clamp(1.6rem, 5vw, 2.5rem)' }}
            >
              {tr(slide.titleKey, slide.title, slide.titleVars)}
            </h2>
            <p className="text-sm text-foreground/75 max-w-[36ch] leading-relaxed mt-2">
              {tr(slide.subKey, slide.sub, slide.subVars)}
            </p>
            {slide.cta && (
              <button
                type="button"
                onClick={() => handleCta(slide.cta)}
                className="inline-flex items-center gap-1 mt-3 px-3 py-1.5 rounded-full bg-primary/30 hover:bg-primary/40 active:bg-primary/40 text-caption font-semibold text-foreground transition-colors"
              >
                {tr(slide.cta.labelKey, slide.cta.label)}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
        </div>
      </div>
    );
  }

  // ── ACHIEVEMENTS or PATH — shared slideshow layout ─────────────────
  const SlideIcon = slide.icon || Sparkles;

  const subKicker = mode === 'achievements'
    ? (slide.when ? formatDistanceToNowStrict(new Date(slide.when), { addSuffix: true }) : null)
    : null;

  return (
    <div className={`relative flex flex-col justify-between gap-5 min-w-0 ${count > 1 ? HERO_SLIDE_GUTTER : ''}`}>
      {/* Contextual watermark. The old comment here described a right-CENTRE
          position with a special case pinning it to the top-right on slides
          carrying a full-width ProgressBar — but both branches of that
          conditional already set `top: 5`, so the two cases were identical
          and had been for as long as the code existed. Every slide was
          top-right regardless. Dropped, along with the `progressPct` guard
          that selected between them. */}
      {SlideIcon && <SlideIcon aria-hidden="true" className="absolute pointer-events-none select-none"
        style={heroWatermarkStyle()} />}
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${slide.iconBg || 'bg-primary/10'}`}>
          <SlideIcon className="w-4 h-4 text-foreground" />
        </div>
        <span className="text-micro font-semibold tracking-[0.04em] text-foreground/70">
          {tr(slide.kickerKey, slide.kicker)}
          {subKicker && <span className="text-foreground/70 normal-case tracking-normal font-normal ms-2">· {subKicker}</span>}
        </span>
      </div>

      {/* No AnimatePresence — the track is the transition. See the note on
          the streak branch. */}
      <div className="min-w-0">
          {/* Slide title — for PR slides this is the EXERCISE name
              (small caps); the big number lives in the metric row
              below it. For non-metric slides this IS the headline. */}
          {/* `pe-20` reserves the watermark's column. The icon is absolutely
              positioned, so it takes no space and text runs straight under it
              — measured, "Follow your first friend" overlapped the icon by
              38×21px at 423pt. Shrinking the icon only moves that threshold;
              reserving 80px against a 72px icon makes the collision
              impossible for ANY title, at any width, in any locale, which is
              what "no overlap on any device" actually requires. */}
          <h2
            className={
              slide.metricValue != null
                ? 'font-heading font-semibold text-foreground/85 break-words pe-20'
                : 'font-heading font-bold leading-[1.05] tracking-tight text-foreground break-words pe-20'
            }
            style={
              slide.metricValue != null
                ? { fontSize: 'clamp(0.95rem, 2.2vw, 1.15rem)' }
                : { fontSize: 'clamp(1.75rem, 5.5vw, 3rem)' }
            }
          >
            {tr(slide.titleKey, slide.title, slide.titleVars)}
          </h2>

          {/* Animated metric — count-up tween. The headline value
              for the slide; size matches the original streak hero
              so the visual rhythm is preserved. */}
          {slide.metricValue != null && (
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className="font-heading font-bold leading-none tracking-tight tabular-nums text-foreground"
                style={{ fontSize: 'clamp(3rem, 10vw, 5.25rem)' }}
              >
                {tr(slide.metricPrefixKey, slide.metricPrefix)}
                <AnimatedNumber
                  from={slide.metricFrom ?? 0}
                  value={slide.metricValue}
                  duration={HERO_COUNT_MS}
                  format={(n) => n.toFixed(slide.metricDecimals ?? 0)}
                />
                {tr(slide.metricUnitKey, slide.metricUnit)}
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
              transition={{ duration: 0.22, delay: 0.9 }}
              className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full bg-secondary text-micro font-bold text-foreground"
            >
              {slide.metricDelta > 0 ? '+' : ''}
              {slide.metricDelta}
              {slide.metricDeltaUnitKey
                ? tFallback(slide.metricDeltaUnitKey, slide.metricDeltaUnit || '')
                : (slide.metricDeltaUnit || '')}
              {slide.metricDeltaSuffix && (
                <span className="font-medium text-foreground/70">
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
              <Sparkline values={slide.history} color="hsl(var(--primary))" height={32} />
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
          <p className="text-sm text-foreground/60 max-w-[36ch] leading-relaxed mt-3">
            {tr(slide.subKey, slide.sub, slide.subVars)}
          </p>

          {slide.cta && (
            <button
              type="button"
              onClick={() => handleCta(slide.cta)}
              className="inline-flex items-center gap-1 mt-3 px-3 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 active:bg-primary/20 text-caption font-semibold text-foreground transition-colors"
            >
              {tr(slide.cta.labelKey, slide.cta.label)}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
      </div>

    </div>
  );
  };

  /* The track, the gesture and the dots are HeroPager's. `ref` is forwarded
     straight through: the parent HeroCard holds it only to call .next() from
     the chevron it renders at the band's edge, and the pager exposes exactly
     that. */
  return (
    <HeroPager
      ref={ref}
      slides={slides}
      rotateMs={ROTATE_MS}
      renderSlide={renderBody}
      onIndexChange={handleIndexChange}
      dotLabel={(i) => tFallback('dashboard.hero.slide', 'Slide {n}', { n: i + 1 })}
    />
  );
});

export default HeroSlideshow;
