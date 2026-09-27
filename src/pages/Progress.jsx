import { workoutLogsKey } from '@/lib/data/workoutKeys';
import React, { useState, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { useUrlState } from '@/hooks/useUrlState';
import { filterAfterReset } from '@/lib/accountReset';
import { LOG_FETCH_LIMIT } from '@/lib/constants';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { muscleKey } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs, formatWeight } from '@/lib/weightUnit';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { format, subDays, eachDayOfInterval, startOfDay, differenceInDays } from 'date-fns';
import { parseLocalDate } from '@/lib/dateUtils';
import { workoutTitle } from '@/lib/workoutTitle';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { motion, AnimatePresence } from 'framer-motion';
import AnimatedNumber from '@/components/AnimatedNumber';
import { fadeUp } from '@/lib/motion';
import useCountUp from '@/hooks/useCountUp';
import {
  TrendingUp, BarChart2,
  Flame, Dumbbell, Camera, Ruler, ChevronRight, Zap, RefreshCw, Lightbulb,
} from 'lucide-react';
import BodyMetricsTab from '@/components/progress/BodyMetricsTab';
import ProgressPhotosTab from '@/components/progress/ProgressPhotosTab';
import ErrorBoundary from '@/components/ErrorBoundary';
import * as workouts from '@/lib/data/workouts';
import * as cardioData from '@/lib/data/cardio';
// Both sheets are lazy per the lazy-loading rule: they only mount on a tap,
// and neither is on the first paint of this page.
const AdvancedAnalyticsSheet = lazy(() => import('@/components/progress/AdvancedAnalyticsSheet'));
const PersonalBestsSheet     = lazy(() => import('@/components/progress/PersonalBestsSheet'));
import ExerciseTrendsTab from '@/components/progress/ExerciseTrendsTab';
import InsightsTab from '@/components/progress/InsightsTab';
import PRHistoryModal from '@/components/progress/PRHistoryModal';
// Achievements moved to ProfileMenu (above "My Bag") — it didn't fit
// next to data / chart tabs. AchievementsTab is now imported by
// src/components/achievements/AchievementsVault.jsx.
import TrainingPatternCard from '@/components/progress/TrainingPatternCard';
import WorkoutCalendarGrid from '@/components/progress/WorkoutCalendarGrid';
import HeroPager from '@/components/HeroPager';
import { HERO_SLIDE_GUTTER, HERO_SLIDE_MIN_H, heroTintGradient, heroWatermarkStyle, heroSlideAccent } from '@/lib/heroChrome';
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

// Timeframe constants (used by the stats-frame toggle in the hero card).
//
// These windows are ROLLING — `week` is seven days back from now, not the
// current calendar week — so the labels say so. They used to read "This
// Week" / "This Month" / "This Year", which disagreed with the Weekly
// Review card lower down the same screen: that one is a real ISO week and
// prints "Week 32, 2026". Two things on one page called "this week" and
// meant different spans. The behaviour is the right one to keep (a Monday
// morning reading "This Week: 0 workouts" is demoralising and true of
// nobody's training), so the copy moved to match the code rather than the
// other way around.
const FRAME_DAYS   = { week: 7, month: 30, year: 365, all: Infinity };
const FRAME_PREV   = { week: 7, month: 30, year: 365, all: null };
const FRAME_LABEL_FALLBACK = {
  week:  'Last 7 Days',
  month: 'Last 30 Days',
  year:  'Last 365 Days',
  all:   'All Time',
};
const FRAME_SHORT_FALLBACK = { week: 'Wk', month: 'Mo', year: 'Yr', all: 'All' };

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

