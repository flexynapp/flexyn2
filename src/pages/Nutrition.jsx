import React, { useState, useRef, useEffect, useMemo } from 'react';
import { filterAfterReset } from '@/lib/accountReset';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import * as nutritionData from '@/lib/data/nutrition';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { XP_REWARDS } from '@/lib/xpSystem';
import { toast } from 'sonner';
import { Trash2, TrendingUp, Loader2, Droplet, X, Beaker, History, ScanLine, ChevronDown, ChevronUp, Plus, Clock, ChevronRight, ChefHat, Calendar, ListChecks, GripVertical, LayoutGrid, RotateCcw, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import MacroNutrientBox from '@/components/nutrition/MacroNutrientBox';
import MineralsVitaminsBox from '@/components/nutrition/MineralsVitaminsBox';
import WaterTracker from '@/components/nutrition/WaterTracker';
import BarcodeResultModal from '@/components/nutrition/BarcodeResultModal';
import BarcodeNotFoundModal from '@/components/nutrition/BarcodeNotFoundModal';
import LogMealForm from '@/components/nutrition/LogMealForm';
import NutritionOnboardingModal from '@/components/nutrition/NutritionOnboardingModal';
import MealHistoryModal from '@/components/nutrition/MealHistoryModal';
import NutritionPlansModal from '@/components/nutrition/NutritionPlansModal';
import MealTypePicker, { autoPickMealType } from '@/components/nutrition/MealTypePicker';
import CalorieTopBar from '@/components/nutrition/CalorieTopBar';
import PortionGuide from '@/components/nutrition/PortionGuide';
import RecipeBuilderModal from '@/components/nutrition/RecipeBuilderModal';
import WeeklyMealPlannerModal from '@/components/nutrition/WeeklyMealPlannerModal';
import FastingTrackerCard from '@/components/nutrition/FastingTrackerCard';
import ErrorBoundary from '@/components/ErrorBoundary';
import { reportError } from '@/lib/reportError';
import { fireFirstMealCelebration } from '@/lib/firstMealCelebration';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { lookupBarcode } from '@/lib/foodLookup';
import { recognizeMealPhoto } from '@/lib/data/photoMealRecognition';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
// @zxing/browser is ~80 KB gzip. Most Nutrition sessions never open
// the barcode scanner — so we dynamic-import it inside the scan
// handler instead of pulling it into the entry chunk.
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { useLocation } from 'react-router-dom';

// Helpers for water entries — encode oz in food_name so the value survives
// even when the water_oz DB column doesn't exist (migration 006 not applied).
// Format: "Water" = 8 oz (legacy/standard glass), "Water|N" = N oz
const isWaterEntry = (e) => e.food_name === 'Water' || e.food_name?.startsWith('Water|');
const waterEntryOz = (e) => e.water_oz ?? (e.food_name?.startsWith('Water|') ? Number(e.food_name.split('|')[1]) : 8);
const waterFoodName = (oz) => oz === 8 ? 'Water' : `Water|${oz}`;

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
  const slides = [
    {
      id: 'scan',
      icon: ScanLine,
      emoji: '📷',
      color: '20 95% 55%',
      kicker: 'Scan a barcode',
      title: 'Scan Food',
      tip: 'Snap any package and we autofill macros, calories, and serving size. Fastest way to log.',
      ctaLabel: 'Open scanner',
      onCta: onScan,
    },
    {
      id: 'recipes',
      icon: ChefHat,
      emoji: '🥘',
      color: '160 80% 50%',
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
      color: '220 85% 60%',
      kicker: 'Meal History',
      title: 'Meal History',
      tip: 'Every meal you\'ve logged. Search, filter, and re-log past meals in two taps.',
      ctaLabel: 'Browse history',
      onCta: onHistory,
    },
    {
      id: 'plans',
      icon: ListChecks,
      emoji: '📋',
      color: '270 85% 60%',
      kicker: 'Nutrition Plans',
      title: 'Nutrition Plans',
      tip: 'Pre-built macro splits — cut, bulk, recomp, keto, maintenance. Apply one and your goals update.',
      ctaLabel: 'See plans',
      onCta: onPlans,
    },
    {
      id: 'planner',
      icon: Calendar,
      emoji: '📅',
      color: '330 80% 60%',
      kicker: 'Weekly Planner',
      title: 'Weekly Planner',
      tip: 'Drop meals into a 7-day grid. Hit your macro targets across the week, not just one day.',
      ctaLabel: 'Plan the week',
      onCta: onPlanner,
    },
  ];

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

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const t = setTimeout(() => setIdx(i => (i + 1) % slides.length), 8000);
    return () => clearTimeout(t);
  }, [idx, paused, slides.length]);

  useEffect(() => () => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
  }, []);

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

        <div className="relative p-4 md:p-5 min-h-[140px] flex flex-col justify-between gap-3">
          {/* Large translucent Lucide icon right-of-centre — symbol not emoji */}
          {Icon && (
            <Icon
              aria-hidden="true"
              className="absolute pointer-events-none select-none"
              style={{ width: 100, height: 100, opacity: 0.13, color: 'white', right: 16, top: '50%', transform: 'translateY(-50%)' }}
            />
          )}
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
              <h3 className="font-heading font-bold leading-none tracking-tight" style={{ fontSize: 'clamp(1.6rem, 5.5vw, 2.25rem)' }}>
                {slide.title}
              </h3>
              <p className="text-sm text-white/75 max-w-[36ch] leading-relaxed mt-2">
                {slide.tip}
              </p>
              <button
                type="button"
                onClick={slide.onCta}
                className="inline-flex items-center gap-1 mt-3 px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/35 backdrop-blur-sm text-[12px] font-semibold text-white transition-colors"
              >
                {slide.ctaLabel}
                <ChevronRight className="w-3.5 h-3.5 rtl:scale-x-[-1]" />
              </button>
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
}

