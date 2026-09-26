import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { routerStateWithoutPayload } from '@/lib/goBack';
import { useUrlState } from '@/hooks/useUrlState';
import { filterAfterReset } from '@/lib/accountReset';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import * as nutritionData from '@/lib/data/nutrition';
import * as mealPlans from '@/lib/data/mealPlans';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { rewardWaterLog, WATER_DAILY_CAP_OZ } from '@/lib/waterLogging';
import { toast } from '@/lib/toast';
import { isAppAdmin } from '@/lib/adminRoles';
import { setLayoutDefault } from '@/lib/data/layoutDefaults';
import { Trash2, TrendingUp, Loader2, Droplet, X, Beaker, History, ScanLine, ChevronDown, ChevronUp, Plus, Clock, ChevronRight, ChefHat, Calendar, ListChecks, LayoutGrid, RotateCcw, CheckCircle2, Save, Repeat, Eye, EyeOff, Target, Flashlight, FlashlightOff, GlassWater } from 'lucide-react';
import { WaterBottleIcon } from '@/components/nutrition/NutrientIcon';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { ReorderableRow, DragHandle } from '@/components/dashboard/ReorderableRow';
import MacroNutrientBox from '@/components/nutrition/MacroNutrientBox';
import MineralsVitaminsBox from '@/components/nutrition/MineralsVitaminsBox';
import WaterTracker from '@/components/nutrition/WaterTracker';
import BarcodeResultModal from '@/components/nutrition/BarcodeResultModal';
import BarcodeNotFoundModal from '@/components/nutrition/BarcodeNotFoundModal';
import FoodSearchSheet from '@/components/nutrition/FoodSearchSheet';
import LogMealForm from '@/components/nutrition/LogMealForm';
import NutritionOnboardingModal from '@/components/nutrition/NutritionOnboardingModal';
import MealHistoryModal from '@/components/nutrition/MealHistoryModal';
import NutritionPlansModal from '@/components/nutrition/NutritionPlansModal';
import CalorieCyclingModal from '@/components/nutrition/CalorieCyclingModal';
import { weeklyRunningLoad } from '@/lib/running/fueling';
import {
  shouldAutoOpenNutritionOnboarding,
  markNutritionOnboardingDismissed,
  clearNutritionOnboardingDismissed,
} from '@/lib/nutritionOnboardingGate';
import MealTypePicker, { autoPickMealType } from '@/components/nutrition/MealTypePicker';
import CalorieTopBar from '@/components/nutrition/CalorieTopBar';
import RecipesHubModal from '@/components/nutrition/RecipesHubModal';
import PhotoMealResultModal from '@/components/nutrition/PhotoMealResultModal';
import FoodPhotoCaptureModal from '@/components/nutrition/FoodPhotoCaptureModal';
import PhotoAiLimitModal from '@/components/nutrition/PhotoAiLimitModal';
import { getPhotoAiUsedToday, PHOTO_AI_DAILY_CAP } from '@/lib/data/photoAiQuota';
import WeeklyMealPlannerModal from '@/components/nutrition/WeeklyMealPlannerModal';
import FastingTrackerCard from '@/components/nutrition/FastingTrackerCard';
import ErrorBoundary from '@/components/ErrorBoundary';
import HeroPager from '@/components/HeroPager';
import { HERO_SLIDE_GUTTER, HERO_SLIDE_MIN_H, heroTintGradient, heroWatermarkStyle, heroSlideAccent } from '@/lib/heroChrome';
import { reportError } from '@/lib/reportError';
import { fireFirstMealCelebration } from '@/lib/firstMealCelebration';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { lookupBarcode } from '@/lib/foodLookup';
import { buildBarcodeHints } from '@/lib/barcodeHints';
import { decodeCanvasMultiOrientation } from '@/lib/barcodeScan';
import { recognizeMealPhoto } from '@/lib/data/photoMealRecognition';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
// @zxing/browser is ~80 KB gzip. Most Nutrition sessions never open
// the barcode scanner — so we dynamic-import it inside the scan
// handler instead of pulling it into the entry chunk.
import { useLanguage } from '@/lib/LanguageContext';
import { enT } from '@/lib/translatorArg';
import { useSettings } from '@/lib/SettingsContext';
import { useNumberFormatter } from '@/lib/intl';
import { useLocation } from 'react-router-dom';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
// Water-entry helpers live in lib so this page and MealHistoryModal cannot
// disagree about what counts as a glass — they used to, and history showed
// every pre-migration-006 water row as a "Water — 0 cal" meal.
import { isWaterEntry, waterEntryOz, waterFoodName } from '@/lib/waterEntries';
import { makeDuplicateFilter } from '@/lib/submitDedupe';


/* ──────────────────────────────────────────────────────────────────
 *  NutritionShortcutsCarousel — mirrors the Progress carousel pattern.
 *  5 slides, each one a feature shortcut:
 *    1. Scan Food (barcode)  ← surfaced first per user request
 *    2. Recipes
 *    3. Meal History
 *    4. Nutrition Plans
 *    5. Weekly Planner
 *  Each slide has a big translucent emoji on the right, a tinted
 *  gradient mesh matching its color, and a CTA button.
 * ────────────────────────────────────────────────────────────────── */

function NutritionShortcutsCarousel({ onScan, onRecipes, onHistory, onPlans, onPlanner }) {
  const { tFallback } = useLanguage();
  const slides = [
    {
      id: 'scan',
      icon: ScanLine,
      emoji: '📷',
      // One hue per slide again, and `color` now drives the whole band —
      // the falloff tint, the 2px identity rule, the icon chip and the
      // dots — exactly as it does on the Dashboard hero.
      //
      // It was a private five-hue rotation (orange, emerald, blue,
      // purple, pink), then flattened to all-orange to stop the sprawl.
      // The rotation is back but drawn only from the four budget tokens
      // in CLAUDE.md, so nothing here invents a colour: primary,
      // success, info, destructive, then back to primary for the fifth.
      color: 'var(--primary)',
      kicker: 'Scan a barcode',
      title: tFallback('nutrition.hero.scan.title', 'Scan Food'),
      tip: 'Snap any package and we autofill macros, calories, and serving size. Fastest way to log.',
      ctaLabel: 'Open scanner',
      onCta: onScan,
    },
    {
      id: 'recipes',
      icon: ChefHat,
      emoji: '🥘',
      color: 'var(--success)',
      kicker: 'Recipes',
      title: 'Recipes',
      tip: 'Build a recipe once, log it in one tap forever. Macros computed from your ingredient list.',
      ctaLabel: 'Open recipes',
      onCta: onRecipes,
    },
    {
      id: 'history',
      icon: History,
      emoji: '📖',
      color: 'var(--info)',
      kicker: 'Meal History',
      title: 'Meal History',
      tip: 'Every meal you\'ve logged. Search it, filter it, and log a past meal again in two taps.',
      ctaLabel: 'Browse history',
      onCta: onHistory,
    },
    {
      id: 'plans',
      icon: ListChecks,
      emoji: '📋',
      color: 'var(--destructive)',
      kicker: 'Nutrition Plans',
      title: 'Nutrition Plans',
      tip: 'Macro splits for cut, bulk, recomp, keto and maintenance. Apply one and its meals land on your day.',
      ctaLabel: 'See plans',
      onCta: onPlans,
    },
    {
      id: 'planner',
      icon: Calendar,
      emoji: '📅',
      color: 'var(--primary)',
      kicker: 'Weekly Planner',
      title: 'Weekly Planner',
      tip: 'Plan a day at a time and watch it add up. Every meal you drop in counts toward that day\'s target.',
      // Not "Plan the week" — that label now belongs to the Dashboard hero
      // CTA that opens the My Week routine calendar, and two buttons with
      // the same words opening different planners is a coin flip for the
      // user. This one plans meals; the sibling labels ("Open scanner",
      // "Browse history", "See plans") are verb + noun for the same reason.
      ctaLabel: 'Plan meals',
      onCta: onPlanner,
    },
  ];

  const pagerRef = useRef(null);
  // The band paints the LIVE slide's accent, exactly as the Dashboard hero
  // does. Seeded from slide 0 so the first paint is already correct.
  const [accent, setAccent] = useState(() => heroSlideAccent(slides[0]));
  const handleIndexChange = useCallback((_i, slide) => {
    setAccent(heroSlideAccent(slide));
  }, []);

  const multi = slides.length > 1;

  return (
    <div className="relative mb-3">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-muted dark:bg-card text-foreground touch-pan-y">
        {/* Accent tint + 2px identity rule — the Dashboard band's chrome.
            Replaces the two blurred radial blobs (one of which animated on
            a 9s loop forever); see the note on ProgressCarousel and
            CLAUDE.md's "no gradient as decoration". */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: heroTintGradient(accent) }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5 pointer-events-none"
          style={{ background: `hsl(${accent})` }}
        />

        {/* No floating next-slide arrow — see the note in Progress.jsx.
            It was the one control that could collide with the watermark,
            on a surface whose interaction is a swipe. */}

        <div className={`relative p-4 md:p-5 ${HERO_SLIDE_MIN_H}`}>
          <HeroPager
            ref={pagerRef}
            slides={slides}
            renderSlide={(slide, opts) => renderShortcutSlide(slide, opts, tFallback)}
            onIndexChange={handleIndexChange}
            dotsClassName="mt-4"
            dotLabel={(i) => `Slide ${i + 1}`}
          />
        </div>
      </div>
    </div>
  );
}

/* One shortcut slide, in the hero's shared layout: corner watermark, icon
   chip + kicker, title, the line of context, then the CTA pill. The pill
   sits inside the pager's track and that is safe — Framer only claims a
   gesture past its drag threshold, so a tap still reaches the button. */
function renderShortcutSlide(slide, { count = 1 } = {}, tFallback = enT) {
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
          {tFallback(`nutrition.hero.${slide.id}.kicker`, slide.kicker)}
        </span>
      </div>
      {/* No AnimatePresence — the track is the transition. See the note in
          renderProgressSlide (src/pages/Progress.jsx). */}
      <div className="min-w-0">
        <h3
          className="font-heading font-bold leading-[1.05] tracking-tight text-foreground break-words pe-20"
          style={{ fontSize: 'clamp(1.6rem, 5.5vw, 2.25rem)' }}
        >
          {tFallback(`nutrition.hero.${slide.id}.title`, slide.title)}
        </h3>
        <p className="text-sm text-foreground/60 max-w-[36ch] leading-relaxed mt-3">
          {tFallback(`nutrition.hero.${slide.id}.tip`, slide.tip)}
        </p>
        {/* The pill takes the SLIDE's accent, not `bg-primary/10` like the
            Dashboard's. The dashboard hero can hold primary because its
            band is usually orange anyway; here the accent turns over on
            every slide, and an orange pill on the green Recipes card or
            the red Plans card is the one element that doesn't belong to
            the card it sits on. Text stays --foreground rather than the
            accent so contrast doesn't move with the hue. */}
        <button
          type="button"
          onClick={slide.onCta}
          style={{ background: `hsl(${heroSlideAccent(slide)} / 0.18)` }}
          className="inline-flex items-center gap-1 mt-3 px-3 py-1.5 rounded-full backdrop-blur-sm text-caption font-semibold text-foreground transition-opacity hover:opacity-80 active:opacity-80"
        >
          {tFallback(`nutrition.hero.${slide.id}.cta`, slide.ctaLabel)}
          <ChevronRight className="w-3.5 h-3.5 rtl:scale-x-[-1]" />
        </button>
      </div>
    </div>
  );
}

// Stable empty defaults. React Query returns `data: undefined` while a
// query is disabled or loading; a `= []` / `= {}` literal default would
// hand back a fresh reference every render, churning the identity of the
// `logs` useMemo and firing the `setEntries(logs)` effect on every render
// ("Maximum update depth exceeded" on the Nutrition tab). Sharing one
// frozen constant keeps the reference stable until real data arrives.
const EMPTY_LOGS = Object.freeze([]);
const EMPTY_PROFILE = Object.freeze({});

