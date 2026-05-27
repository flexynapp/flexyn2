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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flame, Trophy, TrendingUp, Award, Zap, Sparkles,
  Calendar, CheckCircle2, Dumbbell, Footprints, ChevronRight,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useLanguage } from '@/lib/LanguageContext';

const ROTATE_MS = 6000;

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
      entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
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
        slides.push({
          id: `pr:${name}:${recentPR.when}`,
          icon: Trophy, iconBg: 'bg-amber-400/20',
          kicker: 'Personal Record',
          title: `${recentPR.weight} lb ${name}`,
          sub: `+${recentPR.weight - recentPR.prev} lb from your last best`,
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
      slides.push({
        id: `goal:${g.id}`,
        icon: CheckCircle2, iconBg: 'bg-emerald-400/20',
        kicker: 'Goal Completed',
        title: g.title || 'Goal hit',
        sub: g.description?.slice(0, 60) || 'Set the next one.',
        when,
      });
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
        title: `Level ${profile.current_level}`,
        sub: `${profile.total_xp ?? 0} XP earned overall`,
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
      kicker: `${streak}-Day Streak`,
      title: 'You\'re consistent.',
      sub: streak >= 30 ? 'Habit locked in.' : 'Keep the momentum.',
      when: now,
    });
  }

  // 5) Recent cardio milestone — first run over 5km, etc.
  if (Array.isArray(cardioLogs) && cardioLogs.length) {
    const FIRSTS = [
      { meters: 5000,  label: 'First 5K' },
      { meters: 10000, label: 'First 10K' },
      { meters: 21097, label: 'Half Marathon' },
    ];
    for (const f of FIRSTS) {
      const hit = cardioLogs.find(l => Number(l.distance_meters) >= f.meters);
      if (!hit) continue;
      const when = hit.date ? new Date(hit.date).getTime() : 0;
      if (!when || now - when > RECENT_MS) continue;
      slides.push({
        id: `cardio:${f.meters}:${when}`,
        icon: Footprints, iconBg: 'bg-cyan-400/20',
        kicker: 'Distance Milestone',
        title: f.label,
        sub: `${(hit.distance_meters / 1000).toFixed(1)} km logged`,
        when,
      });
    }
  }

  // Sort newest first, cap at 6.
  return slides.sort((a, b) => (b.when || 0) - (a.when || 0)).slice(0, 6);
}

/**
 * Build the new-user calculated path. Driven entirely by onboarding
 * signals + the user's primary fitness goal.
 */
