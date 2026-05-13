import React, { useState, useMemo, useRef, useEffect } from 'react';
import { filterAfterReset } from '@/lib/accountReset';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { muscleKey } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, formatWeight } from '@/lib/weightUnit';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance, formatDuration } from '@/lib/distanceUnit';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { format, subDays, eachDayOfInterval, startOfDay } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import MobileSelect from '@/components/MobileSelect';
import { Skeleton } from '@/components/ui/skeleton';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, ChevronDown, ChevronUp, BarChart2, Trophy, ArrowRight, Sparkles as SparklesIcon, Activity } from 'lucide-react';
import ExerciseProgressCard from '@/components/progress/ExerciseProgressCard';
import BodyMetricsTab from '@/components/progress/BodyMetricsTab';
import ProgressPhotosTab from '@/components/progress/ProgressPhotosTab';
import ErrorBoundary from '@/components/ErrorBoundary';
import FilterDropdown from '@/components/progress/FilterDropdown';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AdvancedAnalytics from '@/components/progress/AdvancedAnalytics';
import AchievementsTab from '@/components/progress/AchievementsTab';
import GroupedExerciseTrends from '@/components/progress/GroupedExerciseTrends';
import LevelBar from '@/components/LevelBar';
import PageHeader from '@/components/PageHeader';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

const CHART_STYLE = {
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
  },
};

// ─── Personal Bests Tab ───────────────────────────────────────────────────────

