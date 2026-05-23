import React, { useState, useMemo, useEffect } from 'react';
import StoriesRow from '@/components/stories/StoriesRow';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { subDays, isAfter, differenceInDays, startOfDay, format } from 'date-fns';
import { Dumbbell, TrendingUp, Play, ArrowRight, Zap, Flame, Activity, Target, Apple, Camera, Scale, TrendingDown, Minus, Repeat2, Moon, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { motion, AnimatePresence } from 'framer-motion';
import GoalsModal from '@/components/goals/GoalsModal';
import GoalsAlmostComplete from '@/components/goals/GoalsAlmostComplete';
import GoalsProgressStrip from '@/components/dashboard/GoalsProgressStrip';
import LogWeightModal from '@/components/dashboard/LogWeightModal';
import ProgressPhotoCapture from '@/components/progress/ProgressPhotoCapture';
import DashboardWidgets from '@/components/dashboard/DashboardWidgets';
import SyncStatus from '@/components/dashboard/SyncStatus';
import ResumeWorkoutBanner from '@/components/dashboard/ResumeWorkoutBanner';
import StreakRescueCard from '@/components/dashboard/StreakRescueCard';
import DailyQuote from '@/components/dashboard/DailyQuote';
import DailyQuestsCard from '@/components/dashboard/DailyQuestsCard';
import WeeklyRecap from '@/components/dashboard/WeeklyRecap';
import WorkoutSuggestionCard from '@/components/dashboard/WorkoutSuggestionCard';
import WorkoutMemoryCard from '@/components/dashboard/WorkoutMemoryCard';
import TodaysPlanCard from '@/components/dashboard/TodaysPlanCard';
import CalorieProgressWidget from '@/components/dashboard/CalorieProgressWidget';
import MacroRingWidget from '@/components/dashboard/MacroRingWidget';
import HydrationRing from '@/components/dashboard/HydrationRing';
import MoodLogCard from '@/components/dashboard/MoodLogCard';
import NemesisCard from '@/components/nemesis/NemesisCard';
import ReadinessCard from '@/components/dashboard/ReadinessCard';
import LoginStreakBanner from '@/components/dashboard/LoginStreakBanner';
import PushOptInBanner from '@/components/dashboard/PushOptInBanner';
import IosInstallBanner from '@/components/dashboard/IosInstallBanner';
import OnboardingNudgeCard from '@/components/dashboard/OnboardingNudgeCard';
import WorkoutStreakBanner from '@/components/dashboard/WorkoutStreakBanner';
import LeagueCard from '@/components/dashboard/LeagueCard';
import DiscoveryCards from '@/components/dashboard/DiscoveryCards';
import ErrorBoundary from '@/components/ErrorBoundary';
import PrestigePrompt from '@/components/prestige/PrestigePrompt';
import { isPrestigeEligible } from '@/lib/data/prestige';
import LeagueStandingsModal from '@/components/dashboard/LeagueStandingsModal';
import { filterAfterReset } from '@/lib/accountReset';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { useNumberFormatter } from '@/lib/intl';

/* ──────────────────────────────────────────────────────────────────
 *  Sub-components live in this file deliberately — they only exist
 *  to compose the dashboard hero and stats strip, and keeping them
 *  co-located makes the page easier to read end-to-end.
 * ────────────────────────────────────────────────────────────────── */

function HeroCard({ streak, hasWorkedOutToday, daysSinceLast, onPrimary, t }) {
  // Pick the right primary message + CTA based on user's recent activity
  const isFresh = streak === 0 && daysSinceLast == null;
  const isOnStreak = streak > 0;
  const isLapsed = !isOnStreak && !isFresh && daysSinceLast >= 2;

  let kicker, cta;
  if (hasWorkedOutToday) {
    kicker = t('dashboard.hero.kicker.done');
    cta = t('dashboard.hero.cta.logAnother');
  } else if (isOnStreak) {
    kicker = t('dashboard.hero.kicker.keepStreak');
    cta = t('dashboard.hero.cta.continueStreak');
  } else if (isLapsed) {
    kicker = t('dashboard.hero.kicker.comeback');
    cta = t('dashboard.hero.cta.getBack');
  } else {
    kicker = t('dashboard.hero.kicker.fresh');
    cta = t('dashboard.hero.cta.startFirst');
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      <div className="relative overflow-hidden rounded-3xl bg-[hsl(210_18%_11%)] dark:bg-[hsl(210_22%_8%)] text-white shadow-2xl shadow-black/20">
        {/* Animated warm gradient mesh */}
        <div className="absolute inset-0 opacity-90 pointer-events-none">
          <div
            className="absolute -top-1/3 -right-1/4 w-[120%] h-[140%] rounded-full blur-3xl"
            style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.55), transparent 65%)' }}
          />
          <motion.div
            className="absolute -bottom-1/3 -left-1/4 w-[100%] h-[120%] rounded-full blur-3xl"
            style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.25), transparent 70%)' }}
            animate={{ x: [0, 20, 0], y: [0, -10, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        {/* Subtle grid texture */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(hsl(0 0% 100% / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.6) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />

        <div className="relative grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-6 md:gap-8 p-6 md:p-8 lg:p-10">
          {/* Left — Streak */}
          <div className="flex flex-col justify-between gap-6 min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
                <Flame className="w-4 h-4 text-primary/80" />
              </div>
              <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-white/70">
                {kicker}
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

          {/* Right — Primary CTA */}
          <div className="flex flex-col justify-end">
            <motion.button
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              onClick={onPrimary}
              className="group w-full bg-white text-[hsl(210_18%_11%)] rounded-2xl p-5 md:p-6 flex items-center justify-between gap-4 shadow-xl shadow-black/10 hover:shadow-2xl transition-shadow text-left select-none-ui"
            >
              <div className="min-w-0">
                <span className="block text-[10px] font-semibold tracking-[0.2em] uppercase text-primary mb-1">
                  {hasWorkedOutToday
                    ? t('dashboard.hero.label.again')
                    : t('dashboard.hero.label.today')}
                </span>
                <span className="font-heading font-bold text-xl md:text-2xl leading-tight break-anywhere">
                  {cta}
                </span>
              </div>
              <motion.div
                className="shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30"
                whileHover={{ rotate: 5 }}
              >
                <ArrowRight className="w-5 h-5 md:w-6 md:h-6 transition-transform group-hover:translate-x-0.5" />
              </motion.div>
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function StatTile({ icon: Icon, value, label, suffix, delay = 0, accent = false, trend = null }) {
  // trend: positive number = up, negative = down, 0 or null = no arrow
  const showTrend = trend !== null && trend !== 0;
  const isUp = trend > 0;
  const TrendIcon = isUp ? TrendingUp : TrendingDown;
  const trendColor = isUp ? 'text-green-500' : 'text-red-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card
        className={`relative overflow-hidden p-4 md:p-5 border-border/60 shadow-sm hover:shadow-md transition-shadow ${
          accent ? 'bg-gradient-to-br from-primary/[0.08] to-transparent' : ''
        }`}
      >
        <div className="flex items-center gap-2 mb-3 text-muted-foreground">
          <Icon className={`w-3.5 h-3.5 ${accent ? 'text-primary' : ''}`} />
          <span className="text-[10px] font-semibold tracking-[0.16em] uppercase">
            {label}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-heading font-bold text-3xl md:text-4xl leading-none tabular-nums tracking-tight">
            {value}
          </span>
          {suffix && (
            <span className="text-xs text-muted-foreground font-medium">{suffix}</span>
          )}
        </div>
        {showTrend && (
          <div className={`flex items-center gap-0.5 mt-1.5 ${trendColor}`}>
            <TrendIcon className="w-3 h-3" />
            <span className="text-[10px] font-semibold">
              {isUp ? '+' : ''}{trend} vs last wk
            </span>
          </div>
        )}
        {trend === 0 && (
          <div className="flex items-center gap-0.5 mt-1.5 text-muted-foreground/60">
            <Minus className="w-3 h-3" />
            <span className="text-[10px]">same as last wk</span>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function QuickAction({ to, icon: Icon, label, onClick, delay = 0 }) {
  const inner = (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, delay, ease: 'easeOut' }}
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.98 }}
      className="group relative flex items-center gap-3 px-4 py-3.5 rounded-xl bg-card border border-border/70 hover:border-primary/40 hover:bg-card transition-colors cursor-pointer select-none-ui"
    >
      <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-primary/10 transition-colors">
        <Icon className="w-4 h-4 text-foreground/70 group-hover:text-primary transition-colors" />
      </div>
      <span className="font-heading font-semibold text-sm flex-1 leading-tight">{label}</span>
      <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
    </motion.div>
  );

  if (to) return <Link to={to}>{inner}</Link>;
  return (
    <button onClick={onClick} className="w-full text-left">
      {inner}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Main Dashboard
 * ────────────────────────────────────────────────────────────────── */


export default function Dashboard() {
  const { t, tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const fmt = useNumberFormatter();
  const isFirstLoad = location.state?.fromSplash;
  const [showWelcome, setShowWelcome] = useState(isFirstLoad);
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);
  const [logWeightOpen, setLogWeightOpen] = useState(false);
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false);
  const [leagueModalOpen, setLeagueModalOpen] = useState(false);

  // ── Rest day declaration ──────────────────────────────────────────────────
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const [isRestDay, setIsRestDay] = useState(() => {
    try { return localStorage.getItem(`flexyn.restDay.${todayKey}`) === '1'; } catch { return false; }
  });
  const handleDeclareRestDay = () => {
    try { localStorage.setItem(`flexyn.restDay.${todayKey}`, '1'); } catch {}
    setIsRestDay(true);
  };
  const handleUndoRestDay = () => {
    try { localStorage.removeItem(`flexyn.restDay.${todayKey}`); } catch {}
    setIsRestDay(false);
  };

  useEffect(() => {
    if (showWelcome) {
      // 6 s gives slower readers time to finish the welcome-back message
      const timer = setTimeout(() => setShowWelcome(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [showWelcome]);

  const { data: rawLogs = [], isLoading: logsLoading, dataUpdatedAt: logsUpdatedAt } = useQuery({
    queryKey: ['workoutLogs', user?.email],
    queryFn: () => db.entities.WorkoutLog.filter({ created_by: user.email }, '-date', 50),
    enabled: !!user?.email,
  });

  const { data: rawCardioLogs = [] } = useQuery({
    queryKey: ['cardioLogs', user?.email],
    queryFn: () => db.entities.CardioLog.filter({ created_by: user.email }, '-date', 50),
    enabled: !!user?.email,
  });

  const { data: rawRegimens = [], isLoading: regimensLoading } = useQuery({
    queryKey: ['regimens', user?.email],
    queryFn: () => db.entities.Regimen.filter({ created_by: user.email }),
    enabled: !!user?.email,
  });

  const { data: rawGoals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ['goals', user?.email],
    queryFn: () => db.entities.Goal.filter({ created_by: user.email }, '-created_date'),
    enabled: !!user?.email,
  });

  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });

  const logs = useMemo(() => filterAfterReset(rawLogs, userProfile), [rawLogs, userProfile]);
  const cardioLogs = useMemo(() => filterAfterReset(rawCardioLogs, userProfile), [rawCardioLogs, userProfile]);
  const regimens = useMemo(() => filterAfterReset(rawRegimens, userProfile), [rawRegimens, userProfile]);
  const goals = useMemo(() => filterAfterReset(rawGoals, userProfile), [rawGoals, userProfile]);

  const isLoading = logsLoading || regimensLoading || goalsLoading;

  /* ── Derived stats ─────────────────────────────────────────────── */

  const today = useMemo(() => startOfDay(new Date()), []);

  const thisWeekLogs = useMemo(
    () => logs.filter(l => l.date && isAfter(new Date(l.date), subDays(new Date(), 7))),
    [logs]
  );

  const muscleGroupCount = useMemo(() => {
    const groups = new Set();
    thisWeekLogs.forEach(log => {
      log.exercises?.forEach(ex => {
        if (ex.muscle_group) groups.add(ex.muscle_group);
        if (ex.muscle_groups?.length) ex.muscle_groups.forEach(g => groups.add(g));
      });
    });
    return groups.size;
  }, [thisWeekLogs]);

  // ── Last-week stats for trend arrows ──────────────────────────────────────
  const lastWeekLogs = useMemo(
    () => logs.filter(l => {
      if (!l.date) return false;
      const d = new Date(l.date);
      return isAfter(d, subDays(new Date(), 14)) && !isAfter(d, subDays(new Date(), 7));
    }),
    [logs]
  );

  const lastWeekWorkoutCount = lastWeekLogs.length;

  const lastWeekMuscleGroupCount = useMemo(() => {
    const groups = new Set();
    lastWeekLogs.forEach(log => {
      log.exercises?.forEach(ex => {
        if (ex.muscle_group) groups.add(ex.muscle_group);
        if (ex.muscle_groups?.length) ex.muscle_groups.forEach(g => groups.add(g));
      });
    });
    return groups.size;
  }, [lastWeekLogs]);

  // delta: positive = up, negative = down, null = no last-week data
  const workoutTrend = lastWeekWorkoutCount > 0
    ? thisWeekLogs.length - lastWeekWorkoutCount
    : null;
  const muscleTrend = lastWeekMuscleGroupCount > 0
    ? muscleGroupCount - lastWeekMuscleGroupCount
    : null;

  // Total volume this week (in user's preferred unit, lbs or kg)
  const weeklyVolume = useMemo(() => {
    let totalLbs = 0;
    thisWeekLogs.forEach(log => {
      log.exercises?.forEach(ex => {
        ex.sets?.forEach(set => {
          if (set.weight && set.reps) totalLbs += set.weight * set.reps;
        });
      });
    });
    return Math.round(fromLbs(totalLbs, weightUnit));
  }, [thisWeekLogs, weightUnit]);

  // Streak — merges workout + cardio dates, parses date strings as LOCAL dates
  const streak = useMemo(() => {
    const parseLocalDate = (s) => {
      if (!s) return null;
      if (typeof s === 'string') {
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      }
      return new Date(s);
    };
    const stamps = new Set();
    const addStamp = (raw) => {
      const d = parseLocalDate(raw);
      if (!d || isNaN(d.getTime())) return;
      const day = startOfDay(d);
      stamps.add(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`);
    };
    logs.forEach(l => addStamp(l.date));
    cardioLogs.forEach(l => addStamp(l.date));
    if (stamps.size === 0) return 0;
    const stampOf = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let cursor = startOfDay(new Date());
    if (!stamps.has(stampOf(cursor))) {
      const yesterday = new Date(cursor);
      yesterday.setDate(yesterday.getDate() - 1);
      if (stamps.has(stampOf(yesterday))) cursor = yesterday;
      else return 0;
    }
    let count = 0;
    while (stamps.has(stampOf(cursor))) {
      count++;
      const prev = new Date(cursor);
      prev.setDate(prev.getDate() - 1);
      cursor = prev;
    }
    return count;
  }, [logs, cardioLogs]);

  const lastWorkoutDate = useMemo(() => {
    const parseLocal = (s) => {
      if (!s) return null;
      if (typeof s === 'string') {
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      }
      return new Date(s);
    };
    const all = [...logs.map(l => l.date), ...cardioLogs.map(l => l.date)]
      .map(parseLocal)
      .filter(d => d && !isNaN(d.getTime()));
    if (all.length === 0) return null;
    return new Date(Math.max(...all.map(d => d.getTime())));
  }, [logs, cardioLogs]);

  const daysSinceLast = useMemo(() => {
    if (!lastWorkoutDate) return null;
    return differenceInDays(today, startOfDay(lastWorkoutDate));
  }, [lastWorkoutDate, today]);

  const hasWorkedOutToday = daysSinceLast === 0;

  // Time-aware greeting
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return t('dashboard.greeting.lateNight');
    if (h < 12) return t('dashboard.greeting.morning');
    if (h < 17) return t('dashboard.greeting.afternoon');
    if (h < 22) return t('dashboard.greeting.evening');
    return t('dashboard.greeting.night');
  }, [t]);

  const firstName = user?.username || user?.full_name?.split(' ')[0] || '';
  const todayLabel = format(new Date(), 'EEEE, MMMM d');

  // Format weekly volume nicely (1.2k for big numbers)
  const formatVolume = (n) => {
    if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return fmt(n);
  };

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="px-4 md:px-6 pt-3 pb-6 md:pt-5 max-w-5xl mx-auto"
    >
      {/* "Continue where you left off" — only renders when there's a
          paused workout in localStorage. Peace-of-mind affordance for
          users interrupted mid-workout. Auto-evicts drafts >24h old
          so it doesn't degrade into "you have nothing to do" noise. */}
      <ResumeWorkoutBanner />

      {/* "Keep your N-day streak alive — log 1 set?" — appears late in
          the day (>= 6 PM local) when the user has an active streak
          but hasn't logged a workout/meal yet. Suppressed on rest days. */}
      {!isRestDay && (
        <StreakRescueCard
          streakDays={streak}
          lastWorkoutDate={lastWorkoutDate?.toISOString()}
        />
      )}

      {/* ── Stories ─────────────────────────────────────────────── */}
      <StoriesRow
        onViewProfile={(u) =>
          navigate('/hub?profile=' + encodeURIComponent(u.email))
        }
      />

      {/* ── Greeting block ─────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="mb-5 md:mb-6"
      >
        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            {todayLabel}
          </span>
        </div>
        <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight leading-tight">
          <span className="text-muted-foreground/80">{greeting}</span>
          {firstName && (
            <>
              <span className="text-muted-foreground/80">, </span>
              <span className="text-foreground">{firstName}</span>
            </>
          )}
          <span className="text-primary">.</span>
        </h1>

        <AnimatePresence>
          {showWelcome && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="text-sm text-muted-foreground mt-2"
            >
              {t('dashboard.welcomeBack')}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <div className="mb-4 md:mb-5">
        <HeroCard
          streak={streak}
          hasWorkedOutToday={hasWorkedOutToday}
          daysSinceLast={daysSinceLast}
          onPrimary={() => navigate('/workout')}
          t={t}
        />
      </div>

      {/* ── Repeat Last Workout — near the top for returning users ──────
           Highest-priority quick action: most returning users want to
           repeat exactly what they did last. Shown before discovery
           cards so it's always visible without scrolling. */}
      {!hasWorkedOutToday && !isRestDay && logs.length > 0 && (() => {
        const last = logs[0];
        const title = last.regimen_name || tFallback('workout.lastWorkout', 'Last workout');
        return (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="mb-4 md:mb-5"
          >
            <button
              onClick={() => navigate('/workout', { state: { repeatLog: last } })}
              className="group w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Repeat2 className="w-4.5 h-4.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Repeat last workout</p>
                <p className="text-sm font-heading font-bold leading-tight truncate">{title}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-primary/60 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </motion.div>
        );
      })()}

      {/* ── Rest day declaration ─────────────────────────────────────── */}
      {!hasWorkedOutToday && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.08 }}
          className="mb-4 md:mb-5"
        >
          {isRestDay ? (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-green-500/30 bg-green-500/5">
              <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-green-600 dark:text-green-400">Rest day — you earned it 🌿</p>
                <p className="text-[11px] text-muted-foreground">Your streak is safe. Recovery is training too.</p>
              </div>
              <button
                onClick={handleUndoRestDay}
                className="text-[10px] text-muted-foreground hover:text-foreground underline shrink-0"
              >
                Undo
              </button>
            </div>
          ) : (
            <button
              onClick={handleDeclareRestDay}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border/60 bg-secondary/30 hover:bg-secondary/60 transition-colors text-left group"
            >
              <Moon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                Mark today as a rest day
              </span>
            </button>
          )}
        </motion.div>
      )}

      {/* ── Today's scheduled plan (PPL / split inference) ──────────── */}
      <div className="mb-4 md:mb-5">
        <ErrorBoundary label="TodaysPlanCard">
          <TodaysPlanCard
            regimens={regimens}
            logs={logs}
            hasWorkedOutToday={hasWorkedOutToday}
          />
        </ErrorBoundary>
      </div>

      {/* ── Discovery cards ─────────────────────────────────────
           Single-slot, prioritized: starter plan → Form Coach → AI Coach.
           Wrapped in its own ErrorBoundary so a card-level bug never
           kills the whole Dashboard. Dismissals persist via
           discoveryPrefs. */}
      <div className="mb-4 md:mb-5">
        <ErrorBoundary label="DiscoveryCards">
          <DiscoveryCards
            logs={rawLogs}
            regimens={rawRegimens}
            isLoading={logsLoading || regimensLoading}
          />
        </ErrorBoundary>
      </div>

      {/* ── Stats strip ────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-5 md:mb-6">
        <StatTile
          icon={Activity}
          value={thisWeekLogs.length}
          label={t('dashboard.stats.thisWeek')}
          suffix={
            thisWeekLogs.length === 1
              ? t('dashboard.stats.workoutSingular')
              : t('dashboard.stats.workoutPlural')
          }
          delay={0.05}
          accent
          trend={workoutTrend}
        />
        <StatTile
          icon={Zap}
          value={formatVolume(weeklyVolume)}
          label={t('dashboard.stats.volume')}
          suffix={weightUnit}
          delay={0.12}
        />
        <StatTile
          icon={Target}
          value={muscleGroupCount}
          label={t('dashboard.stats.muscles')}
          suffix={
            muscleGroupCount === 1
              ? t('dashboard.stats.groupSingular')
              : t('dashboard.stats.groupPlural')
          }
          delay={0.19}
          trend={muscleTrend}
        />
      </div>

      {/* ── Calorie progress + Macro ring ──────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 md:mb-6">
        <ErrorBoundary label="CalorieProgressWidget">
          <CalorieProgressWidget userProfile={userProfile} />
        </ErrorBoundary>
        <ErrorBoundary label="MacroRingWidget">
          <MacroRingWidget userProfile={userProfile} />
        </ErrorBoundary>
      </div>

      {/* ── Weekly recap ────────────────────────────────────────
           "What changed about you this week" — workouts and volume vs
           last week, best lift, any PRs. Renders null when there were
           no workouts in the last 7 days (the streak-break / welcome-
           back pushes own that surface). Wrapped in its own
           ErrorBoundary so a bad log payload doesn't take the page. */}
      {/* data-recap-card lets the OnboardingNudgeCard "share your week"
          nudge scrollIntoView this section without a route change. */}
      <div className="mb-5 md:mb-6" data-recap-card>
        <ErrorBoundary label="WeeklyRecap">
          <WeeklyRecap logs={logs} cardioLogs={cardioLogs} />
        </ErrorBoundary>
      </div>

      {/* Tomorrow's focus suggestion — deterministic heuristic against
          this week's logs. Self-hides when there's less than 2 workouts
          of data so we don't surface a guess based on noise. */}
      <div className="mb-5 md:mb-6">
        <ErrorBoundary label="WorkoutSuggestionCard">
          <WorkoutSuggestionCard logs={logs} cardioLogs={cardioLogs} />
        </ErrorBoundary>
      </div>

      {/* "This day last year" memory — evergreen delight for users with
          historical data. Self-hides when no past-year match for today
          or already dismissed for this date. */}
      <div className="mb-5 md:mb-6">
        <ErrorBoundary label="WorkoutMemoryCard">
          <WorkoutMemoryCard logs={logs} />
        </ErrorBoundary>
      </div>

      {/* Daily mood + hydration ring — quick-tap micro-trackers that
          double as data sources for cross-domain correlations on the
          Progress page (mood-vs-volume, hydration-vs-PRs, etc.). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5 md:mb-6">
        <ErrorBoundary label="MoodLogCard">
          <MoodLogCard />
        </ErrorBoundary>
        <ErrorBoundary label="HydrationRing">
          <HydrationRing />
        </ErrorBoundary>
      </div>

      {/* Readiness Score — composite of sleep + mood + recent-workout
          recency. Drives the daily train/maintain/deload/rest decision.
          Hidden when no user. */}
      <div className="mb-5 md:mb-6">
        <ErrorBoundary label="ReadinessCard">
          <ReadinessCard logs={logs} />
        </ErrorBoundary>
      </div>

      {/* Weekly nemesis snapshot — drives competitive identity on the
          Dashboard surface (rather than only on Workout). Hidden when
          there's no active assignment. */}
      {user?.id && (
        <div className="mb-5 md:mb-6">
          <ErrorBoundary label="NemesisCard">
            <NemesisCard currentUserId={user.id} />
          </ErrorBoundary>
        </div>
      )}

      {/* ── Daily quote ────────────────────────────────────────── */}
      <div className="mb-5 md:mb-6">
        <DailyQuote />
      </div>

      {/* ── Prestige prompt — only when at max level ───────────── */}
      {isPrestigeEligible(userProfile) && !userProfile.prestige_dismissed && (
        <ErrorBoundary label="PrestigePrompt">
          <PrestigePrompt currentPrestige={userProfile.prestige_level || 0} />
        </ErrorBoundary>
      )}

      {/* ── Login + Workout streak banners + push opt-in ──────────── */}
      {/* Each widget wrapped in its own ErrorBoundary so a missing migration
          or DB error in one doesn't take down the whole Dashboard.
          PushOptInBanner self-gates: only renders for engaged users
          (hasWorkouts) on supported devices who haven't subscribed or
          dismissed. */}
      <div className="mb-3 space-y-2">
        <ErrorBoundary label="LoginStreakBanner"><LoginStreakBanner /></ErrorBoundary>
        <ErrorBoundary label="WorkoutStreakBanner"><WorkoutStreakBanner /></ErrorBoundary>
        <ErrorBoundary label="PushOptInBanner">
          <PushOptInBanner hasWorkouts={rawLogs.length > 0} />
        </ErrorBoundary>
        <ErrorBoundary label="IosInstallBanner">
          <IosInstallBanner />
        </ErrorBoundary>
        {/* Onboarding nudge — at most one card per day for the first
            5-7 days. Self-hides once all relevant nudges are completed
            (or were never relevant to begin with for veterans). */}
        <ErrorBoundary label="OnboardingNudgeCard">
          <OnboardingNudgeCard hasWorkouts={rawLogs.length > 0} userEmail={user?.email} />
        </ErrorBoundary>
      </div>

      {/* ── Weekly League card ──────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.10 }}
        className="mb-3"
      >
        <ErrorBoundary label="LeagueCard">
          <LeagueCard onClick={() => setLeagueModalOpen(true)} />
        </ErrorBoundary>
      </motion.div>

      {/* ── Daily quests card ───────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="mb-5 md:mb-6"
      >
        <ErrorBoundary label="DailyQuestsCard">
          <DailyQuestsCard />
        </ErrorBoundary>
      </motion.div>

      {/* ── Goals row ─────────────────────────────────────────────
           Two cooperating components:
             1. GoalsAlmostComplete — for any goal ≥75%, shows the
                full-size "Push to Complete" card.
             2. GoalsProgressStrip — for users whose best active goal
                is <75%, shows a one-line nudge so the home screen
                isn't silent about progress in the middle range.
           They auto-hide via their own filters: the strip checks "no
           goal ≥75%" before rendering, so they never both show. */}
      <div className="mb-5 md:mb-6 space-y-3">
        <ErrorBoundary label="GoalsAlmostComplete">
          <GoalsAlmostComplete
            goals={goals}
            logs={logs}
            limit={1}
            compact={false}
            onOpen={() => setGoalsModalOpen(true)}
          />
        </ErrorBoundary>
        <ErrorBoundary label="GoalsProgressStrip">
          <GoalsProgressStrip
            goals={goals}
            logs={logs}
            onOpen={() => setGoalsModalOpen(true)}
          />
        </ErrorBoundary>
      </div>

      {/* ── Quick Actions ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="mb-5 md:mb-6"
      >
        <span className="block text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-3 px-1">
          {t('dashboard.quickActions')}
        </span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <QuickAction
            to="/workout"
            icon={Play}
            label={t('dashboard.startWorkout')}
            delay={0.18}
          />
          <QuickAction
            icon={Dumbbell}
            label={t('dashboard.createRegimen')}
            onClick={() => navigate('/workout', { state: { openRegimens: true } })}
            delay={0.24}
          />
          <QuickAction
            icon={TrendingUp}
            label={t('dashboard.checkProgress')}
            onClick={() => {
              window.scrollTo({ top: 0, behavior: 'auto' });
              navigate('/progress');
            }}
            delay={0.30}
          />
          <QuickAction
            icon={Apple}
            label={t('dashboard.logMeal')}
            onClick={() => navigate('/nutrition', { state: { openLogMeal: true } })}
            delay={0.36}
          />
          <QuickAction
            icon={Scale}
            label={tFallback('dashboard.logWeight', 'Log weight')}
            onClick={() => setLogWeightOpen(true)}
            delay={0.42}
          />
          <QuickAction
            icon={Camera}
            label={tFallback('dashboard.addPhoto', 'Add progress photo')}
            onClick={() => setPhotoCaptureOpen(true)}
            delay={0.48}
          />
        </div>
      </motion.div>

      {/* ── Widgets ────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25 }}
      >
        <DashboardWidgets logs={logs} goals={goals} isLoading={isLoading} />
      </motion.div>

      <GoalsModal
        open={goalsModalOpen}
        onClose={() => setGoalsModalOpen(false)}
        goals={goals}
        logs={logs}
        userProfile={userProfile}
      />

      <LeagueStandingsModal
        open={leagueModalOpen}
        onClose={() => setLeagueModalOpen(false)}
      />

      {/* Dashboard-level quick-action modals.
          LogWeightModal writes a body-metric row AND mirrors to
          user_profiles.weight_lbs so the global weight stays in sync.
          ProgressPhotoCapture runs in controlled mode (no internal
          trigger button) — the parent owns the prompt's open state. */}
      <LogWeightModal
        open={logWeightOpen}
        onOpenChange={setLogWeightOpen}
        profile={userProfile}
      />
      <ErrorBoundary label="ProgressPhotoCapture">
        <ProgressPhotoCapture
          workoutName={null}
          open={photoCaptureOpen}
          onOpenChange={setPhotoCaptureOpen}
        />
      </ErrorBoundary>

      {/* Subtle "Synced Xm ago" footer. Tappable to force refresh of all
          primary Dashboard queries. Trust signal — when a user wonders
          "is this stale?" they get a clear answer at a glance, and a
          one-tap path to fix it. Color shifts amber/red as data ages. */}
      <div className="mt-6 flex justify-center pb-4">
        <SyncStatus dataUpdatedAt={logsUpdatedAt} />
      </div>
    </motion.div>
  );
}