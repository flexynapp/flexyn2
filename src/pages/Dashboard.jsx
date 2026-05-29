import React, { useState, useMemo, useEffect, useRef } from 'react';
import StoriesRow from '@/components/stories/StoriesRow';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { subDays, isAfter, differenceInDays, startOfDay, format } from 'date-fns';
import { Dumbbell, TrendingUp, Play, ArrowRight, Zap, Activity, Target, Apple, Camera, Scale, TrendingDown, Minus, Repeat2, CheckCircle2, LayoutGrid, GripVertical, CalendarDays, ChevronRight, ChevronDown, ChevronUp, Rows3, Columns2, RotateCcw, Sun, Moon, Save } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import GoalsModal from '@/components/goals/GoalsModal';
import GoalsAlmostComplete from '@/components/goals/GoalsAlmostComplete';
import GoalsProgressStrip from '@/components/dashboard/GoalsProgressStrip';
import LogWeightModal from '@/components/dashboard/LogWeightModal';
import RoutineCalendarModal from '@/components/routines/RoutineCalendarModal';
import ProgressPhotoCapture from '@/components/progress/ProgressPhotoCapture';
import DashboardWidgets from '@/components/dashboard/DashboardWidgets';
import SyncStatus from '@/components/dashboard/SyncStatus';
import ResumeWorkoutBanner from '@/components/dashboard/ResumeWorkoutBanner';
import HeroSlideshow from '@/components/dashboard/HeroSlideshow';
import DailyChestCard from '@/components/dashboard/DailyChestCard';
import StreakRescueCard from '@/components/dashboard/StreakRescueCard';
import DailyQuote from '@/components/dashboard/DailyQuote';
import DailyQuestsCard from '@/components/dashboard/DailyQuestsCard';
import WeeklyRecap from '@/components/dashboard/WeeklyRecap';
import WorkoutSuggestionCard from '@/components/dashboard/WorkoutSuggestionCard';
import WorkoutMemoryCard from '@/components/dashboard/WorkoutMemoryCard';
import CalorieProgressWidget from '@/components/dashboard/CalorieProgressWidget';
import MacroRingWidget from '@/components/dashboard/MacroRingWidget';
import HydrationRing from '@/components/dashboard/HydrationRing';
import MoodLogCard from '@/components/dashboard/MoodLogCard';
import JournalWidget from '@/components/dashboard/JournalWidget';
import StepsLogCard from '@/components/dashboard/StepsLogCard';
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
import { isAppAdmin } from '@/lib/adminRoles';
import { setLayoutDefault } from '@/lib/data/layoutDefaults';
import { checkAndCelebrate as checkTrophies } from '@/lib/data/trophies';
import { toast } from 'sonner';
import LeagueStandingsModal from '@/components/dashboard/LeagueStandingsModal';
import { filterAfterReset } from '@/lib/accountReset';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { useTheme } from '@/lib/ThemeContext';
import { fromLbs } from '@/lib/weightUnit';
import { useNumberFormatter } from '@/lib/intl';
import { parseLocalDate } from '@/lib/dateUtils';


/* ──────────────────────────────────────────────────────────────────
 *  Sub-components live in this file deliberately — they only exist
 *  to compose the dashboard hero and stats strip, and keeping them
 *  co-located makes the page easier to read end-to-end.
 * ────────────────────────────────────────────────────────────────── */