function buildPathSlides({ profile, user }) {
  if (!profile && !user) return [];
  const p = profile || user || {};
  const goals = Array.isArray(p.fitness_goals_arr) ? p.fitness_goals_arr
              : typeof p.fitness_goals === 'string' && p.fitness_goals
                ? p.fitness_goals.split(',').map(s => s.trim()).filter(Boolean)
                : [];
  const primaryGoal = goals[0] || 'general_fitness';
  const level = p.fitness_level || 'beginner';
  const trainingDays = Array.isArray(p.training_days) ? p.training_days.length : 0;

  // Step 1 is always "log workout #1" — universal across goal types.
  const slides = [{
    id: 'path:1',
    icon: Dumbbell, iconBg: 'bg-primary/20',
    kicker: 'Step 1',
    title: 'Log your first workout',
    sub: 'Open the Workout tab and tap Start. Anything counts — even a 10-minute session.',
    cta: { label: 'Start workout', to: '/workout' },
  }];

  // Step 2 — weekly cadence based on training_days.
  const weekTarget = Math.max(3, Math.min(trainingDays || 3, 6));
  slides.push({
    id: 'path:2',
    icon: Calendar, iconBg: 'bg-blue-400/20',
    kicker: 'Step 2',
    title: `Hit ${weekTarget} workouts this week`,
    sub: 'Three a week is the floor where strength builds. Six is the ceiling before recovery suffers.',
    cta: { label: 'Plan the week', to: '/workout' },
  });

  // Step 3 — first PR (timing depends on level)
  const prWeeks = level === 'beginner' ? 2 : level === 'intermediate' ? 4 : 6;
  slides.push({
    id: 'path:3',
    icon: Trophy, iconBg: 'bg-amber-400/20',
    kicker: 'Step 3',
    title: `First PR by week ${prWeeks}`,
    sub: level === 'beginner'
      ? 'Newbie gains are real. Beat any single previous lift = PR.'
      : 'Pick one lift to chase. We\'ll surface +5 lb progress automatically.',
  });

  // Step 4 — goal-specific anchor
  if (/lose|cut|fat|weight/i.test(primaryGoal)) {
    const startLbs = Number(p.weight_lbs);
    const targetLbs = Number(p.target_weight_lbs);
    if (Number.isFinite(startLbs) && Number.isFinite(targetLbs) && startLbs > targetLbs) {
      const delta = startLbs - targetLbs;
      // Healthy fat-loss pace ≈ 1 lb/week. Cap at 24 weeks of horizon.
      const weeks = Math.min(Math.ceil(delta), 24);
      slides.push({
        id: 'path:4-loss',
        icon: TrendingUp, iconBg: 'bg-emerald-400/20',
        kicker: 'Your goal',
        title: `${targetLbs} lb by week ${weeks}`,
        sub: `${delta.toFixed(0)} lb to go · ~1 lb/week (sustainable).`,
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
      title: 'Add 10 lb to a main lift',
      sub: 'Bench, squat, or deadlift — pick one and chase the next +5 every week.',
      cta: { label: 'Start tracking', to: '/workout' },
    });
  } else if (/endurance|cardio|run/i.test(primaryGoal)) {
    slides.push({
      id: 'path:4-endurance',
      icon: Footprints, iconBg: 'bg-cyan-400/20',
      kicker: 'Your goal',
      title: 'Build to a 5K',
      sub: 'Run/walk intervals for 3 weeks → continuous 30-min jog by week 6.',
      cta: { label: 'Log cardio', to: '/cardio' },
    });
  } else {
    slides.push({
      id: 'path:4-generic',
      icon: Sparkles, iconBg: 'bg-violet-400/20',
      kicker: 'Your goal',
      title: '30-day commit',
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

export default function HeroSlideshow({
  logs, cardioLogs, goals, profile, user,
  streak, hasWorkedOutToday, daysSinceLast,
  onPrimary, onSlideCta,
  t,
}) {
  const { tFallback } = useLanguage();

  const achievementSlides = useMemo(
    () => buildAchievementSlides({ logs, cardioLogs, goals, profile }),
    [logs, cardioLogs, goals, profile]
  );
  const pathSlides = useMemo(
    () => buildPathSlides({ profile, user }),
    [profile, user]
  );

  const mode = pickMode({ achievementSlides, pathSlides, profile, logs });
  const slides = mode === 'achievements' ? achievementSlides
               : mode === 'path' ? pathSlides
               : [];

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

  // Cleanup pause timer on unmount.
  useEffect(() => () => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
  }, []);

  // ── STREAK fallback — original layout, preserved as-is ─────────────
  if (mode === 'streak') {
    return (
      <div className="flex flex-col justify-between gap-6 min-w-0">
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
        <div className="flex items-baseline gap-3">
          <motion.span
            key={streak}
            initial={{ opacity: 0, y: 12, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="font-heading font-bold leading-none tracking-tight tabular-nums"
            style={{ fontSize: 'clamp(3.5rem, 12vw, 6.5rem)' }}
          >
            {streak}
          </motion.span>
          <span className="font-heading text-lg md:text-xl font-medium text-white/70 leading-tight pb-2">
            {streak === 1 ? t('dashboard.hero.daySingular') : t('dashboard.hero.dayPlural')}
          </span>
        </div>
        <p className="text-sm text-white/60 max-w-[28ch] leading-relaxed">
          {hasWorkedOutToday
            ? t('dashboard.hero.subtitle.done')
            : streak > 0
              ? t('dashboard.hero.subtitle.keepGoing')
              : t('dashboard.hero.subtitle.startToday')}
        </p>
      </div>
    );
  }

  // ── ACHIEVEMENTS or PATH — shared slideshow layout ─────────────────
  const slide = slides[idx];
  if (!slide) return null;
  const SlideIcon = slide.icon || Sparkles;

  const subKicker = mode === 'achievements'
    ? (slide.when ? formatDistanceToNowStrict(new Date(slide.when), { addSuffix: true }) : null)
    : null;

  return (
    <div className="flex flex-col justify-between gap-5 min-w-0">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-full backdrop-blur-sm flex items-center justify-center ${slide.iconBg || 'bg-white/10'}`}>
          <SlideIcon className="w-4 h-4 text-white" />
        </div>
        <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-white/70">
          {slide.kicker}
          {subKicker && <span className="text-white/40 normal-case tracking-normal font-normal ml-2">· {subKicker}</span>}
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
          <h2
            className="font-heading font-bold leading-[1.05] tracking-tight text-white break-words"
            style={{ fontSize: 'clamp(1.75rem, 5.5vw, 3rem)' }}
          >
            {slide.title}
          </h2>
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