function AnalyticsTab({ logs }) {
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);

  // Sort by the RAW 'yyyy-MM-dd' date BEFORE mapping to display labels.
  // The previous version formatted the localized label first and then
  // sorted by `new Date(label)` — 'MMM d' labels are Invalid Date in 14
  // of 15 locales, so the sort was a no-op, the chart rendered in
  // whatever order logs arrived (newest-first), and slice(-20) kept the
  // OLDEST 20 sessions. Cardio-only logs (max weight 0) are filtered out
  // so they don't drag the line to zero.
  const weightOverTime = useMemo(() => logs
    .filter(l => l.date)
    .map(log => {
      const maxWeightLbs = (log.exercises || []).reduce((max, ex) => {
        const exMax = (ex.sets || []).reduce((m, s) => Math.max(m, s.weight || 0), 0);
        return Math.max(max, exMax);
      }, 0);
      return { rawDate: String(log.date).slice(0, 10), maxWeightLbs };
    })
    .filter(e => e.maxWeightLbs > 0)
    .sort((a, b) => a.rawDate.localeCompare(b.rawDate))
    .slice(-20)
    // Only `weightDisplay` is charted. A second field carrying the raw
    // lbs under the key 'Max Weight (lbs)' rode along here and no axis,
    // line or tooltip ever read it — a hardcoded unit in a key name is
    // also exactly what a kg user must not be shown, so it was one
    // careless dataKey away from being a bug rather than dead weight.
    .map(e => ({
      date: format(parseLocalDate(e.rawDate), 'MMM d', { locale: dateLocale }),
      weightDisplay: fromLbs(e.maxWeightLbs, weightUnit),
    })),
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
    // log.date is a LOCAL 'yyyy-MM-dd' string — key by the raw string and
    // compare via parseLocalDate so the frequency bars don't shift a day
    // for users west of UTC.
    const cutoff = startOfDay(subDays(new Date(), 29));
    const loggedDays = new Set(
      logs
        .filter(l => {
          if (!l.date) return false;
          const d = parseLocalDate(l.date);
          return d && d >= cutoff;
        })
        .map(l => String(l.date).slice(0, 10))
    );
    return last30.map(day => ({ date: format(day, 'MMM d', { locale: dateLocale }), Workouts: loggedDays.has(format(day, 'yyyy-MM-dd')) ? 1 : 0 }));
  }, [logs, dateLocale]);

  const trainedDays = workoutFrequency.filter(d => d.Workouts === 1).length;

  if (logs.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <BarChart2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="font-heading font-semibold">{t('progress.noData')}</p>
        <p className="text-sm text-muted-foreground mt-1">{t('progress.logWorkoutsForAnalytics')}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { value: logs.length, label: t('progress.totalWorkouts'), color: 'text-info' },
          { value: trainedDays, label: t('progress.daysTrained30d'), color: 'text-primary' },
          { value: volumeByMuscle[0]?.displayGroup || '—', label: t('progress.topMuscleGroup'), color: 'text-success', span: 'col-span-2 md:col-span-1' },
        ].map((stat, i) => (
          <motion.div key={stat.label} {...fadeUp(i)} className={stat.span || ''}>
            <Card className="p-4 border border-border shadow-none text-center h-full">
              {/* Numbers count up from zero rather than popping in at scale 0.5:
                the tile's own entrance already moves it, and a count is the
                motion that says something about the number. */}
              <p className={`font-heading text-2xl font-bold tabular-nums ${stat.color}`}>
                {typeof stat.value === 'number'
                  ? <AnimatedNumber value={stat.value} animateOnMount duration={700} />
                  : stat.value}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="p-5 border border-border shadow-none">
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
              <Line type="monotone" dataKey="weightDisplay" name={t('workout.weightWithUnit', { unit: weightUnit })} stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 3 }} activeDot={{ r: 5, strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-5 border border-border shadow-none">
        <h2 className="font-heading font-bold mb-1">{t('progress.totalVolumeByMuscle')}</h2>
        <p className="text-xs text-muted-foreground mb-4">{t('progress.totalVolumeDesc')}</p>
        {volumeByMuscle.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t('progress.noMuscleData')}</p>
        ) : (
          <ResponsiveContainer width="100%" height={240} key={language}>
            <BarChart data={volumeByMuscle} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              {/* no inputMode — it was an <input> attribute on an SVG axis,
                  which renders nothing and configures no keyboard. */}
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis type="category" dataKey="displayGroup" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={80} />
              <Tooltip {...CHART_STYLE} />
              <Bar dataKey="Volume" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-5 border border-border shadow-none">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-heading font-bold">{t('progress.workoutFrequency')}</h2>
          <span className="text-xs font-medium text-primary">{trainedDays} / 30 {t('progress.daysShort')}</span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">{t('progress.workoutFrequencyDesc')}</p>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={workoutFrequency}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={4} />
            <YAxis hide domain={[0, 1]} />
            <Tooltip {...CHART_STYLE} formatter={(v) => [v === 1
              ? tFallback('progress.analytics.trained', 'Trained ✓')
              : tFallback('progress.analytics.restDay', 'Rest day'), '']} />
            <Bar dataKey="Workouts" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  ProgressCarousel — 4 slides (Streak / Workouts / Volume / Level)
 *  with motivational copy per slide.
 *
 *  This is now the SAME carousel as the Dashboard hero, not a carousel
 *  "modeled after" it. It used to be a private copy of the original
 *  design — one slide cross-fading in place, with `drag` on a card
 *  pinned by `dragConstraints={{ left: 0, right: 0 }}` so the gesture
 *  rubber-banded back to where it started and the slide changed after
 *  the fact. Nothing travelled with the thumb. The Dashboard hero had
 *  since been rebuilt as a real pager (a track holding every slide,
 *  translated under the finger, settling on a spring, clamped at the
 *  ends like an iOS home screen) and the two read as different
 *  components wearing the same dots.
 *
 *  Everything that moves is HeroPager; everything that is painted is
 *  src/lib/heroChrome.js. What is left here is this page's slide.
 *
 *  Two chrome changes came with it, both from CLAUDE.md's composition
 *  rules: the two blurred radial blobs (one animating on a 9s loop) are
 *  replaced by the band's smoothstep accent tint plus its 2px identity
 *  rule — "no gradient as decoration" — and `shadow-sm` is gone, since
 *  a resting surface is a hairline and nothing else.
 *
 *  This used to be a forwardRef exposing .goToId(id), so the stat tiles
 *  below the carousel could jump it to the matching slide when tapped.
 *  Those tiles moved into the Advanced Analytics modal (see heroStats),
 *  which receives them as data and has no handle on this component — so
 *  the bridge had no caller left. Removed rather than reconnected:
 *  wiring the modal's tiles back to a carousel behind it is a product
 *  decision, not a cleanup. HeroPager still exposes goToId for anyone
 *  who wants it.
 * ────────────────────────────────────────────────────────────────── */

function ProgressCarousel({ slides }) {
  const { tFallback } = useLanguage();
  const pagerRef = useRef(null);
  // The band paints the LIVE slide's accent — tint and identity rule —
  // exactly as the Dashboard hero does. Seeded from slide 0 so the first
  // paint is already correct rather than flashing brand-orange first.
  const [accent, setAccent] = useState(() => heroSlideAccent(slides[0]));
  const handleIndexChange = useCallback((_i, slide) => {
    setAccent(heroSlideAccent(slide));
  }, []);


  return (
    <div className="relative mb-3">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-muted dark:bg-card text-foreground touch-pan-y">
        {/* Accent tint — the smoothstep falloff from heroChrome, keyed to
            the slide on screen. Ends exactly on the card's own boundary,
            so there is no edge in open space for Mach banding to find. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: heroTintGradient(accent) }}
        />
        {/* Slide identity — a 2px solid rule, after the tint so the tint
            cannot wash it out. NO `transition-colors`: transitioning a
            background-color whose value is `hsl(var(--x))` does not work,
            and the rule would sit frozen on slide one's accent forever. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5 pointer-events-none"
          style={{ background: `hsl(${accent})` }}
        />

        {/* No floating next-slide arrow. It was the only thing on this card
            that could ever collide with the watermark, and it sat on top of
            a surface whose whole interaction is a swipe. The Dashboard hero
            has never had one — its chevrons live inside in-flow CTA buttons,
            which is what this now copies. Slides advance by drag, by the
            dots, and on the pager's own timer. (kegan, 2026-08-10.) */}

        {/* min-h holds the card's rhythm on the page. It no longer has to
            absorb the difference between slides: the pager mounts every
            slide side by side in one flex row, so the track is already as
            tall as its tallest page and rotation cannot resize the card. */}
        <div className={`relative p-4 md:p-5 ${HERO_SLIDE_MIN_H}`}>
          <HeroPager
            ref={pagerRef}
            slides={slides}
            renderSlide={renderProgressSlide}
            onIndexChange={handleIndexChange}
            dotsClassName="mt-4"
            dotLabel={(i) => tFallback('progress.carousel.slideN', 'Slide {n}', { n: i + 1 })}
          />
        </div>
      </div>
    </div>
  );
}

/* The slide's figure. A slide that carries a numeric `count` and a
   `formatCount` counts up to it (useCountUp) and formats each frame;
   anything else renders its `value` string as before. A component rather
   than inline because renderProgressSlide is a plain function and cannot
   hold a hook. */
function SlideFigure({ slide }) {
  const hasCount = typeof slide.count === 'number' && typeof slide.formatCount === 'function';
  const counted = useCountUp(hasCount ? slide.count : null, { duration: 700 });
  if (!hasCount) return slide.value;
  return slide.formatCount(Math.round(counted ?? slide.count));
}

/* One slide of the Progress carousel, in the hero's shared layout:
   corner watermark, icon chip + kicker, the figure, the line of context.
   The watermark is heroWatermarkStyle — 72px hard in the corner — rather
   than the 96px inset copy this file used to carry, and the text column
   reserves it with `pe-20` because an absolutely positioned icon creates
   no clearance of its own. */
function renderProgressSlide(slide, { count = 1 } = {}) {
  const Icon = slide.icon;
  return (
    <div className={`relative flex flex-col justify-between gap-5 min-w-0 ${count > 1 ? HERO_SLIDE_GUTTER : ''}`}>
      {Icon && (
        <Icon aria-hidden="true" className="absolute pointer-events-none select-none"
          style={heroWatermarkStyle()} />
      )}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full backdrop-blur-sm flex items-center justify-center" style={{ background: `hsl(${heroSlideAccent(slide)} / 0.2)` }}>
          <Icon className="w-4 h-4 text-foreground" />
        </div>
        <span className="text-micro font-semibold tracking-[0.04em] text-foreground/70">
          {slide.kicker}
        </span>
      </div>
      {/* No AnimatePresence — the track IS the transition. A page that also
          cross-fades its own contents while sliding reads as two animations
          disagreeing, and with `mode="wait"` it renders empty for a beat
          mid-slide, in full view of the page beside it. */}
      <div className="min-w-0">
        {/* An `empty` slide carries a sentence, not a figure, so it takes a
            heading size rather than the display size a number gets. */}
        <h3
          className={`text-foreground break-words pe-20 ${slide.empty ? 'font-heading font-bold tracking-tight leading-tight text-balance' : 'font-display tabular-nums'}`}
          style={{ fontSize: slide.empty ? 'clamp(1.25rem, 5vw, 1.5rem)' : 'clamp(2rem, 7vw, 3rem)' }}
        >
          <SlideFigure slide={slide} />
        </h3>
        <p className="text-sm text-foreground/60 max-w-[36ch] leading-relaxed mt-3">
          {slide.tip}
        </p>

        {/* CTA — the Dashboard hero's button, copied verbatim: same radius,
            same fill, same chevron, same mt-3. It replaces the floating
            arrow, so the only interactive thing on the card is now in the
            text flow where it cannot reach the watermark. */}
        {slide.cta && (
          <button
            type="button"
            onClick={slide.cta.onClick}
            className="inline-flex items-center gap-1 mt-3 px-3 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 active:bg-primary/20 backdrop-blur-sm text-caption font-semibold text-foreground transition-colors"
          >
            {slide.cta.label}
            <ChevronRight className="w-3.5 h-3.5 rtl:scale-x-[-1]" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Progress Page ───────────────────────────────────────────────────────

export default function Progress() {
  // No distanceUnit and no dateLocale here: this component renders no
  // distance and formats no date. Both were read and never used — the
  // sub-components that DO format dates (PersonalBestsTab, AnalyticsTab)
  // derive their own dateLocale, so those stay.
  const { t, tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();

  const location = useLocation();
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
    queryFn: () => db.entities.BodyMetric.filter({ user_id: user.id }, '-date', LOG_FETCH_LIMIT),
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
    return logs.filter(l => l.date && parseLocalDate(l.date) >= cutoff);
  }, [logs, statsFrame]);

  const prevFrameLogs = useMemo(() => {
    const days = FRAME_PREV[statsFrame];
    if (!days) return [];
    const end   = subDays(new Date(), days);
    const start = subDays(new Date(), days * 2);
    return logs.filter(l => l.date && parseLocalDate(l.date) >= start && parseLocalDate(l.date) < end);
  }, [logs, statsFrame]);

  const thisWeekLogs = useMemo(() => {
    const cutoff = subDays(new Date(), 7);
    return logs.filter(l => l.date && parseLocalDate(l.date) >= cutoff);
  }, [logs]);

  const lastWeekLogs = useMemo(() => {
    const end   = subDays(new Date(), 7);
    const start = subDays(new Date(), 14);
    return logs.filter(l => l.date && parseLocalDate(l.date) >= start && parseLocalDate(l.date) < end);
  }, [logs]);

  const frameVolume    = useMemo(() => calcVolume(frameLogs),    [frameLogs]);
  const prevVolume     = useMemo(() => calcVolume(prevFrameLogs), [prevFrameLogs]);
  const thisWeekVolume = useMemo(() => calcVolume(thisWeekLogs), [thisWeekLogs]);
  const lastWeekVolume = useMemo(() => calcVolume(lastWeekLogs), [lastWeekLogs]);
  const volumeDelta    = prevVolume > 0 ? ((frameVolume - prevVolume) / prevVolume) * 100 : null;

  // Workout and cardio counts for the PREVIOUS window, so all three figures
  // in the stats row can state a comparison rather than only volume. This
  // number already existed for volume and was rendered once, as a pill in
  // the card header; a figure with nothing to compare against is decoration.
  // `null` where the frame is All Time — there is no prior period to a
  // lifetime, and "same as prev" would be a claim about nothing.
  const prevFrameWorkouts = FRAME_PREV[statsFrame] === null ? null : prevFrameLogs.length;
  const prevFrameCardio = useMemo(() => {
    const days = FRAME_PREV[statsFrame];
    if (!days) return null;
    const end   = subDays(new Date(), days);
    const start = subDays(new Date(), days * 2);
    return cardioLogs.filter(l => {
      if (!l.date) return false;
      const d = parseLocalDate(l.date);
      return d && d >= start && d < end;
    }).length;
  }, [cardioLogs, statsFrame]);

  // A session COUNT, not a stats object. It also summed distance, duration
  // and calories on every frame change and nothing ever read any of the
  // three — the card shows one number. Three unread reduces over the full
  // cardio history is not free on a phone, and worse, an unused aggregate
  // reads as a feature someone forgot to finish. If a distance or duration
  // stat is wanted here, add it to the card and the sum with it.
  const frameCardioSessions = useMemo(() => {
    const days = FRAME_DAYS[statsFrame];
    if (!isFinite(days)) return cardioLogs.length;
    const cutoff = subDays(new Date(), days);
    return cardioLogs.filter(l => l.date && parseLocalDate(l.date) >= cutoff).length;
  }, [cardioLogs, statsFrame]);

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
      .slice(0, 5);
  }, [logs]);

  const lastWorkout     = logs[0] || null;
  const daysSinceLast   = lastWorkout?.date ? differenceInDays(new Date(), parseLocalDate(lastWorkout.date)) : null;

  const streak = userProfile?.workout_streak ?? 0;
  const level  = userProfile?.current_level  ?? 1;

  // Hero stat tiles. These use the standard themed <Card> (bg-card /
  // text-card-foreground / theme-card-accent) so they pick up the
  // user's equipped loot theme automatically — same as every other
  // card across the app. Each tile keeps its own color identity via
  // an accent applied to the icon + value only (not a solid fill),
  // mirroring the Dashboard StatTile pattern.
  // One colour per stat. Three of these four were `text-primary`, so Streak,
  // Workouts and Level were visually identical and the row read as one
  // undifferentiated block — you could not tell the tiles apart at a glance,
  // which is the entire job of a stat tile. Each now owns a semantic token:
  //
  //   streak   → primary      (orange — the brand's "keep going" colour, and
  //                            the flame already reads orange everywhere else)
  //   workouts → info         (blue)
  //   volume   → success      (green — unchanged)
  //   level    → accent       (the progression/reward colour)
  //
  // Tokens, not raw hex, so themes and dark mode keep working.
  // The four hero tiles that used to sit here are gone with the old
  // Advanced Analytics dialog (2026-08-10). They restated Streak /
  // Workouts / Volume / Level — the same four the carousel directly
  // behind the dialog was already showing, one swipe apart. The sheet
  // that replaced it leads with a single figure instead.

  // Carousel slides — one per heroStat. Each has a motivational tip
  // tailored to the user's current state.
  //
  // `color` is the slide's accent, and it drives everything the band
  // paints: the falloff tint, the 2px identity rule, the icon chip and
  // the pagination dots. One hue per slide, matching the stat tiles
  // above (streak → primary, workouts → info, volume → success) so the
  // tile and the slide for the same stat agree — tapping through from
  // one to the other lands somewhere that looks related.
  //
  // Budget tokens only, per CLAUDE.md — nothing here invents a hue.
  //
  // Level repeats `primary` rather than taking a fourth colour, and that
  // is deliberate (kegan, 2026-08-09). It was briefly `destructive`, on
  // the reasoning that four slides should get four hues; red reads fine
  // on the dark band, but Level is a progression, not a warning, and
  // orange is what the app already uses for it everywhere else — the
  // LevelBar, the Lv pill, the level-up capsule. A repeated hue costs
  // less than a wrong one. Don't "finish" the rotation.
  //
  // `--accent` is not the escape hatch either: it is a desaturated
  // slate, so as a full-band tint it reads as dirt rather than colour.
  // A brand-new account has nothing on either the Workouts or the Volume
  // slide, and both used to render a display-size bare "0". A zero at that
  // size reads as a failure the user did not commit (CLAUDE.md, "a section
  // with no data must not render as zeros"), so both say what comes next.
  const noTrainingYet = logs.length === 0 && !(totalVolume > 0);
  const carouselSlides = [
    {
      id: 'streak',
      icon: Flame,
      color: 'var(--primary)',
      kicker: tFallback('progress.slide.streak.kicker', 'Streak'),
      count: streak || null,
      formatCount: (n) => tFallback(
        n === 1 ? 'progress.slide.streak.days_one' : 'progress.slide.streak.days_other',
        n === 1 ? '{n} day' : '{n} days',
        { n },
      ),
      value: streak
        ? tFallback(
            streak === 1 ? 'progress.slide.streak.days_one' : 'progress.slide.streak.days_other',
            streak === 1 ? '{n} day' : '{n} days',
            { n: streak },
          )
        : tFallback('progress.slide.streak.none', 'Start today'),
      cta: { label: tFallback('progress.slide.cta.logWorkout', 'Log a workout'), onClick: () => navigate('/workout') },
      tip: streak > 0
        ? tFallback(
            'progress.slide.streak.tipActive',
            'Log a workout today to push your streak to {next} days. Skipping resets it to 0.',
            { next: streak + 1 },
          )
        : tFallback(
            'progress.slide.streak.tipNone',
            'A single set counts. Log a workout today and the streak starts at 1.',
          ),
    },
    {
      id: 'workouts',
      icon: Dumbbell,
      color: 'var(--info)',
      kicker: tFallback('progress.slide.workouts.kicker', 'Workouts'),
      value: noTrainingYet
        ? tFallback('progress.slide.workouts.empty', 'Your first workout starts the chart')
        : `${logs.length}`,
      count: noTrainingYet ? null : logs.length,
      empty: noTrainingYet,
      formatCount: (n) => `${n}`,
      cta: { label: tFallback('progress.slide.cta.logWorkout', 'Log a workout'), onClick: () => navigate('/workout') },
      tip: logs.length === 0
        ? tFallback(
            'progress.slide.workouts.tipNone',
            'Your first workout unlocks history, trends, and your first PR.',
          )
        : tFallback(
            logs.length === 1 ? 'progress.slide.workouts.tipSome_one' : 'progress.slide.workouts.tipSome_other',
            logs.length === 1
              ? '{n} workout logged. Three a week beats five-then-zero every time.'
              : '{n} workouts logged. Three a week beats five-then-zero every time.',
            { n: logs.length },
          ),
    },
    {
      id: 'volume',
      icon: TrendingUp,
      color: 'var(--success)',
      kicker: tFallback('progress.slide.volume.kicker', 'Volume'),
      value: totalVolume > 0
        ? `${formatBigNumber(Math.round(fromLbs(totalVolume, weightUnit)))} ${weightUnit}`
        : noTrainingYet
          ? tFallback('progress.slide.volume.empty', 'Nothing lifted yet')
          : '0',
      empty: noTrainingYet,
      count: totalVolume > 0 ? Math.round(fromLbs(totalVolume, weightUnit)) : null,
      formatCount: (n) => `${formatBigNumber(n)} ${weightUnit}`,
      cta: { label: tFallback('progress.slide.cta.analytics', 'See analytics'), onClick: () => setAdvancedAnalyticsOpen(true) },
      tip: thisWeekVolume > 0 && lastWeekVolume > 0
        ? tFallback(
            'progress.slide.volume.tipCompare',
            'This week: {thisWeek} {unit}. Last week: {lastWeek}. A 10% bump = new gains.',
            {
              thisWeek: formatBigNumber(Math.round(fromLbs(thisWeekVolume, weightUnit))),
              lastWeek: formatBigNumber(Math.round(fromLbs(lastWeekVolume, weightUnit))),
              unit: weightUnit,
            },
          )
        : tFallback(
            'progress.slide.volume.tipNone',
            'Total weight × reps lifted. Track it weekly. Small bumps compound into PRs.',
          ),
    },
    {
      id: 'level',
      icon: Zap,
      color: 'var(--primary)',
      kicker: tFallback('progress.slide.level.kicker', 'Level'),
      value: tFallback('progress.stat.levelValue', 'Lv. {level}', { level }),
      cta: { label: tFallback('progress.slide.cta.personalBests', 'Personal bests'), onClick: () => setPersonalBestsModalOpen(true) },
      tip: tFallback(
        'progress.slide.level.tip',
        'Every workout earns XP. Hit personal bests for bonus XP and watch the bar fill.',
      ),
    },
  ];

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
  // crowding is a wrapping problem, not a scaling one" — and px-4 is also
  // what the carousel's -mx-4 cancels, so those two have to stay the same
  // literal or the bleed stops lining up.
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
      className="px-4 md:px-6 lg:pb-6 max-w-5xl mx-auto"
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
          {/* ── Carousel — the page's ONE dominant element, and the only
                thing that breaks the page inset.

                "One dominant element per screen, and only it may bleed"
                (CLAUDE.md). It had been one card among many, sitting under
                two gradient CTAs that asked for a tap before the page had
                shown anything worth tapping about. Those moved to text
                links at the end of the Recent list; this became the band.

                The negative margins cancel the page's own px-4 / md:px-6,
                so the band runs edge to edge. A full-bleed band has no
                side edges to round or draw, hence rounded-none and
                border-x-0 — the 2px accent rule inside ProgressCarousel is
                its identity, exactly as before.

                Design: Penpot page "Progress — proposed layout", board B.
                The carousel was KEPT there by kegan (2026-08-10) against a
                proposal to replace it with the activity grid; see the
                ledger on board C. ─────────────────────────────────────── */}
          <motion.div {...fadeUp(0)} className="-mx-4 md:-mx-6 mb-2 [&_.rounded-2xl]:rounded-none [&_.border]:border-x-0">
            <ProgressCarousel slides={carouselSlides} />
          </motion.div>

          {/* The 4 stat tiles (Streak / Workouts / Volume / Level) that
              used to sit here now live inside the "Advanced Analytics"
              modal — see the heroStats prop below. */}

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

          {/* ── Frame Stats (rolling 7 / 30 / 365 days, or all time) ───── */}
          <motion.div
            {...fadeUp(3)}
            style={{ marginBottom: 'var(--fluid-section)' }}
          >
            {/* No shadow and no blur blob. "Resting = hairline border, no
                shadow; shadow-sm adds nothing a hairline doesn't", and the
                blurred radial gradient behind the corner was decoration of
                exactly the kind the composition rules name. */}
            <Card className="p-5 border border-border shadow-none overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-heading font-black text-base">
                  {tFallback(`progress.frame.${statsFrame}`, FRAME_LABEL_FALLBACK[statsFrame])}
                </h2>
              </div>

              {/* Each figure states its own change against the previous
                  window. The single "vs prev" pill that used to sit in the
                  header spoke only for volume, so two of the three numbers
                  were bare — and a number with nothing to compare against is
                  decoration, not a stat. "vs prev" is said once, on the
                  first column, rather than three times across the row. */}
              {/* An empty window with an empty previous window has nothing
                  to compare, so the row is dropped and the line below says
                  so. It used to draw a blue 0 beside two dashes. When the
                  previous window had sessions the row stays, because "0,
                  down 3" is a real stat. The figures are foreground: colour
                  is for state, and a count is not a state. */}
              {(frameLogs.length > 0 || frameCardioSessions > 0 || prevFrameWorkouts > 0 || prevFrameCardio > 0) && (
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <p className="font-heading font-black text-2xl text-foreground tabular-nums">
                    {/* Counts up on first paint and rolls between values when
                        the timeframe toggle below changes, so switching
                        week to month reads as the number moving. */}
                    <AnimatedNumber value={frameLogs.length} animateOnMount duration={500} />
                  </p>
                  <p className="text-micro text-muted-foreground mt-0.5">{tFallback('progress.frame.workouts', 'Workouts')}</p>
                  {(() => {
                    const d = countDelta(frameLogs.length, prevFrameWorkouts, tFallback);
                    return d ? <p className={`text-micro font-bold mt-0.5 ${d.tone}`}>{d.text}</p> : null;
                  })()}
                </div>
                <div className="text-center">
                  <p className="font-heading font-black text-2xl text-foreground">
                    {frameVolume > 0
                      ? <AnimatedNumber value={Math.round(fromLbs(frameVolume, weightUnit))} animateOnMount duration={500} format={(n) => formatBigNumber(Math.round(n))} />
                      : '—'}
                  </p>
                  <p className="text-micro text-muted-foreground mt-0.5">{tFallback('progress.frame.volumeLifted', '{unit} lifted', { unit: weightUnit })}</p>
                  {volumeDelta !== null && (
                    <p className={`text-micro font-bold mt-0.5 ${volumeDelta >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {tFallback(
                        volumeDelta >= 0 ? 'progress.frame.deltaPctUp' : 'progress.frame.deltaPctDown',
                        volumeDelta >= 0 ? '+{pct}%' : '−{pct}%',
                        { pct: Math.abs(Math.round(volumeDelta)) },
                      )}
                    </p>
                  )}
                </div>
                <div className="text-center">
                  <p className="font-heading font-black text-2xl text-foreground tabular-nums">
                    {frameCardioSessions
                      ? <AnimatedNumber value={frameCardioSessions} animateOnMount duration={500} />
                      : '—'}
                  </p>
                  <p className="text-micro text-muted-foreground mt-0.5">{tFallback('progress.frame.cardio', 'Cardio')}</p>
                  {(() => {
                    const d = countDelta(frameCardioSessions, prevFrameCardio, tFallback);
                    return d ? <p className={`text-micro font-bold mt-0.5 ${d.tone}`}>{d.text}</p> : null;
                  })()}
                </div>
              </div>
              )}

              {/* Muscle group pills — derived from the selected frame's logs */}
              {(() => {
                // Deduped by muscleKey(), not by the raw string: the column
                // carries whatever the exercise row was written with, so
                // 'Chest' and 'chest' used to render as two pills for one
                // muscle. The key is also what the label and the colour are
                // looked up by, so both agree per pill.
                const frameMusclePills = (() => {
                  const byKey = new Map();
                  frameLogs.forEach(log => {
                    (log.exercises || []).forEach(ex => {
                      const arr = ex.muscle_groups?.length ? ex.muscle_groups : (ex.muscle_group ? [ex.muscle_group] : []);
                      arr.forEach(g => {
                        if (!g) return;
                        const key = muscleKey(g);
                        if (!byKey.has(key)) byKey.set(key, g);
                      });
                    });
                  });
                  return [...byKey.entries()].map(([key, raw]) => ({ key, raw }));
                })();
                return (
                  <>
                    {frameMusclePills.length > 0 ? (
                      // Plain text, interpunct-separated, not chips. Three
                      // bordered pills read as filters you can tap; this is a
                      // list of what you trained. Losing the borders also
                      // loses the per-muscle hue, which was decorative — the
                      // hue said nothing the word didn't.
                      //
                      // Same lookup the charts and the filter dropdown already
                      // use (see volumeByMuscle / muscleGroupItems); these were
                      // printing the raw English column value in all 15
                      // languages until audit 20 finding 4.
                      <p className="text-micro text-muted-foreground mb-3 leading-relaxed">
                        {frameMusclePills
                          .map(({ key, raw }) => tFallback(`muscleGroups.${key}`, raw))
                          .join('  ·  ')}
                      </p>
                    ) : frameLogs.length === 0 ? (
                      // Gated on frameLogs, NOT on the pill set. It used to
                      // fire whenever the pills were empty, so a session whose
                      // exercises carry no muscle_group rendered "1 Workout"
                      // and "No workouts logged this week" in the same card,
                      // one above the other. With workouts but no muscle data
                      // there is simply nothing to say, so it says nothing.
                      <p className="text-xs text-muted-foreground mb-3">
                        {tFallback('progress.frame.noWorkouts', 'No workouts logged in this period.')}
                      </p>
                    ) : null}
                    {/* Timeframe toggle — below muscle pills, centered */}
                    <div className="flex justify-center">
                      <div className="flex gap-1 bg-secondary/50 rounded-xl p-1 shadow-inner">
                        {(['week', 'month', 'year', 'all']).map((f) => (
                          <button
                            key={f}
                            onClick={() => setStatsFrame(f)}
                            className={`px-3 py-1 rounded-lg text-micro font-bold uppercase tracking-wider transition-all duration-150 ${
                              statsFrame === f
                                ? 'bg-foreground text-background shadow-md scale-[1.04]'
                                : 'text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary/80 active:bg-secondary/80'
                            }`}
                          >
                            {tFallback(`progress.frameShort.${f}`, FRAME_SHORT_FALLBACK[f])}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* ── Weekly Review, folded in ──────────────────────────────
                    This was a full stats card lower down, inside the Trends
                    tab — Volume / Sessions / Streak / PR. So the page had
                    two period summaries a scroll apart, one a rolling
                    window and one a real ISO week, and audit 20 finding 7
                    was the labels disagreeing about which "week" they meant.
                    Making the labels honest was the code half; this is the
                    design half — one period section, one place.

                    Only the week label and the insight survive here. The
                    four figures were the same quantities the row directly
                    above already shows for the selected frame, and the full
                    week-by-week vault is still one tap away in
                    ProfileMenu → Weekly Reviews (DebriefVault), so nothing
                    is lost — it stops being said twice. */}
              {latestDebriefData && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-bold text-foreground">
                      {latestDebriefData.week_label}
                    </p>
                    <button
                      onClick={() => refetchDebrief()}
                      className="text-muted-foreground/50 hover:text-muted-foreground active:text-muted-foreground transition-colors shrink-0"
                      title={tFallback('progress.review.refresh', 'Refresh summary')}
                      aria-label={tFallback('progress.review.refresh', 'Refresh summary')}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {latestDebriefData.data?.ai_insight && (
                    <p className="text-micro text-muted-foreground leading-relaxed mt-1">
                      {latestDebriefData.data.ai_insight}
                    </p>
                  )}
                </div>
              )}
            </Card>
          </motion.div>

          {/* ── Recent ──────────────────────────────────────────────────────
                The last-workout callout and the Top PRs rail were two cards
                and a horizontal scroller holding four facts between them.
                Both are read-only and neither is user-arranged, so per
                CLAUDE.md they get no surface: "cards mark discrete,
                user-arranged objects — read-only data that is not a widget
                gets hairline dividers instead."

                Three things came off with the surfaces. The PR cards' own
                `bg-gradient-to-br` (gradient as decoration). The horizontal
                scroller, which hid PRs 3–5 off-screen behind a gesture
                nothing advertised. And the "All ›" affordance, which is now
                the "Personal Bests" link at the foot of the same list —
                one way in rather than two.

                Design: Penpot "Progress — proposed layout", board B. ──── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24, type: 'spring', stiffness: 260, damping: 22 }}
            style={{ marginBottom: 'var(--fluid-section)' }}
          >
            {/* The heading and rows are conditional; the two links below are
                NOT. Nesting them inside the same guard is a regression this
                change introduced and a browser check caught: on an account
                with no workouts there is no last session and no PR, so the
                whole section vanished — and with it the only route to
                Personal Bests and Advanced Analytics, which the old layout
                kept above the fold. Both modals carry their own empty
                states; being unreachable is not one of them. */}
            {(lastWorkout || topPRs.length > 0) && (
              <h2 className="font-heading font-black text-micro uppercase tracking-wider text-muted-foreground mb-2">
                {tFallback('progress.recent.title', 'RECENT')}
              </h2>
            )}

            {lastWorkout && (
              <div className="flex items-baseline justify-between gap-2 py-2 border-b border-border">
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight truncate">
                    {workoutTitle(lastWorkout) || tFallback('progress.lastWorkout.freestyle', 'Freestyle Session')}
                  </p>
                  <p className="text-micro text-muted-foreground mt-0.5">
                    {/* progress.today / progress.yesterday already ship in
                        all 15 languages — this line had been hardcoding
                        the same two words in English. Only the N-days
                        case needed a new key, and it needs a whole
                        template rather than progress.ago ("ago"): gluing
                        a count onto a bare preposition puts the words in
                        English order in every language. */}
                    {daysSinceLast === 0
                      ? t('progress.today')
                      : daysSinceLast === 1
                        ? t('progress.yesterday')
                        : tFallback('progress.lastWorkout.daysAgo', '{n} days ago', { n: daysSinceLast })}
                    {lastWorkout.exercises?.length
                      ? ` · ${tFallback(
                          lastWorkout.exercises.length === 1
                            ? 'progress.lastWorkout.exercises_one'
                            : 'progress.lastWorkout.exercises_other',
                          lastWorkout.exercises.length === 1 ? '{n} exercise' : '{n} exercises',
                          { n: lastWorkout.exercises.length },
                        )}`
                      : ''}
                  </p>
                </div>
                <span className="text-micro text-muted-foreground shrink-0">
                  {tFallback('progress.lastWorkout.label', 'Last workout')}
                </span>
              </div>
            )}

            {topPRs.map(pr => (
              <button
                key={pr.name}
                onClick={() => setPRHistoryExercise(pr.name)}
                className="w-full flex items-baseline justify-between gap-2 py-2 border-b border-border text-start hover:bg-secondary/40 active:bg-secondary/40 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight truncate">{pr.name}</p>
                  <p className="text-micro text-muted-foreground mt-0.5">
                    {/* Same rule as the sheet: with no load the headline
                        IS the rep count, so the secondary line says what
                        kind of best it is rather than repeating it. */}
                    {pr.weight > 0
                      ? tFallback('progress.recent.personalBest', 'personal best')
                      : tFallback('pbSheet.bodyweight', 'bodyweight')}
                    {pr.weight > 0 && pr.reps > 0
                      ? ` · ${tFallback(
                          pr.reps === 1 ? 'progress.topPRs.repsBest_one' : 'progress.topPRs.repsBest_other',
                          pr.reps === 1 ? '{n} rep best' : '{n} reps best',
                          { n: pr.reps },
                        )}`
                      : ''}
                  </p>
                </div>
                <span className="font-heading font-black text-sm text-primary shrink-0 tabular-nums">
                  {pr.weight > 0
                    ? formatWeight(pr.weight, weightUnit)
                    : tFallback(
                        pr.reps === 1 ? 'pbSheet.heroReps_one' : 'pbSheet.heroReps_other',
                        pr.reps === 1 ? '{n} rep' : '{n} reps',
                        { n: pr.reps },
                      )}
                </span>
              </button>
            ))}

            {/* The two CTAs that used to sit above the carousel, as links
                at the end of the list they belong to. No gradient, no
                shimmer sweep, and they no longer ask for a tap before the
                page has shown anything worth tapping about. */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2">
              <button
                onClick={() => setPersonalBestsModalOpen(true)}
                className="inline-flex items-center gap-0.5 text-xs font-bold text-primary hover:text-primary/80 active:text-primary/80 transition-colors"
              >
                {t('progress.personalBests')} <ChevronRight className="w-3.5 h-3.5 rtl:scale-x-[-1]" />
              </button>
              <button
                onClick={() => setAdvancedAnalyticsOpen(true)}
                className="inline-flex items-center gap-0.5 text-xs font-bold text-primary hover:text-primary/80 active:text-primary/80 transition-colors"
              >
                {t('progress.advancedAnalytics')} <ChevronRight className="w-3.5 h-3.5 rtl:scale-x-[-1]" />
              </button>
            </div>
          </motion.div>

          {/* ── Tab Navigation ──────────────────────────────────────────────
              Sized for proper touch targets (min-h ~48px, the Apple HIG
              floor + Material baseline). A 2×2 grid, so all four tabs are
              on screen at once at any width and none of them scrolls out
              of reach — this app ships to phones only.

              The comment that used to sit here described a flex-1 row that
              overflow-scrolled on mobile. That layout is gone; it was
              replaced by this grid and the note was left behind, which is
              worse than no comment because it reads as the intent. `grid`
              is right here per CLAUDE.md's rule — the count is a fixed 4
              from TAB_META, not decided by data, so there is no partial
              row for tileRow() to centre. */}
          <div style={{ marginBottom: 'var(--fluid-section)' }}>
            <div className="grid grid-cols-2 gap-2.5">
              {TAB_META.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <motion.button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className={`flex items-center justify-center gap-2.5 px-5 py-3.5 min-h-[48px] w-full rounded-xl text-body font-bold whitespace-nowrap transition-all border ${
                      isActive
                        ? `${tab.activeBg} ${tab.activeText} border-transparent shadow-md`
                        : `bg-secondary/60 text-muted-foreground border-border/50 hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground`
                    }`}
                  >
                    <tab.Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? '' : tab.iconColor}`} />
                    {tFallback(tab.labelKey, tab.label)}
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
                    <ExerciseTrendsTab logs={logs} frame={statsFrame} />
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
              logs={logs}
            >
              {/* The old "Analytics" tab's charts, still here as a section. */}
              <AnalyticsTab logs={logs} />
            </AdvancedAnalyticsSheet>
          </ErrorBoundary>
        </Suspense>
      )}
    </motion.div>
  );
}