function PersonalBestsTab({ logs }) {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);
  const bests = useMemo(() => {
    const map = {};
    logs.forEach(log => {
      if (!log.date) return;
      (log.exercises || []).forEach(ex => {
        if (!ex.name || !ex.sets?.length) return;
        if (!map[ex.name]) map[ex.name] = { weight: 0, weightDate: null, reps: 0, repsDate: null };
        ex.sets.forEach(s => {
          if ((s.weight || 0) > map[ex.name].weight) {
            map[ex.name].weight = s.weight;
            map[ex.name].weightDate = log.date;
          }
          if ((s.reps || 0) > map[ex.name].reps) {
            map[ex.name].reps = s.reps;
            map[ex.name].repsDate = log.date;
          }
        });
      });
    });
    return Object.entries(map)
      .map(([name, pb]) => ({ name, ...pb }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [logs]);

  if (logs.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <Trophy className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="font-heading font-semibold">{t('progress.noData')}</p>
        <p className="text-sm text-muted-foreground mt-1">{t('progress.logWorkoutsForAnalytics')}</p>
      </Card>
    );
  }

  if (bests.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <Trophy className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="font-heading font-semibold">{t('progress.noData')}</p>
        <p className="text-sm text-muted-foreground mt-1">{t('progress.noSetsRecorded')}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {bests.map((pb, idx) => (
        <motion.div
          key={pb.name}
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22, delay: idx * 0.05 }}
        >
          <Card className="border-none shadow-sm overflow-hidden">
            <div className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <motion.div
                  className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0"
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: idx * 0.3 }}
                >
                  <Trophy className="w-4 h-4 text-yellow-500" />
                </motion.div>
                <span className="font-heading font-bold text-sm">{pb.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <motion.div
                  className="bg-primary/5 rounded-lg p-3"
                  whileHover={{ scale: 1.03 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                >
                  <p className="text-xs text-muted-foreground mb-1 font-medium">{t('progress.bestWeight')}</p>
                  <motion.p
                    className="font-heading font-bold text-xl text-primary"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, delay: idx * 0.05 + 0.1 }}
                  >
                    {pb.weight > 0 ? formatWeight(pb.weight, weightUnit) : '—'}
                  </motion.p>
                  {pb.weightDate && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(pb.weightDate), 'MMM d, yyyy', { locale: dateLocale })}
                    </p>
                  )}
                </motion.div>
                <motion.div
                  className="bg-accent/5 rounded-lg p-3"
                  whileHover={{ scale: 1.03 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                >
                  <p className="text-xs text-muted-foreground mb-1 font-medium">{t('progress.bestReps')}</p>
                  <motion.p
                    className="font-heading font-bold text-xl text-accent"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, delay: idx * 0.05 + 0.15 }}
                  >
                    {pb.reps > 0 ? `${pb.reps} reps` : '—'}
                  </motion.p>
                  {pb.repsDate && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(pb.repsDate), 'MMM d, yyyy', { locale: dateLocale })}
                    </p>
                  )}
                </motion.div>
              </div>
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

  const weightOverTime = useMemo(() => {
    return logs
      .filter(l => l.date)
      .map(log => {
        const maxWeightLbs = (log.exercises || []).reduce((max, ex) => {
          const exMax = (ex.sets || []).reduce((m, s) => Math.max(m, s.weight || 0), 0);
          return Math.max(max, exMax);
        }, 0);
        return {
          date: format(new Date(log.date), 'MMM d', { locale: dateLocale }),
          'Max Weight (lbs)': maxWeightLbs,
          weightDisplay: fromLbs(maxWeightLbs, weightUnit),
        };
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-20);
  }, [logs, dateLocale, weightUnit]);

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
      .map(([group, volume]) => ({
        group,
        displayGroup: t(`muscleGroups.${muscleKey(group)}`),
        Volume: Math.round(volume),
      }))
      .sort((a, b) => b.Volume - a.Volume)
      .slice(0, 8);
  }, [logs, t]);

  const workoutFrequency = useMemo(() => {
    const last30 = eachDayOfInterval({ start: subDays(new Date(), 29), end: new Date() });
    const loggedDays = new Set(
      logs
        .filter(l => l.date && new Date(l.date) >= subDays(new Date(), 29))
        .map(l => format(startOfDay(new Date(l.date)), 'yyyy-MM-dd'))
    );
    return last30.map(day => ({
      date: format(day, 'MMM d', { locale: dateLocale }),
      Workouts: loggedDays.has(format(day, 'yyyy-MM-dd')) ? 1 : 0,
    }));
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
      {/* Summary Pills */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { value: logs.length, label: t('progress.totalWorkouts'), color: 'text-primary', span: '' },
          { value: trainedDays, label: t('progress.daysTrained30d'), color: 'text-accent', span: '' },
          { value: volumeByMuscle[0]?.displayGroup || '—', label: t('progress.topMuscleGroup'), color: '', span: 'col-span-2 md:col-span-1', style: { color: 'hsl(var(--chart-4))' } },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 280, damping: 20, delay: i * 0.08 }}
            whileHover={{ scale: 1.04, y: -2 }}
            className={stat.span}
          >
            <Card className="p-4 border-none shadow-sm text-center h-full">
              <motion.p
                className={`font-heading text-2xl font-bold ${stat.color}`}
                style={stat.style}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 18, delay: i * 0.08 + 0.1 }}
              >
                {stat.value}
              </motion.p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Weight Over Time */}
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

      {/* Volume by Muscle Group */}
      <Card className="p-5 border-none shadow-sm">
        <h2 className="font-heading font-bold mb-1">{t('progress.totalVolumeByMuscle')}</h2>
        <p className="text-xs text-muted-foreground mb-4">{t('progress.totalVolumeDesc')}</p>
        {volumeByMuscle.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t('progress.noMuscleData')}</p>
        ) : (
          <ResponsiveContainer width="100%" height={240} key={language}>
            <BarChart data={volumeByMuscle} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis type="category" dataKey="displayGroup" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={80} />
              <Tooltip {...CHART_STYLE} />
              <Bar dataKey="Volume" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Workout Frequency */}
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

// ─── Main Progress Page ───────────────────────────────────────────────────────

function WeeklyStat({ label, value }) {
  return (
    <div className="text-center min-w-0">
      <p className="font-heading font-bold text-base leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground leading-tight break-words hyphens-auto">{label}</p>
    </div>
  );
}