function HeroCard({
  streak, hasWorkedOutToday, daysSinceLast,
  logs, cardioLogs, goals, userProfile, user,
  onPrimary, navigate,
  t, tFallback,
}) {
  // Day/night toggle pinned to the CTA column. On mobile (grid-cols-1),
  // the CTA stacks below the slideshow — toggle sits to the LEFT of
  // the gold button on a single row. On md+ the gold button has its
  // own column; toggle stacks above it.
  const { darkMode, setDarkMode } = useTheme();
  // Pick the right CTA copy based on the user's recent activity.
  // HeroSlideshow handles the LEFT-column content (achievement
  // carousel / new-user calculated path / streak fallback) and uses
  // these same booleans to pick its mode.
  const isFresh = streak === 0 && daysSinceLast == null;
  const isOnStreak = streak > 0;
  const isLapsed = !isOnStreak && !isFresh && daysSinceLast >= 2;

  let cta;
  if (hasWorkedOutToday) {
    cta = t('dashboard.hero.cta.logAnother');
  } else if (isOnStreak) {
    cta = t('dashboard.hero.cta.continueStreak');
  } else if (isLapsed) {
    cta = t('dashboard.hero.cta.getBack');
  } else {
    cta = t('dashboard.hero.cta.startFirst');
  }

  // Carousel chevron lives at the OUTER right edge of the viewport,
  // not inside the slideshow column. Drag-to-swipe also lives on the
  // outer wrapper so the WHOLE hero card is swipeable, not just the
  // slideshow content area.
  const slideshowRef = useRef(null);
  const [slideCount, setSlideCount] = useState(0);
  // Per-slide color tint. Each slide reports its own HSL accent up
  // via onSlideColorChange — HeroCard paints the hero's gradient
  // mesh in that color. Falls back to the app's primary brand color
  // (the "warm orange" hue) when no slide is selected.
  const [slideColor, setSlideColor] = useState(null);
  const handleDragEnd = (_e, info) => {
    if (slideCount <= 1) return;
    const dx = info.offset.x;
    const vx = info.velocity.x;
    if (dx < -50 || vx < -500) slideshowRef.current?.next?.();
    else if (dx > 50 || vx > 500) slideshowRef.current?.prev?.();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      {/* Carousel chevron — pinned to the OUTER right edge of the
          dashboard content (overflowing past the page's p-4/p-6/p-8
          padding lands it at the viewport's right edge). Sibling of
          the rounded card, so the rounded card's overflow-hidden
          doesn't clip it. */}
      {slideCount > 1 && (
        <button
          type="button"
          onClick={() => slideshowRef.current?.next?.()}
          aria-label={tFallback ? tFallback('dashboard.hero.next', 'Next slide') : 'Next slide'}
          className="absolute -end-4 md:-end-6 lg:-end-8 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-foreground/80 backdrop-blur-sm text-background hover:bg-foreground active:scale-95 flex items-center justify-center shadow-lg transition-all"
        >
          <ChevronRight className="w-5 h-5 rtl:scale-x-[-1]" />
        </button>
      )}
      <motion.div
        drag={slideCount > 1 ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        onDragEnd={handleDragEnd}
        className="relative overflow-hidden rounded-2xl bg-[hsl(210_18%_11%)] dark:bg-[hsl(210_22%_8%)] text-white shadow-2xl shadow-black/20 touch-pan-y"
      >
        {/* Animated gradient mesh — tint follows the current slide's
            color (orange for streak, purple for duels feature, pink
            for stories feature, cyan for cardio milestones, etc.). */}
        <div className="absolute inset-0 opacity-90 pointer-events-none">
          <motion.div
            key={`mesh-tr-${slideColor || 'default'}`}
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className="absolute -top-1/3 -right-1/4 w-[120%] h-[140%] rounded-full blur-3xl"
            style={{ background: `radial-gradient(circle, hsl(${slideColor || 'var(--primary)'} / 0.55), transparent 65%)` }}
          />
          <motion.div
            key={`mesh-bl-${slideColor || 'default'}`}
            className="absolute -bottom-1/3 -left-1/4 w-[100%] h-[120%] rounded-full blur-3xl"
            style={{ background: `radial-gradient(circle, hsl(${slideColor || 'var(--primary)'} / 0.25), transparent 70%)` }}
            animate={{ x: [0, 20, 0], y: [0, -10, 0], opacity: [0.85, 1, 0.85] }}
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

        <div className="relative p-4 md:p-6 md:pb-12">
          <HeroSlideshow
            ref={slideshowRef}
            logs={logs}
            cardioLogs={cardioLogs}
            goals={goals}
            profile={userProfile}
            user={user}
            streak={streak}
            hasWorkedOutToday={hasWorkedOutToday}
            daysSinceLast={daysSinceLast}
            onPrimary={onPrimary}
            onSlideCta={(to) => navigate(to)}
            onSlidesCountChange={setSlideCount}
            onSlideColorChange={setSlideColor}
            t={t}
          />
        </div>
      </motion.div>

      {/* Day/night switch + gold CTA — hang OFF the bottom of the
          rounded hero card. Negative top margin pulls them up so the
          gold button visually overlaps the hero's bottom edge (the
          "loot hanging off the chest" look the user mocked up). The
          day/night toggle aligns to the BOTTOM of the row (via
          self-end), so it sits about a centimeter lower than the
          gold CTA's vertical midline — splits the empty space below
          the carousel into two halves instead of crowding the top. */}
      <div className="relative -mt-5 mx-4 md:mx-6 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDarkMode(!darkMode)}
          aria-label={darkMode
            ? tFallback('dashboard.theme.toLight', 'Switch to light mode')
            : tFallback('dashboard.theme.toDark',  'Switch to dark mode')}
          aria-pressed={darkMode}
          className="relative self-end mb-2 shrink-0 inline-flex items-center w-14 h-7 rounded-full bg-card border border-border shadow-md hover:shadow-lg transition-all"
        >
          <span className="absolute left-1.5 inline-flex items-center justify-center w-4 h-4 pointer-events-none">
            <Sun className={`w-3 h-3 transition-opacity ${darkMode ? 'opacity-40 text-muted-foreground' : 'opacity-100 text-amber-500'}`} />
          </span>
          <span className="absolute right-1.5 inline-flex items-center justify-center w-4 h-4 pointer-events-none">
            <Moon className={`w-3 h-3 transition-opacity ${darkMode ? 'opacity-100 text-indigo-400' : 'opacity-40 text-muted-foreground'}`} />
          </span>
          <span
            className={`absolute top-0.5 inline-block w-6 h-6 rounded-full bg-gradient-to-br from-white to-white/90 shadow-md transition-transform ${
              darkMode ? 'translate-x-7' : 'translate-x-0.5'
            }`}
          />
        </button>
        <motion.button
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          onClick={onPrimary}
          className="group relative flex-1 overflow-hidden rounded-2xl p-3.5 md:p-4 flex items-center justify-between gap-3 text-left select-none-ui"
          style={{
            background:
              'linear-gradient(135deg, #fef3c7 0%, #fde68a 25%, #fcd34d 50%, #fbbf24 75%, #f59e0b 100%)',
            color: 'hsl(28 65% 22%)',
            boxShadow:
              '0 14px 28px -8px rgba(245, 158, 11, 0.55), 0 6px 12px -4px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.6)',
          }}
        >
          {/* Primary shine sweep */}
          <motion.div
            aria-hidden="true"
            className="absolute inset-y-0 -inset-x-4 pointer-events-none"
            style={{
              background:
                'linear-gradient(105deg, transparent 28%, rgba(255,255,255,0.65) 46%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.65) 54%, transparent 72%)',
              mixBlendMode: 'screen',
            }}
            initial={{ x: '-110%' }}
            animate={{ x: '110%' }}
            transition={{
              duration: 0.7,
              ease: 'easeInOut',
              repeat: Infinity,
              repeatDelay: 1.4,
            }}
          />
          {/* Secondary echo */}
          <motion.div
            aria-hidden="true"
            className="absolute inset-y-0 -inset-x-4 pointer-events-none"
            style={{
              background:
                'linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.4) 49%, rgba(255,255,255,0.7) 50%, rgba(255,255,255,0.4) 51%, transparent 62%)',
              mixBlendMode: 'screen',
            }}
            initial={{ x: '-110%' }}
            animate={{ x: '110%' }}
            transition={{
              duration: 0.5,
              ease: 'easeInOut',
              repeat: Infinity,
              repeatDelay: 1.6,
              delay: 0.25,
            }}
          />
          {/* Amber-glow pulse */}
          <motion.div
            aria-hidden="true"
            className="absolute -inset-2 rounded-2xl pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(251,191,36,0.4), transparent 70%)',
              filter: 'blur(6px)',
              zIndex: -1,
            }}
            animate={{ opacity: [0.5, 0.9, 0.5] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="relative min-w-0">
            <span className="block text-[10px] font-semibold tracking-[0.2em] uppercase mb-1" style={{ color: 'hsl(28 70% 32%)' }}>
              {hasWorkedOutToday
                ? t('dashboard.hero.label.again')
                : t('dashboard.hero.label.today')}
            </span>
            <span className="font-heading font-bold text-lg md:text-xl leading-tight break-anywhere">
              {cta}
            </span>
          </div>
          <motion.div
            className="relative shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #fff7d6 0%, #fcd34d 100%)',
              color: 'hsl(28 70% 28%)',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.55), inset 0 1px 1px rgba(255,255,255,0.7)',
            }}
            whileHover={{ rotate: 5 }}
          >
            <ArrowRight className="w-5 h-5 md:w-6 md:h-6 transition-transform group-hover:translate-x-0.5 rtl:scale-x-[-1]" strokeWidth={2.5} />
          </motion.div>
        </motion.button>
      </div>
    </motion.div>
  );
}