export default function Nutrition() {
  const { t, tFallback } = useLanguage();
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
      window.history.replaceState({}, document.title, '/nutrition' + (search ? '?' + search : ''));
    } else {
      window.history.replaceState({}, document.title);
    }
    // Scroll to the form after a tick so the animation has started
    setTimeout(() => {
      const el = document.getElementById('log-meal-form');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, [location?.state?.openLogMeal, location.search]);
  // Date is always today's local date — Nutrition no longer supports past-day viewing.
  const date = format(new Date(), 'yyyy-MM-dd');

  // Reorderable sections — same mechanism as Dashboard customize.
  // Defaults to the order shown when the user opens a fresh Nutrition
  // page; can be dragged in edit mode and persists to localStorage
  // per-user. CalorieTopBar is intentionally NOT in this list — it
  // stays pinned at the top as the headline.
  // 'shortcuts' carousel is pinned above CalorieTopBar (not reorderable)
  // 'portionGuide' is its own reorderable section
  const DEFAULT_NUTRITION_ORDER = ['logForm', 'portionGuide', 'water', 'fasting', 'tabs', 'meals'];
  const [editMode, setEditMode] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState(DEFAULT_NUTRITION_ORDER);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('idle');
  const [scannerError, setScannerError] = useState(null);
  const [scannedProduct, setScannedProduct] = useState(null);
  const [notFoundBarcode, setNotFoundBarcode] = useState(null);

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

  // Hard daily cap: 200 oz (~5.9L). Beyond this is water-toxicity territory.
  const WATER_DAILY_CAP_OZ = 200;
  const [nutritionTab, setNutritionTab] = useState('macros');
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
  const [showRecipeBuilder, setShowRecipeBuilder] = useState(false);
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
  const [newEntry, setNewEntry] = useState({
    food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '',
    sodium_mg: '', fiber_g: '', sugar_g: '', cholesterol_mg: '',
    iron_mg: '', magnesium_mg: '', calcium_mg: '', potassium_mg: '',
    vitamin_a_iu: '', vitamin_c_mg: '', vitamin_d_iu: '', vitamin_b12_mcg: ''
  });
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const lastBarcodeRef = useRef(null);
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
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReorder = (newOrder) => {
    setWidgetOrder(newOrder);
    try { localStorage.setItem(`flexyn.nutritionWidgetOrder.${user?.id || 'anon'}`, JSON.stringify(newOrder)); } catch { /* ignore */ }
  };
  const handleResetOrder = () => {
    setWidgetOrder(DEFAULT_NUTRITION_ORDER);
    try { localStorage.removeItem(`flexyn.nutritionWidgetOrder.${user?.id || 'anon'}`); } catch { /* ignore */ }
  };

  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email
  });

  const [showGoalsOnboarding, setShowGoalsOnboarding] = useState(false);
  const [goalsModalManuallyOpened, setGoalsModalManuallyOpened] = useState(false);

  // Per-user localStorage keys (CLAUDE.md namespace convention).
  // Fall back to 'anon' before sign-in resolves so we don't error on
  // the read; the real user-keyed bucket takes over once auth lands.
  const scanHistoryKey = `flexyn.scanHistory.${user?.id || 'anon'}`;
  const nutritionOnboardedKey = `flexyn.nutritionOnboarded.${user?.id || 'anon'}`;

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
  // users who already onboarded.
  useEffect(() => {
    if (!user?.email) return;
    if (userProfile && Object.keys(userProfile).length === 0) return; // still loading
    const localDone = (() => {
      try {
        // Check per-user key first; fall back to legacy un-namespaced.
        return localStorage.getItem(nutritionOnboardedKey) === 'true'
            || localStorage.getItem('fn-nutrition-onboarded') === 'true';
      } catch { return false; }
    })();
    if (userProfile?.nutrition_onboarding_complete || localDone) return;
    if (goalsModalManuallyOpened) return;
    setShowGoalsOnboarding(true);
  }, [user?.email, userProfile?.nutrition_onboarding_complete, goalsModalManuallyOpened, nutritionOnboardedKey]);

  const handleOnboardingComplete = () => {
    setShowGoalsOnboarding(false);
    setGoalsModalManuallyOpened(false);
    queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
  };

  const openGoalsEditor = () => {
    setGoalsModalManuallyOpened(true);
    setShowGoalsOnboarding(true);
  };

  const { data: rawLogs = [], isLoading: logsLoading } = useQuery({
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
    // Strip non-DB telemetry flags (leading underscore) so they don't
    // trigger PostgREST strip-and-retry round-trips on save.
    mutationFn: ({ _via_barcode: _vb, ...data } = {}) => nutritionData.create(data),
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
    onSuccess: async (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['nutritionLogs', user?.email, date] });
      if (isWaterEntry(variables)) {
        // XP value comes from XP_REWARDS.waterGlass (single source of truth).
        // Was hardcoded to 1 inline, drifted from the documented 3.
        const xpForWater = (XP_REWARDS && XP_REWARDS.waterGlass) || 3;
        db.functions.invoke('updateUserXpAndAchievements', {
          xp_gained: xpForWater,
          action_type: 'water_logged',
          action_data: { date, oz: waterEntryOz(variables) },
        }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        toast.success(t('nutrition.toast.waterLogged'));
        // Quest progress — count one quest "tick" per logged glass entry
        quests.recordAction(user, ACTION_TYPES.WATER_LOGGED, 1)
          .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
          .catch(() => {});
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
      toast.error(t('nutrition.toast.saveError'));
    },
    onSettled: () => {
      // Clear the synchronous double-submit guard regardless of
      // success/failure so a legit retry after a network error
      // works without a 400ms wait.
      submitInFlightRef.current = false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => nutritionData.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutritionLogs', user?.email, date] });
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
  const handlePhotoMealPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so picking the same file twice still fires
    if (!file) return;
    setPhotoRecognizing(true);
    const res = await recognizeMealPhoto(file);
    setPhotoRecognizing(false);
    if (!res?.ok) {
      const err = res?.error;
      if (err === 'NOT_FOOD') toast.error("That doesn't look like food — try another photo.");
      else if (err === 'PIPELINE_MISSING') toast.error('Photo recognition isn\'t enabled yet.');
      else if (err === 'RATE_LIMIT') toast.error('Hit the rate limit — try again in a moment.');
      else if (err === 'TOO_LARGE') toast.error('Photo is too large — try a smaller image.');
      else toast.error('Could not recognize meal. Try again.');
      return;
    }
    const r = res.result || {};
    // Coerce + finite-check each macro. The LLM occasionally returns
    // string values like "≈340" or "N/A" — without coercion those
    // strings landed in state, got passed to addEntry, and persisted
    // to the DB as strings (which then broke arithmetic everywhere
    // else). Wave 57 (Cardio/Coach/Progress/Nutrition audit) caught
    // this.
    const finiteOr = (val, fallback) => {
      if (val == null) return fallback;
      const n = Number(val);
      return Number.isFinite(n) ? n : fallback;
    };
    setNewEntry(prev => ({
      ...prev,
      food_name:  (typeof r.food_name === 'string' && r.food_name.trim()) || prev.food_name,
      calories:   finiteOr(r.calories,  prev.calories),
      protein_g:  finiteOr(r.protein_g, prev.protein_g),
      carbs_g:    finiteOr(r.carbs_g,   prev.carbs_g),
      fat_g:      finiteOr(r.fat_g,     prev.fat_g),
      fiber_g:    finiteOr(r.fiber_g,   prev.fiber_g),
    }));
    toast.success(`Identified: ${r.food_name || 'meal'} — review macros and save.`);
    // Scroll the meal form into view so the user can review.
    setTimeout(() => {
      document.getElementById('log-meal-form')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const startScanner = async () => {
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
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      if (devices.length === 0) throw new Error('No camera found on this device.');
      const rearCamera = devices.find((d) => /back|rear|environment/i.test(d.label));
      const deviceId = rearCamera?.deviceId || devices[0].deviceId;

      readerRef.current = new BrowserMultiFormatReader();
      setScannerStatus('scanning');

      controlsRef.current = await readerRef.current.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        async (result) => {
          if (!result) return;
          const barcode = result.getText();
          if (barcode === lastBarcodeRef.current) return;
          lastBarcodeRef.current = barcode;
          setScannerStatus('looking-up');
          controlsRef.current?.stop();
          await lookupAndShow(barcode);
        }
      );
    } catch (e) {
      setScannerError(parseCameraError(e, t));
      setScannerStatus('error');
    }
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

  const stopScanner = () => {
    try { controlsRef.current?.stop(); } catch {}
    controlsRef.current = null;
    readerRef.current = null;
    lastBarcodeRef.current = null;
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
    return () => { try { controlsRef.current?.stop(); } catch {} };
  }, []);

  /* ========================================================= */

  const logProduct = (product) => {
    const n = product.nutrition;
    const v = product.vitamins || {};
    saveMutation.mutate({
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
    saveMutation.mutate({
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
      // Vitamins & minerals — now populated from USDA/community sources
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

  const addEntry = () => {
    if (!newEntry.food_name.trim()) { toast.error(t('nutrition.toast.enterFoodName')); return; }
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
    saveMutation.mutate({
      date,
      created_by: user?.email,
      user_id: user?.id,
      meal_type: mealType,
      ...safeEntry,
    });
    setNewEntry({ food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '', sodium_mg: '', fiber_g: '', sugar_g: '', cholesterol_mg: '', iron_mg: '', magnesium_mg: '', calcium_mg: '', potassium_mg: '', vitamin_a_iu: '', vitamin_c_mg: '', vitamin_d_iu: '', vitamin_b12_mcg: '' });
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
  const [bottleInputUnit, setBottleInputUnit] = useState('oz');
  const [bottleNickname, setBottleNickname] = useState('');

  // Largest commercial bottle: 5-gallon jug = 640 oz
  const MAX_BOTTLE_OZ = 640;

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
      toast.error(`Max bottle size is ${maxBottleInUnit(bottleInputUnit)} (5-gallon jug).`);
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
      className="px-4 pt-4 md:px-8 md:pt-8 lg:pb-8 max-w-4xl mx-auto">

      {/* ── Header row: title left, scanner CTA right ─────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="flex items-start justify-between gap-4 mb-6"
      >
        {/* Left — title + date + customize toggle */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight">{t('nutrition.title')}</h1>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setEditMode(e => !e)}
                title={editMode ? 'Done editing' : 'Customize'}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  editMode
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground/60 hover:text-foreground hover:bg-secondary'
                }`}
              >
                {editMode ? (
                  <><CheckCircle2 className="w-3.5 h-3.5" /><span>Done</span></>
                ) : (
                  <LayoutGrid className="w-3.5 h-3.5" />
                )}
              </button>
              {editMode && (
                <button
                  type="button"
                  onClick={handleResetOrder}
                  title="Reset to default"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              )}
            </div>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">{format(new Date(), 'EEEE, MMMM d')}</p>
        </div>

        {/* Right — Scan + History stacked */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {/* Primary scan button */}
          <motion.button
            whileHover={{ scale: 1.04, y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            onClick={startScanner}
            className="group relative flex items-center gap-2 px-4 py-2.5 rounded-xl font-heading font-bold text-sm text-primary-foreground overflow-hidden shadow-lg shadow-primary/30"
            style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8))' }}
          >
            {/* Shimmer sweep */}
            <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)' }} />
            <ScanLine className="w-4 h-4 shrink-0" />
            {tFallback('nutrition.scanFood', 'Scan Food')}
          </motion.button>

          {/* Photo-AI recognition trigger — hidden file input behind
              a styled button so iOS surfaces "Take photo" + "Choose
              from library" naturally. */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handlePhotoMealPick}
          />
          <motion.button
            whileHover={{ scale: 1.04, y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            onClick={() => photoInputRef.current?.click()}
            disabled={photoRecognizing}
            className="group relative flex items-center gap-2 px-4 py-2.5 rounded-xl font-heading font-bold text-sm text-white overflow-hidden shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4338ca)' }}
          >
            {photoRecognizing
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <span className="text-base leading-none">📸</span>}
            {photoRecognizing ? tFallback('nutrition.reading', 'Reading…') : tFallback('nutrition.photoAi', 'Photo-AI')}
          </motion.button>

          {/* Scanner history toggle */}
          <button
            onClick={() => setShowScanHistory(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            Scanner History
            {scanHistory.length > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center">
                {scanHistory.length}
              </span>
            )}
            {showScanHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
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
                  <span className="font-heading font-bold text-sm">Scanner History</span>
                </div>
                {scanHistory.length > 0 && (
                  <button
                    onClick={() => {
                      setScanHistory([]);
                      try { localStorage.removeItem(scanHistoryKey); } catch {}
                    }}
                    className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
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
                        className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors"
                      >
                        {/* Food info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold leading-tight truncate">{item.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {cal != null && (
                              <span className="text-[11px] text-orange-500 font-medium">{Math.round(cal)} kcal</span>
                            )}
                            {pro != null && (
                              <span className="text-[11px] text-muted-foreground">P {Math.round(pro)}g</span>
                            )}
                            {carb != null && (
                              <span className="text-[11px] text-muted-foreground">C {Math.round(carb)}g</span>
                            )}
                            {fat != null && (
                              <span className="text-[11px] text-muted-foreground">F {Math.round(fat)}g</span>
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
                          className="shrink-0 w-8 h-8 rounded-full bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground flex items-center justify-center transition-colors disabled:opacity-50"
                          title="Log to today"
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
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary" />
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
            </div>
            {scannerStatus === 'scanning' && (
              <p className="text-xs text-muted-foreground text-center mb-3">{t('nutrition.pointCamera')}</p>
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
        onRecipes={() => setShowRecipeBuilder(true)}
        onHistory={() => setShowMealHistory(true)}
        onPlans={() => setShowNutritionPlans(true)}
        onPlanner={() => setShowWeeklyPlanner(true)}
      />

      {/* Quick-access row — same 5 actions as icon buttons for users who miss the carousel */}
      <div className="flex gap-2 mb-1">
        {[
          { label: 'Scan',    icon: ScanLine,   action: startScanner },
          { label: 'Recipes', icon: ChefHat,    action: () => setShowRecipeBuilder(true) },
          { label: 'History', icon: History,    action: () => setShowMealHistory(true) },
          { label: 'Plans',   icon: ListChecks, action: () => setShowNutritionPlans(true) },
          { label: 'Planner', icon: Calendar,   action: () => setShowWeeklyPlanner(true) },
        ].map(({ label, icon: Icon, action }) => (
          <button key={label} type="button" onClick={action}
            className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl bg-secondary/60 border border-border/40 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <Icon className="w-4 h-4" />
            <span className="text-[10px] font-semibold">{label}</span>
          </button>
        ))}
      </div>

      {/* Calorie counter — just below the shortcut row */}
      <CalorieTopBar entries={entries} userProfile={userProfile} />

      {/* ═══ Reorderable sections — drag in edit mode to reorder.
              Each Reorder.Item iteration matches widgetOrder; inside,
              a chain of `{id === 'X' && (...)}` conditionals filters
              to the one section that matches the id. Per-user
              localStorage via flexyn.nutritionWidgetOrder.<userId>. ═══ */}
      <Reorder.Group axis="y" values={widgetOrder} onReorder={handleReorder} as="div">
        {widgetOrder.map(rowId => (
          <Reorder.Item
            key={rowId}
            value={rowId}
            as="div"
            dragListener={editMode}
            className={`relative ${editMode ? 'touch-none select-none' : ''}`}
          >
            {editMode && (
              <div className="flex items-center gap-2 mt-2 mb-1 px-1 cursor-grab active:cursor-grabbing">
                <GripVertical className="w-4 h-4 text-primary/50" />
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/50">
                  {rowId === 'tabs'         ? 'Nutritional Values'
                    : rowId === 'logForm'   ? 'Log A Meal'
                    : rowId === 'portionGuide' ? 'Portion Guide'
                    : rowId === 'water'     ? 'Water Intake'
                    : rowId === 'fasting'   ? 'Intermittent Fasting'
                    : rowId === 'meals'     ? "Today's Meals"
                    : rowId}
                </span>
              </div>
            )}

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
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${nutritionTab === tab.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
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

      {rowId === 'portionGuide' && (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mb-4">
        <PortionGuide />
      </motion.div>
      )}

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
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Meal</p>
          <MealTypePicker value={mealType} onChange={setMealType} />
        </div>
        <ErrorBoundary label="LogMealForm">
          <LogMealForm
            newEntry={newEntry}
            setNewEntry={setNewEntry}
            onScan={startScanner}
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
              <h3 className="font-heading text-lg font-bold">{t('nutrition.waterIntake')}</h3>
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
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
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
              {/* Add Glass Button */}
              <Button
                className="text-xs md:text-sm"
                onClick={() => guardSubmit(() => {
                  if (waterOz + 8 > WATER_DAILY_CAP_OZ) {
                    toast.error(`Daily water limit reached (${ozToDisplay(WATER_DAILY_CAP_OZ)} ${waterUnit}). Stay safe!`);
                    return;
                  }
                  saveMutation.mutate({ date, food_name: waterFoodName(8), calories: 0, created_by: user?.email, user_id: user?.id });
                })}
                disabled={saveMutation.isPending || waterOz + 8 > WATER_DAILY_CAP_OZ}
              >
                <Droplet className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">{getGlassLabel()}</span><span className="sm:hidden">Glass (8 oz)</span>
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
                        toast.error(`Daily water limit reached (${ozToDisplay(WATER_DAILY_CAP_OZ)} ${waterUnit}). Stay safe!`);
                        return;
                      }
                      saveMutation.mutate({ date, food_name: waterFoodName(bottle.oz), calories: 0, created_by: user?.email, user_id: user?.id });
                    })}
                    disabled={saveMutation.isPending || waterOz + bottle.oz > WATER_DAILY_CAP_OZ}
                    className="pr-8 text-xs"
                  >
                    🍶 {bottle.label}
                  </Button>
                  <button
                    onClick={() => handleDeleteBottle(bottle.id)}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs hover:bg-destructive/90"
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
                <Beaker className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">{t('nutrition.customBottle')}</span><span className="sm:hidden">Bottle</span>
              </Button>
            </div>

            {/* WATER ENTRY LOG — grouped by size */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-muted-foreground">{t('nutrition.waterEntries')}</p>
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
              <label htmlFor="bottle-nickname" className="text-sm font-medium mb-2 block">Nickname <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                id="bottle-nickname"
                type="text"
                placeholder="e.g. My Nalgene, Office Bottle"
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
              <p className="text-xs text-muted-foreground mt-1">Max: {maxBottleInUnit(bottleInputUnit)}</p>
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
                        : 'text-muted-foreground hover:text-foreground'
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
                <Card className="p-4 border-none shadow-sm flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium">{entry.food_name}</p>
                    <p className="text-sm text-muted-foreground space-x-2">
                      <span>{entry.calories} kcal</span>
                      {entry.protein_g > 0 && <span>• P: {entry.protein_g}g</span>}
                      {entry.carbs_g > 0 && <span>• C: {entry.carbs_g}g</span>}
                      {entry.fat_g > 0 && <span>• F: {entry.fat_g}g</span>}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tFallback ? tFallback('nutrition.deleteEntry', 'Delete entry') : 'Delete entry'}
                    onClick={() => deleteMutation.mutate(entry.id)}
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

          </Reorder.Item>
        ))}
      </Reorder.Group>

      {/* Meal History Modal */}
      <ErrorBoundary label="RecipeBuilderModal">
        <RecipeBuilderModal
          open={showRecipeBuilder}
          onClose={() => setShowRecipeBuilder(false)}
        />
      </ErrorBoundary>

      <ErrorBoundary label="MealHistoryModal">
        <MealHistoryModal
          open={showMealHistory}
          onClose={() => setShowMealHistory(false)}
          userProfile={userProfile}
        />
      </ErrorBoundary>

      {/* Nutrition Goals Onboarding */}
      <ErrorBoundary label="NutritionOnboardingModal">
        <NutritionOnboardingModal
          open={showGoalsOnboarding}
          userProfile={userProfile}
          onComplete={handleOnboardingComplete}
        />
      </ErrorBoundary>

      {/* Nutrition Plans Modal */}
      <ErrorBoundary label="NutritionPlansModal">
        <NutritionPlansModal
          open={showNutritionPlans}
          onClose={() => setShowNutritionPlans(false)}
          userProfile={userProfile}
        />
      </ErrorBoundary>

      {/* Weekly planner — 7-day grid + grocery list export */}
      <ErrorBoundary label="WeeklyMealPlannerModal">
        <WeeklyMealPlannerModal
          open={showWeeklyPlanner}
          onClose={() => setShowWeeklyPlanner(false)}
        />
      </ErrorBoundary>
    </motion.div>
  );
}



/* ── Grouped water entries ──────────────────────────────────────────────── */
function WaterEntryGroups({ entries, ozToDisplay, waterUnit, onDelete }) {
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
          className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs"
        >
          <Droplet className="w-3 h-3 text-blue-500 shrink-0" />
          <span className="font-medium text-blue-700 dark:text-blue-300">{g.label}</span>
          {g.count > 1 && (
            <span className="font-heading font-bold text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400">
              ×{g.count}
            </span>
          )}
          <button
            onClick={() => onDelete(g.latestId)}
            className="ml-0.5 p-1 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Remove one"
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