export default function Progress() {
  const { t } = useLanguage();
  const { distanceUnit } = useDistanceUnit();
  const TABS = [
    { id: 'trends', label: t('progress.tabs.trends') },
    { id: 'analytics', label: t('progress.tabs.analytics') },
    { id: 'body', label: t('progress.tabs.body') },
    { id: 'photos', label: t('progress.tabs.photos') },
    { id: 'achievements', label: t('progress.achievements') },
  ];
  const location = useLocation();
  const navigate = useNavigate();

  // Read ?tab= from the URL — used by StatsHubModal to deep-link the user
  // straight to the Achievements tab. Strip the param after consuming so a
  // reload doesn't keep re-applying it.
  const initialTab = (() => {
    const p = new URLSearchParams(location.search);
    const t = p.get('tab');
    if (TABS.some(x => x.id === t)) return t;
    return 'trends';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const t = p.get('tab');
    if (t && TABS.some(x => x.id === t)) {
      setActiveTab(t);
      p.delete('tab');
      navigate({ pathname: '/progress', search: p.toString() ? '?' + p.toString() : '' }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);
  const [personalBestsModalOpen, setPersonalBestsModalOpen] = useState(false);
  const [advancedAnalyticsOpen, setAdvancedAnalyticsOpen] = useState(false);
  const [selectedRegimen, setSelectedRegimen] = useState('all');
  const [timeRange, setTimeRange] = useState('90');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState('all');
  const [showStickyNav, setShowStickyNav] = useState(false);
  const exerciseTrendsRef = React.useRef(null);
  const analyticsRef = React.useRef(null);
  const analyticsContentRef = React.useRef(null);
  const bodyMetricsRef = React.useRef(null);
  const tabsRef = React.useRef(null);
  const { user } = useAuth();

  React.useEffect(() => {
    const handleScroll = () => {
      if (tabsRef.current) {
        const tabsBottom = tabsRef.current.getBoundingClientRect().bottom;
        setShowStickyNav(tabsBottom < 0);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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

  const { data: rawAchievements = [] } = useQuery({
    queryKey: ['achievements', user?.email],
    queryFn: () => db.entities.Achievement.filter({ created_by: user.email }),
    enabled: !!user?.email,
  });

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

  const logs = useMemo(() => filterAfterReset(rawLogs, userProfile), [rawLogs, userProfile]);
  const regimens = useMemo(() => filterAfterReset(rawRegimens, userProfile), [rawRegimens, userProfile]);
  const achievements = useMemo(() => rawAchievements ?? [], [rawAchievements]);

  const weeklyCardio = useMemo(() => {
    const cutoff = subDays(new Date(), 7);
    const inWindow = cardioLogs.filter(l => l.date && new Date(l.date) >= cutoff);
    return {
      sessions: inWindow.length,
      distanceMeters: inWindow.reduce((s, l) => s + (l.distance_meters || 0), 0),
      durationSeconds: inWindow.reduce((s, l) => s + (l.duration_seconds || 0), 0),
      calories: inWindow.reduce((s, l) => s + (l.calories || 0), 0),
    };
  }, [cardioLogs]);

  const isLoading = logsLoading || regimensLoading;
  const regimenNames = useMemo(() => regimens.map(r => r.name).sort(), [regimens]);

  const regimenLogs = useMemo(() => {
    if (selectedRegimen === 'all') return logs;
    return logs.filter(l => l.regimen_name === selectedRegimen);
  }, [logs, selectedRegimen]);

  const exerciseNames = useMemo(() => {
    const names = new Set();
    regimenLogs.forEach(log => {
      log.exercises?.forEach(ex => { if (ex.name) names.add(ex.name); });
    });
    return Array.from(names).sort();
  }, [regimenLogs]);

  const scrollToTab = (tabId) => {
    setTimeout(() => {
      let contentElement;
      if (tabId === 'analytics') contentElement = analyticsContentRef.current;
      else if (tabId === 'body') contentElement = bodyMetricsRef.current;
      else if (tabId === 'trends') contentElement = exerciseTrendsRef.current;

      if (contentElement) {
        const contentTop = contentElement.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: contentTop - 80, behavior: 'smooth' });
      }
    }, 100);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="p-4 md:p-8 max-w-5xl mx-auto"
    >
      <PageHeader
        kicker={t('pageHeader.kicker.progress')}
        title={t('progress.title')}
        hidePeriod
        subtitle={t('progress.subtitle')}
      />

      {/* Weekly Cardio Summary */}
      {!isLoading && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-8"
        >
          <Card className="p-4 border-none shadow-sm">
            <p className="text-sm font-medium mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              {t('cardio.weekly.title')}
            </p>
            {weeklyCardio.sessions === 0 ? (
              <p className="text-sm text-muted-foreground">{t('cardio.weekly.noActivity')}</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                <WeeklyStat label={t('cardio.weekly.sessions')} value={weeklyCardio.sessions} />
                <WeeklyStat label={t('cardio.weekly.distance')} value={formatDistance(weeklyCardio.distanceMeters, distanceUnit, 1)} />
                <WeeklyStat label={t('cardio.weekly.time')} value={formatDuration(weeklyCardio.durationSeconds)} />
                <WeeklyStat label={t('cardio.weekly.calories')} value={`${Math.round(weeklyCardio.calories)}`} />
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {/* Tab Cards */}
      <motion.div
        ref={tabsRef}
        className="grid grid-cols-2 gap-4 mb-8 items-stretch"
        variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } }}
        initial="hidden"
        animate="visible"
      >
        {TABS.map((tab) => (
          <motion.div
            key={tab.id}
            variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 350, damping: 18 }}
          >
            <button
              onClick={() => { setActiveTab(tab.id); setTimeout(() => scrollToTab(tab.id), 450); }}
              className="w-full h-full"
            >
              <Card className={`p-3 md:p-6 border-none cursor-pointer shadow-sm h-full ${activeTab === tab.id ? 'bg-primary text-primary-foreground' : ''}`}>
                <div className="flex items-center justify-between gap-2 md:gap-3 h-full">
                  <div className="text-left flex-1 min-w-0">
                    <p className="font-heading text-sm md:text-lg font-bold break-normal leading-tight">{tab.label}</p>
                    <p className={`text-[11px] md:text-sm mt-1 break-normal leading-tight ${activeTab === tab.id ? 'opacity-80' : 'text-muted-foreground'}`}>
                      {tab.id === 'trends' && t('progress.tabs.trendsDesc')}
                      {tab.id === 'analytics' && t('progress.tabs.analyticsDesc')}
                      {tab.id === 'body' && t('progress.tabs.bodyDesc')}
                      {tab.id === 'photos' && t('progress.tabs.photosDesc')}
                    </p>
                  </div>
                  <motion.div
                    className={`w-8 h-8 md:w-12 md:h-12 rounded-full flex items-center justify-center shrink-0 ${activeTab === tab.id ? 'bg-white/20' : 'bg-secondary'}`}
                    whileHover={{ scale: 1.2, rotate: 15 }}
                    transition={{ type: 'spring', stiffness: 400 }}
                  >
                    <ArrowRight className={`w-3.5 h-3.5 md:w-5 md:h-5 ${activeTab === tab.id ? '' : 'text-muted-foreground'}`} />
                  </motion.div>
                </div>
              </Card>
            </button>
          </motion.div>
        ))}
      </motion.div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20, pointerEvents: 'none' }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            {activeTab === 'analytics' ? (
              <div className="space-y-6">
                <div ref={analyticsContentRef} className="flex gap-3 justify-center flex-wrap">
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 400 }}>
                    <Button
                      onClick={() => setPersonalBestsModalOpen(true)}
                      className="bg-gradient-to-r from-yellow-400 via-yellow-500 to-amber-500 hover:from-yellow-500 hover:via-yellow-600 hover:to-amber-600 text-slate-900 font-bold shadow-lg hover:shadow-xl transition-all relative overflow-hidden"
                    >
                      <motion.div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/40 to-white/0" animate={{ x: ['100%', '-100%'] }} transition={{ duration: 2, repeat: Infinity }} />
                      <Trophy className="w-4 h-4 mr-2 relative z-10" /> {t('progress.personalBests')}
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 400 }}>
                    <Button
                      onClick={() => setAdvancedAnalyticsOpen(true)}
                      className="bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500 hover:from-emerald-500 hover:via-teal-600 hover:to-cyan-600 text-slate-900 font-bold shadow-lg hover:shadow-xl transition-all relative overflow-hidden"
                    >
                      <motion.div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/40 to-white/0" animate={{ x: ['100%', '-100%'] }} transition={{ duration: 2, repeat: Infinity }} />
                      <SparklesIcon className="w-4 h-4 mr-2 relative z-10" /> {t('progress.advancedAnalytics')}
                    </Button>
                  </motion.div>
                </div>
                <div ref={analyticsRef}>
                  <ErrorBoundary label="Analytics">
                    <AnalyticsTab logs={logs} />
                  </ErrorBoundary>
                </div>
              </div>
            ) : activeTab === 'body' ? (
              <div ref={bodyMetricsRef}>
                <ErrorBoundary label="BodyMetrics">
                  <BodyMetricsTab />
                </ErrorBoundary>
              </div>
            ) : activeTab === 'photos' ? (
              <div>
                <ErrorBoundary label="ProgressPhotos">
                  <ProgressPhotosTab />
                </ErrorBoundary>
              </div>
            ) : activeTab === 'achievements' ? (
              <div>
                <ErrorBoundary label="Achievements">
                  <AchievementsTab achievements={achievements} />
                </ErrorBoundary>
              </div>
            ) : (
              /* Exercise Trends Tab */
              <ErrorBoundary label="ExerciseTrends">
              <div>
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
                      { value: '7', label: t('progress.last7Days') },
                      { value: '30', label: t('progress.last30Days') },
                      { value: '90', label: t('progress.last90Days') },
                      { value: '365', label: t('progress.lastYear') },
                    ]}
                    selectedMuscleGroup={selectedMuscleGroup}
                    onMuscleGroupChange={setSelectedMuscleGroup}
                    muscleGroupItems={[
                      { value: 'all', label: t('progress.filterAllMuscleGroups') },
                      ...Array.from(
                        new Set(
                          regimenLogs.flatMap(log =>
                            log.exercises?.flatMap(ex => ex.muscle_groups?.length ? ex.muscle_groups : (ex.muscle_group ? [ex.muscle_group] : [])) || []
                          )
                        )
                      )
                        .map(group => ({ value: group, label: t(`muscleGroups.${muscleKey(group)}`) }))
                        .sort((a, b) => a.label.localeCompare(b.label)),
                    ]}
                  />
                </div>

                <div className="space-y-6" ref={exerciseTrendsRef}>
                  <div>
                    <h2 className="font-heading font-bold mb-4">{t('progress.exerciseTrends')}</h2>
                    {exerciseNames.length === 0 ? (
                      <Card className="p-10 text-center border-dashed">
                        <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                        <p className="font-heading font-semibold">{t('progress.noExerciseData')}</p>
                        <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
                          {t('progress.noExerciseDataDesc')}
                        </p>
                        <div className="mt-4 p-4 bg-secondary rounded-xl text-left text-sm text-muted-foreground max-w-xs mx-auto space-y-1.5">
                          <p className="font-medium text-foreground mb-2">{t('progress.howToLog')}</p>
                          <p>1.{' '}
                            {t('progress.howToLog.step1').split('{workout}')[0]}
                            <span className="text-primary font-medium">{t('nav.workout')}</span>
                            {t('progress.howToLog.step1').split('{workout}')[1]}
                          </p>
                          <p>2. {t('progress.howToLog.step2')}</p>
                          <p>3. {t('progress.howToLog.step3')}</p>
                          <p>4.{' '}
                            {t('progress.howToLog.step4').split('{save}')[0]}
                            <span className="text-primary font-medium">{t('workout.saveWorkout')}</span>
                            {t('progress.howToLog.step4').split('{save}')[1]}
                          </p>
                        </div>
                      </Card>
                    ) : (
                      <GroupedExerciseTrends
                        exerciseNames={exerciseNames}
                        regimenLogs={regimenLogs}
                        timeRange={timeRange}
                        selectedMuscleGroup={selectedMuscleGroup}
                        scrollRef={exerciseTrendsRef}
                      />
                    )}
                  </div>
                </div>
              </div>
              </ErrorBoundary>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Personal Bests Modal */}
      <Dialog open={personalBestsModalOpen} onOpenChange={setPersonalBestsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">{t('progress.personalBests')}</DialogTitle>
          </DialogHeader>
          <PersonalBestsTab logs={logs} />
        </DialogContent>
      </Dialog>

      {/* Advanced Analytics Modal */}
      <AdvancedAnalytics open={advancedAnalyticsOpen} onClose={() => setAdvancedAnalyticsOpen(false)} logs={logs} />

      {/* Achievements Modal */}

      {/* Sticky Tab Navigation */}
      {showStickyNav && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.25 }}
          className="fixed top-0 left-0 right-0 bg-background/95 backdrop-blur-md border-b border-border z-40 md:ml-64"
        >
          <div className="max-w-5xl mx-auto px-4 md:px-8 py-4">
            {/*
              These "tabs" are scroll-to-anchor jump links, NOT WAI-ARIA
              tabs (no tabpanels, no roving focus). `aria-pressed`
              correctly communicates the toggle-style selection state to
              screen readers without falsely promising tab semantics
              the underlying markup doesn't honor.
            */}
            <div role="group" aria-label="Section navigation" className="grid grid-cols-4 gap-3">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setTimeout(() => scrollToTab(tab.id), 450); }}
                  aria-pressed={activeTab === tab.id}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
