import React, { useState, useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { filterAfterReset } from '@/lib/accountReset';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { muscleKey } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, formatWeight } from '@/lib/weightUnit';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { format, subDays, eachDayOfInterval, startOfDay, differenceInDays } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, BarChart2, Trophy, Sparkles as SparklesIcon,
  Flame, Dumbbell, Camera, Ruler, ChevronRight, Zap, RefreshCw, Lightbulb,
} from 'lucide-react';
import BodyMetricsTab from '@/components/progress/BodyMetricsTab';
import ProgressPhotosTab from '@/components/progress/ProgressPhotosTab';
import ErrorBoundary from '@/components/ErrorBoundary';
import FilterDropdown from '@/components/progress/FilterDropdown';
import BottomSheet from '@/components/ui/BottomSheet';
import AdvancedAnalytics from '@/components/progress/AdvancedAnalytics';
import InsightsTab from '@/components/progress/InsightsTab';
import PRHistoryModal from '@/components/progress/PRHistoryModal';
// Achievements moved to ProfileMenu (above "My Bag") — it didn't fit
// next to data / chart tabs. AchievementsTab is now imported by
// src/components/achievements/AchievementsVault.jsx.
import GroupedExerciseTrends from '@/components/progress/GroupedExerciseTrends';
import TrainingPatternCard from '@/components/progress/TrainingPatternCard';
import MuscleGroupHeatmap from '@/components/progress/MuscleGroupHeatmap';
import WorkoutCalendarGrid from '@/components/progress/WorkoutCalendarGrid';
import PageHeader from '@/components/PageHeader';
import { latestDebrief, generateWeeklyDebrief, currentWeekStart } from '@/lib/data/debriefs';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_STYLE = {
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
  },
};

const MUSCLE_PILL = {
  chest:       'bg-blue-500/15 text-blue-500 border-blue-500/25',
  back:        'bg-emerald-500/15 text-emerald-500 border-emerald-500/25',
  shoulders:   'bg-violet-500/15 text-violet-500 border-violet-500/25',
  biceps:      'bg-cyan-500/15 text-cyan-500 border-cyan-500/25',
  triceps:     'bg-indigo-500/15 text-indigo-500 border-indigo-500/25',
  legs:        'bg-orange-500/15 text-orange-500 border-orange-500/25',
  glutes:      'bg-pink-500/15 text-pink-500 border-pink-500/25',
  core:        'bg-yellow-500/15 text-yellow-500 border-yellow-500/25',
  'full body': 'bg-teal-500/15 text-teal-500 border-teal-500/25',
  cardio:      'bg-red-500/15 text-red-500 border-red-500/25',
};
const MUSCLE_PILL_DEFAULT = 'bg-primary/15 text-primary border-primary/25';

// Timeframe constants (used by the stats-frame toggle in the hero card)
const FRAME_DAYS   = { week: 7, month: 30, year: 365, all: Infinity };
const FRAME_LABELS = { week: 'This Week', month: 'This Month', year: 'This Year', all: 'All Time' };
const FRAME_PREV   = { week: 7, month: 30, year: 365, all: null };

