import { workoutLogsKey } from '@/lib/data/workoutKeys';
import React, { useState, useMemo, lazy, Suspense } from 'react';
import { useUrlState } from '@/hooks/useUrlState';
import { filterAfterReset } from '@/lib/accountReset';
import { LOG_FETCH_LIMIT } from '@/lib/constants';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { muscleKey, translateExerciseName } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, formatWeight } from '@/lib/weightUnit';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { splitByPeriod, PERIODS } from '@/lib/progressPeriod';
import { parseLocalDate } from '@/lib/dateUtils';
import { Skeleton } from '@/components/ui/skeleton';
import { motion, AnimatePresence } from 'framer-motion';
import AnimatedNumber from '@/components/AnimatedNumber';
import { fadeUp } from '@/lib/motion';
import {
  TrendingUp, Camera, Ruler, ChevronRight, Lightbulb,
} from 'lucide-react';
import BodyMetricsTab from '@/components/progress/BodyMetricsTab';
import ProgressPhotosTab from '@/components/progress/ProgressPhotosTab';
import ErrorBoundary from '@/components/ErrorBoundary';
import * as workouts from '@/lib/data/workouts';
import * as cardioData from '@/lib/data/cardio';
import * as bodyMetricsData from '@/lib/data/bodyMetrics';
// Both sheets are lazy per the lazy-loading rule: they only mount on a tap,
// and neither is on the first paint of this page.
const AdvancedAnalyticsSheet = lazy(() => import('@/components/progress/AdvancedAnalyticsSheet'));
const PersonalBestsSheet     = lazy(() => import('@/components/progress/PersonalBestsSheet'));
import ExerciseTrendsTab from '@/components/progress/ExerciseTrendsTab';
import TrendFilterChip from '@/components/progress/TrendFilterChip';
import { liftSeries, defaultLift } from '@/lib/liftSeries';
import InsightsTab from '@/components/progress/InsightsTab';
import PRHistoryModal from '@/components/progress/PRHistoryModal';
// Achievements moved to ProfileMenu (above "My Bag") — it didn't fit
// next to data / chart tabs. AchievementsTab is now imported by
// src/components/achievements/AchievementsVault.jsx.
import TrainingPatternCard from '@/components/progress/TrainingPatternCard';
import WorkoutCalendarGrid from '@/components/progress/WorkoutCalendarGrid';
import ProgressFocal from '@/components/progress/ProgressFocal';
import { latestDebrief, generateWeeklyDebrief, currentWeekStart } from '@/lib/data/debriefs';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { cardioLogsKey } from '@/lib/data/cardioKeys';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_STYLE = {
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
  },
};

// The per-muscle pill palette that used to live here is gone with the
// pills themselves. It mapped ten muscle keys onto four semantic hues,
// which meant chest and biceps shared `info`, legs and core shared
// `primary`, and so on — so the colour never identified the muscle, it
// only decorated the word that already did. The frame's muscle list is
// now interpunct-separated text. See the ledger on the Penpot page
// "Progress — proposed layout", board C.

// Period labels. The windows are calendar periods now (see
// src/lib/progressPeriod.js), so "This week" is true again: it is the same
// week the hero ring counts.
const PERIOD_LABEL_FALLBACK = { week: 'This week', month: 'This month', year: 'This year', all: 'All time' };
const PERIOD_SHORT_FALLBACK = { week: 'Week', month: 'Month', year: 'Year', all: 'All' };