function StatTile({ icon: Icon, value, label, suffix, delay = 0, accent = false, trend = null }) {
  const { tFallback } = useLanguage();
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
      className="h-full"
    >
      <Card
        className={`relative overflow-hidden p-4 md:p-5 border-border/60 shadow-sm hover:shadow-md transition-shadow h-full ${
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
              {isUp ? '+' : ''}{trend} {tFallback('dashboard.stats.vsLastWeek', 'vs last wk')}
            </span>
          </div>
        )}
        {trend === 0 && (
          <div className="flex items-center gap-0.5 mt-1.5 text-muted-foreground/60">
            <Minus className="w-3 h-3" />
            <span className="text-[10px]">{tFallback('dashboard.stats.sameAsLastWeek', 'same as last wk')}</span>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function QuickAction({ to, icon: Icon, label, onClick, delay = 0, iconBg, iconColor }) {
  // Default to muted secondary chrome if no color hint provided.
  const bg = iconBg   || 'bg-secondary';
  const fg = iconColor || 'text-foreground/70';
  const inner = (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, delay, ease: 'easeOut' }}
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.98 }}
      className="group relative flex items-center gap-3 px-4 py-3.5 rounded-xl bg-card border border-border/70 hover:border-primary/40 hover:bg-card transition-colors cursor-pointer select-none-ui"
    >
      <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center transition-colors`}>
        <Icon className={`w-4 h-4 ${fg} transition-colors`} />
      </div>
      <span className="font-heading font-semibold text-sm flex-1 leading-tight">{label}</span>
      <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 rtl:scale-x-[-1]" />
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
 *  Section header + collapse helpers (module-scoped — DO NOT inline
 *  inside Dashboard(). Inlined functional components get a new
 *  reference each render → React treats them as a different component
 *  type → mount/unmount churn that defeats AnimatePresence.)
 * ────────────────────────────────────────────────────────────────── */

// Section label lookup — used by edit mode's drag-handle chips so each
// section row shows its name next to the layout-toggle button. Keyed
// by widgetOrder id; takes (tFallback, t) so it stays i18n-aware.
const SECTION_LABELS = {
  readiness:    (tF) => tF('dashboard.section.readiness',    'Readiness'),
  recovery:     (tF) => tF('dashboard.section.recovery',     'Recovery'),
  challenges:   (tF) => tF('dashboard.section.challenges',   'Challenges'),
  chest:        (tF) => tF('dashboard.section.chest',        'Daily chest'),
  league:       (tF) => tF('dashboard.section.league',       'Weekly rank'),
  progress:     (tF) => tF('dashboard.section.progress',     'Your progress'),
  actions:      (tF, t) => t('dashboard.quickActions'),
  discover:     (tF) => tF('dashboard.section.discover',     'Discover'),
  motivation:   (tF) => tF('dashboard.section.motivation',   'More motivation'),
  onboarding:   (tF) => tF('dashboard.section.onboarding',   'Get started'),
  customize:    (tF) => tF('dashboard.section.customize',    'Customize dashboard'),
};

function SectionHeader({ label, open, onToggle, tFallback }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full mt-3 mb-1.5 px-1 flex items-center justify-between text-left group"
      aria-expanded={open}
    >
      <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/70 group-hover:text-foreground transition-colors">
        {label}
      </span>
      <span className="text-[10px] font-semibold text-muted-foreground/50 group-hover:text-foreground transition-colors">
        {open ? tFallback('dashboard.hide', 'Hide') : tFallback('dashboard.showAll', 'Show all')}
        <span className="ml-1">{open ? '▾' : '▸'}</span>
      </span>
    </button>
  );
}