export default function Nutrition() {
  const { t, tFallback } = useLanguage();
  const { calorieCyclingEnabled } = useSettings();
  const fmt = useNumberFormatter();
  const location = useLocation();

  const [openLogMeal, setOpenLogMeal] = useState(false);

  // Two ways to land here with "open the meal logger":
  //   1. router-state — Dashboard.jsx uses navigate('/nutrition', { state: { openLogMeal: true } })
  //   2. query-string — questCatalog.js routes meal-logging quests to /nutrition?openLogMeal=1
  // Both are supported. Query-string is friendlier (survives reload, shareable);
  // router-state is what Dashboard already uses and we don't want to churn it.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('openLogMeal') === '1';
    const fromState = !!location?.state?.openLogMeal;
    if (!fromQuery && !fromState) return;
    setOpenLogMeal(true);
    // Clear both. For the query string we strip the param so reload
    // doesn't re-fire; for state we wipe history.state. replaceState
    // here keeps the URL stable (no flash of a different route).
    if (fromQuery) {
      params.delete('openLogMeal');
      const search = params.toString();
      window.history.replaceState(routerStateWithoutPayload(), document.title, '/nutrition' + (search ? '?' + search : ''));
    } else {
      window.history.replaceState(routerStateWithoutPayload(), document.title);
    }
    // Scroll to the form after a tick so the animation has started
    setTimeout(() => {
      const el = document.getElementById('log-meal-form');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, [location?.state?.openLogMeal, location.search]);

  // Deep-link from the AI Coach running plan ("Fuel your training") opens the
  // Nutrition Plans sheet, where the training-fuel banner lives.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('plans') !== '1') return;
    setShowNutritionPlans(true);
    params.delete('plans');
    const search = params.toString();
    window.history.replaceState(routerStateWithoutPayload(), document.title, '/nutrition' + (search ? '?' + search : ''));
  }, [location.search]);
  // Date is always today's local date — Nutrition no longer supports
  // past-day viewing. Held in state with a minute tick (same pattern
  // as MoodLogCard) instead of a per-mount const: a PWA left open
  // across midnight previously kept yesterday's date, so every query
  // key, meal save, and water log landed on the wrong day. The tick
  // advances `date` on the first render after midnight, which also
  // re-keys the nutritionLogs query automatically.
  const computeTodayKey = () => format(new Date(), 'yyyy-MM-dd');
  const [date, setDate] = useState(computeTodayKey);
  useEffect(() => {
    const id = setInterval(() => {
      const next = computeTodayKey();
      setDate(prev => (prev === next ? prev : next));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Reorderable sections — same mechanism as Dashboard customize.
  // Defaults to the order shown when the user opens a fresh Nutrition
  // page; can be dragged in edit mode and persists to localStorage
  // per-user. CalorieTopBar is intentionally NOT in this list — it
  // stays pinned at the top as the headline.
  // 'shortcuts' carousel is pinned above CalorieTopBar (not reorderable)
  // 'portionGuide' is its own reorderable section
  const DEFAULT_NUTRITION_ORDER = ['logForm', 'tabs', 'water', 'fasting', 'meals'];
  const [editMode, setEditMode] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState(DEFAULT_NUTRITION_ORDER);
  // Sections the user has hidden (e.g. Intermittent Fasting). Persisted
  // per-user; hidden rows are skipped in normal mode but reappear (dimmed,
  // with a restore button) in customize mode.
  const [hiddenWidgets, setHiddenWidgets] = useState([]);
  const [showScanner, setShowScanner] = useState(false);
  const [showFoodSearch, setShowFoodSearch] = useState(false);
  // The barcode scanner is a full-screen overlay on a long scrolling page —
  // hold the page behind it. See @/lib/scrollLock.
  useBodyScrollLock(showScanner);
  const [scannerStatus, setScannerStatus] = useState('idle');
  const [scannerError, setScannerError] = useState(null);
  const [scannedProduct, setScannedProduct] = useState(null);
  const [notFoundBarcode, setNotFoundBarcode] = useState(null);
  // Torch/flashlight — only offered when the active camera track supports it
  // (Android Chrome yes; desktop + iOS Safari no). Helps cut glare on shiny
  // packaging like a metallic seltzer can.
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Scan history — persisted to localStorage; updated every time a barcode resolves.
  // Per-user namespace per CLAUDE.md `flexyn.<feature>.<userId>` convention.
  // Previously used the bare key `flexyn_scan_history`, which meant two
  // users on the same device saw each other's scan history (privacy
  // leak on shared phones / family iPads). Wave 57 caught this.
  // Lazy-init to empty; a useEffect (below the user destructure) hydrates
  // once user.id is known.
  const [scanHistory, setScanHistory] = useState([]);
  const [showScanHistory, setShowScanHistory] = useState(false);
  const [showNutritionPlans, setShowNutritionPlans] = useState(false);
  const [showMealHistory, setShowMealHistory] = useState(false);

  // In the URL (?nutrients=) so the tab bar and a refresh keep your place.
  const [nutritionTab, setNutritionTab] = useUrlState('nutrients', 'macros', ['macros', 'vitamins']);
  const [entries, setEntries] = useState([]);
  // waterOz is derived from persisted logs
  const [waterUnit, setWaterUnit] = useState('oz');
  const [customBottles, setCustomBottles] = useState(() => {
    // Per-user persistence so bottles survive refresh and across sessions
    try {
      const raw = localStorage.getItem('flexyn.customBottles.default');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  // Selected meal context for the next log. Auto-picks from local
  // clock on mount so the user doesn't have to choose mid-day; can
  // be overridden via MealTypePicker.
  const [mealType, setMealType] = useState(() => autoPickMealType());
  const [showRecipes, setShowRecipes] = useState(false);
  const [showWeeklyPlanner, setShowWeeklyPlanner] = useState(false);
  // Photo-AI meal recognition state — `photoInputRef` is the hidden
  // <input type="file"> behind the "Photo-AI" button. `photoRecognizing`
  // shows a spinner on the button while the Edge Function round-trips.
  const photoInputRef = useRef(null);
  // Synchronous double-submit guard for the water + meal log buttons.
  // saveMutation.isPending is updated asynchronously after the mutation
  // starts, so two clicks within ~50ms can both fire before React
  // re-renders with `disabled`. This ref flips synchronously inside
  // the click handler. (Audit 11 #7.)
  const submitInFlightRef = useRef(false);
  const guardSubmit = (fn) => {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    try { fn(); } finally {
      // Re-arm after the mutation has had a chance to flip isPending.
      // Mutation onSettled also clears in case the mutation completes
      // before this timeout fires.
      setTimeout(() => { submitInFlightRef.current = false; }, 400);
    }
  };
  const [photoRecognizing, setPhotoRecognizing] = useState(false);
  // Guided in-app camera for Photo-AI (framing overlay) — the primary capture
  // entry; the hidden file input is the "choose from library" fallback.
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  // Out-of-scans upsell: { used, cap } when the daily Photo-AI allotment is
  // spent, null otherwise. `purchasingUnlimited` guards the IAP button.
  const [photoLimit, setPhotoLimit] = useState(null);
  const [purchasingUnlimited, setPurchasingUnlimited] = useState(false);
  // Photo-AI result pop-out — the recognized meal + the photo the user took.
  const [showPhotoResult, setShowPhotoResult] = useState(false);
  const [photoResult, setPhotoResult] = useState(null);
  const [photoImageUrl, setPhotoImageUrl] = useState(null);
  // The exact File the user picked — held so we can upload it to storage on
  // save (the blob: preview URL doesn't survive a reload / can't be persisted).
  const photoFileRef = useRef(null);
  // Read-only detail view for re-opening an already-saved meal (image + metrics).
  // { result, imageUrl } shaped like a recognition result so PhotoMealResultModal
  // can render it directly.
  const [mealDetail, setMealDetail] = useState(null);
  const [newEntry, setNewEntry] = useState({
    food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '',
    sodium_mg: '', fiber_g: '', sugar_g: '', cholesterol_mg: '',
    iron_mg: '', magnesium_mg: '', calcium_mg: '', potassium_mg: '',
    vitamin_a_iu: '', vitamin_c_mg: '', vitamin_d_iu: '', vitamin_b12_mcg: ''
  });
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);        // the getUserMedia MediaStream
  const scanLoopRef = useRef(null);      // setInterval id for the frame-decode loop
  const scanCanvasRef = useRef(null);    // offscreen canvas frames are drawn to
  const videoTrackRef = useRef(null);    // active video track (for torch)
  const lastBarcodeRef = useRef(null);
  // Set by stopScanner/unmount so an in-flight startScanner (which has
  // several awaits before the stream is assigned) can tell the user
  // already closed and tear down the just-created camera stream
  // instead of leaving it running with no owner (camera light stuck on).
  const scanCancelledRef = useRef(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Re-key custom bottles to the real user id once auth resolves,
  // and persist on every change going forward.
  useEffect(() => {
    if (!user?.id) return;
    const key = `flexyn.customBottles.${user.id}`;
    // Migrate from the default key if present
    const defaultRaw = localStorage.getItem('flexyn.customBottles.default');
    if (defaultRaw) {
      try { localStorage.setItem(key, defaultRaw); } catch {}
      localStorage.removeItem('flexyn.customBottles.default');
      try { setCustomBottles(JSON.parse(defaultRaw)); } catch {}
    } else {
      try {
        const saved = localStorage.getItem(key);
        if (saved) setCustomBottles(JSON.parse(saved));
      } catch {}
    }
  }, [user?.id]);

  // Persist bottles on every change (user.id known at this point)
  useEffect(() => {
    if (!user?.id) return;
    try { localStorage.setItem(`flexyn.customBottles.${user.id}`, JSON.stringify(customBottles)); } catch {}
  }, [customBottles, user?.id]);

  // Load saved widget order on user resolve.
  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = localStorage.getItem(`flexyn.nutritionWidgetOrder.${user.id}`);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      const known   = parsed.filter(id => DEFAULT_NUTRITION_ORDER.includes(id));
      const missing = DEFAULT_NUTRITION_ORDER.filter(id => !known.includes(id));
      const merged  = [...known, ...missing];
      if (merged.length > 0 && merged.join('|') !== DEFAULT_NUTRITION_ORDER.join('|')) {
        setWidgetOrder(merged);
      }
    } catch { /* ignore */ }
    // Hidden sections
    try {
      const savedHidden = localStorage.getItem(`flexyn.nutritionHidden.${user.id}`);
      if (savedHidden) {
        const parsedHidden = JSON.parse(savedHidden);
        if (Array.isArray(parsedHidden)) {
          setHiddenWidgets(parsedHidden.filter(id => DEFAULT_NUTRITION_ORDER.includes(id)));
        }
      }
    } catch { /* ignore */ }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReorder = (newOrder) => {
    setWidgetOrder(newOrder);
    try { localStorage.setItem(`flexyn.nutritionWidgetOrder.${user?.id || 'anon'}`, JSON.stringify(newOrder)); } catch { /* ignore */ }
  };
  const persistHidden = (next) => {
    try { localStorage.setItem(`flexyn.nutritionHidden.${user?.id || 'anon'}`, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const hideWidget = (id) => {
    setHiddenWidgets(prev => { const next = prev.includes(id) ? prev : [...prev, id]; persistHidden(next); return next; });
  };
  const showWidget = (id) => {
    setHiddenWidgets(prev => { const next = prev.filter(x => x !== id); persistHidden(next); return next; });
  };
  const handleResetOrder = () => {
    setWidgetOrder(DEFAULT_NUTRITION_ORDER);
    setHiddenWidgets([]);
    try { localStorage.removeItem(`flexyn.nutritionWidgetOrder.${user?.id || 'anon'}`); } catch { /* ignore */ }
    try { localStorage.removeItem(`flexyn.nutritionHidden.${user?.id || 'anon'}`); } catch { /* ignore */ }
  };
  // Hidden sections keep their slot in both modes. Normal mode renders a
  // compact "Show …" stub in place (a discoverable, one-tap restore);
  // customize mode shows the section dimmed with a Show button in its
  // drag header. Nothing is silently dropped, so a hidden section is
  // always recoverable without hunting through the customize toggle.
  const renderOrder = widgetOrder;
  // Admin: snapshot current widgetOrder as the default for new users.
  const canSetAsDefault = isAppAdmin(user);
  const handleSetAsDefault = async () => {
    const res = await setLayoutDefault('nutrition', widgetOrder, null);
    if (res.ok) {
      toast.success(tFallback('nutrition.layoutDefaultSaved', 'Saved. New users will see this nutrition layout.'));
    } else if (res.error === 'rpc_missing') {
      toast.error(tFallback('nutrition.layoutMigrationMissing', 'Default-layouts RPC not deployed yet. Apply migration 166.'));
    } else if (res.error === 'admin_only') {
      toast.error(tFallback('workout.adminsOnly', 'Admins only.'));
    } else {
      toast.error(tFallback('nutrition.layoutDefaultFailed', 'Could not save default layout. Try again.'));
    }
  };

  const { data: userProfile = EMPTY_PROFILE } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email
  });

  // Training-load fuel: estimate the weekly running load from the user's saved
  // regimens (only when the Plans sheet is open, to keep the page light) so the
  // diet plan can be tuned around what they're actually training. Feeds the
  // "Fuel your training" banner in NutritionPlansModal.
  const { data: regimensForFuel = [] } = useQuery({
    queryKey: ['regimens', user?.email],
    queryFn: () => db.entities.Regimen.filter({ created_by: user.email }, '-created_date', 50),
    enabled: !!user?.email && showNutritionPlans,
  });
  const trainingFuel = useMemo(() => {
    const cardio = (regimensForFuel || []).flatMap(r => (r.exercises || []).filter(e => e?.kind === 'cardio'));
    return weeklyRunningLoad(cardio, Number(userProfile?.weight_lbs) || 165);
  }, [regimensForFuel, userProfile?.weight_lbs]);

  const [showGoalsOnboarding, setShowGoalsOnboarding] = useState(false);
  const [goalsModalManuallyOpened, setGoalsModalManuallyOpened] = useState(false);

  // Per-user localStorage keys (CLAUDE.md namespace convention).
  // Fall back to 'anon' before sign-in resolves so we don't error on
  // the read; the real user-keyed bucket takes over once auth lands.
  const scanHistoryKey = `flexyn.scanHistory.${user?.id || 'anon'}`;
  // The nutrition-onboarding keys (completed / dismissed) are owned by
  // `@/lib/nutritionOnboardingGate` — don't rebuild them inline here.

  const pushToScanHistory = (product) => {
    setScanHistory(prev => {
      // Dedupe by name, keep most recent, cap at 20
      const next = [
        { ...product, _histId: Date.now(), _scannedAt: new Date().toISOString() },
        ...prev.filter(h => h.name !== product.name),
      ].slice(0, 20);
      try { localStorage.setItem(scanHistoryKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Hydrate per-user scan history once user.id is known. Also migrates
  // any legacy un-namespaced `flexyn_scan_history` value over so a
  // single user upgrading from a stale build doesn't lose their list.
  // The legacy key is then deleted so a second user on the same device
  // doesn't pick it up.
  useEffect(() => {
    if (!user?.id) return;
    try {
      let raw = localStorage.getItem(scanHistoryKey);
      if (!raw) {
        const legacy = localStorage.getItem('flexyn_scan_history');
        if (legacy) {
          localStorage.setItem(scanHistoryKey, legacy);
          localStorage.removeItem('flexyn_scan_history');
          raw = legacy;
        }
      }
      if (raw) setScanHistory(JSON.parse(raw));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Auto-open onboarding the first time the user lands on the Nutrition page,
  // but only after the user profile has loaded so we don't flash the modal at
  // users who already onboarded. All the gating rules live in
  // `@/lib/nutritionOnboardingGate` so they're unit-testable — including the
  // session dismissal that makes ONE close stick.
  useEffect(() => {
    if (shouldAutoOpenNutritionOnboarding({
      userEmail: user?.email,
      userId: user?.id,
      userProfile,
      manuallyOpened: goalsModalManuallyOpened,
    })) {
      setShowGoalsOnboarding(true);
    }
  }, [user?.email, user?.id, userProfile, goalsModalManuallyOpened]);

  // Finished (or explicitly skipped) — the modal has already persisted
  // completion, so just close and refresh the profile.
  const handleOnboardingComplete = () => {
    setShowGoalsOnboarding(false);
    setGoalsModalManuallyOpened(false);
    clearNutritionOnboardingDismissed(user?.id);
    queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
  };

  // Closed via X / Esc / backdrop WITHOUT entering goals. Record a
  // session-scoped dismissal — distinct from the completion flag, so the
  // user is NOT falsely marked as onboarded (NutritionPlansPanel still
  // shows its gate, and they get prompted again next session) but the
  // wizard stays shut for the rest of this one.
  const handleOnboardingDismiss = () => {
    markNutritionOnboardingDismissed(user?.id);
    setShowGoalsOnboarding(false);
    setGoalsModalManuallyOpened(false);
  };

  const openGoalsEditor = () => {
    clearNutritionOnboardingDismissed(user?.id);
    setGoalsModalManuallyOpened(true);
    setShowGoalsOnboarding(true);
  };

  // Launched from the Nutrition Plans gate when the user hasn't completed
  // nutrition onboarding yet — close the plan surfaces and open setup.
  // Clearing the dismissal is what keeps this entry point working after a
  // user has already waved the auto-prompt away.
  const startNutritionOnboarding = () => {
    setShowNutritionPlans(false);
    setShowWeeklyPlanner(false);
    clearNutritionOnboardingDismissed(user?.id);
    setGoalsModalManuallyOpened(true);
    setShowGoalsOnboarding(true);
  };

  const { data: rawLogs = EMPTY_LOGS, isLoading: logsLoading } = useQuery({
    queryKey: ['nutritionLogs', user?.email, date],
    queryFn: () => db.entities.NutritionLog.filter({ created_by: user.email, date }),
    enabled: !!user?.email
  });
  // Also wait for the profile so macro goals render correctly on first paint
  const isLoading = logsLoading || (!!user?.email && Object.keys(userProfile).length === 0);

  const logs = useMemo(() => filterAfterReset(rawLogs, userProfile), [rawLogs, userProfile]);

  // Derive water data from logs
  const waterEntries = logs.filter(isWaterEntry);
  const waterOz = waterEntries.reduce((sum, e) => sum + waterEntryOz(e), 0);

  // Always sync — ensures carousel clears on delete and updates after refetch
  useEffect(() => {
    setEntries(logs);
  }, [logs]);

  const saveMutation = useMutation({
    // Strip non-DB fields (leading underscore) so they don't trigger
    // PostgREST strip-and-retry round-trips on save. `_planner_mirror` is a
    // food_snapshot consumed in onSuccess (needs the new row's id), not a
    // column.
    mutationFn: ({ _via_barcode: _vb, _planner_mirror: _pm, ...data } = {}) => nutritionData.create(data),
    onMutate: async (variables) => {
      if (!isWaterEntry(variables)) return;
      const qKey = ['nutritionLogs', user?.email, date];
      await queryClient.cancelQueries({ queryKey: qKey });
      const previousLogs = queryClient.getQueryData(qKey);
      queryClient.setQueryData(qKey, (old) => [
        ...(old || []),
        {
          id: `optimistic-${Date.now()}`,
          date,
          food_name: variables.food_name,
          water_oz: waterEntryOz(variables),
          calories: 0,
          created_by: user?.email,
          created_at: new Date().toISOString(),
        },
      ]);
      return { previousLogs };
    },
    onSuccess: async (createdRow, variables) => {
      queryClient.invalidateQueries({ queryKey: ['nutritionLogs', user?.email, date] });
      // History keeps its own 500-row query. It normally refetches on open, but
      // "Log this again" fires while that sheet is already mounted, so without
      // this the meal lands and the list you are looking at does not move.
      queryClient.invalidateQueries({ queryKey: ['nutritionHistory', user?.email] });

      // Mirror a photo-logged meal into the weekly planner slot so it shows
      // in its date+meal-type square on the Plans page. Best-effort; stores
      // the new log's id on the snapshot so removing the plan can also un-log
      // the diary entry. Fire-and-forget — never blocks the save.
      if (variables?._planner_mirror && user?.id) {
        mealPlans.upsert({
          user,
          planDate: variables.date || date,
          mealType: variables.meal_type || mealType,
          foodSnapshot: { ...variables._planner_mirror, log_id: createdRow?.id || null },
        })
          .then(() => queryClient.invalidateQueries({ queryKey: ['mealPlans', user?.id] }))
          .catch((mirrorErr) => reportError(mirrorErr, { feature: 'nutrition.planner-mirror', level: 'warning', userEmail: user?.email }));
      }

      if (isWaterEntry(variables)) {
        // XP, the quest tick and the profile refresh are shared with the +
        // sheet (lib/waterLogging.js) so both ways of logging water pay out
        // the same. No toast on water: the hydration ring filling is the
        // confirmation, and a toast per glass was noise.
        rewardWaterLog({ user, date, oz: waterEntryOz(variables), queryClient });
      } else {
        setNewEntry({ food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '', sodium_mg: '', fiber_g: '', sugar_g: '', cholesterol_mg: '', iron_mg: '', magnesium_mg: '', calcium_mg: '', potassium_mg: '', vitamin_a_iu: '', vitamin_c_mg: '', vitamin_d_iu: '', vitamin_b12_mcg: '' });

        // First-meal milestone — count lifetime non-water entries.
        // count === 1 means this save is the first MEAL the user has
        // ever logged on this account. Fire the celebration; otherwise
        // fall through to the regular toast.
        //
        // The count is async (separate HEAD round-trip) so this branch
        // is async too. Errors here must NOT block the existing quest
        // credit + toast — a failed first-meal check is a missed
        // celebration, not a broken save. Reported via reportError.
        let firedFirst = false;
        try {
          const { count, error } = await safeSelect({
            columns: ['id'],
            build: (cols) => supabase
              .from('nutrition_logs')
              .select(cols, { count: 'exact', head: true })
              .eq('created_by', user?.email)
              .not('food_name', 'like', 'Water%'),
          });
          if (!error && count === 1) {
            fireFirstMealCelebration({
              t: tFallback,
              mealName: variables?.food_name,
              calories: typeof variables?.calories === 'number' ? variables.calories : null,
              userEmail: user?.email,
            });
            firedFirst = true;
          }
        } catch (countErr) {
          reportError(countErr, { feature: 'nutrition.first-meal-check', level: 'warning', userEmail: user?.email });
        }
        if (!firedFirst) {
          toast.success(t('nutrition.toast.mealLogged'));
        }

        quests.recordAction(user, ACTION_TYPES.MEAL_LOGGED, 1)
          .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
          .catch(() => {});

        // Server-side achievement evaluation (meal-count milestones, log
        // streak, barcode-scanner unlock, daily-protein-goal unlock).
        // Fire-and-forget — a failed RPC just delays the achievement
        // unlock, doesn't break the save.
        try {
          const proteinG  = Number(variables?.protein_g) || 0;
          const proteinTarget = Number(userProfile?.daily_protein_goal_g) || 0;
          // Check whether today's cumulative protein crosses the goal
          // post-save. We sum from the optimistic logs (includes the
          // entry we just added).
          const todayProtein = (logs || []).reduce(
            (sum, l) => sum + (Number(l.protein_g ?? l.protein) || 0), 0,
          ) + proteinG;
          db.functions.invoke('updateUserXpAndAchievements', {
            xp_gained: 5,
            action_type: 'meal_logged',
            action_data: {
              date,
              viaBarcode:      !!variables?._via_barcode,
              proteinGoalHit:  proteinTarget > 0 && todayProtein >= proteinTarget,
            },
          }).catch(() => {});
        } catch { /* non-blocking */ }
      }
    },
    onError: (err, variables, context) => {
      if (context?.previousLogs !== undefined) {
        queryClient.setQueryData(['nutritionLogs', user?.email, date], context.previousLogs);
      }
      reportError(err, { feature: 'nutrition.save', userEmail: user?.email });
      // Surface the underlying error so beta testers can report
      // something specific ("Cannot save any food item" in the
      // screenshot was the catch-all message; the actual cause —
      // profanity hit, schema drift, network timeout — was hidden).
      const reason = err?.code === 'PROFANITY'
        ? 'That name has a word our filter blocks — try rephrasing.'
        : err?.message
          ? `${t('nutrition.toast.saveError')} (${err.message})`
          : t('nutrition.toast.saveError');
      toast.error(reason);
    },
    onSettled: () => {
      // Clear the synchronous double-submit guard regardless of
      // success/failure so a legit retry after a network error
      // works without a 400ms wait.
      submitInFlightRef.current = false;
    },
  });

  // Content-level double-submit guard. The mechanism, and why it is not a
  // timing guard, is documented in src/lib/submitDedupe.js — it lives there so
  // the app's primary write path is testable without rendering this page.
  const acceptSubmitRef = useRef(null);
  if (!acceptSubmitRef.current) acceptSubmitRef.current = makeDuplicateFilter({ isExempt: isWaterEntry });
  const submitEntry = (payload) => {
    if (!acceptSubmitRef.current(payload)) return false;
    saveMutation.mutate(payload);
    return true;
  };

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await nutritionData.remove(id);
      // A photo-logged meal is MIRRORED into the planner, with this log's id
      // on the snapshot. Removing only the log left the plan behind pointing
      // at a row that no longer exists — 3 of 8 production rows were orphans
      // that way. It matters more now that the planner sums a day's calories:
      // an orphan is the app counting a meal the user just deleted.
      // Best-effort — the diary delete has already succeeded and must stand.
      try { await mealPlans.removeMirrorForLog(id); } catch (mirrorErr) {
        reportError(mirrorErr, { feature: 'nutrition.mirror-cleanup', level: 'warning', userEmail: user?.email });
      }
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutritionLogs', user?.email, date] });
      queryClient.invalidateQueries({ queryKey: ['mealPlans', user?.id] });
      toast.success(t('nutrition.toast.entryRemoved'));
    },
    onError: (err) => {
      reportError(err, { feature: 'nutrition.delete', userEmail: user?.email });
      toast.error(t('nutrition.toast.deleteError'));
    },
  });

  /* =========================================================
     BARCODE SCANNER
     ========================================================= */

  // ── Photo-AI meal recognition handler ─────────────────────────────
  // Reads the chosen file, sends it to the recognize-meal Edge
  // Function, then prefills the meal log form with the returned
  // macros. User reviews + saves.
  // Core recognition path — accepts a File from either source: the library
  // picker (hidden file input) or the in-app guided camera (captured frame).
  const processPhotoFile = async (file) => {
    if (!file) return;
    setPhotoRecognizing(true);
    const res = await recognizeMealPhoto(file);
    setPhotoRecognizing(false);
    if (!res?.ok) {
      const err = res?.error;
      if (err === 'NOT_FOOD') toast.error(tFallback('nutrition.photoAi.notFood', "That doesn't look like food. Try another photo."));
      // PIPELINE_MISSING = function not deployed; SERVER_MISCONFIGURED = deployed
      // but the Anthropic key isn't set. Both mean "not fully set up" to a user.
      else if (err === 'PIPELINE_MISSING' || err === 'SERVER_MISCONFIGURED') toast.error(tFallback('nutrition.photoAi.notEnabled', "Photo recognition isn't enabled yet."));
      // Server signalled the daily cap explicitly (if the Edge Function sends
      // it) — go straight to the out-of-scans upsell.
      else if (err === 'DAILY_LIMIT') setPhotoLimit({ used: PHOTO_AI_DAILY_CAP, cap: PHOTO_AI_DAILY_CAP });
      // RATE_LIMIT is shared by the daily cap AND a transient upstream 429 —
      // distinguish by the user's actual count: at/over the cap → out-of-scans
      // upsell; otherwise it's a momentary blip → retry toast.
      else if (err === 'RATE_LIMIT') {
        const used = await getPhotoAiUsedToday(user?.id);
        if (used >= PHOTO_AI_DAILY_CAP) setPhotoLimit({ used, cap: PHOTO_AI_DAILY_CAP });
        else toast.error(tFallback('nutrition.photoAi.rateLimit', 'Hit the rate limit. Try again in a moment.'));
      }
      // 'TOO_LARGE' was the old client-side code; the server has always
      // sent 'IMAGE_TOO_LARGE'. Accept both so neither path falls
      // through to the generic toast.
      else if (err === 'IMAGE_TOO_LARGE' || err === 'TOO_LARGE') toast.error(tFallback('nutrition.photoAi.tooLarge', 'Photo is too large even after compression. Try a smaller image.'));
      else if (err === 'UNSUPPORTED_FORMAT') toast.error(tFallback('nutrition.photoAi.unsupportedFormat', "This photo format isn't supported here. Try a JPEG or PNG."));
      else if (err === 'TIMEOUT') toast.error(tFallback('nutrition.photoAi.timeout', 'Recognition timed out. Check your connection and try again.'));
      else if (err === 'NETWORK') toast.error(tFallback('nutrition.photoAi.network', "Couldn't reach the recognizer. Check your connection and try again."));
      else toast.error(tFallback('nutrition.photoAi.failed', 'Could not recognize meal. Try again.'));
      return;
    }
    // Show the result in a rich pop-out with the photo, a swipeable macro
    // panel, and a per-ingredient breakdown — the user reviews / edits there
    // and saves. Keep a preview URL of the exact photo they used.
    const r = res.result || {};
    try { if (photoImageUrl) URL.revokeObjectURL(photoImageUrl); } catch { /* noop */ }
    photoFileRef.current = file;   // keep for upload-on-save
    setPhotoImageUrl(URL.createObjectURL(file));
    setPhotoResult(r);
    setShowPhotoResult(true);
  };

  // Library-picker onChange → hand the chosen file to the recognition path.
  const handlePhotoMealPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so picking the same file twice still fires
    processPhotoFile(file);
  };

  // Guided in-app camera → recognise the captured frame.
  const handlePhotoCapture = (file) => {
    setShowPhotoCapture(false);
    processPhotoFile(file);
  };

  // Open the Photo-AI camera — but if the user has already spent today's scans,
  // show the out-of-scans upsell instead (saves a wasted capture + round-trip).
  // Fails OPEN: any error reading the counter just opens the camera.
  const openPhotoCapture = async () => {
    try {
      const used = await getPhotoAiUsedToday(user?.id);
      if (used >= PHOTO_AI_DAILY_CAP) {
        setPhotoLimit({ used, cap: PHOTO_AI_DAILY_CAP });
        return;
      }
    } catch { /* fail open */ }
    setShowPhotoCapture(true);
  };

  // "$2.99 unlimited" — integration point for the native in-app purchase
  // (App Store / Play Store). No payment is collected in-app here.
  const handlePurchaseUnlimited = () => {
    if (purchasingUnlimited) return;
    setPurchasingUnlimited(true);
    // TODO(iap): trigger the store purchase flow, then unlock on success.
    setTimeout(() => {
      setPurchasingUnlimited(false);
      toast.info(tFallback('nutrition.photoAi.unlimitedSoon', 'Unlimited Photo-AI is coming soon. Hang tight!'));
    }, 500);
  };

  // Close + tidy up the photo-result modal (revoke the object URL).
  const closePhotoResult = () => {
    setShowPhotoResult(false);
    setPhotoResult(null);
    photoFileRef.current = null;
    try { if (photoImageUrl) URL.revokeObjectURL(photoImageUrl); } catch { /* noop */ }
    setPhotoImageUrl(null);
  };

  // Save the (possibly edited) recognized meal through the normal logging
  // path so daily calories, macros, and the dashboard Nutrition/Recovery
  // cards all update. `entry` carries food_name + numeric macro columns.
  //
  // Before saving we upload the photo to storage so it persists with the log
  // (the blob: preview URL is memory-only). The recognition extras that have
  // no dedicated column (portion/confidence/ingredients/sugar) ride along in
  // `ai_meta`. We also hand the mutation a `_planner_mirror` snapshot so the
  // meal shows up in its date+meal-type square on the Plans page — the mirror
  // itself runs in onSuccess where the new log's id is available.
  const saveRecognizedMeal = async (entry) => {
    if (saveMutation.isPending) return;
    const src = photoResult || {};
    const file = photoFileRef.current;

    // Upload the photo (best-effort — a failed upload shouldn't block the log).
    let imageUrl = null;
    if (file) {
      try {
        const up = await db.integrations.Core.UploadFile({ file, bucket: 'uploads' });
        imageUrl = up?.file_url || null;
      } catch (uploadErr) {
        reportError(uploadErr, { feature: 'nutrition.photo-upload', level: 'warning', userEmail: user?.email });
      }
    }

    const macros = {
      calories:  Number(entry.calories)  || 0,
      protein_g: Number(entry.protein_g) || 0,
      carbs_g:   Number(entry.carbs_g)   || 0,
      fat_g:     Number(entry.fat_g)     || 0,
      fiber_g:   Number(entry.fiber_g)   || 0,
      sugar_g:   Number(entry.sugar_g)   || 0,
      sodium_mg: Number(entry.sodium_mg) || 0,
    };
    const foodName = (entry.food_name || 'Meal').trim();
    // Prefer the (possibly edited) ingredient list from the modal so meals the
    // user added an ingredient to persist that change; fall back to the raw
    // recognition items.
    const items = Array.isArray(entry.items) ? entry.items
                : Array.isArray(src.items)   ? src.items
                : [];
    const aiMeta = {
      source:           'photo_ai',
      portion_estimate: src.portion_estimate || null,
      confidence:       ['high', 'medium', 'low'].includes(src.confidence) ? src.confidence : null,
      items,
      notes:            src.notes || null,
      sugar_g:          macros.sugar_g,
    };
    // Snapshot mirrored into the weekly planner slot (food_snapshot JSONB).
    const plannerSnapshot = {
      name:             foodName,
      ...macros,
      image_url:        imageUrl,
      portion_estimate: aiMeta.portion_estimate,
      confidence:       aiMeta.confidence,
      items:            aiMeta.items,
      source:           'photo_ai',
    };

    submitEntry({
      date,
      created_by: user?.email,
      user_id: user?.id,
      meal_type: mealType,
      food_name: foodName,
      ...macros,
      image_url: imageUrl,
      ai_meta: aiMeta,
      _planner_mirror: plannerSnapshot,
    });
    closePhotoResult();
  };

  // Re-open an already-saved meal in a read-only detail view (image + metrics).
  // Reconstructs a recognition-shaped result from the stored row: headline
  // macros live in their own columns (protein/carbs/fat/… or the _g aliases),
  // the extras come from ai_meta.
  const openMealDetail = (entry) => {
    if (!entry || isWaterEntry(entry)) return;
    const meta = entry.ai_meta || {};
    setMealDetail({
      imageUrl: entry.image_url || null,
      result: {
        food_name:        entry.food_name || 'Meal',
        calories:         Number(entry.calories) || 0,
        protein_g:        Number(entry.protein_g ?? entry.protein) || 0,
        carbs_g:          Number(entry.carbs_g   ?? entry.carbs)   || 0,
        fat_g:            Number(entry.fat_g     ?? entry.fat)     || 0,
        fiber_g:          Number(entry.fiber_g   ?? entry.fiber)   || 0,
        sugar_g:          Number(meta.sugar_g ?? entry.sugar_g)    || 0,
        sodium_mg:        Number(entry.sodium_mg ?? entry.sodium)  || 0,
        items:            Array.isArray(meta.items) ? meta.items : [],
        portion_estimate: meta.portion_estimate || null,
        confidence:       meta.confidence || null,
        notes:            meta.notes || entry.notes || null,
      },
    });
  };

  const startScanner = async () => {
    scanCancelledRef.current = false;
    setShowScanner(true);
    setScannerError(null);
    setScannerStatus('initializing');
    lastBarcodeRef.current = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Your browser does not support camera access.');
      }
      // Dynamic-import the barcode reader on first scan. The module is
      // cached by the browser after the initial fetch, so subsequent
      // scans don't re-download. Keeps ~80 KB out of the entry chunk.
      // @zxing/library carries the DecodeHintType/BarcodeFormat enums used
      // to build the hints — imported alongside so nothing leaks into the
      // eager bundle.
      const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      if (scanCancelledRef.current) return;

      // Acquire the rear camera ourselves (rather than letting zxing's
      // decodeFromVideoDevice own the stream) so we control frame capture and
      // torch. Prefer an explicit environment-facing device when labels are
      // available (post-permission); otherwise fall back to the facingMode
      // constraint. Then retry once unconstrained if the exact device is busy.
      let stream;
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const rear = devices.filter(d => d.label).find(d => /back|rear|environment/i.test(d.label));
        stream = await navigator.mediaDevices.getUserMedia({
          video: rear ? { deviceId: { exact: rear.deviceId } } : { facingMode: { ideal: 'environment' } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      }
      if (scanCancelledRef.current) {
        stream.getTracks().forEach(tr => { try { tr.stop(); } catch {} });
        return;
      }
      streamRef.current = stream;
      videoTrackRef.current = stream.getVideoTracks()[0] || null;

      // Show the stream in the preview element.
      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play().catch(() => {}); // autoplay may reject; frames still flow

      // Torch — driven directly off the track. Only Android Chrome exposes it.
      const caps = videoTrackRef.current?.getCapabilities?.() || {};
      setTorchAvailable('torch' in caps);
      setTorchOn(false);

      // TRY_HARDER scans the full frame (helps glare-broken / low-contrast
      // codes on shiny cans); POSSIBLE_FORMATS narrows to retail UPC/EAN for
      // faster, more reliable frames. Rotation itself is handled by us, per
      // frame, because zxing's built-in rotate can't resize the canvas source.
      const hints = buildBarcodeHints(DecodeHintType, BarcodeFormat);
      readerRef.current = new BrowserMultiFormatReader(hints);
      scanCanvasRef.current = document.createElement('canvas');
      setScannerStatus('scanning');

      // Frame-decode loop: draw the current video frame, then try to decode it
      // upright and rotated 90°/270° so a sideways can reads. ~6 fps is plenty
      // for barcodes and keeps the multi-orientation decode affordable.
      scanLoopRef.current = setInterval(() => {
        if (scanCancelledRef.current || !readerRef.current) return;
        const v = videoRef.current;
        const canvas = scanCanvasRef.current;
        if (!v || !canvas || v.readyState < 2 || !v.videoWidth) return;
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        let text = null;
        try {
          text = decodeCanvasMultiOrientation(readerRef.current, canvas);
        } catch { /* decoder hiccup on a frame — try the next */ }
        if (text && text !== lastBarcodeRef.current) {
          lastBarcodeRef.current = text;
          setScannerStatus('looking-up');
          stopScanLoop();
          lookupAndShow(text);
        }
      }, 160);
    } catch (e) {
      // User closed the scanner mid-init — don't resurrect the error UI.
      if (scanCancelledRef.current) return;
      setScannerError(parseCameraError(e, t));
      setScannerStatus('error');
    }
  };

  // Stop just the decode loop + release the camera, without tearing down the
  // modal UI (so the "looking-up" spinner can show while we fetch nutrition).
  const stopScanLoop = () => {
    if (scanLoopRef.current) { clearInterval(scanLoopRef.current); scanLoopRef.current = null; }
    try { videoTrackRef.current?.applyConstraints?.({ advanced: [{ torch: false }] }); } catch {}
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(tr => { try { tr.stop(); } catch {} });
      streamRef.current = null;
    }
    videoTrackRef.current = null;
    if (videoRef.current) { try { videoRef.current.srcObject = null; } catch {} }
  };

  const lookupAndShow = async (barcode) => {
    try {
      const product = await lookupBarcode(barcode);
      if (!product) {
        // No match across all three sources — show the community submission form
        stopScanner();
        setNotFoundBarcode(barcode);
        return;
      }
      stopScanner();
      pushToScanHistory(product);
      setScannedProduct(product);
    } catch (e) {
      setScannerError(`Lookup failed: ${e.message}. Check your connection and try again.`);
      setScannerStatus('error');
    }
  };

  const toggleTorch = async () => {
    const next = !torchOn;
    try {
      await videoTrackRef.current?.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      // Some tracks advertise torch but reject applyConstraints — degrade
      // quietly and hide the toggle so we don't keep offering a dead button.
      setTorchAvailable(false);
    }
  };

  const stopScanner = () => {
    scanCancelledRef.current = true;
    stopScanLoop();  // clears the interval, kills torch + camera tracks
    readerRef.current = null;
    scanCanvasRef.current = null;
    lastBarcodeRef.current = null;
    setTorchAvailable(false);
    setTorchOn(false);
    setScannerStatus('idle');
    setScannerError(null);
    setShowScanner(false);
  };

  const retryScanner = () => {
    setScannerError(null);
    lastBarcodeRef.current = null;
    startScanner();
  };

  useEffect(() => {
    return () => {
      scanCancelledRef.current = true;
      // Release the camera + torch + decode loop on unmount so nothing leaks.
      stopScanLoop();
    };
  }, []);

  /* ========================================================= */

  const logProduct = (product) => {
    const n = product.nutrition;
    const v = product.vitamins || {};
    submitEntry({
      date,
      food_name: product.name,
      calories:       n.calories ?? 0,
      protein_g:      n.protein  ?? 0,
      carbs_g:        n.carbs    ?? 0,
      fat_g:          n.fat      ?? 0,
      fiber_g:        n.fiber    ?? null,
      sugar_g:        n.sugar    ?? null,
      sodium_mg:      n.sodium   ?? null,
      cholesterol_mg: n.cholesterol ?? null,
      calcium_mg:      v.calcium_mg     ?? null,
      iron_mg:         v.iron_mg        ?? null,
      magnesium_mg:    v.magnesium_mg   ?? null,
      potassium_mg:    v.potassium_mg   ?? null,
      vitamin_a_iu:    v.vitamin_a_iu   ?? null,
      vitamin_c_mg:    v.vitamin_c_mg   ?? null,
      vitamin_d_iu:    v.vitamin_d_iu   ?? null,
      vitamin_b12_mcg: v.vitamin_b12_mcg ?? null,
      meal_type: mealType,
    });
  };

  const handleLogScannedProduct = () => {
    if (!scannedProduct) return;
    const n = scannedProduct.nutrition;
    const v = scannedProduct.vitamins || {};
    submitEntry({
      date,
      food_name: scannedProduct.name,
      calories:       n.calories ?? 0,
      protein_g:      n.protein  ?? 0,
      carbs_g:        n.carbs    ?? 0,
      fat_g:          n.fat      ?? 0,
      fiber_g:        n.fiber    ?? null,
      sugar_g:        n.sugar    ?? null,
      sodium_mg:      n.sodium   ?? null,
      cholesterol_mg: n.cholesterol ?? null,
      // Vitamins & minerals — populated from Open Food Facts / community sources
      calcium_mg:      v.calcium_mg     ?? null,
      iron_mg:         v.iron_mg        ?? null,
      magnesium_mg:    v.magnesium_mg   ?? null,
      potassium_mg:    v.potassium_mg   ?? null,
      vitamin_a_iu:    v.vitamin_a_iu   ?? null,
      vitamin_c_mg:    v.vitamin_c_mg   ?? null,
      vitamin_d_iu:    v.vitamin_d_iu   ?? null,
      vitamin_b12_mcg: v.vitamin_b12_mcg ?? null,
      meal_type: mealType,
      _via_barcode: true, // telemetry-only, stripped in mutationFn
    });
    setScannedProduct(null);
  };

  // Returns TRUE only when a mutation actually starts.
  //
  // The form latches an in-flight ref before calling this and clears it in an
  // effect keyed on `isLogging`. Both early returns below skip the mutation,
  // so `isLogging` never flips, the effect never re-runs, and that ref stayed
  // latched FOREVER — every later tap on Log Meal was swallowed and the
  // button was dead until remount. Kegan hit exactly this on 2026-08-05:
  // "I added all the calories and protein and hit log meal and nothing's
  // happening. Maybe it's because I just logged one."
  //
  // Reporting whether we started lets the form release its own guard. Any
  // new early return added here MUST return false.
  const addEntry = () => {
    if (!newEntry.food_name.trim()) { toast.error(t('nutrition.toast.enterFoodName')); return false; }
    // Parent-side guard against re-entrant mutation calls — the form's
    // submittingRef catches taps inside the form, but a programmatic
    // call path (e.g. Enter key fast-firing twice before isPending
    // flips, or a scanner that triggers addEntry alongside a tap)
    // can still produce duplicate POSTs without this server-state
    // check. React Query's isPending flips after the first .mutate()
    // resolves a microtask later, leaving a brief window we close here.
    if (saveMutation.isPending) return false;
    // Per-field coercion so non-numeric values (from photo-AI / barcode
    // / paste / typed-then-edited input) never persist as strings to
    // numeric DB columns. Previously `v === '' ? 0 : v` left strings
    // intact, which broke arithmetic downstream + corrupted the daily
    // totals roll-up. Wave 57 (Cardio/Coach/Progress/Nutrition audit)
    // caught this. `food_name` stays as string; everything else is a
    // numeric column.
    const STRING_KEYS = new Set(['food_name', 'meal_type', 'date', 'notes']);
    const safeEntry = Object.fromEntries(
      Object.entries(newEntry).map(([k, v]) => {
        if (STRING_KEYS.has(k)) return [k, v];
        if (v === '' || v == null) return [k, 0];
        const n = Number(v);
        return [k, Number.isFinite(n) ? n : 0];
      })
    );
    // Suppressed as a duplicate counts as an early return, and the contract
    // above is explicit: report false so the form releases its own in-flight
    // ref. Returning true here would latch it forever and kill the button —
    // the exact failure that comment records.
    if (!submitEntry({
      date,
      created_by: user?.email,
      user_id: user?.id,
      meal_type: mealType,
      ...safeEntry,
    })) return false;
    setNewEntry({ food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '', sodium_mg: '', fiber_g: '', sugar_g: '', cholesterol_mg: '', iron_mg: '', magnesium_mg: '', calcium_mg: '', potassium_mg: '', vitamin_a_iu: '', vitamin_c_mg: '', vitamin_d_iu: '', vitamin_b12_mcg: '' });
    return true;
  };

  // A food picked out of Search FILLS THE FORM rather than logging straight
  // away. The user still has to press Log Meal.
  //
  // That is deliberate and it is the opposite of the History tab's Re-Log
  // beside it. Re-Log repeats something you already ate, unchanged, so one
  // tap is the whole point. Search is how you reach a food you may want to
  // adjust — a different serving, a bigger portion — and silently committing
  // it would make the numbers wrong in a way that is tedious to undo.
  const applySearchPick = (entry) => {
    if (!entry) return;
    setNewEntry({
      food_name: entry.name || '',
      calories:  entry.calories  ? String(entry.calories)  : '',
      protein_g: entry.protein_g ? String(entry.protein_g) : '',
      carbs_g:   entry.carbs_g   ? String(entry.carbs_g)   : '',
      fat_g:     entry.fat_g     ? String(entry.fat_g)     : '',
      sodium_mg: entry.sodium_mg ? String(entry.sodium_mg) : '',
      fiber_g:   entry.fiber_g   ? String(entry.fiber_g)   : '',
      sugar_g:   entry.sugar_g   ? String(entry.sugar_g)   : '',
      // The remaining micronutrient fields have no column on nutrition_logs
      // (migration 006 is unapplied), so there is nothing to carry across.
      // See docs/nutrition-meal-logging-audit.md.
      cholesterol_mg: '', iron_mg: '', magnesium_mg: '', calcium_mg: '',
      potassium_mg: '', vitamin_a_iu: '', vitamin_c_mg: '', vitamin_d_iu: '',
      vitamin_b12_mcg: '',
    });
    toast.success(tFallback('nutrition.search.filled', 'Filled in. Check the amount, then log it.'));
  };

  // Re-log a previously-logged meal (from the Log Meal form's History tab)
  // straight into today under the selected meal type — a fresh entry, so it
  // flows through the normal calorie/macro/dashboard update path.
  const reLogMeal = (meal) => {
    if (!meal || saveMutation.isPending) return;
    submitEntry({
      date,
      created_by: user?.email,
      user_id: user?.id,
      meal_type: mealType,
      food_name: (meal.food_name || 'Meal').trim(),
      calories:  Number(meal.calories)  || 0,
      protein_g: Number(meal.protein_g) || 0,
      carbs_g:   Number(meal.carbs_g)   || 0,
      fat_g:     Number(meal.fat_g)     || 0,
      fiber_g:   Number(meal.fiber_g)   || 0,
      sugar_g:   Number(meal.sugar_g)   || 0,
      sodium_mg: Number(meal.sodium_mg) || 0,
    });
  };

  const ozToDisplay = (oz) => {
    if (waterUnit === 'ml') return Math.round(oz * 29.5735);
    if (waterUnit === 'L') return parseFloat((oz * 0.0295735).toFixed(2));
    return oz;
  };

  const displayToOz = (amount, unit) => {
    if (unit === 'ml') return amount / 29.5735;
    if (unit === 'L') return amount * 33.814;
    return amount;
  };

  const unitLabel = waterUnit;

  const [showBottleModal, setShowBottleModal] = useState(false);
  const [bottleInput, setBottleInput] = useState('');
  const [showCalorieCycling, setShowCalorieCycling] = useState(false);
  const [bottleInputUnit, setBottleInputUnit] = useState('oz');
  const [bottleNickname, setBottleNickname] = useState('');

  // A bottle may not be bigger than a whole day's water. This used to be a
  // free-standing 640 (a 5-gallon jug) while WATER_DAILY_CAP_OZ was 200,
  // so the modal invited you to create a bottle — and advertised "Max:
  // 640 oz" — that the quick-add chip then refused forever, because its
  // disabled test is `waterOz + bottle.oz > WATER_DAILY_CAP_OZ` and
  // `0 + 640 > 200` is true at every water level. Deriving it from the cap
  // means the two can't contradict each other again.
  const MAX_BOTTLE_OZ = WATER_DAILY_CAP_OZ;

  const maxBottleInUnit = (unit) => {
    if (unit === 'ml') return `${fmt(Math.round(MAX_BOTTLE_OZ * 29.5735))} ml`;
    if (unit === 'L')  return `${(MAX_BOTTLE_OZ * 0.0295735).toFixed(1)} L`;
    return `${MAX_BOTTLE_OZ} oz`;
  };

  const handleSaveBottle = () => {
    const amount = Number(bottleInput);
    if (isNaN(amount) || amount <= 0) {
      toast.error(t('nutrition.toast.positiveNumber'));
      return;
    }
    const convertedOz = displayToOz(amount, bottleInputUnit);
    if (convertedOz > MAX_BOTTLE_OZ) {
      toast.error(tFallback('nutrition.toast.bottleTooBig', 'That bottle is too big. Try a smaller size.'));
      return;
    }
    const nick = bottleNickname.trim();
    setCustomBottles([...customBottles, {
      id: Date.now().toString(),
      label: nick || `${bottleInput} ${bottleInputUnit}`,
      nickname: nick || null,
      oz: convertedOz,
      displayAmount: amount,
      displayUnit: bottleInputUnit
    }]);
    setShowBottleModal(false);
    setBottleInput('');
    setBottleNickname('');
  };

  const handleDeleteBottle = (id) => {
    setCustomBottles(customBottles.filter(b => b.id !== id));
  };

  const getGlassLabel = () => {
    const oz = 8;
    if (waterUnit === 'ml') return `+ Glass (${Math.round(oz * 29.5735)} ml)`;
    if (waterUnit === 'L') return `+ Glass (${(oz * 0.0295735).toFixed(2)} L)`;
    return '+ Glass (8 oz)';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="px-4 pt-1 md:px-8 md:pt-2 lg:pb-8 max-w-4xl mx-auto">

      {/* ── Header ───────────────────────────────────────────────────────────
          Top row: title + customize (container-mover) buttons on the left,
          Scanner History on the right — all vertically centered so the
          dropdown lines up with the heading and mover. Date sits below. */}
      <motion.div
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="mb-6"
      >
        {/* Photo-AI hidden file input (library fallback). */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handlePhotoMealPick}
        />

        {/* Row 1 — date + Scanner History on one line (aligned). */}
        <div className="flex items-center justify-between gap-4">
          <p className="text-micro font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            {format(new Date(), 'EEEE, MMMM d')}
          </p>
          <button
            onClick={() => setShowScanHistory(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors shrink-0"
          >
            <Clock className="w-3.5 h-3.5" />
            Scanner History
            {scanHistory.length > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-primary/15 text-primary text-micro font-bold flex items-center justify-center">
                {scanHistory.length}
              </span>
            )}
            {showScanHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Row 2 — title (+ container-mover) + Edit Goals on one line (aligned). */}
        <div className="flex items-center justify-between gap-4 mt-1">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight leading-tight">{t('nutrition.title')}</h1>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setEditMode(e => !e)}
                title={editMode ? 'Done editing' : 'Customize'}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  editMode
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground/60 hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary'
                }`}
              >
                {editMode ? (
                  <><CheckCircle2 className="w-3.5 h-3.5" /><span>{tFallback("coach.plan.done", "Done")}</span></>
                ) : (
                  <LayoutGrid className="w-3.5 h-3.5" />
                )}
              </button>
              {editMode && canSetAsDefault && (
                <button
                  type="button"
                  onClick={handleSetAsDefault}
                  title={tFallback("nutrition.saveThisLayoutAsDefault", "Save this layout as default for all new users")}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-primary dark:text-primary hover:bg-primary/10 active:bg-primary/10 transition-colors"
                >
                  <Save className="w-3 h-3" />
                  {tFallback("dashboard.setDefault", "Set default")}
                </button>
              )}
              {editMode && (
                <button
                  type="button"
                  onClick={handleResetOrder}
                  title={tFallback("nutrition.resetToDefault", "Reset to default")}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  {tFallback("workout.reset", "Reset")}
                </button>
              )}
            </div>
          </div>
          {/* Re-run nutrition onboarding to reset goals + dietary prefs. */}
          <button
            onClick={openGoalsEditor}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors shrink-0"
          >
            <Target className="w-3.5 h-3.5" />
            {tFallback("nutrition.editGoals", "Edit Goals")}
          </button>
        </div>
      </motion.div>

      {/* ── Scanner history panel ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showScanHistory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="overflow-hidden mb-5"
          >
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <span className="font-heading font-bold text-sm">{tFallback("nutrition.scannerHistory", "Scanner History")}</span>
                </div>
                {scanHistory.length > 0 && (
                  <button
                    onClick={() => {
                      setScanHistory([]);
                      try { localStorage.removeItem(scanHistoryKey); } catch {}
                    }}
                    className="text-micro text-muted-foreground hover:text-destructive active:text-destructive transition-colors"
                  >
                    {tFallback('nutrition.clearAll', 'Clear all')}
                  </button>
                )}
              </div>

              {scanHistory.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <ScanLine className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No scans yet — scan a barcode to get started.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {scanHistory.map((item) => {
                    const cal = item.nutrition?.calories;
                    const pro = item.nutrition?.protein;
                    const carb = item.nutrition?.carbs;
                    const fat = item.nutrition?.fat;
                    return (
                      <motion.div
                        key={item._histId}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 active:bg-secondary/40 transition-colors"
                      >
                        {/* Food info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold leading-tight truncate">{item.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {cal != null && (
                              <span className="text-micro text-primary font-medium">{Math.round(cal)} cal</span>
                            )}
                            {pro != null && (
                              <span className="text-micro text-muted-foreground">P {Math.round(pro)}g</span>
                            )}
                            {carb != null && (
                              <span className="text-micro text-muted-foreground">C {Math.round(carb)}g</span>
                            )}
                            {fat != null && (
                              <span className="text-micro text-muted-foreground">F {Math.round(fat)}g</span>
                            )}
                          </div>
                        </div>

                        {/* Log button */}
                        <motion.button
                          whileTap={{ scale: 0.88 }}
                          onClick={() => {
                            logProduct(item);
                            toast.success(`Logged ${item.name}!`);
                          }}
                          disabled={saveMutation.isPending}
                          className="shrink-0 w-8 h-8 rounded-full bg-primary/10 hover:bg-primary active:bg-primary text-primary hover:text-primary-foreground active:text-primary-foreground flex items-center justify-center transition-colors disabled:opacity-50"
                          title={tFallback("nutrition.logToToday", "Log to today")}
                        >
                          <Plus className="w-4 h-4" />
                        </motion.button>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading skeleton — shown while logs + profile are fetching on first render */}
      {isLoading && (
        <div className="space-y-4 mb-6">
          <div className="flex gap-3">
            <Skeleton className="h-28 flex-1 rounded-xl" />
            <Skeleton className="h-28 flex-1 rounded-xl" />
            <Skeleton className="h-28 flex-1 rounded-xl" />
          </div>
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      )}

      {/* Barcode scanner modal */}
      {showScanner && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-4">
            <h3 className="font-heading font-bold mb-4">{t('nutrition.scanBarcode')}</h3>
            <div className="relative w-full aspect-square rounded-lg mb-4 bg-black overflow-hidden">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-3/4 h-1/3 relative">
                  <div className="absolute top-0 start-0 w-6 h-6 border-t-2 border-s-2 border-primary" />
                  <div className="absolute top-0 end-0 w-6 h-6 border-t-2 border-e-2 border-primary" />
                  <div className="absolute bottom-0 start-0 w-6 h-6 border-b-2 border-s-2 border-primary" />
                  <div className="absolute bottom-0 end-0 w-6 h-6 border-b-2 border-e-2 border-primary" />
                </div>
              </div>
              {(scannerStatus === 'initializing' || scannerStatus === 'looking-up') && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-white text-sm">
                    {scannerStatus === 'initializing' ? t('nutrition.startingCamera') : t('nutrition.fetchingNutrition')}
                  </p>
                </div>
              )}
              {/* Torch — only rendered when the camera track supports it. */}
              {scannerStatus === 'scanning' && torchAvailable && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  aria-label={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
                  aria-pressed={torchOn}
                  className={`absolute top-2 end-2 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    torchOn ? 'bg-primary text-primary-foreground' : 'bg-black/50 text-white'
                  }`}
                >
                  {torchOn ? <Flashlight className="w-5 h-5" /> : <FlashlightOff className="w-5 h-5" />}
                </button>
              )}
            </div>
            {scannerStatus === 'scanning' && (
              <p className="text-xs text-muted-foreground text-center mb-3">
                {t('nutrition.pointCamera')} · {tFallback('nutrition.scanRotateHint', 'reads sideways codes too. Rotate a shiny can to cut glare')}
              </p>
            )}
            {scannerStatus === 'error' && scannerError && (
              <div className="mb-3 p-3 rounded-md bg-destructive/10 border border-destructive/30">
                <p className="text-sm text-destructive">{scannerError}</p>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={stopScanner} className="flex-1">{t('nutrition.close')}</Button>
              {scannerStatus === 'error' && (
                <Button onClick={retryScanner} className="flex-1">{t('nutrition.tryAgain')}</Button>
              )}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Scan result modal */}
      {scannedProduct && (
        <ErrorBoundary label="BarcodeResultModal">
          <BarcodeResultModal
            product={scannedProduct}
            onCancel={() => setScannedProduct(null)}
            onLog={handleLogScannedProduct}
            isLogging={saveMutation.isPending}
          />
        </ErrorBoundary>
      )}

      {/* Not found modal — community submission form */}
      {notFoundBarcode && (
        <ErrorBoundary label="BarcodeNotFoundModal">
          <BarcodeNotFoundModal
            barcode={notFoundBarcode}
            onCancel={() => setNotFoundBarcode(null)}
            onSubmit={(product) => {
              setNotFoundBarcode(null);
              setScannedProduct(product);  // immediately show the result modal for logging
            }}
          />
        </ErrorBoundary>
      )}

      {/* Shortcuts carousel — pinned at top */}
      <NutritionShortcutsCarousel
        onScan={startScanner}
        onRecipes={() => setShowRecipes(true)}
        onHistory={() => setShowMealHistory(true)}
        onPlans={() => setShowNutritionPlans(true)}
        onPlanner={() => setShowWeeklyPlanner(true)}
      />

      {/* Quick-access row — icon shortcuts for users who miss the carousel.
          Scan wears the logo flame gradient; Photo-AI wears its signature
          purple (replaces the header button). Plans was removed — it now
          lives as a tab inside the Planner. */}
      <div className="flex gap-2 mb-3">
        {/* Scan — flame gradient (matches the logo) */}
        <button
          type="button"
          onClick={startScanner}
          className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-white shadow-sm active:scale-95 transition-transform"
          style={{ background: 'linear-gradient(315deg, #ffd27a 0%, #fb9d38 32%, #f2700d 64%, #c2410c 100%)' }}
        >
          <ScanLine className="w-4 h-4" />
          <span className="text-micro font-semibold">{tFallback('nutrition.scan', 'Scan')}</span>
        </button>

        {/* Neutral shortcuts */}
        {[
          { id: 'recipes', label: 'Recipes', icon: ChefHat,  action: () => setShowRecipes(true) },
          { id: 'history', label: 'History', icon: History,   action: () => setShowMealHistory(true) },
          { id: 'plans',   label: 'Plans',   icon: Calendar, action: () => setShowWeeklyPlanner(true) },
        ].map(({ id, label, icon: Icon, action }) => (
          <button key={id} type="button" onClick={action}
            className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl bg-secondary/60 border border-border/40 text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors">
            <Icon className="w-4 h-4" />
            <span className="text-micro font-semibold">{tFallback(`nutrition.shortcut.${id}`, label)}</span>
          </button>
        ))}

        {/* Photo-AI — purple gradient (moved out of the header) */}
        <button
          type="button"
          onClick={openPhotoCapture}
          disabled={photoRecognizing}
          className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-white shadow-sm active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(315deg, hsl(var(--primary) / 0.82) 0%, hsl(var(--primary)) 55%, hsl(var(--primary) / 0.92) 100%)' }}
        >
          {photoRecognizing
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <span className="text-base leading-none">📸</span>}
          <span className="text-micro font-semibold">
            {photoRecognizing ? tFallback('nutrition.reading', 'Reading…') : tFallback('nutrition.photoAi', 'Photo-AI')}
          </span>
        </button>
      </div>

      {/* Calorie counter — just below the shortcut row */}
      <CalorieTopBar entries={entries} userProfile={userProfile} />

      {/* Calorie cycling — set training-vs-rest-day targets. Hidden unless the
          user opts into the feature in Settings (off by default). A small,
          low-emphasis affordance right under the target it controls. */}
      {calorieCyclingEnabled && (
        <div className="flex justify-end -mt-1 mb-1">
          <button
            type="button"
            onClick={() => setShowCalorieCycling(true)}
            className="flex items-center gap-1 text-micro font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
          >
            <Repeat className="w-3 h-3" />
            {userProfile?.calorie_cycling
              ? tFallback('nutrition.cycling.editCta', 'Calorie cycling: on')
              : tFallback('nutrition.cycling.setCta', 'Set calorie cycling')}
          </button>
        </div>
      )}

      {/* ═══ Reorderable sections — drag in edit mode to reorder.
              Each Reorder.Item iteration matches widgetOrder; inside,
              a chain of `{id === 'X' && (...)}` conditionals filters
              to the one section that matches the id. Per-user
              localStorage via flexyn.nutritionWidgetOrder.<userId>. ═══ */}
      <Reorder.Group axis="y" values={renderOrder} onReorder={handleReorder} as="div">
        {renderOrder.map(rowId => {
          const isHidden = hiddenWidgets.includes(rowId);
          const sectionLabel =
              rowId === 'tabs'    ? 'Nutritional Values'
            : rowId === 'logForm' ? 'Log A Meal'
            : rowId === 'water'   ? 'Water Intake'
            : rowId === 'fasting' ? 'Intermittent Fasting'
            : rowId === 'meals'   ? "Today's Meals"
            : rowId;
          return (
          <ReorderableRow
            key={rowId}
            value={rowId}
            // Layout animation is only wanted for drag-reordering, which only
            // happens in customize mode. Enabling it in normal mode made
            // framer scale-/position-project the box during hide/show — that
            // stretched the stub text on collapse and clipped the next
            // section (Today's Meals) on expand. Gate it to editMode so
            // hide/show is an instant, distortion-free swap.
            layout={editMode ? 'position' : false}
            className={`relative ${editMode ? 'select-none' : ''} ${editMode && isHidden ? 'opacity-50' : ''}`}
          >
            {(dragControls) => (<>
            {editMode && (
              <div className="flex items-center gap-2 mt-2 mb-1 px-1">
                {/* Borrowing Dashboard's key rather than minting a Nutrition
                    one: it is the same sentence about the same control, and it
                    already has all 15 human translations. A new key here would
                    ship English to fourteen of them for an aria-label. */}
                <DragHandle
                  dragControls={dragControls}
                  label={tFallback('dashboard.editLegend.drag', 'Long-press and drag to reorder a section')}
                  className="text-primary/70"
                />
                <span className="text-micro font-bold uppercase tracking-[0.18em] text-primary/50">
                  {sectionLabel}
                </span>
                {isHidden && (
                  <button
                    type="button"
                    onClick={() => showWidget(rowId)}
                    className="ms-auto flex items-center gap-1 px-2 py-0.5 rounded-md text-micro font-bold text-primary hover:bg-primary/10 active:bg-primary/10 transition-colors"
                  >
                    <Eye className="w-3 h-3" /> {tFallback("injuries.cleared.show", "Show")}
                  </button>
                )}
              </div>
            )}

            {/* Normal mode: a hidden section collapses to an in-place
                restore stub so it's obvious it can be brought back. */}
            {isHidden && !editMode ? (
              <button
                type="button"
                onClick={() => showWidget(rowId)}
                className="w-full flex items-center justify-center gap-2 mb-4 py-3 rounded-xl border border-dashed border-border text-xs font-semibold text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary/50 active:bg-secondary/50 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" /> Show {sectionLabel}
              </button>
            ) : (
            <>

      {rowId === 'tabs' && (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="mb-6">
        <div className="flex gap-1 p-1 bg-secondary rounded-lg mb-4 border border-border">
          {[
            { id: 'macros', label: t('nutrition.nutritionalValues') },
            { id: 'vitamins', label: t('nutrition.vitaminsAndMinerals') },
          ].map(tab => (
            <motion.button
              key={tab.id}
              onClick={() => setNutritionTab(tab.id)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${nutritionTab === tab.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground active:text-foreground'}`}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            >
              {tab.label}
            </motion.button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          {nutritionTab === 'macros' ? (
            <motion.div key="macros" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, pointerEvents: 'none' }} transition={{ duration: 0.2 }}>
              <ErrorBoundary label="MacroNutrientBox">
                <MacroNutrientBox entries={entries} userProfile={userProfile} />
              </ErrorBoundary>
            </motion.div>
          ) : (
            <motion.div key="vitamins" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, pointerEvents: 'none' }} transition={{ duration: 0.2 }}>
              <ErrorBoundary label="MineralsVitaminsBox">
                <MineralsVitaminsBox entries={entries} userProfile={userProfile} />
              </ErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      )}

{/* shortcuts is pinned above CalorieTopBar — not rendered here */}

      {/* Portion guide removed — unnecessary and took up space. */}

      {rowId === 'logForm' && (
      <motion.div
        id="log-meal-form"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="mb-6 scroll-mt-24"
      >
        {/* Meal-type compact pills — right above the form */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{tFallback("hub.share.meal", "Meal")}</p>
          <MealTypePicker value={mealType} onChange={setMealType} />
        </div>
        <ErrorBoundary label="LogMealForm">
          <LogMealForm
            newEntry={newEntry}
            setNewEntry={setNewEntry}
            onScan={startScanner}
            onPhotoAI={openPhotoCapture}
            onSearch={() => setShowFoodSearch(true)}
            onReLog={reLogMeal}
            isRecognizing={photoRecognizing}
            onLog={addEntry}
            isScanning={showScanner}
            isLogging={saveMutation.isPending}
            defaultOpen={openLogMeal}
          />
        </ErrorBoundary>
      </motion.div>

      )}

      {rowId === 'water' && (
      <>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }} className="mb-6">
        <Card className="p-6 border-none shadow-sm">
          <div className="space-y-4">
            {/* HEADER ROW */}
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold flex items-center gap-2 min-w-0">
                <GlassWater className="w-5 h-5 shrink-0 text-info" />
                <span className="truncate">{t('nutrition.waterIntake')}</span>
              </h3>
              {/* Unit Toggle — radio-style group; aria-pressed lets screen
                  readers announce active vs inactive state. */}
              <div role="group" aria-label={t('nutrition.waterIntake')} className="flex rounded-lg border border-border overflow-hidden bg-secondary/30">
                {['oz', 'ml', 'L'].map(unit => (
                  <button
                    key={unit}
                    onClick={() => setWaterUnit(unit)}
                    aria-pressed={waterUnit === unit}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      waterUnit === unit
                        ? 'bg-info text-white'
                        : 'text-muted-foreground hover:text-foreground active:text-foreground'
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>

            {/* WATERTRACKER */}
            <ErrorBoundary label="WaterTracker">
              <WaterTracker waterOz={waterOz} userProfile={userProfile} waterUnit={waterUnit} ozToDisplay={ozToDisplay} />
            </ErrorBoundary>

            {/* BUTTON ROW */}
            <div className="flex flex-wrap gap-2 pt-2">
              {/* Add Glass Button — blue to match the water theme */}
              <Button
                className="text-xs md:text-sm bg-info hover:bg-info active:bg-info text-white"
                onClick={() => guardSubmit(() => {
                  if (waterOz + 8 > WATER_DAILY_CAP_OZ) {
                    toast.error(tFallback('nutrition.toast.waterCap', "That's plenty of water for today. Stay safe!"));
                    return;
                  }
                  submitEntry({ date, food_name: waterFoodName(8), calories: 0, created_by: user?.email, user_id: user?.id });
                })}
                // Only the in-flight guard disables this. The cap is enforced
                // inside onClick, which raises a toast naming the limit —
                // and a disabled button never fires onClick, so gating on
                // the cap here made that toast unreachable and left a dead
                // control with no explanation. Let the tap through; let the
                // copy do its job.
                disabled={saveMutation.isPending}
              >
                <Droplet className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{getGlassLabel()}</span><span className="sm:hidden">Glass (8 oz)</span>
              </Button>

              {/* Custom Bottle Buttons */}
              {customBottles.map(bottle => (
                <motion.div
                  key={bottle.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="relative"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => guardSubmit(() => {
                      if (waterOz + bottle.oz > WATER_DAILY_CAP_OZ) {
                        toast.error(tFallback('nutrition.toast.waterCap', "That's plenty of water for today. Stay safe!"));
                        return;
                      }
                      submitEntry({ date, food_name: waterFoodName(bottle.oz), calories: 0, created_by: user?.email, user_id: user?.id });
                    })}
                    // Same as the Glass chip above — the cap is enforced in
                    // onClick with an explanatory toast, so disabling here
                    // silenced it. This is the one that bit: a bottle
                    // bigger than the daily cap was born permanently dead.
                    disabled={saveMutation.isPending}
                    className="pe-8 text-xs"
                  >
                    <WaterBottleIcon className="w-3.5 h-3.5 me-1 text-info" /> {bottle.label}
                  </Button>
                  <button
                    onClick={() => handleDeleteBottle(bottle.id)}
                    className="absolute -top-2 -end-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs hover:bg-destructive/90 active:bg-destructive/90"
                  >
                    ×
                  </button>
                </motion.div>
              ))}

              {/* Add Custom Bottle Button */}
              <Button
                variant="outline"
                className="border-dashed text-xs md:text-sm"
                onClick={() => setShowBottleModal(true)}
              >
                <Beaker className="w-4 h-4 me-1" /> <span className="hidden sm:inline">{t('nutrition.customBottle')}</span><span className="sm:hidden">{tFallback("nutrition.bottle", "Bottle")}</span>
              </Button>
            </div>

            {/* WATER ENTRY LOG — grouped by size */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Droplet className="w-3.5 h-3.5 shrink-0 text-info" />
                  {t('nutrition.waterEntries')}
                </p>
              </div>
              {waterEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('nutrition.noWater')}</p>
              ) : (
                <WaterEntryGroups
                  entries={waterEntries}
                  ozToDisplay={ozToDisplay}
                  waterUnit={waterUnit}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Custom Bottle Modal */}
      <Dialog open={showBottleModal} onOpenChange={setShowBottleModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('nutrition.addCustomBottle')}</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">{t('nutrition.bottleSize')}</p>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="bottle-nickname" className="text-sm font-medium mb-2 block">{tFallback("nutrition.nickname", "Nickname")} <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                id="bottle-nickname"
                type="text"
                placeholder={tFallback('nutrition.bottleNicknamePlaceholder', 'e.g. My Nalgene, Office Bottle')}
                value={bottleNickname}
                onChange={e => setBottleNickname(e.target.value)}
                maxLength={30}
              />
            </div>
            <div>
              <label htmlFor="bottle-amount" className="text-sm font-medium mb-2 block">{t('nutrition.amount')}</label>
              <Input
                id="bottle-amount"
                type="number" inputMode="decimal"
                min="1"
                max={bottleInputUnit === 'ml' ? Math.round(MAX_BOTTLE_OZ * 29.5735) : bottleInputUnit === 'L' ? (MAX_BOTTLE_OZ * 0.0295735).toFixed(1) : MAX_BOTTLE_OZ}
                placeholder="e.g. 32"
                value={bottleInput}
                onChange={e => setBottleInput(e.target.value)}
              />
              
            </div>
            <div>
              <span id="bottle-unit-label" className="text-sm font-medium mb-2 block">{t('nutrition.unit')}</span>
              <div
                role="group"
                aria-labelledby="bottle-unit-label"
                className="flex rounded-lg border border-border overflow-hidden bg-secondary/30"
              >
                {['oz', 'ml', 'L'].map(unit => (
                  <button
                    key={unit}
                    onClick={() => setBottleInputUnit(unit)}
                    aria-pressed={bottleInputUnit === unit}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      bottleInputUnit === unit
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground active:text-foreground'
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-4">
              <Button variant="outline" onClick={() => setShowBottleModal(false)} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSaveBottle} className="flex-1">
                {t('nutrition.saveBottle')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </>
      )}

      {rowId === 'fasting' && (
      <div className="mb-4">
        {!hiddenWidgets.includes('fasting') && (
          <div className="flex justify-end mb-1">
            <button
              type="button"
              onClick={() => hideWidget('fasting')}
              className="flex items-center gap-1 text-micro font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
            >
              <EyeOff className="w-3 h-3" /> {tFallback("injuries.cleared.hide", "Hide")}
            </button>
          </div>
        )}
        <FastingTrackerCard />
      </div>
      )}

      {rowId === 'meals' && (
      <motion.div className="space-y-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}>
        <h3 className="font-heading font-bold mb-4">{t('nutrition.todaysMeals')}</h3>
        <AnimatePresence>
          {entries.filter(entry => !isWaterEntry(entry)).length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="font-heading font-semibold">{t('nutrition.noMeals')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('nutrition.noMealsDesc')}</p>
            </Card>
          ) : (
            entries.filter(entry => !isWaterEntry(entry)).map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 100, height: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                whileHover={{ scale: 1.02, y: -1 }}
                style={{ overflow: 'hidden' }}>
                <Card
                  onClick={() => openMealDetail(entry)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMealDetail(entry); } }}
                  className="p-4 border-none shadow-sm flex items-center justify-between cursor-pointer hover:bg-secondary/40 active:bg-secondary/40 transition-colors"
                >
                  {/* Photo thumbnail — hints the meal is viewable in detail. */}
                  {entry.image_url && (
                    <img
                      src={entry.image_url}
                      alt=""
                      className="w-11 h-11 rounded-lg object-cover me-3 shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{entry.food_name}</p>
                    <p className="text-sm text-muted-foreground space-x-2">
                      <span>{entry.calories} cal</span>
                      {entry.protein_g > 0 && <span>• P: {entry.protein_g}g</span>}
                      {entry.carbs_g > 0 && <span>• C: {entry.carbs_g}g</span>}
                      {entry.fat_g > 0 && <span>• F: {entry.fat_g}g</span>}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tFallback ? tFallback('nutrition.deleteEntry', 'Delete entry') : 'Delete entry'}
                    onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(entry.id); }}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" aria-hidden="true" />
                  </Button>
                </Card>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </motion.div>
      )}

            </>
            )}
            </>)}
          </ReorderableRow>
          );
        })}
      </Reorder.Group>

      {/* Recipes hub — My Recipes + Discover, owns the builder */}
      <ErrorBoundary label="RecipesHubModal">
        <RecipesHubModal
          open={showRecipes}
          onClose={() => setShowRecipes(false)}
          userProfile={userProfile}
          logDate={date}
          defaultMealType={mealType}
          logBusy={saveMutation.isPending}
          // Logging a recipe goes through the SAME mutation as any other meal,
          // so quest credit, the achievement RPC, the first-meal celebration
          // and cache invalidation all happen exactly once and in one place.
          // See the head comment on LogRecipeSheet.
          onLogRecipe={(payload) => submitEntry(payload)}
        />
      </ErrorBoundary>

      {/* Guided in-app camera for Photo-AI — framing overlay + shutter. */}
      <ErrorBoundary label="FoodPhotoCaptureModal">
        <FoodPhotoCaptureModal
          open={showPhotoCapture}
          onClose={() => setShowPhotoCapture(false)}
          onCapture={handlePhotoCapture}
          onPickLibrary={() => { setShowPhotoCapture(false); photoInputRef.current?.click(); }}
        />
      </ErrorBoundary>

      {/* Out-of-scans upsell — shown when the daily Photo-AI allotment is spent. */}
      <ErrorBoundary label="PhotoAiLimitModal">
        <PhotoAiLimitModal
          open={!!photoLimit}
          used={photoLimit?.used ?? PHOTO_AI_DAILY_CAP}
          cap={photoLimit?.cap ?? PHOTO_AI_DAILY_CAP}
          purchasing={purchasingUnlimited}
          onClose={() => setPhotoLimit(null)}
          onPurchase={handlePurchaseUnlimited}
        />
      </ErrorBoundary>

      {/* Photo-AI result pop-out */}
      <ErrorBoundary label="PhotoMealResultModal">
        <PhotoMealResultModal
          open={showPhotoResult}
          imageUrl={photoImageUrl}
          result={photoResult}
          saving={saveMutation.isPending}
          onClose={closePhotoResult}
          onSave={saveRecognizedMeal}
        />
      </ErrorBoundary>

      {/* Read-only detail view — re-open a saved meal (image + metrics). */}
      <ErrorBoundary label="MealDetailModal">
        <PhotoMealResultModal
          open={!!mealDetail}
          readOnly
          imageUrl={mealDetail?.imageUrl}
          result={mealDetail?.result}
          onClose={() => setMealDetail(null)}
        />
      </ErrorBoundary>

      <ErrorBoundary label="MealHistoryModal">
        <MealHistoryModal
          open={showMealHistory}
          onClose={() => setShowMealHistory(false)}
          userProfile={userProfile}
          onLogPhoto={() => setShowPhotoCapture(true)}
          onLogManual={() => setOpenLogMeal(true)}
          onLogAgain={reLogMeal}
        />
      </ErrorBoundary>

      <ErrorBoundary label="CalorieCyclingModal">
        <CalorieCyclingModal
          open={showCalorieCycling}
          onClose={() => setShowCalorieCycling(false)}
        />
      </ErrorBoundary>

      {/* Search — fills the Log Meal form from foods this user already has. */}
      <ErrorBoundary label="FoodSearchSheet">
        <FoodSearchSheet
          open={showFoodSearch}
          onClose={() => setShowFoodSearch(false)}
          onPick={applySearchPick}
        />
      </ErrorBoundary>

      {/* Nutrition Goals Onboarding */}
      <ErrorBoundary label="NutritionOnboardingModal">
        <NutritionOnboardingModal
          open={showGoalsOnboarding}
          userProfile={userProfile}
          onComplete={handleOnboardingComplete}
          onDismiss={handleOnboardingDismiss}
        />
      </ErrorBoundary>

      {/* Nutrition Plans Modal */}
      <ErrorBoundary label="NutritionPlansModal">
        <NutritionPlansModal
          open={showNutritionPlans}
          onClose={() => setShowNutritionPlans(false)}
          userProfile={userProfile}
          onStartOnboarding={startNutritionOnboarding}
          trainingFuel={trainingFuel}
          onApplyFuel={() => { setShowNutritionPlans(false); setShowCalorieCycling(true); }}
        />
      </ErrorBoundary>

      {/* Weekly planner — 7-day grid + grocery list export */}
      <ErrorBoundary label="WeeklyMealPlannerModal">
        <WeeklyMealPlannerModal
          open={showWeeklyPlanner}
          onClose={() => setShowWeeklyPlanner(false)}
          userProfile={userProfile}
          onStartOnboarding={startNutritionOnboarding}
        />
      </ErrorBoundary>
    </motion.div>
  );
}