// Achievements removed from this strip — it lives in ProfileMenu now.
// See src/components/achievements/AchievementsVault.jsx.
const TAB_META = [
  { id: 'trends',    label: 'Trends',    Icon: TrendingUp,  iconColor: 'text-primary',    activeBg: 'bg-primary',     activeText: 'text-primary-foreground' },
  { id: 'analytics', label: 'Analytics', Icon: BarChart2,   iconColor: 'text-amber-500',  activeBg: 'bg-amber-500',   activeText: 'text-white' },
  { id: 'body',      label: 'Body',      Icon: Ruler,       iconColor: 'text-emerald-500', activeBg: 'bg-emerald-500', activeText: 'text-white' },
  { id: 'photos',    label: 'Photos',    Icon: Camera,      iconColor: 'text-violet-500', activeBg: 'bg-violet-500',  activeText: 'text-white' },
  { id: 'insights',  label: 'Insights',  Icon: Lightbulb,   iconColor: 'text-cyan-500',   activeBg: 'bg-cyan-500',    activeText: 'text-white' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBigNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function calcVolume(logs) {
  let v = 0;
  for (const log of logs) {
    for (const ex of log.exercises || []) {
      for (const s of ex.sets || []) {
        v += (Number(s.weight) || 0) * (Number(s.reps) || 0);
      }
    }
  }
  return v;
}

// ─── Personal Bests Tab ───────────────────────────────────────────────────────

function PersonalBestsTab({ logs, onViewHistory }) {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);
  const bests = useMemo(() => {
    const map = {};
    logs.forEach(log => {
      if (!log.date) return;
      (log.exercises || []).forEach(ex => {
        if (!ex.name || !ex.sets?.length) return;
        if (!map[ex.name]) map[ex.name] = { weight: 0, weightDate: null, reps: 0, repsDate: null, sessionCount: 0 };
        map[ex.name].sessionCount += 1;
        ex.sets.forEach(s => {
          if ((s.weight || 0) > map[ex.name].weight) { map[ex.name].weight = s.weight; map[ex.name].weightDate = log.date; }
          if ((s.reps   || 0) > map[ex.name].reps)   { map[ex.name].reps   = s.reps;   map[ex.name].repsDate   = log.date; }
        });
      });
    });
    return Object.entries(map)
      .map(([name, pb]) => ({ name, ...pb }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [logs]);

  if (bests.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <Trophy className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="font-heading font-semibold">{t('progress.noData')}</p>
        <p className="text-sm text-muted-foreground mt-1">{t('progress.logWorkoutsForAnalytics')}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {bests.map((pb, idx) => (
        <motion.div key={pb.name} initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 22, delay: idx * 0.05 }}>
          <Card className="border-none shadow-sm overflow-hidden">
            <div className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <motion.div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0" animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: idx * 0.3 }}>
                  <Trophy className="w-4 h-4 text-yellow-500" />
                </motion.div>
                <span className="font-heading font-bold text-sm flex-1">{pb.name}</span>
                {onViewHistory && (
                  <button
                    onClick={() => onViewHistory(pb.name)}
                    className="text-[10px] font-semibold text-primary/70 hover:text-primary flex items-center gap-0.5 transition-colors shrink-0"
                  >
                    History <ChevronRight className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <motion.div className="bg-primary/5 rounded-lg p-3" whileHover={{ scale: 1.03 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
                  <p className="text-xs text-muted-foreground mb-1 font-medium">{t('progress.bestWeight')}</p>
                  <motion.p className="font-heading font-bold text-xl text-primary" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, delay: idx * 0.05 + 0.1 }}>
                    {pb.weight > 0 ? formatWeight(pb.weight, weightUnit) : '—'}
                  </motion.p>
                  {pb.weightDate && <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(pb.weightDate), 'MMM d, yyyy', { locale: dateLocale })}</p>}
                </motion.div>
                <motion.div className="bg-accent/5 rounded-lg p-3" whileHover={{ scale: 1.03 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
                  <p className="text-xs text-muted-foreground mb-1 font-medium">{t('progress.bestReps')}</p>
                  <motion.p className="font-heading font-bold text-xl text-accent" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, delay: idx * 0.05 + 0.15 }}>
                    {pb.reps > 0 ? `${pb.reps} reps` : '—'}
                  </motion.p>
                  {pb.repsDate && <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(pb.repsDate), 'MMM d, yyyy', { locale: dateLocale })}</p>}
                </motion.div>
              </div>
              {pb.sessionCount > 0 && (
                <p className="text-[10px] text-muted-foreground mt-2 pl-0.5">
                  Logged {pb.sessionCount} {pb.sessionCount === 1 ? 'time' : 'times'}
                </p>
              )}
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────

function AnalyticsTab({ logs }) {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);

  const weightOverTime = useMemo(() => logs
    .filter(l => l.date)
    .map(log => {
      const maxWeightLbs = (log.exercises || []).reduce((max, ex) => {
        const exMax = (ex.sets || []).reduce((m, s) => Math.max(m, s.weight || 0), 0);
        return Math.max(max, exMax);
      }, 0);
      return { date: format(new Date(log.date), 'MMM d', { locale: dateLocale }), 'Max Weight (lbs)': maxWeightLbs, weightDisplay: fromLbs(maxWeightLbs, weightUnit) };
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-20),
  [logs, dateLocale, weightUnit]);

  const volumeByMuscle = useMemo(() => {
    const map = {};
    logs.forEach(log => {
      (log.exercises || []).forEach(ex => {
        const group = ex.muscle_group || ex.muscle_groups?.[0] || 'Other';
        const vol = (ex.sets || []).reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
        map[group] = (map[group] || 0) + vol;
      });
    });
    return Object.entries(map)
      .map(([group, volume]) => ({ group, displayGroup: t(`muscleGroups.${muscleKey(group)}`), Volume: Math.round(volume) }))
      .sort((a, b) => b.Volume - a.Volume).slice(0, 8);
  }, [logs, t]);

  const workoutFrequency = useMemo(() => {
    const last30 = eachDayOfInterval({ start: subDays(new Date(), 29), end: new Date() });
    const loggedDays = new Set(logs.filter(l => l.date && new Date(l.date) >= subDays(new Date(), 29)).map(l => format(startOfDay(new Date(l.date)), 'yyyy-MM-dd')));
    return last30.map(day => ({ date: format(day, 'MMM d', { locale: dateLocale }), Workouts: loggedDays.has(format(day, 'yyyy-MM-dd')) ? 1 : 0 }));
  }, [logs, dateLocale]);

  const trainedDays = workoutFrequency.filter(d => d.Workouts === 1).length;

  if (logs.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <BarChart2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="font-heading font-semibold">No data yet</p>
        <p className="text-sm text-muted-foreground mt-1">{t('progress.logWorkoutsForAnalytics')}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { value: logs.length, label: t('progress.totalWorkouts'), color: 'text-primary' },
          { value: trainedDays, label: t('progress.daysTrained30d'), color: 'text-amber-500' },
          { value: volumeByMuscle[0]?.displayGroup || '—', label: t('progress.topMuscleGroup'), color: 'text-emerald-500', span: 'col-span-2 md:col-span-1' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 280, damping: 20, delay: i * 0.08 }} whileHover={{ scale: 1.04, y: -2 }} className={stat.span || ''}>
            <Card className="p-4 border-none shadow-sm text-center h-full">
              <motion.p className={`font-heading text-2xl font-bold ${stat.color}`} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18, delay: i * 0.08 + 0.1 }}>{stat.value}</motion.p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="p-5 border-none shadow-sm">
        <h2 className="font-heading font-bold mb-1">{t('progress.maxWeightOverTime')}</h2>
        <p className="text-xs text-muted-foreground mb-4">{t('progress.maxWeightSubtitle')}</p>
        {weightOverTime.length < 2 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t('progress.minWorkoutsForTrend')}</p>
        ) : (
          <ResponsiveContainer width="100%" height={240} key={`${language}-${weightUnit}`}>
            <LineChart data={weightOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" domain={[0, 'auto']} allowDataOverflow={false} />
              <Tooltip {...CHART_STYLE} />
              <Line type="monotone" dataKey="weightDisplay" name={t('workout.weightWithUnit').replace('lbs', weightUnit)} stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 3 }} activeDot={{ r: 5, strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-5 border-none shadow-sm">
        <h2 className="font-heading font-bold mb-1">{t('progress.totalVolumeByMuscle')}</h2>
        <p className="text-xs text-muted-foreground mb-4">{t('progress.totalVolumeDesc')}</p>
        {volumeByMuscle.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t('progress.noMuscleData')}</p>
        ) : (
          <ResponsiveContainer width="100%" height={240} key={language}>
            <BarChart data={volumeByMuscle} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" inputMode="decimal" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis type="category" dataKey="displayGroup" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={80} />
              <Tooltip {...CHART_STYLE} />
              <Bar dataKey="Volume" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Muscle-split volume heatmap — anatomical body map colored by
          training intensity per group. Complements the volume bar chart
          above with the "what am I neglecting?" read at a glance.
          TODO (user request 2026-05-28): redo the training heat map.
          Current version reads fine but the user wants a redesigned
          variant — design TBD; come back to this. */}
      <ErrorBoundary label="MuscleGroupHeatmap">
        <MuscleGroupHeatmap logs={logs} />
      </ErrorBoundary>

      <Card className="p-5 border-none shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-heading font-bold">{t('progress.workoutFrequency')}</h2>
          <span className="text-xs font-medium text-primary">{trainedDays} / 30 {t('progress.daysShort')}</span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">{t('progress.workoutFrequencyDesc')}</p>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={workoutFrequency}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={4} />
            <YAxis hide domain={[0, 1]} />
            <Tooltip {...CHART_STYLE} formatter={(v) => [v === 1 ? 'Trained ✓' : 'Rest day', '']} />
            <Bar dataKey="Workouts" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  ProgressCarousel — 4 slides (Streak / Workouts / Volume / Level)
 *  with motivational copy per slide. Modeled after the Dashboard
 *  HeroSlideshow:
 *    • auto-rotates every 8s, pauses 12s after manual nav
 *    • swipe left/right snaps to next/prev
 *    • right-edge chevron button (lifted to the wrapper, not inside)
 *    • pagination dots
 *    • each slide has its own accent color (HSL via inline style)
 *  forwardRef so the parent's stat tiles can call .goTo(id) to jump
 *  the carousel to a specific slide when tapped.
 * ────────────────────────────────────────────────────────────────── */

const ProgressCarousel = forwardRef(function ProgressCarousel({ slides }, ref) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const pauseTimerRef = useRef(null);

  const goTo = (i) => {
    setIdx(i);
    setPaused(true);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => setPaused(false), 12_000);
  };
  const next = () => goTo((idx + 1) % slides.length);
  const prev = () => goTo((idx - 1 + slides.length) % slides.length);

  // Expose .goToId(id) so parent can wire stat tiles to specific slides.
  useImperativeHandle(ref, () => ({
    goToId: (id) => {
      const i = slides.findIndex(s => s.id === id);
      if (i >= 0) goTo(i);
    },
  }), [slides, goTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-rotate.
  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const t = setTimeout(() => setIdx(i => (i + 1) % slides.length), 8000);
    return () => clearTimeout(t);
  }, [idx, paused, slides.length]);

  useEffect(() => () => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
  }, []);

  // Swipe
  const handleDragEnd = (_e, info) => {
    if (slides.length <= 1) return;
    const dx = info.offset.x;
    const vx = info.velocity.x;
    if (dx < -50 || vx < -500) next();
    else if (dx > 50 || vx > 500) prev();
  };

  const slide = slides[idx];
  if (!slide) return null;
  const Icon = slide.icon;

  return (
    <div className="relative mb-3">
      {/* Chevron lifted out of the rounded card so it sits at the
          dashboard's right edge (matches the hero carousel pattern). */}
      {slides.length > 1 && (
        <button
          type="button"
          onClick={next}
          aria-label="Next slide"
          className="absolute -end-4 md:-end-6 lg:-end-8 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-foreground/80 backdrop-blur-sm text-background hover:bg-foreground active:scale-95 flex items-center justify-center shadow-lg transition-all"
        >
          <ChevronRight className="w-5 h-5 rtl:scale-x-[-1]" />
        </button>
      )}
      <motion.div
        drag={slides.length > 1 ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        onDragEnd={handleDragEnd}
        className="relative overflow-hidden rounded-2xl text-white shadow-xl shadow-black/20 touch-pan-y"
        style={{ background: 'hsl(210 18% 11%)' }}
      >
        {/* Per-slide color tint — animates on slide change */}
        <motion.div
          key={`mesh-tr-${slide.id}`}
          initial={{ opacity: 0.5 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="absolute -top-1/3 -right-1/4 w-[120%] h-[140%] rounded-full blur-3xl pointer-events-none"
          style={{ background: `radial-gradient(circle, hsl(${slide.color} / 0.55), transparent 65%)` }}
        />
        <motion.div
          key={`mesh-bl-${slide.id}`}
          className="absolute -bottom-1/3 -left-1/4 w-[100%] h-[120%] rounded-full blur-3xl pointer-events-none"
          style={{ background: `radial-gradient(circle, hsl(${slide.color} / 0.22), transparent 70%)` }}
          animate={{ x: [0, 20, 0], y: [0, -10, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />

        <div className="relative p-4 md:p-5 min-h-[120px] flex flex-col justify-between gap-3">
          {/* Large translucent icon on the right-centre — Lucide symbol,
              not an emoji, so it scales crisply at any resolution. */}
          {slide.icon && (() => {
            const IconComp = slide.icon;
            return (
              <IconComp
                aria-hidden="true"
                className="absolute end-4 top-1/2 -translate-y-1/2 pointer-events-none select-none"
                style={{ width: 96, height: 96, opacity: 0.13, color: 'white' }}
              />
            );
          })()}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
              <Icon className="w-4 h-4 text-white/85" />
            </div>
            <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-white/70">
              {slide.kicker}
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="min-w-0 pe-20"
            >
              <h3
                className="font-heading font-bold leading-none tracking-tight tabular-nums"
                style={{ fontSize: 'clamp(2rem, 7vw, 3rem)' }}
              >
                {slide.value}
              </h3>
              <p className="text-sm text-white/75 max-w-[36ch] leading-relaxed mt-2">
                {slide.tip}
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
                  aria-label={`Slide ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${
                    i === idx ? 'bg-white w-6' : 'bg-white/30 w-1.5 hover:bg-white/50'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
});

// ─── Main Progress Page ───────────────────────────────────────────────────────

export default function Progress() {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();
  const dateLocale = getDateLocale(language);

  const location = useLocation();
  const navigate = useNavigate();

  const initialTab = (() => {
    const p = new URLSearchParams(location.search);
    const tab = p.get('tab');
    if (TAB_META.some(x => x.id === tab)) return tab;
    return 'trends';
  })();

  const [activeTab, setActiveTab] = useState(initialTab);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const tab = p.get('tab');
    if (tab && TAB_META.some(x => x.id === tab)) {
      setActiveTab(tab);
      p.delete('tab');
      navigate({ pathname: '/progress', search: p.toString() ? '?' + p.toString() : '' }, { replace: true });
    }
  }, [location.search]);

  const [personalBestsModalOpen, setPersonalBestsModalOpen] = useState(false);
  const [advancedAnalyticsOpen, setAdvancedAnalyticsOpen]   = useState(false);
  const [prHistoryExercise,     setPRHistoryExercise]       = useState(null);
  const [selectedRegimen,       setSelectedRegimen]         = useState('all');
  const [timeRange,             setTimeRange]               = useState('90');
  const [selectedMuscleGroup,   setSelectedMuscleGroup]     = useState('all');
  // Timeframe toggle for the hero metrics strip (Week / Month / Year / All Time)
  const [statsFrame,            setStatsFrame]              = useState('week');

  const tabsBarRef = React.useRef(null);
  const contentRef = React.useRef(null);
  const { user } = useAuth();

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: rawLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['workoutLogs', user?.email],
    queryFn: () => db.entities.WorkoutLog.filter({ created_by: user.email }, '-date', 200),
    enabled: !!user?.email,
  });
  const { data: rawRegimens = [], isLoading: regimensLoading } = useQuery({
    queryKey: ['regimens', user?.email],
    queryFn: () => db.entities.Regimen.filter({ created_by: user.email }),
    enabled: !!user?.email,
  });
  // Achievements query removed — the surface is now in
  // ProfileMenu → Achievements (AchievementsVault), which fetches
  // its own data lazily.
  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });
  const { data: cardioLogs = [] } = useQuery({
    queryKey: ['cardioLogs', user?.email],
    queryFn: () => db.entities.CardioLog.filter({ created_by: user.email }, '-date', 200),
    enabled: !!user?.email,
  });
  const { data: rawBodyMetrics = [] } = useQuery({
    queryKey: ['bodyMetrics', user?.email],
    queryFn: () => db.entities.BodyMetric.filter({ created_by: user.email }, '-date', 200),
    enabled: !!user?.email,
  });

  const logs         = useMemo(() => filterAfterReset(rawLogs, userProfile),       [rawLogs, userProfile]);
  const regimens     = useMemo(() => filterAfterReset(rawRegimens, userProfile),   [rawRegimens, userProfile]);
  const bodyMetrics  = useMemo(() => filterAfterReset(rawBodyMetrics, userProfile), [rawBodyMetrics, userProfile]);
  const isLoading    = logsLoading || regimensLoading;

  // Weekly summary — auto-generate on first load, then cache for 5 min
  const { data: latestDebriefData, refetch: refetchDebrief } = useQuery({
    queryKey: ['latestDebrief', user?.id],
    queryFn:  async () => {
      await generateWeeklyDebrief(currentWeekStart());
      return latestDebrief();
    },
    enabled:   !!user?.id,
    staleTime: 5 * 60_000,
  });

  // ── Derived stats (timeframe-aware) ───────────────────────────────────────

  const frameLogs = useMemo(() => {
    const days = FRAME_DAYS[statsFrame];
    if (!isFinite(days)) return logs;
    const cutoff = subDays(new Date(), days);
    return logs.filter(l => l.date && new Date(l.date) >= cutoff);
  }, [logs, statsFrame]);

  const prevFrameLogs = useMemo(() => {
    const days = FRAME_PREV[statsFrame];
    if (!days) return [];
    const end   = subDays(new Date(), days);
    const start = subDays(new Date(), days * 2);
    return logs.filter(l => l.date && new Date(l.date) >= start && new Date(l.date) < end);
  }, [logs, statsFrame]);

  const thisWeekLogs = useMemo(() => {
    const cutoff = subDays(new Date(), 7);
    return logs.filter(l => l.date && new Date(l.date) >= cutoff);
  }, [logs]);

  const lastWeekLogs = useMemo(() => {
    const end   = subDays(new Date(), 7);
    const start = subDays(new Date(), 14);
    return logs.filter(l => l.date && new Date(l.date) >= start && new Date(l.date) < end);
  }, [logs]);

  const frameVolume    = useMemo(() => calcVolume(frameLogs),    [frameLogs]);
  const prevVolume     = useMemo(() => calcVolume(prevFrameLogs), [prevFrameLogs]);
  const thisWeekVolume = useMemo(() => calcVolume(thisWeekLogs), [thisWeekLogs]);
  const lastWeekVolume = useMemo(() => calcVolume(lastWeekLogs), [lastWeekLogs]);
  const volumeDelta    = prevVolume > 0 ? ((frameVolume - prevVolume) / prevVolume) * 100 : null;

  const frameCardio = useMemo(() => {
    const days = FRAME_DAYS[statsFrame];
    const inWindow = isFinite(days)
      ? cardioLogs.filter(l => l.date && new Date(l.date) >= subDays(new Date(), days))
      : cardioLogs;
    return {
      sessions:        inWindow.length,
      distanceMeters:  inWindow.reduce((s, l) => s + (l.distance_meters  || 0), 0),
      durationSeconds: inWindow.reduce((s, l) => s + (l.duration_seconds || 0), 0),
      calories:        inWindow.reduce((s, l) => s + (l.calories         || 0), 0),
    };
  }, [cardioLogs, statsFrame]);

  // Keep backward-compat name so existing references below still work
  const weeklyCardio = frameCardio;

  // (muscleGroupsThisWeek removed — muscle pills now computed inline
  //  from frameLogs inside the timeframe-aware stats card)

  const totalVolume = useMemo(() => {
    const fromProfile = Number(userProfile?.total_volume_lbs);
    if (fromProfile > 0) return fromProfile;
    return calcVolume(logs);
  }, [logs, userProfile]);

  const topPRs = useMemo(() => {
    const map = {};
    logs.forEach(log => {
      (log.exercises || []).forEach(ex => {
        if (!ex.name) return;
        if (!map[ex.name]) map[ex.name] = { name: ex.name, weight: 0, reps: 0 };
        (ex.sets || []).forEach(s => {
          if ((s.weight || 0) > map[ex.name].weight) map[ex.name].weight = s.weight;
          if ((s.reps   || 0) > map[ex.name].reps)   map[ex.name].reps   = s.reps;
        });
      });
    });
    return Object.values(map)
      .filter(pr => pr.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);
  }, [logs]);

  const lastWorkout     = logs[0] || null;
  const daysSinceLast   = lastWorkout?.date ? differenceInDays(new Date(), new Date(lastWorkout.date)) : null;
  const regimenNames    = useMemo(() => regimens.map(r => r.name).sort(), [regimens]);
  const regimenLogs     = useMemo(() => selectedRegimen === 'all' ? logs : logs.filter(l => l.regimen_name === selectedRegimen), [logs, selectedRegimen]);
  const exerciseNames   = useMemo(() => { const n = new Set(); regimenLogs.forEach(log => log.exercises?.forEach(ex => { if (ex.name) n.add(ex.name); })); return [...n].sort(); }, [regimenLogs]);

  const streak = userProfile?.workout_streak ?? 0;
  const level  = userProfile?.current_level  ?? 1;

  // Hero stat tiles. These use the standard themed <Card> (bg-card /
  // text-card-foreground / theme-card-accent) so they pick up the
  // user's equipped loot theme automatically — same as every other
  // card across the app. Each tile keeps its own color identity via
  // an accent applied to the icon + value only (not a solid fill),
  // mirroring the Dashboard StatTile pattern.
  const heroStats = [
    { id: 'streak',   icon: Flame,      value: streak ? `${streak}d` : '—', label: 'Streak',
      accent: 'text-orange-500',  iconBg: 'bg-orange-500/15'  },
    { id: 'workouts', icon: Dumbbell,   value: logs.length,                  label: 'Workouts',
      accent: 'text-primary',     iconBg: 'bg-primary/15'     },
    { id: 'volume',   icon: TrendingUp, value: totalVolume > 0 ? `${formatBigNumber(fromLbs(totalVolume, weightUnit))}` : '—', label: `Volume (${weightUnit})`,
      accent: 'text-emerald-500', iconBg: 'bg-emerald-500/15' },
    { id: 'level',    icon: Zap,        value: `Lv ${level}`,                label: 'Level',
      accent: 'text-violet-500',  iconBg: 'bg-violet-500/15'  },
  ];

  // Carousel slides — one per heroStat. Each has a motivational tip
  // tailored to the user's current state. Color = HSL accent for the
  // slide's gradient mesh tint. Emoji fills the dead space on the
  // right of each slide — large + semi-translucent so it reads as
  // illustration rather than content.
  const carouselSlides = [
    {
      id: 'streak',
      icon: Flame,
      color: '20 95% 55%',
      emoji: '🔥',
      kicker: 'Streak',
      value: streak ? `${streak} day${streak === 1 ? '' : 's'}` : 'Start today',
      tip: streak > 0
        ? `Log a workout today to push your streak to ${streak + 1} days. Skipping resets it to 0.`
        : 'A single set counts. Log a workout today and the streak starts at 1.',
    },
    {
      id: 'workouts',
      icon: Dumbbell,
      color: '20 95% 55%',
      emoji: '💪',
      kicker: 'Workouts',
      value: `${logs.length}`,
      tip: logs.length === 0
        ? 'Your first workout unlocks history, trends, and your first PR.'
        : `${logs.length} workout${logs.length === 1 ? '' : 's'} logged. Three a week beats five-then-zero every time.`,
    },
    {
      id: 'volume',
      icon: TrendingUp,
      color: '160 80% 50%',
      emoji: '🏋️',
      kicker: 'Volume',
      value: totalVolume > 0
        ? `${formatBigNumber(Math.round(fromLbs(totalVolume, weightUnit)))} ${weightUnit}`
        : '0',
      tip: thisWeekVolume > 0 && lastWeekVolume > 0
        ? `This week: ${formatBigNumber(Math.round(fromLbs(thisWeekVolume, weightUnit)))} ${weightUnit}. Last week: ${formatBigNumber(Math.round(fromLbs(lastWeekVolume, weightUnit)))}. A 10% bump = new gains.`
        : 'Total weight × reps lifted. Track it weekly — small bumps compound into PRs.',
    },
    {
      id: 'level',
      icon: Zap,
      color: '270 85% 60%',
      emoji: '⚡',
      kicker: 'Level',
      value: `Lv ${level}`,
      tip: 'Every workout earns XP. Hit personal bests for bonus XP and watch the bar fill.',
    },
  ];
  const carouselRef = useRef(null);
  const jumpToSlide = (id) => carouselRef.current?.goToId?.(id);

  // ── Tab switch helper ─────────────────────────────────────────────────────
  // Auto-scroll-on-switch removed per user feedback: it was pushing
  // the page down whenever they tapped Photos / Analytics / etc.
  // contentRef is still used by ProgressPhotos' scroll-into-view.
  const switchTab = (id) => {
    setActiveTab(id);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="px-4 pt-4 md:px-6 md:pt-6 lg:pb-6 max-w-5xl mx-auto"
    >
      <PageHeader
        kicker={t('pageHeader.kicker.progress')}
        title={t('progress.title')}
        hidePeriod
      />

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <>
          {/* ── Personal Bests + Advanced Analytics — lifted ABOVE the
                carousel per user feedback (they were buried inside the
                Analytics tab, easy to miss). ─────────────────────── */}
          <div className="flex gap-2 mb-3 flex-wrap">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setPersonalBestsModalOpen(true)}
              className="flex-1 min-w-[10rem] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-yellow-400 via-yellow-500 to-amber-500 text-slate-900 text-xs font-bold shadow-md hover:shadow-lg transition-all relative overflow-hidden"
            >
              <motion.div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/40 to-white/0" animate={{ x: ['100%', '-100%'] }} transition={{ duration: 2, repeat: Infinity }} />
              <Trophy className="w-3.5 h-3.5 relative z-10" />
              <span className="relative z-10">{t('progress.personalBests')}</span>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setAdvancedAnalyticsOpen(true)}
              className="flex-1 min-w-[10rem] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500 text-slate-900 text-xs font-bold shadow-md hover:shadow-lg transition-all relative overflow-hidden"
            >
              <motion.div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/40 to-white/0" animate={{ x: ['100%', '-100%'] }} transition={{ duration: 2, repeat: Infinity }} />
              <SparklesIcon className="w-3.5 h-3.5 relative z-10" />
              <span className="relative z-10">{t('progress.advancedAnalytics')}</span>
            </motion.button>
          </div>

          {/* ── Carousel — one slide per stat (Streak / Workouts /
                Volume / Level) with motivational tips. Per-slide
                color tint, swipe to advance, right-edge chevron. ──── */}
          <ProgressCarousel ref={carouselRef} slides={carouselSlides} />

          {/* ── Hero Stats Strip — clickable, drives the carousel.
                Tap Streak → carousel jumps to Streak slide, etc. ──── */}
          <motion.div
            className="grid grid-cols-4 gap-2 md:gap-3 mb-6"
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }}
          >
            {heroStats.map((stat) => (
              <motion.button
                key={stat.label}
                type="button"
                onClick={() => jumpToSlide(stat.id)}
                variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                whileHover={{ y: -2, scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                aria-label={`Show ${stat.label} in carousel`}
              >
                <Card className="p-3 border-border/60 shadow-sm text-center h-full cursor-pointer">
                  <div className={`w-8 h-8 rounded-xl ${stat.iconBg} flex items-center justify-center mx-auto mb-2`}>
                    <stat.icon className={`w-4 h-4 ${stat.accent}`} />
                  </div>
                  <p className={`font-heading font-black text-lg leading-none ${stat.accent}`}>{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider leading-tight">{stat.label}</p>
                </Card>
              </motion.button>
            ))}
          </motion.div>

          {/* "You usually train Mon · Wed · Fri at 6:30 PM" — a soft
              pattern-recognition insight. Renders nothing if there
              isn't enough data to call a pattern (see trainingPatterns.js). */}
          <div className="mb-4">
            <TrainingPatternCard workoutLogs={logs} />
          </div>

          {/* 26-week GitHub-style activity grid. Self-hides on empty
              windows. Drives habit awareness — seeing the streaks-and-
              gaps pattern is more motivating than a workout count.
              Second tap on a trained square → "repeat this workout"
              flow on the Workout page. */}
          <div className="mb-4">
            <WorkoutCalendarGrid
              logs={logs}
              onSelectDay={(log) => {
                navigate('/workout', { state: { repeatFromLog: log } });
              }}
            />
          </div>

          {/* ── Frame Stats (This Week / Month / Year / All Time) ─────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, type: 'spring', stiffness: 260, damping: 22 }}
            className="mb-4"
          >
            <Card className="p-5 border-none shadow-sm overflow-hidden relative">
              {/* Background gradient accent */}
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-30 pointer-events-none" style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.4), transparent 70%)', transform: 'translate(30%, -30%)' }} />

              <div className="flex items-center justify-between mb-4">
                <h2 className="font-heading font-black text-base">{FRAME_LABELS[statsFrame]}</h2>
                {volumeDelta !== null && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${volumeDelta >= 0 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
                    {volumeDelta >= 0 ? '↑' : '↓'} {Math.abs(Math.round(volumeDelta))}% vs prev
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <p className="font-heading font-black text-2xl text-primary">{frameLogs.length}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Workouts</p>
                </div>
                <div className="text-center">
                  <p className="font-heading font-black text-2xl text-emerald-500">
                    {frameVolume > 0 ? formatBigNumber(Math.round(fromLbs(frameVolume, weightUnit))) : '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{weightUnit} lifted</p>
                </div>
                <div className="text-center">
                  <p className="font-heading font-black text-2xl text-orange-500">{weeklyCardio.sessions || '—'}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Cardio</p>
                </div>
              </div>

              {/* Muscle group pills — derived from the selected frame's logs */}
              {(() => {
                const frameMusclePills = (() => {
                  const groups = new Set();
                  frameLogs.forEach(log => {
                    (log.exercises || []).forEach(ex => {
                      const arr = ex.muscle_groups?.length ? ex.muscle_groups : (ex.muscle_group ? [ex.muscle_group] : []);
                      arr.forEach(g => groups.add(g));
                    });
                  });
                  return [...groups].filter(Boolean);
                })();
                return (
                  <>
                    {frameMusclePills.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {frameMusclePills.map(g => {
                          const key = g.toLowerCase();
                          const cls = MUSCLE_PILL[key] || MUSCLE_PILL_DEFAULT;
                          return (
                            <span key={g} className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${cls}`}>
                              {g}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mb-3">No workouts logged {statsFrame === 'week' ? 'this week' : statsFrame === 'month' ? 'this month' : statsFrame === 'year' ? 'this year' : 'yet'}.</p>
                    )}
                    {/* Timeframe toggle — below muscle pills, right-aligned */}
                    <div className="flex justify-end">
                      <div className="flex gap-1 bg-secondary/50 rounded-xl p-1 shadow-inner">
                        {(['week', 'month', 'year', 'all']).map((f) => (
                          <button
                            key={f}
                            onClick={() => setStatsFrame(f)}
                            className={`px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all duration-150 ${
                              statsFrame === f
                                ? 'bg-primary text-primary-foreground shadow-md scale-[1.04]'
                                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/80'
                            }`}
                          >
                            {f === 'all' ? 'All' : f === 'week' ? 'Wk' : f === 'month' ? 'Mo' : 'Yr'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}
            </Card>
          </motion.div>

          {/* ── Last Workout Callout ──────────────────────────────────────── */}
          {lastWorkout && (
            <motion.div
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.24, type: 'spring', stiffness: 280, damping: 24 }}
              className="mb-4"
            >
              <Card className="px-4 py-3 border-none shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Dumbbell className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight truncate">
                        {lastWorkout.regimen_name || 'Freestyle Session'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {daysSinceLast === 0 ? 'Today' : daysSinceLast === 1 ? 'Yesterday' : `${daysSinceLast} days ago`}
                        {lastWorkout.exercises?.length ? ` · ${lastWorkout.exercises.length} exercises` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">Last workout</span>
                </div>
              </Card>
            </motion.div>
          )}

          {/* ── Top PRs Preview ───────────────────────────────────────────── */}
          {topPRs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, type: 'spring', stiffness: 260, damping: 22 }}
              className="mb-6"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-heading font-black text-sm uppercase tracking-wider text-muted-foreground">Top PRs</h2>
                <button
                  onClick={() => setPersonalBestsModalOpen(true)}
                  className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-0.5"
                >
                  All <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-3 lg:grid-cols-5">
                {topPRs.map((pr, i) => (
                  <motion.div
                    key={pr.name}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.3 + i * 0.06, type: 'spring', stiffness: 300, damping: 22 }}
                    whileHover={{ y: -3, scale: 1.03 }}
                    className="shrink-0 w-36 md:w-auto"
                  >
                    <Card className="p-3 border-none shadow-sm bg-gradient-to-br from-yellow-500/8 via-amber-500/5 to-transparent overflow-hidden relative">
                      <div className="absolute top-1.5 right-1.5">
                        <Trophy className="w-3.5 h-3.5 text-yellow-500/60" />
                      </div>
                      <p className="text-[11px] text-muted-foreground font-medium leading-tight mb-1 pr-4 line-clamp-1">{pr.name}</p>
                      <p className="font-heading font-black text-xl text-amber-500 leading-none">
                        {formatWeight(pr.weight, weightUnit)}
                      </p>
                      {pr.reps > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-1">{pr.reps} reps best</p>
                      )}
                    </Card>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Tab Navigation ──────────────────────────────────────────────
              Sized for proper touch targets (min-h ~48px, the Apple HIG
              floor + Material baseline). On md+ each tab takes equal
              width (flex-1) so the row reads as a tab bar instead of
              a left-aligned chip cluster — the empty right-side gap
              the previous layout had felt unfinished. On mobile they
              keep their natural width and overflow-scroll so the row
              doesn't squeeze each one into an unreadable nub. */}
          <div ref={tabsBarRef} className="mb-6">
            <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
              {TAB_META.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <motion.button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className={`flex items-center justify-center gap-2.5 px-5 py-3.5 min-h-[48px] min-w-[120px] md:flex-1 rounded-xl text-[15px] font-bold whitespace-nowrap transition-all border ${
                      isActive
                        ? `${tab.activeBg} ${tab.activeText} border-transparent shadow-md`
                        : `bg-secondary/60 text-muted-foreground border-border/50 hover:bg-secondary hover:text-foreground`
                    }`}
                  >
                    <tab.Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? '' : tab.iconColor}`} />
                    {tab.label}
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* ── Tab Content ───────────────────────────────────────────────── */}
          <div ref={contentRef}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12, pointerEvents: 'none' }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
              >
                {activeTab === 'analytics' && (
                  <div className="space-y-6">
                    {/* Personal Bests + Advanced Analytics buttons
                        moved ABOVE the carousel — see lifted version
                        near top of Progress page. */}
                    <ErrorBoundary label="Analytics">
                      <AnalyticsTab logs={logs} />
                    </ErrorBoundary>
                  </div>
                )}

                {activeTab === 'body' && (
                  <ErrorBoundary label="BodyMetrics">
                    <BodyMetricsTab />
                  </ErrorBoundary>
                )}

                {activeTab === 'photos' && (
                  <ErrorBoundary label="ProgressPhotos">
                    <ProgressPhotosTab />
                  </ErrorBoundary>
                )}

                {activeTab === 'insights' && (
                  <ErrorBoundary label="Insights">
                    <InsightsTab
                      logs={logs}
                      cardioLogs={cardioLogs}
                      bodyMetrics={bodyMetrics}
                      userProfile={userProfile}
                    />
                  </ErrorBoundary>
                )}

                {activeTab === 'trends' && (
                  <ErrorBoundary label="ExerciseTrends">
                    <div>
                      {/* ── Weekly Summary Card ───────────────────────────── */}
                      {latestDebriefData && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-2xl overflow-hidden border border-border mb-5"
                          style={{ background: 'linear-gradient(135deg, #0f0f14 0%, #141824 100%)' }}
                        >
                          {/* Header */}
                          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-purple-400">Weekly Summary</p>
                              <p className="text-sm font-bold text-white">{latestDebriefData.week_label}</p>
                            </div>
                            <button
                              onClick={() => refetchDebrief()}
                              className="text-white/30 hover:text-white/60 transition-colors"
                              title="Refresh summary"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Stats row */}
                          {(() => {
                            const d = latestDebriefData.data || {};
                            const vol    = d.volume_lbs    ?? 0;
                            const chg    = d.volume_change_pct;
                            const wks    = d.workouts_count ?? 0;
                            const streak = d.workout_streak ?? 0;
                            const isPr   = !!d.top_lift_is_pr;
                            const insight = d.ai_insight || '';
                            return (
                              <>
                                <div className="flex divide-x divide-white/10">
                                  <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
                                    <span className="text-xs text-white/40">Volume</span>
                                    <span className="text-base font-black text-white tabular-nums">
                                      {Number(vol) >= 1000 ? `${Math.round(vol/1000)}K` : Math.round(vol)}
                                      <span className="text-[10px] font-normal text-white/40 ml-0.5">lbs</span>
                                    </span>
                                    {chg != null && (
                                      <span className={`text-[10px] font-semibold ${Number(chg) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {Number(chg) >= 0 ? '+' : ''}{chg}%
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
                                    <span className="text-xs text-white/40">Sessions</span>
                                    <span className="text-base font-black text-white">{wks}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
                                    <span className="text-xs text-white/40">Streak</span>
                                    <span className="text-base font-black text-orange-400">{streak}d 🔥</span>
                                  </div>
                                  {isPr && (
                                    <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
                                      <span className="text-xs text-white/40">PR</span>
                                      <Trophy className="w-4 h-4 text-yellow-400" />
                                    </div>
                                  )}
                                </div>
                                {insight && (
                                  <div className="px-4 py-2.5 border-t border-white/10">
                                    <p className="text-xs text-white/60 italic leading-relaxed">"{insight}"</p>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </motion.div>
                      )}

                      <div className="flex justify-start mb-6">
                        <FilterDropdown
                          selectedRegimen={selectedRegimen}
                          onRegimenChange={setSelectedRegimen}
                          regimenItems={[
                            { value: 'all', label: t('progress.filterAllRegimens') },
                            ...regimenNames.map(name => ({ value: name, label: name })),
                          ]}
                          selectedTimeRange={timeRange}
                          onTimeRangeChange={setTimeRange}
                          timeRangeItems={[
                            { value: '7',   label: t('progress.last7Days') },
                            { value: '30',  label: t('progress.last30Days') },
                            { value: '90',  label: t('progress.last90Days') },
                            { value: '365', label: t('progress.lastYear') },
                          ]}
                          selectedMuscleGroup={selectedMuscleGroup}
                          onMuscleGroupChange={setSelectedMuscleGroup}
                          muscleGroupItems={[
                            { value: 'all', label: t('progress.filterAllMuscleGroups') },
                            ...Array.from(new Set(
                              regimenLogs.flatMap(log =>
                                log.exercises?.flatMap(ex => ex.muscle_groups?.length ? ex.muscle_groups : (ex.muscle_group ? [ex.muscle_group] : [])) || []
                              )
                            ))
                              .map(group => ({ value: group, label: t(`muscleGroups.${muscleKey(group)}`) }))
                              .sort((a, b) => a.label.localeCompare(b.label)),
                          ]}
                        />
                      </div>

                      <h2 className="font-heading font-bold mb-4">{t('progress.exerciseTrends')}</h2>

                      {exerciseNames.length === 0 ? (
                        <Card className="p-10 text-center border-dashed">
                          <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                          <p className="font-heading font-semibold">{t('progress.noExerciseData')}</p>
                          <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">{t('progress.noExerciseDataDesc')}</p>
                          <div className="mt-4 p-4 bg-secondary rounded-xl text-left text-sm text-muted-foreground max-w-xs mx-auto space-y-1.5">
                            <p className="font-medium text-foreground mb-2">{t('progress.howToLog')}</p>
                            <p>1. {t('progress.howToLog.step1').split('{workout}')[0]}<span className="text-primary font-medium">{t('nav.workout')}</span>{t('progress.howToLog.step1').split('{workout}')[1]}</p>
                            <p>2. {t('progress.howToLog.step2')}</p>
                            <p>3. {t('progress.howToLog.step3')}</p>
                            <p>4. {t('progress.howToLog.step4').split('{save}')[0]}<span className="text-primary font-medium">{t('workout.saveWorkout')}</span>{t('progress.howToLog.step4').split('{save}')[1]}</p>
                          </div>
                        </Card>
                      ) : (
                        <GroupedExerciseTrends
                          exerciseNames={exerciseNames}
                          regimenLogs={regimenLogs}
                          timeRange={timeRange}
                          selectedMuscleGroup={selectedMuscleGroup}
                          scrollRef={contentRef}
                        />
                      )}
                    </div>
                  </ErrorBoundary>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      )}

      {/* Personal Bests — BottomSheet on mobile (swipe-to-dismiss) */}
      <BottomSheet
        open={personalBestsModalOpen}
        onClose={() => setPersonalBestsModalOpen(false)}
        title={t('progress.personalBests')}
      >
        <PersonalBestsTab
          logs={logs}
          onViewHistory={(name) => {
            setPersonalBestsModalOpen(false);
            setPRHistoryExercise(name);
          }}
        />
      </BottomSheet>

      {/* PR History Modal */}
      <PRHistoryModal
        open={!!prHistoryExercise}
        onClose={() => setPRHistoryExercise(null)}
        exerciseName={prHistoryExercise}
        logs={logs}
      />

      {/* Advanced Analytics Modal */}
      <AdvancedAnalytics open={advancedAnalyticsOpen} onClose={() => setAdvancedAnalyticsOpen(false)} logs={logs} />
    </motion.div>
  );
}