function Collapsible({ open, children }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Main Dashboard
 * ────────────────────────────────────────────────────────────────── */


export default function Dashboard() {
  const { t, tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const fmt = useNumberFormatter();
  const isFirstLoad = location.state?.fromSplash;
  const [showWelcome, setShowWelcome] = useState(isFirstLoad);
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);
  const [logWeightOpen, setLogWeightOpen] = useState(false);
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false);
  const [weekModalOpen, setWeekModalOpen] = useState(false);
  const [leagueModalOpen, setLeagueModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const defaultWidgetOrder = [
    'readiness', 'league',   // small square + wide rank, directly under hero
    'challenges', 'actions', // hotdog pair: quests next to quick actions
    'chest',
    'recovery',
    'progress',
    'journal',               // daily journal preview widget
    'discover', 'motivation',
    'onboarding',
    'customize',
  ];
  const [widgetOrder, setWidgetOrder] = useState(defaultWidgetOrder);

  // Per-section layout — hamburger (full-width, default) or hotdog
  // (half-width, pairs with adjacent half neighbor). Persisted per-user
  // to localStorage alongside widgetOrder. Two consecutive half
  // sections in widgetOrder render side-by-side; a lone half degrades
  // to full width (no half-width orphan).
  //
  // Factory default pairs:
  //   readiness + league   — small square + wide rank under hero
  //   challenges + actions — daily quests next to quick actions
  // User can flip any of these via the layout icon in edit mode.
  const [sectionLayouts, setSectionLayouts] = useState({
    readiness:  'half',
    league:     'half',
  });
  const toggleSectionLayout = (id) => {
    setSectionLayouts(prev => {
      const next = { ...prev, [id]: (prev[id] || 'full') === 'half' ? 'full' : 'half' };
      try { localStorage.setItem(`flexyn.dashSectionLayouts.${user?.id || 'anon'}`, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Per-section collapse state. Every section gets its own Hide / Show
  // all toggle. State is per-device (sessionStorage) — resets fresh on
  // next launch. Default OPEN so first-load behavior matches the
  // pre-refactor state; the user can choose to collapse anything they
  // don't want to see.
  const initOpen = (key, defaultOpen) => {
    try {
      const v = sessionStorage.getItem(`flexyn.dash.${key}Open`);
      if (v == null) return defaultOpen;
      return v === '1';
    } catch { return defaultOpen; }
  };
  const [readinessOpen,    setReadinessOpen]    = useState(() => initOpen('readiness',    true));
  const [recoveryOpen,     setRecoveryOpen]     = useState(() => initOpen('recovery',     true));
  const [challengesOpen,   setChallengesOpen]   = useState(() => initOpen('challenges',   true));
  const [chestOpen,        setChestOpen]        = useState(() => initOpen('chest',        true));
  const [leagueOpen,       setLeagueOpen]       = useState(() => initOpen('league',       true));
  const [progressOpen,     setProgressOpen]     = useState(() => initOpen('progress',     true));
  const [actionsOpen,      setActionsOpen]      = useState(() => initOpen('actions',      true));
  const [discoverOpen,     setDiscoverOpen]     = useState(() => initOpen('discover',     true));
  const [motivationOpen,   setMotivationOpen]   = useState(() => initOpen('motivation',   true));
  const [onboardingOpen,   setOnboardingOpen]   = useState(() => initOpen('onboarding',   true));
  const [customizeOpen,    setCustomizeOpen]    = useState(() => initOpen('customize',    true));
  // "Show more / less" toggle for the quick-actions vertical list.
  // Defaults to collapsed — user sees the top 3 actions; the rest are
  // one tap away.
  const [actionsExpanded, setActionsExpanded] = useState(false);

  const makeToggle = (key, setter) => () => setter(v => {
    try { sessionStorage.setItem(`flexyn.dash.${key}Open`, v ? '0' : '1'); } catch { /* ignore */ }
    return !v;
  });
  const toggleReadiness    = makeToggle('readiness',    setReadinessOpen);
  const toggleRecovery     = makeToggle('recovery',     setRecoveryOpen);
  const toggleChest        = makeToggle('chest',        setChestOpen);
  const toggleLeague       = makeToggle('league',       setLeagueOpen);
  const toggleProgress     = makeToggle('progress',     setProgressOpen);
  const toggleActions      = makeToggle('actions',      setActionsOpen);
  const toggleDiscover     = makeToggle('discover',     setDiscoverOpen);
  const toggleMotivation   = makeToggle('motivation',   setMotivationOpen);
  const toggleOnboarding   = makeToggle('onboarding',   setOnboardingOpen);
  const toggleCustomize    = makeToggle('customize',    setCustomizeOpen);

  // ── Rest day declaration ──────────────────────────────────────────────────
  // Per-user key (flexyn.<feature>.<userId> per CLAUDE.md) so two users
  // on the same device (family shared phone, sign in/out) don't inherit
  // each other's rest-day state. Falls back to 'anon' before auth resolves
  // so the read on first render still works.
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const restDayKey = `flexyn.restDay.${user?.id || 'anon'}.${todayKey}`;
  const [isRestDay, setIsRestDay] = useState(() => {
    try { return localStorage.getItem(restDayKey) === '1'; } catch { return false; }
  });
  // Re-read when the user resolves (the initial render happens with
  // user undefined; once auth loads we want the per-user value).
  useEffect(() => {
    try { setIsRestDay(localStorage.getItem(restDayKey) === '1'); } catch {}
  }, [restDayKey]);

  // Trophy check — fires once per dashboard mount (per user). The
  // server-side RPC is idempotent (UNIQUE constraint on the trophies
  // table) so re-calling never double-grants. Cheap: one round-trip
  // with COUNT queries, returns the newly-granted IDs which trigger
  // a celebration toast.
  useEffect(() => {
    if (!user?.id) return;
    const t = setTimeout(() => { checkTrophies().catch(() => {}); }, 1500);
    return () => clearTimeout(t);
  }, [user?.id]);
  const handleDeclareRestDay = () => {
    try { localStorage.setItem(restDayKey, '1'); } catch {}
    setIsRestDay(true);
  };
  const handleUndoRestDay = () => {
    try { localStorage.removeItem(restDayKey); } catch {}
    setIsRestDay(false);
  };

  // Load + persist widget order per user.
  //
  // Merge-with-defaults: keep the user's saved positions for ids that
  // still exist, drop unknown/stale ids, and APPEND any new
  // defaultWidgetOrder ids that don't appear in the saved array. The
  // previous code required `defaultWidgetOrder.every(id => parsed.includes(id))`,
  // which meant the very next time we add a new section to
  // defaultWidgetOrder, every existing user's saved order is silently
  // discarded — they lose their customization on first load after the
  // deploy. Merge instead.
  useEffect(() => {
    if (!user?.id) return;
    try {
      // First try user-specific saved order, then fall back to admin-set default
      const userSaved  = localStorage.getItem(`flexyn.dashWidgetOrder.${user.id}`);
      const appDefault = localStorage.getItem('flexyn.dashWidgetOrder.default');
      const raw = userSaved || appDefault;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const known   = parsed.filter(id => defaultWidgetOrder.includes(id));
      const missing = defaultWidgetOrder.filter(id => !known.includes(id));
      const merged  = [...known, ...missing];
      if (merged.length > 0 && merged.join('|') !== defaultWidgetOrder.join('|')) {
        setWidgetOrder(merged);
      }
    } catch {}
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load sectionLayouts on user resolve.
  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = localStorage.getItem(`flexyn.dashSectionLayouts.${user.id}`);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') setSectionLayouts(parsed);
    } catch {}
  }, [user?.id]);

  // Compute rows from widgetOrder + sectionLayouts. Two consecutive
  // 'half' sections share a row; everything else stands alone. A lone
  // 'half' is rendered full-width (degraded — no orphan).
  const dashboardRows = useMemo(() => {
    const result = [];
    let i = 0;
    while (i < widgetOrder.length) {
      const id = widgetOrder[i];
      const layout = sectionLayouts[id] || 'full';
      const nextId = widgetOrder[i + 1];
      const nextLayout = nextId ? (sectionLayouts[nextId] || 'full') : null;
      if (layout === 'half' && nextLayout === 'half') {
        result.push({ rowKey: `${id}+${nextId}`, sections: [id, nextId] });
        i += 2;
      } else {
        result.push({ rowKey: id, sections: [id] });
        i++;
      }
    }
    return result;
  }, [widgetOrder, sectionLayouts]);

  // Reset the customize state — clears widgetOrder + sectionLayouts
  // back to factory defaults. Used by the "Reset" button in edit mode
  // so a user who doesn't like their tweaks can go back without
  // dragging every section around manually.
  // Admin-only: snapshot the current widgetOrder + sectionLayouts and
  // write them to app_layout_defaults so new users (and Reset) read
  // from there. NOT a live sync — re-tap to push a new snapshot.
  const canSetAsDefault = isAppAdmin(user);
  const handleSetAsDefault = async () => {
    const res = await setLayoutDefault('dashboard', widgetOrder, sectionLayouts);
    if (res.ok) {
      toast.success('Saved — new users will see this dashboard layout.');
    } else if (res.error === 'rpc_missing') {
      toast.error('Default-layouts RPC not deployed yet. Apply migration 166.');
    } else if (res.error === 'admin_only') {
      toast.error('Admins only.');
    } else {
      toast.error('Could not save default layout — try again.');
    }
  };

  const handleResetCustomize = () => {
    setWidgetOrder(defaultWidgetOrder);
    setSectionLayouts({
      readiness: 'half',
      league:    'half',
    });
    try {
      localStorage.removeItem(`flexyn.dashWidgetOrder.${user?.id || 'anon'}`);
      localStorage.removeItem(`flexyn.dashSectionLayouts.${user?.id || 'anon'}`);
    } catch { /* ignore */ }
  };

  const handleWidgetReorder = (newRowKeys) => {
    // newRowKeys is a list of rowKeys. Map each back to its sections
    // and flatten to the new widgetOrder. Hotdog pairs travel together
    // (the user moved the row, not the individual section).
    const rowMap = Object.fromEntries(dashboardRows.map(r => [r.rowKey, r.sections]));
    const newOrder = newRowKeys.flatMap(k => rowMap[k] || []);
    setWidgetOrder(newOrder);
    try { localStorage.setItem(`flexyn.dashWidgetOrder.${user?.id || 'anon'}`, JSON.stringify(newOrder)); } catch {}
  };

  // ── Deep-link query params ───────────────────────────────────────────────
  // Layout.jsx long-press shortcuts on the Progress tab navigate to:
  //   /dashboard?logWeight=1  → open LogWeightModal
  //   /dashboard?addPhoto=1   → open ProgressPhotoCapture
  // Without this effect those navigations would land on /dashboard with
  // the modal NEVER opening — the shortcuts looked like they worked
  // (URL changed, page changed) but the promised action silently
  // failed. Strip the params after consuming so a back-nav doesn't
  // reopen the modal on every revisit.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    let changed = false;
    if (params.get('logWeight') === '1') {
      setLogWeightOpen(true);
      params.delete('logWeight');
      changed = true;
    }
    if (params.get('addPhoto') === '1') {
      setPhotoCaptureOpen(true);
      params.delete('addPhoto');
      changed = true;
    }
    if (changed) {
      navigate(
        { pathname: '/dashboard', search: params.toString() ? '?' + params.toString() : '' },
        { replace: true },
      );
    }
  }, [location.search, navigate]);

  useEffect(() => {
    if (showWelcome) {
      // 6 s gives slower readers time to finish the welcome-back message
      const timer = setTimeout(() => setShowWelcome(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [showWelcome]);

  // Audit D-4 — best-effort reconcile pass. Fixes the case where a
  // workout INSERT landed but the increment_user_volume RPC never
  // ran (network died between the two). Idempotent server-side (RPC
  // skips already-credited rows) so it's safe to fire on every mount.
  // Gated to fire once per session via sessionStorage.
  useEffect(() => {
    if (!user?.id) return;
    const sessionKey = 'flexyn.volumeReconciled';
    try { if (sessionStorage.getItem(sessionKey)) return; } catch {}
    let cancelled = false;
    (async () => {
      try {
        const { reconcileMyVolume } = await import('@/lib/data/workouts');
        const res = await reconcileMyVolume();
        if (cancelled) return;
        try { sessionStorage.setItem(sessionKey, '1'); } catch {}
        if (res.ok && res.reconciled > 0) {
          // Quietly refresh the profile so the leaderboard rank picks
          // up the recovered volume on the next render.
          queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.email, queryClient]);

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

  // Lightweight meal-log query for the StreakRescueCard. Only needs the
  // date column — small payload, generous staleTime since the rescue
  // card only checks "logged anything today?" not specific entries.
  // Without this query the streak-rescue card would fire on users who
  // logged a meal today but not a workout. (Audit 08 #1.)
  const { data: rawNutritionLogs = [] } = useQuery({
    queryKey: ['nutritionLogsRecent', user?.email],
    queryFn: () => db.entities.NutritionLog.filter({ created_by: user.email }, '-date', 20),
    enabled: !!user?.email,
    staleTime: 5 * 60_000,
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

  // parseLocalDate so a 'YYYY-MM-DD' DATE column is interpreted in the
  // user's local TZ. Plain `new Date('YYYY-MM-DD')` is UTC midnight,
  // which is the PREVIOUS local day for negative-offset zones — making
  // a workout that happened on the 7-day boundary fall in or out of
  // "this week" depending on which side of midnight UTC the user is on.
  const thisWeekLogs = useMemo(
    () => logs.filter(l => {
      const d = parseLocalDate(l.date);
      return d && isAfter(d, subDays(new Date(), 7));
    }),
    [logs]
  );

  const muscleGroupCount = useMemo(() => {
    const groups = new Set();
    thisWeekLogs.forEach(log => {
      log.exercises?.forEach(ex => {
        if (ex.muscle_group?.trim?.()) groups.add(ex.muscle_group.trim());
        if (ex.muscle_groups?.length) ex.muscle_groups.forEach(g => { if (g && g.trim()) groups.add(g.trim()); });
      });
    });
    return groups.size;
  }, [thisWeekLogs]);

  // ── Last-week stats for trend arrows ──────────────────────────────────────
  const lastWeekLogs = useMemo(
    () => logs.filter(l => {
      const d = parseLocalDate(l.date);
      if (!d) return false;
      return isAfter(d, subDays(new Date(), 14)) && !isAfter(d, subDays(new Date(), 7));
    }),
    [logs]
  );

  const lastWeekWorkoutCount = lastWeekLogs.length;

  const lastWeekMuscleGroupCount = useMemo(() => {
    const groups = new Set();
    lastWeekLogs.forEach(log => {
      log.exercises?.forEach(ex => {
        if (ex.muscle_group?.trim?.()) groups.add(ex.muscle_group.trim());
        if (ex.muscle_groups?.length) ex.muscle_groups.forEach(g => { if (g && g.trim()) groups.add(g.trim()); });
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
  // via the shared parseLocalDate helper.
  const streak = useMemo(() => {
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
    const all = [...logs.map(l => l.date), ...cardioLogs.map(l => l.date)]
      .map(parseLocalDate)
      .filter(d => d && !isNaN(d.getTime()));
    if (all.length === 0) return null;
    return new Date(Math.max(...all.map(d => d.getTime())));
  }, [logs, cardioLogs]);

  // Most-recent meal date for the StreakRescueCard's "logged anything
  // today?" check. Same parseLocalDate convention as workout dates so
  // the late-evening / timezone-edge cases line up.
  const lastMealDate = useMemo(() => {
    const all = rawNutritionLogs
      .map(l => l.date)
      .map(parseLocalDate)
      .filter(d => d && !isNaN(d.getTime()));
    if (all.length === 0) return null;
    return new Date(Math.max(...all.map(d => d.getTime())));
  }, [rawNutritionLogs]);

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

  // Format weekly volume nicely (1.2k for big numbers).
  // Use fmt() for ALL branches so digit grouping + decimal separator
  // respect the user's locale (matches CrewStatsPanel.fmtVolume).
  // Previously: `(n/1000).toFixed(1)` rendered "1.5k" for German users
  // who expect "1,5k", and English digits for Arabic users.
  const formatVolume = (n) => {
    // Guard at entry — a NaN/Infinity from upstream (corrupt set, broken
    // import) would otherwise fall through every branch and render as
    // "NaN" in the stats tile. Treat unrenderable inputs as zero.
    if (!Number.isFinite(n)) return fmt(0);
    if (n >= 10000) return `${fmt(Math.round(n / 1000))}k`;
    if (n >= 1000) return `${fmt(n / 1000, { maximumFractionDigits: 1 })}k`;
    return fmt(n);
  };

  /* ── Section renderer for drag-to-reorder ──────────────────────── */
  const renderDashboardSection = (id) => {
    switch (id) {
      case 'readiness': {
        // In half/hotdog mode the readiness card collapses to a small
        // labeled square that sits next to weekly rank under the hero.
        // We drop the section header so the row can be as compact as
        // possible (the card has its own internal "Readiness" label).
        const isHalf = (sectionLayouts.readiness || 'full') === 'half';
        if (isHalf) {
          return (
            <React.Fragment key="readiness">
              <ErrorBoundary label="ReadinessCard">
                <ReadinessCard logs={logs} compact />
              </ErrorBoundary>
            </React.Fragment>
          );
        }
        return (
          <React.Fragment key="readiness">
            <SectionHeader
              label={tFallback('dashboard.section.readiness', 'Readiness')}
              open={readinessOpen}
              onToggle={toggleReadiness}
              tFallback={tFallback}
            />
            <Collapsible open={readinessOpen}>
              <div className="mb-3">
                <ErrorBoundary label="ReadinessCard"><ReadinessCard logs={logs} /></ErrorBoundary>
              </div>
            </Collapsible>
          </React.Fragment>
        );
      }
      case 'recovery': return (
        <React.Fragment key="recovery">
          {/* Recovery card — mirrors Daily Quests exactly: outer Card
              always visible, the header (icon + label) lives inside,
              widgets are conditionally rendered, chevron at the bottom
              toggles. Hitting collapse no longer wipes the whole
              section like the old SectionHeader + Collapsible
              wrappers did. */}
          <Card className="p-4 md:p-5 bg-gradient-to-br from-blue-200/30 to-blue-100/10 dark:from-blue-500/8 dark:to-blue-500/5 border-blue-200/40 dark:border-blue-500/20 theme-card-accent">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-sky-500" />
              <h3 className="font-heading font-bold text-sm tracking-tight">
                {tFallback('dashboard.section.recovery', 'Recovery')}
              </h3>
            </div>

            {recoveryOpen && (
              <div className="space-y-2">
                <ErrorBoundary label="MacroRingWidget"><MacroRingWidget userProfile={userProfile} /></ErrorBoundary>
                <ErrorBoundary label="CalorieProgressWidget"><CalorieProgressWidget userProfile={userProfile} /></ErrorBoundary>
                <div className="grid grid-cols-2 gap-2">
                  <ErrorBoundary label="HydrationRing"><HydrationRing /></ErrorBoundary>
                  <ErrorBoundary label="MoodLogCard"><MoodLogCard /></ErrorBoundary>
                </div>
                <ErrorBoundary label="StepsLogCard"><StepsLogCard /></ErrorBoundary>
              </div>
            )}

            <button
              type="button"
              onClick={toggleRecovery}
              aria-label={recoveryOpen ? 'Collapse recovery' : 'Expand recovery'}
              aria-expanded={recoveryOpen}
              className="w-full mt-2 -mb-1 flex items-center justify-center py-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-secondary/40 transition-colors"
            >
              {recoveryOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </Card>
        </React.Fragment>
      );
      case 'challenges': return (
        <React.Fragment key="challenges">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
            <ErrorBoundary label="DailyQuestsCard"><DailyQuestsCard /></ErrorBoundary>
          </motion.div>
          {!isRestDay && (
            <div className="mt-2">
              <StreakRescueCard
                streakDays={streak}
                lastWorkoutDate={lastWorkoutDate?.toISOString()}
                lastMealDate={lastMealDate?.toISOString()}
              />
            </div>
          )}
        </React.Fragment>
      );
      case 'chest': return (
        <React.Fragment key="chest">
          <ErrorBoundary label="DailyChestCard"><DailyChestCard /></ErrorBoundary>
        </React.Fragment>
      );
      case 'league': return (
        <React.Fragment key="league">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.10 }} className="h-full">
            <ErrorBoundary label="LeagueCard"><LeagueCard onClick={() => setLeagueModalOpen(true)} /></ErrorBoundary>
          </motion.div>
        </React.Fragment>
      );
      case 'progress': return (
        <React.Fragment key="progress">
          <SectionHeader
            label={tFallback('dashboard.section.progress', 'Your progress')}
            open={progressOpen}
            onToggle={toggleProgress}
            tFallback={tFallback}
          />
          <Collapsible open={progressOpen}>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <StatTile icon={Activity} value={thisWeekLogs.length} label={t('dashboard.stats.thisWeek')} suffix={thisWeekLogs.length === 1 ? t('dashboard.stats.workoutSingular') : t('dashboard.stats.workoutPlural')} delay={0.05} accent trend={workoutTrend} />
              <StatTile icon={Zap} value={formatVolume(weeklyVolume)} label={t('dashboard.stats.volume')} suffix={weightUnit} delay={0.12} />
              <StatTile icon={Target} value={muscleGroupCount} label={t('dashboard.stats.muscles')} suffix={muscleGroupCount === 1 ? t('dashboard.stats.groupSingular') : t('dashboard.stats.groupPlural')} delay={0.19} trend={muscleTrend} />
            </div>
            <div className="mb-2 space-y-2">
              <ErrorBoundary label="GoalsAlmostComplete">
                <GoalsAlmostComplete goals={goals} logs={logs} cardioLogs={cardioLogs} limit={1} compact={false} onOpen={() => setGoalsModalOpen(true)} />
              </ErrorBoundary>
              <ErrorBoundary label="GoalsProgressStrip">
                <GoalsProgressStrip goals={goals} logs={logs} onOpen={() => setGoalsModalOpen(true)} />
              </ErrorBoundary>
            </div>
            <div className="mb-2" data-recap-card>
              <ErrorBoundary label="WeeklyRecap"><WeeklyRecap logs={logs} cardioLogs={cardioLogs} /></ErrorBoundary>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex-1 min-w-[15rem] empty:hidden">
                <ErrorBoundary label="WorkoutSuggestionCard"><WorkoutSuggestionCard logs={logs} cardioLogs={cardioLogs} /></ErrorBoundary>
              </div>
              <div className="flex-1 min-w-[15rem] empty:hidden">
                <ErrorBoundary label="WorkoutMemoryCard"><WorkoutMemoryCard logs={logs} /></ErrorBoundary>
              </div>
            </div>
          </Collapsible>
        </React.Fragment>
      );
      case 'actions': {
        // Single vertical list — top 3 always visible, rest hidden
        // behind a "Show more" toggle to keep the dashboard compact
        // (per the "fit in the palm of her hand" goal).
        const allActions = [
          { key: 'startWorkout',  to: '/workout', icon: Play,         label: t('dashboard.startWorkout'),
            iconBg: 'bg-orange-500/15',  iconColor: 'text-orange-500' },
          { key: 'myWeek',        icon: CalendarDays, label: tFallback('dashboard.myWeek', 'My week'),
            iconBg: 'bg-blue-500/15',    iconColor: 'text-blue-500',
            onClick: () => setWeekModalOpen(true) },
          { key: 'createRegimen', icon: Dumbbell,     label: t('dashboard.createRegimen'),
            iconBg: 'bg-purple-500/15',  iconColor: 'text-purple-500',
            onClick: () => navigate('/workout', { state: { openRegimens: true } }) },
          { key: 'checkProgress', icon: TrendingUp,   label: t('dashboard.checkProgress'),
            iconBg: 'bg-cyan-500/15',    iconColor: 'text-cyan-500',
            onClick: () => { window.scrollTo({ top: 0, behavior: 'auto' }); navigate('/progress'); } },
          { key: 'logMeal',       icon: Apple,        label: t('dashboard.logMeal'),
            iconBg: 'bg-rose-500/15',    iconColor: 'text-rose-500',
            onClick: () => navigate('/nutrition', { state: { openLogMeal: true } }) },
          { key: 'logWeight',     icon: Scale,        label: tFallback('dashboard.logWeight', 'Log weight'),
            iconBg: 'bg-amber-500/15',   iconColor: 'text-amber-500',
            onClick: () => setLogWeightOpen(true) },
          { key: 'addPhoto',      icon: Camera,       label: tFallback('dashboard.addPhoto', 'Add progress photo'),
            iconBg: 'bg-pink-500/15',    iconColor: 'text-pink-500',
            onClick: () => setPhotoCaptureOpen(true) },
        ];
        const visibleActions = actionsExpanded ? allActions : allActions.slice(0, 3);
        const hiddenCount = allActions.length - 3;
        return (
          <React.Fragment key="actions">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.15 }}>
              <div className="flex flex-col gap-2">
                {visibleActions.map((a, i) => (
                  a.to ? (
                    <QuickAction key={a.key} to={a.to} icon={a.icon} label={a.label} delay={0.05 + i * 0.03} iconBg={a.iconBg} iconColor={a.iconColor} />
                  ) : (
                    <QuickAction key={a.key} icon={a.icon} label={a.label} onClick={a.onClick} delay={0.05 + i * 0.03} iconBg={a.iconBg} iconColor={a.iconColor} />
                  )
                ))}
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActionsExpanded(v => !v)}
                    className="mt-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                    aria-expanded={actionsExpanded}
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${actionsExpanded ? 'rotate-180' : ''}`} />
                    {actionsExpanded
                      ? tFallback('dashboard.actions.showLess', 'Show less')
                      : tFallback('dashboard.actions.showMore', `Show ${hiddenCount} more`).replace('{n}', String(hiddenCount))}
                  </button>
                )}
              </div>
            </motion.div>
          </React.Fragment>
        );
      }
      case 'journal': return (
        <React.Fragment key="journal">
          <ErrorBoundary label="JournalWidget">
            <JournalWidget userId={user?.id} userEmail={user?.email} />
          </ErrorBoundary>
        </React.Fragment>
      );
      case 'discover': return (
        <React.Fragment key="discover">
          <ErrorBoundary label="DiscoveryCards">
            <DiscoveryCards
              logs={rawLogs}
              regimens={rawRegimens}
              isLoading={logsLoading || regimensLoading}
            />
          </ErrorBoundary>
        </React.Fragment>
      );
      case 'motivation': return (
        <React.Fragment key="motivation">
          <DailyQuote editMode={editMode} />
        </React.Fragment>
      );
      case 'onboarding': return (
        <React.Fragment key="onboarding">
          <div className="space-y-2">
            <ErrorBoundary label="OnboardingNudgeCard">
              <OnboardingNudgeCard hasWorkouts={rawLogs.length > 0} userEmail={user?.email} />
            </ErrorBoundary>
            <ErrorBoundary label="PushOptInBanner">
              <PushOptInBanner hasWorkouts={rawLogs.length > 0} />
            </ErrorBoundary>
            <ErrorBoundary label="IosInstallBanner">
              <IosInstallBanner />
            </ErrorBoundary>
          </div>
        </React.Fragment>
      );
      case 'customize': return (
        <React.Fragment key="customize">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            <DashboardWidgets logs={logs} goals={goals} isLoading={isLoading} />
          </motion.div>
        </React.Fragment>
      );
      default: return null;
    }
  };

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="px-4 md:px-6 pt-3 md:pt-5 lg:pb-6 max-w-5xl mx-auto"
    >
      {/* ── Stories ──────────────────────────────────────────────
           Pinned to the very top (above the greeting) to maximize
           social engagement — the one card kept out of the priority
           tiering below by product decision. */}
      <StoriesRow
        onViewProfile={(u) =>
          navigate('/hub?profile=' + encodeURIComponent(u.email))
        }
      />

      {/* ═══ TIER 1 · Orient & act ════════════════════════════════ */}

      {/* ── Greeting block ─────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className=""
      >
        <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5">
          {todayLabel}
        </p>
        <div className="flex items-start justify-between gap-2">
          <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight leading-tight flex-1 min-w-0">
            <span className="text-muted-foreground/80">{greeting}</span>
            {firstName && (
              <>
                <span className="text-muted-foreground/80">, </span>
                <span className="text-foreground">{firstName}</span>
              </>
            )}
            <span className="text-primary">.</span>
          </h1>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            {/* Reset-customize — only shown in edit mode. Restores
                the default widgetOrder + sectionLayouts. */}
            {editMode && canSetAsDefault && (
              <button
                type="button"
                onClick={handleSetAsDefault}
                title="Save this layout as the default for all new users"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Set default</span>
              </button>
            )}
            {editMode && (
              <button
                type="button"
                onClick={handleResetCustomize}
                title={tFallback('dashboard.resetCustomize', 'Reset to default')}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{tFallback('dashboard.reset', 'Reset')}</span>
              </button>
            )}
            {/* Rest-day toggle — small left/right switch tucked next to
                Customize home. Only appears on un-worked-out days. */}
            {!hasWorkedOutToday && (
              <button
                type="button"
                role="switch"
                aria-checked={isRestDay}
                onClick={() => isRestDay ? handleUndoRestDay() : handleDeclareRestDay()}
                title={isRestDay
                  ? tFallback('dashboard.restDay.undo', 'Undo rest day')
                  : tFallback('dashboard.restDay.markCta', 'Mark today as a rest day')}
                className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="hidden sm:inline">{tFallback('dashboard.restDay.short', 'Rest')}</span>
                <span
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                    isRestDay ? 'bg-green-500/70' : 'bg-secondary border border-border'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                      isRestDay ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>
            )}
            {editMode && (
              <button
                onClick={() => {
                  try {
                    localStorage.setItem('flexyn.dashWidgetOrder.default', JSON.stringify(widgetOrder));
                    localStorage.setItem('flexyn.dashSectionLayouts.default', JSON.stringify(sectionLayouts));
                  } catch {}
                  toast.success('Layout set as default for new users.');
                }}
                title="Set this layout as the default for all new users"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /><span>Set Default</span>
              </button>
            )}
            <button
              onClick={() => setEditMode(e => !e)}
              title={editMode ? 'Done editing' : 'Customize home'}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                editMode
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground/60 hover:text-foreground hover:bg-secondary'
              }`}
            >
              {editMode ? (
                <><CheckCircle2 className="w-3.5 h-3.5" /><span>Done</span></>
              ) : (
                <LayoutGrid className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

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

      {/* "Continue where you left off" — only renders when there's a
          paused workout in localStorage. Peace-of-mind affordance for
          users interrupted mid-workout. Auto-evicts drafts >24h old
          so it doesn't degrade into "you have nothing to do" noise. */}
      <ResumeWorkoutBanner />

      {/* ── Streak banners — sit between the greeting and the hero so
            the user sees their daily streak the moment they open the
            app. Kept compact via the banners' own min variants. ───── */}
      <div className="mt-1 mb-2 space-y-1">
        <ErrorBoundary label="LoginStreakBanner"><LoginStreakBanner /></ErrorBoundary>
        <ErrorBoundary label="WorkoutStreakBanner"><WorkoutStreakBanner /></ErrorBoundary>
      </div>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <div className="mb-2">
        <HeroCard
          streak={streak}
          hasWorkedOutToday={hasWorkedOutToday}
          daysSinceLast={daysSinceLast}
          logs={logs}
          cardioLogs={cardioLogs}
          goals={goals}
          userProfile={userProfile}
          user={user}
          onPrimary={() => navigate('/workout')}
          navigate={navigate}
          t={t}
          tFallback={tFallback}
        />
      </div>

      {/* ── Repeat-last-workout — single quick action below the hero.
            TodaysPlanCard removed for now (user will reimplement later);
            rest-day moved to a toggle next to the Customize Home button. */}
      <div className="flex flex-wrap items-start gap-2 mb-3 md:mb-4">
        <div className="flex-1 min-w-[15rem] empty:hidden">
          {!hasWorkedOutToday && !isRestDay && logs.length > 0 && (() => {
            // Pick the most-recent log with actual exercises. logs[0] could
            // be an empty-exercises row from a crashed mid-save; repeating
            // it lands the user in an empty workout screen with nothing
            // to repeat. (Audit 08 #13.)
            const last = logs.find(l => Array.isArray(l.exercises) && l.exercises.length > 0);
            if (!last) return null;
            const title = last.regimen_name || tFallback('workout.lastWorkout', 'Last workout');
            return (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 }}
              >
                <button
                  onClick={() => navigate('/workout', { state: { repeatLog: last } })}
                  className="group w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Repeat2 className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-primary">{tFallback('dashboard.repeatLast', 'Repeat last workout')}</p>
                    <p className="text-xs font-heading font-bold leading-tight truncate">{title}</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-primary/60 shrink-0 group-hover:translate-x-0.5 transition-transform rtl:scale-x-[-1]" />
                </button>
              </motion.div>
            );
          })()}
        </div>

      </div>

      {/* ═══ Reorderable rows — each row holds 1 section (hamburger /
              full-width) or 2 sections side-by-side (hotdog / half).
              Edit mode: long-press the drag handle to move a row, tap
              the layout icon to switch between hamburger and hotdog.
              Hotdog pairs travel together when reordered. ═══ */}
      <Reorder.Group axis="y" values={dashboardRows.map(r => r.rowKey)} onReorder={handleWidgetReorder} as="div">
        {dashboardRows.map(row => (
          <Reorder.Item key={row.rowKey} value={row.rowKey} as="div" dragListener={editMode} className={`relative mb-3${editMode ? ' touch-none select-none' : ''}`}>
            {editMode && (
              <div className="flex items-center gap-2 mt-6 mb-1 px-1">
                <GripVertical className="w-4 h-4 text-primary/50 cursor-grab active:cursor-grabbing" />
                {row.sections.map((id, i) => {
                  const layout = sectionLayouts[id] || 'full';
                  const isHalf = layout === 'half';
                  return (
                    <React.Fragment key={id}>
                      {i > 0 && <span className="text-[10px] text-primary/30">+</span>}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleSectionLayout(id); }}
                        onPointerDown={(e) => e.stopPropagation()}
                        title={isHalf
                          ? tFallback('dashboard.layout.toHamburger', 'Stack full-width')
                          : tFallback('dashboard.layout.toHotdog',     'Pair side-by-side')}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-primary/10 text-primary/60 hover:text-primary transition-colors"
                      >
                        {isHalf
                          ? <Columns2 className="w-3 h-3" />
                          : <Rows3    className="w-3 h-3" />}
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em]">
                          {SECTION_LABELS[id]?.(tFallback, t) || id}
                        </span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            <div className={row.sections.length === 2 ? 'flex items-stretch gap-2' : ''}>
              {row.sections.map(id => {
                // Default hotdog = 50/50. Readiness in a hotdog row is
                // a fixed small square (24 = 96px); whichever section
                // it's paired with takes the remaining flex-1 width.
                const widthClass = row.sections.length === 2
                  ? (id === 'readiness' ? 'shrink-0 w-20' : 'flex-1 min-w-0')
                  : '';
                return (
                  <div key={id} className={widthClass}>
                    {renderDashboardSection(id)}
                  </div>
                );
              })}
            </div>
          </Reorder.Item>
        ))}
      </Reorder.Group>

      {/* ── Prestige prompt — only when at max level ───────────── */}
      {isPrestigeEligible(userProfile) && !userProfile.prestige_dismissed && (
        <ErrorBoundary label="PrestigePrompt">
          <PrestigePrompt currentPrestige={userProfile.prestige_level || 0} />
        </ErrorBoundary>
      )}

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

      <RoutineCalendarModal open={weekModalOpen} onClose={() => setWeekModalOpen(false)} />
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
      <div className="mt-2 flex justify-center">
        <SyncStatus dataUpdatedAt={logsUpdatedAt} />
      </div>
    </motion.div>
  );
}