/* ── Grouped water entries ──────────────────────────────────────────────── */
function WaterEntryGroups({ entries, ozToDisplay, waterUnit, onDelete }) {
  const { tFallback } = useLanguage();
  // Group entries by their oz value so identical glasses collapse
  const groups = React.useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const key = waterEntryOz(e);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return Array.from(map.entries()).map(([oz, items]) => ({
      oz,
      label: `${ozToDisplay(oz)} ${waterUnit}`,
      count: items.length,
      ids: items.map(i => i.id),
      latestId: items[items.length - 1].id,
    }));
  }, [entries, ozToDisplay, waterUnit]);

  return (
    <div className="flex flex-wrap gap-2">
      {groups.map(g => (
        <motion.div
          key={g.oz}
          layout
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          className="flex items-center gap-1.5 ps-2.5 pe-1.5 py-1 rounded-full bg-info/10 border border-info/20 text-xs"
        >
          <Droplet className="w-3 h-3 text-info shrink-0" />
          <span className="font-medium text-info dark:text-info">{g.label}</span>
          {g.count > 1 && (
            <span className="font-heading font-bold text-micro px-1.5 py-0.5 rounded-full bg-info/20 text-info dark:text-info">
              ×{g.count}
            </span>
          )}
          <button
            onClick={() => onDelete(g.latestId)}
            className="ms-0.5 p-1 rounded-full text-muted-foreground hover:text-destructive active:text-destructive hover:bg-destructive/10 active:bg-destructive/10 transition-colors"
            title={tFallback("nutrition.removeOne", "Remove one")}
            aria-label={`Remove one ${g.label}`}
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </motion.div>
      ))}
    </div>
  );
}

function parseCameraError(err, t) {
  const msg = err?.message || String(err);
  if (/permission|notallowed|denied/i.test(msg)) return t('formcoach.cameraAccessDenied');
  if (/notfound|devices/i.test(msg)) return t('formcoach.noCameraFound');
  if (/notreadable|inuse/i.test(msg)) return t('formcoach.noCameraSupport');
  return msg || 'Could not start the camera.';
}