// Achievements removed from this strip — it lives in ProfileMenu now.
// See src/components/achievements/AchievementsVault.jsx.
//
// `label` is the English fallback; the rendered string comes from
// tFallback(labelKey, label). The longer `progress.tabs.*` keys that ship
// in 15 languages say "Exercise Trends" / "Body Metrics" / "Progress
// Photos" — written for a list with room, not for four pills in a 2×2
// grid — so these get their own short keys rather than a relabelled bar.
// Selected is neutral (foreground on background) for every tab. It used to be
// each tab's own hue, so Trends selected was a full orange pill beside the
// orange WK timeframe toggle: two primaries for what is navigation state,
// on a screen whose one orange control should be an action.
const TAB_META = [
  { id: 'trends',    labelKey: 'progress.tab.trends',   label: 'Trends',   Icon: TrendingUp,  iconColor: 'text-primary',    activeBg: 'bg-foreground', activeText: 'text-background' },
  { id: 'body',      labelKey: 'progress.tab.body',     label: 'Body',     Icon: Ruler,       iconColor: 'text-success', activeBg: 'bg-foreground', activeText: 'text-background' },
  { id: 'photos',    labelKey: 'progress.tab.photos',   label: 'Photos',   Icon: Camera,      iconColor: 'text-primary', activeBg: 'bg-foreground', activeText: 'text-background' },
  { id: 'insights',  labelKey: 'progress.tab.insights', label: 'Insights', Icon: Lightbulb,   iconColor: 'text-info',   activeBg: 'bg-foreground', activeText: 'text-background' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBigNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/**
 * The comparison line under a stat. Returns null when there is nothing
 * honest to say — an All Time frame has no prior period, and rendering
 * "same as prev" against a window that does not exist is worse than
 * rendering nothing.
 *
 * `tone` is a semantic token, never a raw hue: up is success, down is
 * destructive, flat is muted.
 */
function countDelta(current, prev, tFallback) {
  if (prev == null) return null;
  // Nothing in either window is not a comparison, it is two absences.
  // "same as prev" under a 0 reads as the app labouring a point about a
  // user who has not trained yet.
  if (current === 0 && prev === 0) return null;
  const d = current - prev;
  if (d === 0) return { text: tFallback('progress.frame.deltaCountSame', 'same as prev'), tone: 'text-muted-foreground' };
  return d > 0
    ? { text: tFallback('progress.frame.deltaCountUp', '+{n} vs prev', { n: d }), tone: 'text-success' }
    : { text: tFallback('progress.frame.deltaCountDown', '−{n} vs prev', { n: Math.abs(d) }), tone: 'text-destructive' };
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

// PersonalBestsTab lived here. It is now
// src/components/progress/PersonalBestsSheet.jsx — a real sheet rather
// than a tab body wrapped in a generic BottomSheet, sorted heaviest
// first instead of alphabetically. See that file's head for the rest.

// ─── Analytics Tab ────────────────────────────────────────────────────────────

// The two charts under the analytics sheet, for the period's logs.
//
// Round 2 of the Progress audit (2026-09-30) took three things out:
// - the three coloured tiles on top, which restated the sheet's own rows
//   (total workouts, top muscle group) in blue, orange and green;
// - the 30 day frequency bars, which drew the calendar grid on the page
//   behind the sheet a second time;
// - the mixed "max weight" line. It took the heaviest set of ANY exercise
//   per session, so a leg day followed by an arm day drew a sawtooth that
//   was nothing but which day it was. It charts one lift now.
//
// Sections, not cards: the sheet is already the surface, and a card inside
// it was a card in a card.
function AnalyticsTab({ logs }) {
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);
  const [pickedLift, setPickedLift] = useState(null);

  const lifts = useMemo(() => liftSeries(logs), [logs]);
  // A pick survives a period change only while the lift is still in it.
  const lift = lifts.find(l => l.name === pickedLift) || defaultLift(lifts);

  const weightOverTime = useMemo(() => (lift?.sessions || [])
    .slice(-20)
    .map(e => ({
      date: format(parseLocalDate(e.rawDate), 'MMM d', { locale: dateLocale }),
      weightDisplay: fromLbs(e.maxLbs, weightUnit),
    })),
  [lift, dateLocale, weightUnit]);

  const liftItems = useMemo(() => lifts
    .map(l => ({ value: l.name, label: translateExerciseName(l.name, language) }))
    .sort((x, y) => x.label.localeCompare(y.label, language)),
  [lifts, language]);

  const volumeByMuscle = useMemo(() => {
    const map = {};
    logs.forEach(log => {
      (log.exercises || []).forEach(ex => {
        const group = ex.muscle_group || ex.muscle_groups?.[0] || 'Other';
        const vol = (ex.sets || []).reduce((sum, st) => sum + (Number(st.weight) || 0) * (Number(st.reps) || 0), 0);
        map[group] = (map[group] || 0) + vol;
      });
    });
    return Object.entries(map)
      .filter(([, volume]) => volume > 0)
      // Converted for the reader's unit. It charted raw pounds for a kg user.
      .map(([group, volume]) => ({ group, displayGroup: t(`muscleGroups.${muscleKey(group)}`), Volume: Math.round(fromLbs(volume, weightUnit)) }))
      .sort((x, y) => y.Volume - x.Volume).slice(0, 8);
  }, [logs, t, weightUnit]);

  if (logs.length === 0) return null;

  return (
    <div>
      {/* No rule above the first: the sheet's "Charts" label already has one. */}
      <section className="pb-[var(--fluid-section)]">
        <h2 className="font-heading font-bold">{t('progress.maxWeightOverTime')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t('progress.maxWeightSubtitle')}</p>
        {lift && liftItems.length > 1 && (
          <div className="mt-2">
            <TrendFilterChip
              label={tFallback('progress.analytics.liftLabel', 'Lift')}
              value={lift.name}
              onChange={setPickedLift}
              items={liftItems}
            />
          </div>
        )}
        {lift && liftItems.length === 1 && (
          <p className="text-sm font-semibold mt-2">{translateExerciseName(lift.name, language)}</p>
        )}
        {weightOverTime.length < 2 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {lift
              ? tFallback('progress.analytics.oneSession', 'Only one session of this lift so far. The line starts at two.')
              : t('progress.minWorkoutsForTrend')}
          </p>
        ) : (
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={220} key={`${language}-${weightUnit}`}>
              <LineChart data={weightOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" domain={['auto', 'auto']} width={40} />
                <Tooltip {...CHART_STYLE} />
                <Line type="monotone" dataKey="weightDisplay" name={t('workout.weightWithUnit', { unit: weightUnit })} stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ fill: 'hsl(var(--chart-1))', strokeWidth: 0, r: 3 }} activeDot={{ r: 5, strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="py-[var(--fluid-section)] border-t border-border">
        <h2 className="font-heading font-bold">{t('progress.totalVolumeByMuscle')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {tFallback('progress.analytics.volumeDesc', 'Weight times reps, added up for each muscle group, in {unit}', { unit: weightUnit })}
        </p>
        {volumeByMuscle.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t('progress.noMuscleData')}</p>
        ) : (
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={Math.max(120, volumeByMuscle.length * 32)} key={`${language}-${weightUnit}`}>
              <BarChart data={volumeByMuscle} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatBigNumber} />
                <YAxis type="category" dataKey="displayGroup" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={80} />
                <Tooltip {...CHART_STYLE} />
                <Bar dataKey="Volume" name={tFallback('progress.analytics.volume', 'Volume')} fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Main Progress Page ───────────────────────────────────────────────────────

export default function Progress() {
  // No distanceUnit and no dateLocale here: this component renders no
  // distance and formats no date. Both were read and never used — the
  // sub-components that DO format dates (PersonalBestsTab, AnalyticsTab)
  // derive their own dateLocale, so those stay.
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();

  const navigate = useNavigate();

  // The tab lives in the URL (?tab=), kept in step as it changes. It used to
  // be read once and stripped as a one-shot instruction, which meant leaving
  // Progress and coming back always reset to Trends. useUrlState replaces the
  // entry on every switch, so Back never replays an old tab choice (the
  // reason the param used to be stripped).
  const [activeTab, setActiveTab] = useUrlState('tab', 'trends', TAB_META.map(x => x.id));

  const [personalBestsModalOpen, setPersonalBestsModalOpen] = useState(false);
  const [advancedAnalyticsOpen, setAdvancedAnalyticsOpen]   = useState(false);
  const [prHistoryExercise,     setPRHistoryExercise]       = useState(null);
  // Timeframe toggle for the hero metrics strip (Week / Month / Year / All
  // Time). Also the Trends tab's period — see the tab's own note; it used
  // to carry a second, independently-defaulted one.
  const [statsFrame,            setStatsFrame]              = useState('week');

  const contentRef = React.useRef(null);
  const { user } = useAuth();

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: rawLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: workoutLogsKey(user?.email, 'progress'),
    queryFn: () => workouts.list(user.id, LOG_FETCH_LIMIT),
    enabled: !!user?.email,
  });
  // The regimens query is gone (2026-08-10). Its ONLY consumer was the
  // Trends tab's regimen filter, which listed every regimen name the
  // user owned and compared each against `workout_logs.regimen_name` —
  // a column that does not exist, so every option filtered the tab to
  // zero logs and rendered "you have never logged a workout". The
  // replacement derives its options from the logs themselves, so this
  // page no longer fetches a table it does not display.
  //
  // Achievements query removed — the surface is now in
  // ProfileMenu → Achievements (AchievementsVault), which fetches
  // its own data lazily.
  const { data: userProfile = {}, isLoading: profileLoading } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });
  const { data: rawCardioLogs = [] } = useQuery({
    queryKey: cardioLogsKey(user?.email, 'progress'),
    queryFn: () => cardioData.list(user.id, LOG_FETCH_LIMIT),
    enabled: !!user?.email,
  });
  const { data: rawBodyMetrics = [] } = useQuery({
    queryKey: ['bodyMetrics', user?.email],
    queryFn: () => bodyMetricsData.list(user.id, LOG_FETCH_LIMIT),
    enabled: !!user?.email,
  });

  // EVERY list this page reads goes through filterAfterReset. cardioLogs
  // used to be the one exception — it was consumed raw by the frame stats
  // and handed to InsightsTab unfiltered — so after an account reset the
  // "Cardio" tile kept counting sessions the reset was supposed to erase.
  // The filter is a defensive layer for exactly the case where the backend
  // delete half-failed, and a layer with one hole in it is not a layer.
  const logs         = useMemo(() => filterAfterReset(rawLogs, userProfile),        [rawLogs, userProfile]);
  const bodyMetrics  = useMemo(() => filterAfterReset(rawBodyMetrics, userProfile), [rawBodyMetrics, userProfile]);
  const cardioLogs   = useMemo(() => filterAfterReset(rawCardioLogs, userProfile),  [rawCardioLogs, userProfile]);
  // userProfile belongs in this gate as much as the other two. Streak and
  // Level are read from it and nothing else supplies them, so while it was
  // outside the gate the page rendered a complete-looking hero from the
  // `= {}` default: "Start today" and "Lv 1" at someone with a 40-day
  // streak, for as long as that query took. A skeleton says "not yet"; a
  // confident wrong number does not.
  //
  // filterAfterReset reads it too, so gating here also stops the brief
  // window where pre-reset rows were rendered before the reset timestamp
  // arrived to filter them out.
  const isLoading    = logsLoading || profileLoading;

  // Weekly summary — auto-generate on first load, then cache for 5 min
  const { data: latestDebriefData } = useQuery({
    queryKey: ['latestDebrief', user?.id],
    queryFn:  async () => {
      await generateWeeklyDebrief(currentWeekStart());
      return latestDebrief();
    },
    enabled:   !!user?.id,
    staleTime: 5 * 60_000,
  });

  // ── Derived stats (timeframe-aware) ───────────────────────────────────────

  // Calendar periods, the same week the hero ring counts. See
  // src/lib/progressPeriod.js for why, and for how the previous window is
  // cut to the same number of days so a Monday is not measured against a
  // whole week.
  const { current: frameLogs, prev: prevLogsOrNull } = useMemo(
    () => splitByPeriod(logs, statsFrame),
    [logs, statsFrame],
  );
  const prevFrameLogs = useMemo(() => prevLogsOrNull || [], [prevLogsOrNull]);
  const cardioSplit = useMemo(() => splitByPeriod(cardioLogs, statsFrame), [cardioLogs, statsFrame]);

  const frameVolume    = useMemo(() => calcVolume(frameLogs),    [frameLogs]);
  const prevVolume     = useMemo(() => calcVolume(prevFrameLogs), [prevFrameLogs]);
  const volumeDelta    = prevVolume > 0 ? ((frameVolume - prevVolume) / prevVolume) * 100 : null;

  // Workout and cardio counts for the PREVIOUS window, so all three figures
  // in the stats row can state a comparison rather than only volume. This
  // number already existed for volume and was rendered once, as a pill in
  // the card header; a figure with nothing to compare against is decoration.
  // `null` where the frame is All Time — there is no prior period to a
  // lifetime, and "same as prev" would be a claim about nothing.
  const prevFrameWorkouts = prevLogsOrNull ? prevLogsOrNull.length : null;
  const prevFrameCardio = cardioSplit.prev ? cardioSplit.prev.length : null;

  // A session COUNT, not a stats object. It also summed distance, duration
  // and calories on every frame change and nothing ever read any of the
  // three — the card shows one number. Three unread reduces over the full
  // cardio history is not free on a phone, and worse, an unused aggregate
  // reads as a feature someone forgot to finish. If a distance or duration
  // stat is wanted here, add it to the card and the sum with it.
  const frameCardioSessions = cardioSplit.current.length;

  // (muscleGroupsThisWeek removed — muscle pills now computed inline
  //  from frameLogs inside the timeframe-aware stats card)

  const topPRs = useMemo(() => {
    const map = {};
    logs.forEach(log => {
      (log.exercises || []).forEach(ex => {
        if (!ex.name) return;
        if (!map[ex.name]) map[ex.name] = { name: ex.name, weight: 0, reps: 0 };
        // Reps are the reps AT the heaviest weight, because the row prints
        // them as one set ("225 lbs × 5"). The best weight and the most reps
        // came from different sets before, which was fine while they were
        // printed as separate facts and would be a set nobody lifted as one.
        // With no load at all, reps is simply the most reps.
        (ex.sets || []).forEach(s => {
          const w = Number(s.weight) || 0;
          const r = Number(s.reps) || 0;
          const cur = map[ex.name];
          if (w > cur.weight || (w === cur.weight && r > cur.reps)) { cur.weight = w; cur.reps = r; }
        });
      });
    });
    // A bodyweight best is still a best. `.filter(pr => pr.weight > 0)`
    // dropped every push-up, pull-up and dip from this list, so a lifter
    // who trains bodyweight saw no personal bests here at all — while the
    // Personal Bests sheet, one tap below, listed them by reps. Two answers
    // to the same question on one screen. (kegan, 2026-08-10.)
    //
    // Same ranking as that sheet: loaded lifts first, heaviest down, then
    // bodyweight by reps. A tie falls back to the name so the order is
    // stable rather than insertion-dependent.
    return Object.values(map)
      .filter(pr => pr.weight > 0 || pr.reps > 0)
      .sort((a, b) => {
        const aLoaded = a.weight > 0, bLoaded = b.weight > 0;
        if (aLoaded !== bLoaded) return aLoaded ? -1 : 1;
        if (aLoaded) return b.weight - a.weight || a.name.localeCompare(b.name);
        return b.reps - a.reps || a.name.localeCompare(b.name);
      })
      .slice(0, 3);
  }, [logs]);


  // ── Tab switch helper ─────────────────────────────────────────────────────
  // Auto-scroll-on-switch removed per user feedback: it was pushing
  // the page down whenever they tapped Photos / Analytics / etc.
  // contentRef is still used by ProgressPhotos' scroll-into-view.
  const switchTab = (id) => {
    setActiveTab(id);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // Vertical padding and the between-section gaps come off the fluid scale;
  // the horizontal inset does not. The scale is vertical only — "horizontal
  // crowding is a wrapping problem, not a scaling one".
  //
  // This is a PARTIAL conversion on purpose. Onboarding got the full
  // treatment because its steps must END at a fixed point, above a pinned
  // CTA; CLAUDE.md's rule is "convert a surface when it has to end at a
  // fixed point". Progress scrolls inside Layout, so it needs neither its
  // type nor its component heights clamped — only its spacing, which is
  // what turns the 24px section gaps into 12px on an SE.
  //
  // Three things are deliberately NOT fluid, all measured at 375×667:
  //   · the 48px tab targets — that is the Apple HIG floor, not a gap
  //   · the 32px seam — its entire job is to be the one outlier, so
  //     shrinking it alongside the gaps it is meant to stand apart from
  //     defeats it. Sections shrinking to 12 makes the ratio BETTER (2.7×).
  //   · the 11px type floor, which the scale itself treats as a floor
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="px-4 md:px-6 pb-16 lg:pb-6 max-w-2xl mx-auto"
      style={{ paddingTop: 'var(--fluid-pad-y)' }}
    >
      {/* The top bar already titles this page "Progress", so a visible
          kicker and heading here said it twice and cost ~100px before any
          content. The h1 stays for screen readers and document outline. */}
      <h1 className="sr-only">{t('progress.title')}</h1>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <>
          {/* ── Focal goal: the page's ONE dominant element (hero option D,
                kegan 2026-09-27). The week's sessions against the user's own
                target, the sentence that says what that means today, the
                day dots, then a quieter stat row and one next step taken from
                their own data. It replaced a four-slide carousel whose focal
                point moved every few seconds. It no longer bleeds: nothing on
                it has an edge to run to, and being the only large thing on
                the screen is what makes it dominant. ─────────────────────── */}
          <motion.div {...fadeUp(0)} className="mb-2">
            <ErrorBoundary label="ProgressFocal">
              <ProgressFocal
                logs={logs}
                userProfile={userProfile}
                userId={user?.id}
                weightUnit={weightUnit}
                onOpenAnalytics={() => setAdvancedAnalyticsOpen(true)}
                onOpenBests={() => setPersonalBestsModalOpen(true)}
                onOpenPR={(name) => setPRHistoryExercise(name)}
                onStart={() => navigate('/workout')}
                onRepeat={(log) => navigate('/workout', { state: { repeatFromLog: log } })}
              />
            </ErrorBoundary>
          </motion.div>

          {/* "You usually train Mon · Wed · Fri at 6:30 PM" — a soft
              pattern-recognition insight. Renders nothing if there
              isn't enough data to call a pattern (see trainingPatterns.js). */}
          <motion.div {...fadeUp(1)} className="mb-2 empty:hidden empty:mb-0">
            <TrainingPatternCard workoutLogs={logs} />
          </motion.div>

          {/* ── The one 32px seam on this page. Above it is who you are
                right now; below it is what you did and when. "Exactly one
                gap-8 per page — a second break means neither reads as the
                break." ──────────────────────────────────────────────── */}
          <div className="h-8" aria-hidden="true" />

          {/* 26-week GitHub-style activity grid. Self-hides on empty
              windows. Drives habit awareness — seeing the streaks-and-
              gaps pattern is more motivating than a workout count.
              Second tap on a trained square → "repeat this workout"
              flow on the Workout page.

              Sits directly under the seam, above the period stats: it is
              the history the period below summarises. */}
          <motion.div {...fadeUp(2)} className="mb-2 empty:hidden empty:mb-0">
            <WorkoutCalendarGrid
              logs={logs}
              onSelectDay={(log) => {
                navigate('/workout', { state: { repeatFromLog: log } });
              }}
            />
          </motion.div>

          {/* ── The period: one section, no card. Its control sits in its own
                header so the thing it filters is the thing beside it; it used
                to live in the hero card and silently filter Trends as well. */}
          <section aria-labelledby="progress-period" style={{ marginBottom: 'var(--fluid-section)' }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 id="progress-period" className="font-heading font-bold text-base">
                {tFallback(`progress.period.${statsFrame}`, PERIOD_LABEL_FALLBACK[statsFrame])}
              </h2>
              <div className="flex rounded-lg bg-secondary/60 p-0.5" role="group" aria-label={tFallback('progress.period.pick', 'Period')}>
                {PERIODS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={statsFrame === f}
                    onClick={() => setStatsFrame(f)}
                    className={`min-h-[44px] px-2.5 rounded-md text-label font-semibold transition-colors ${statsFrame === f ? 'bg-background text-foreground' : 'text-muted-foreground'}`}
                  >
                    {tFallback(`progress.periodShort.${f}`, PERIOD_SHORT_FALLBACK[f])}
                  </button>
                ))}
              </div>
            </div>
            {(frameLogs.length > 0 || frameCardioSessions > 0 || prevFrameWorkouts > 0 || prevFrameCardio > 0) ? (
              <div className="grid grid-cols-3 border-y border-border divide-x divide-border rtl:divide-x-reverse">
                {[
                  {
                    key: 'workouts',
                    value: frameLogs.length,
                    label: tFallback('progress.frame.workouts', 'Workouts'),
                    delta: countDelta(frameLogs.length, prevFrameWorkouts, tFallback),
                  },
                  {
                    key: 'volume',
                    value: frameVolume > 0 ? formatBigNumber(Math.round(fromLbs(frameVolume, weightUnit))) : '—',
                    label: tFallback('progress.frame.volumeLifted', '{unit} lifted', { unit: weightUnit }),
                    delta: volumeDelta !== null && prevVolume > 0 ? {
                      text: volumeDelta >= 0
                        ? tFallback('progress.frame.deltaPctUp', '+{pct}%', { pct: Math.round(volumeDelta) })
                        : tFallback('progress.frame.deltaPctDown', '−{pct}%', { pct: Math.abs(Math.round(volumeDelta)) }),
                      tone: volumeDelta >= 0 ? 'text-success' : 'text-destructive',
                    } : null,
                  },
                  {
                    key: 'cardio',
                    value: frameCardioSessions || '—',
                    label: tFallback('progress.frame.cardio', 'Cardio'),
                    delta: countDelta(frameCardioSessions, prevFrameCardio, tFallback),
                  },
                ].map((c) => (
                  <div key={c.key} className="py-3 ps-3 first:ps-0">
                    <p className="text-micro text-muted-foreground">{c.label}</p>
                    <p className="font-heading font-bold text-xl tabular-nums leading-tight mt-0.5">
                      {typeof c.value === 'number' ? <AnimatedNumber value={c.value} duration={500} /> : c.value}
                    </p>
                    {c.delta && <p className={`text-micro font-semibold ${c.delta.tone}`}>{c.delta.text}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-3 border-y border-border">
                {statsFrame === 'week'
                  ? tFallback('progress.period.emptyWeek', 'Nothing logged yet this week.')
                  : tFallback('progress.period.empty', 'Nothing logged in this period.')}
              </p>
            )}
            {statsFrame === 'week' && latestDebriefData?.data?.ai_insight && (
              <p className="text-sm text-muted-foreground leading-relaxed mt-3">{latestDebriefData.data.ai_insight}</p>
            )}
            <button
              type="button"
              onClick={() => setAdvancedAnalyticsOpen(true)}
              className="mt-1 min-h-[44px] w-full flex items-center justify-between text-sm font-semibold text-foreground border-b border-border"
            >
              {tFallback('progress.period.analytics', 'Charts and analytics')}
              <ChevronRight className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" />
            </button>
          </section>

          {/* ── Personal bests, the top three. "Recent" used to sit here and
                repeated the grid above it; a best is the one number on this
                page that only ever goes up. The full list is the sheet. */}
          {topPRs.length > 0 && (
            <section aria-labelledby="progress-bests" style={{ marginBottom: 'var(--fluid-section)' }}>
              <div className="flex items-center justify-between mb-1">
                <h2 id="progress-bests" className="font-heading font-bold text-base">
                  {tFallback('progress.bests.title', 'Personal bests')}
                </h2>
                <button
                  type="button"
                  onClick={() => setPersonalBestsModalOpen(true)}
                  className="min-h-[44px] text-sm font-semibold text-primary"
                >
                  {tFallback('progress.bests.seeAll', 'See all')}
                </button>
              </div>
              {topPRs.map(pr => (
                <button
                  key={pr.name}
                  type="button"
                  onClick={() => setPRHistoryExercise(pr.name)}
                  className="w-full min-h-[52px] flex items-center justify-between gap-2 border-t border-border text-start"
                >
                  <span className="text-sm font-semibold truncate">{translateExerciseName(pr.name, language)}</span>
                  <span className="text-sm tabular-nums shrink-0">
                    {pr.weight > 0 ? (
                      <>
                        <span className="font-heading font-bold">{formatWeight(pr.weight, weightUnit)}</span>
                        {pr.reps > 0 && <span className="text-muted-foreground">{' × '}{pr.reps}</span>}
                      </>
                    ) : (
                      <span className="font-heading font-bold">
                        {tFallback(pr.reps === 1 ? 'pbSheet.heroReps_one' : 'pbSheet.heroReps_other', pr.reps === 1 ? '{n} rep' : '{n} reps', { n: pr.reps })}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </section>
          )}

          {/* ── Tabs: one row of text with an underline. They were a 2×2 grid
                of filled pills with icons, heavier than the hero above them. */}
          <div
            className="flex border-b border-border mb-4"
            role="tablist"
            aria-label={tFallback('progress.tabs.label', 'Progress sections')}
            style={{ marginTop: 'var(--fluid-section)' }}
          >
            {TAB_META.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => switchTab(tab.id)}
                  className={`flex-1 min-h-[44px] text-sm font-semibold -mb-px border-b-2 transition-colors ${isActive ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}
                >
                  {tFallback(tab.labelKey, tab.label)}
                </button>
              );
            })}
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
                    {/* The tab owns its own filtering now, and takes the
                        PAGE's period rather than carrying a second one.
                        It used to ship a 7/30/90/365 dropdown defaulting
                        to 90 while the hero card above defaulted to
                        week — one page, two answers to "what period am I
                        looking at". Same reasoning as the Weekly Review
                        fold-in above: one period section, one place. */}
                    <ExerciseTrendsTab logs={logs} />
                  </ErrorBoundary>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      )}

      {/* ── Personal Bests ───────────────────────────────────────────────
            Was a generic BottomSheet wrapping PersonalBestsTab. Now the
            bespoke sheet, in the shape QuestsSheet and ReadinessSheet use
            (kegan, 2026-08-10). Lazy + rendered only while open, so the
            chunk never loads for someone who does not open it.
            Design: Penpot "Analytics + Personal Bests — as sheets", D. */}
      {personalBestsModalOpen && (
        <Suspense fallback={null}>
          <ErrorBoundary label="PersonalBests">
            <PersonalBestsSheet
              open={personalBestsModalOpen}
              onClose={() => setPersonalBestsModalOpen(false)}
              logs={logs}
              onViewHistory={(name) => {
                setPersonalBestsModalOpen(false);
                setPRHistoryExercise(name);
              }}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {/* PR History Modal */}
      <PRHistoryModal
        open={!!prHistoryExercise}
        onClose={() => setPRHistoryExercise(null)}
        exerciseName={prHistoryExercise}
        logs={logs}
      />

      {/* ── Advanced Analytics ───────────────────────────────────────────
            Was a centered Radix Dialog that read as a desktop modal on a
            phone. Now the same sheet shell as above. The four hero tiles it
            used to carry are gone with it — they restated the carousel
            directly behind them, and the sheet leads with one figure
            instead. Design: same Penpot page, board B; ledger on E. */}
      {advancedAnalyticsOpen && (
        <Suspense fallback={null}>
          <ErrorBoundary label="Analytics">
            <AdvancedAnalyticsSheet
              open={advancedAnalyticsOpen}
              onClose={() => setAdvancedAnalyticsOpen(false)}
              logs={frameLogs}
              period={statsFrame}
              onPeriodChange={setStatsFrame}
            >
              {/* The old "Analytics" tab's charts, still here as a section. */}
              <AnalyticsTab logs={frameLogs} />
            </AdvancedAnalyticsSheet>
          </ErrorBoundary>
        </Suspense>
      )}
    </motion.div>
  );
}
