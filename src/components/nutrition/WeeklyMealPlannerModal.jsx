// src/components/nutrition/WeeklyMealPlannerModal.jsx
//
// 7-day meal-planner grid. The `meal_plans` table + the
// `buildGroceryList` helper (mig 123 + lib/data/mealPlans.js) shipped
// weeks ago; this is the UI that finally surfaces both.
//
// Layout:
//   Row 1: 7 day cards (Mon → Sun), each with 4 meal slots
//          (Breakfast / Lunch / Dinner / Snack).
//   Row 2: "Generate grocery list" CTA → sums ingredients across all
//          uncompleted plans and renders a downloadable PNG via
//          Canvas 2D (same pattern as WorkoutShareCard).
//
// Tap a slot → recipe picker (your saved recipes). Tap an already-
// filled slot → swap or remove via a small menu. Long-press isn't
// used here; tapping a filled slot reveals the action menu inline.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  X, ChevronLeft, ChevronRight, ChevronDown, Loader2, Plus,
  CalendarDays, Camera, ChefHat, Pencil, ChevronRight as ChevRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, addDays, startOfWeek } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import * as mealPlans from '@/lib/data/mealPlans';
import * as recipes from '@/lib/data/nutritionRecipes';
import { syncPlannerDiaryLog, removePlannerDiaryLog, remove as removeDiaryLog } from '@/lib/data/nutrition';
import { recognizeMealPhoto } from '@/lib/data/photoMealRecognition';
import { NutritionPlansPanel } from '@/components/nutrition/NutritionPlansModal';
import PhotoMealResultModal from '@/components/nutrition/PhotoMealResultModal';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const MEAL_SLOTS = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { key: 'lunch',     label: 'Lunch',     emoji: '🥗' },
  { key: 'dinner',    label: 'Dinner',    emoji: '🍽️' },
  { key: 'snack',     label: 'Snack',     emoji: '🍎' },
];

// Full nutrient set for manual meal entry — mirrors LogMealForm so the
// planner can capture any nutrient, not just the four headline macros.
const MANUAL_MACRO_FIELDS = [
  { key: 'calories',       label: 'Calories',    unit: 'cal', color: 'text-orange-600' },
  { key: 'protein_g',      label: 'Protein',     unit: 'g',    color: 'text-red-600' },
  { key: 'carbs_g',        label: 'Carbs',       unit: 'g',    color: 'text-blue-600' },
  { key: 'fat_g',          label: 'Fat',         unit: 'g',    color: 'text-yellow-600' },
  { key: 'fiber_g',        label: 'Fiber',       unit: 'g',    color: 'text-green-600' },
  { key: 'sugar_g',        label: 'Sugar',       unit: 'g',    color: 'text-purple-600' },
  { key: 'sodium_mg',      label: 'Sodium',      unit: 'mg',   color: 'text-pink-600' },
  { key: 'cholesterol_mg', label: 'Cholesterol', unit: 'mg',   color: 'text-cyan-600' },
];
const MANUAL_MICRO_FIELDS = [
  { key: 'iron_mg',         label: 'Iron',        unit: 'mg',  color: 'text-red-600' },
  { key: 'magnesium_mg',    label: 'Magnesium',   unit: 'mg',  color: 'text-emerald-600' },
  { key: 'calcium_mg',      label: 'Calcium',     unit: 'mg',  color: 'text-slate-600' },
  { key: 'potassium_mg',    label: 'Potassium',   unit: 'mg',  color: 'text-yellow-600' },
  { key: 'vitamin_a_iu',    label: 'Vitamin A',   unit: 'IU',  color: 'text-orange-600' },
  { key: 'vitamin_c_mg',    label: 'Vitamin C',   unit: 'mg',  color: 'text-rose-600' },
  { key: 'vitamin_d_iu',    label: 'Vitamin D',   unit: 'IU',  color: 'text-amber-600' },
  { key: 'vitamin_b12_mcg', label: 'Vitamin B12', unit: 'mcg', color: 'text-purple-600' },
];
const MANUAL_ALL_FIELDS = [...MANUAL_MACRO_FIELDS, ...MANUAL_MICRO_FIELDS];
const emptyNutrients = () => MANUAL_ALL_FIELDS.reduce((acc, f) => { acc[f.key] = ''; return acc; }, {});

function weekStart(date) {
  // ISO week (Mon as start) so Sun stays at the END, not start.
  return startOfWeek(date, { weekStartsOn: 1 });
}

function isoDay(date) {
  return format(date, 'yyyy-MM-dd');
}

// ── Recipe-picker sub-modal ────────────────────────────────────────────
function RecipePickerModal({ open, recipes: recipeList, onPick, onClose }) {
  if (!open) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      onClick={onClose}
      className="fixed inset-0 z-[10000] bg-black/60 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div
        initial={{ y: 24 }} animate={{ y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-card border border-border rounded-2xl shadow-2xl max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-heading font-bold text-sm">Pick a recipe</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {recipeList.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No saved recipes yet — build one in the Recipe Builder.
            </p>
          ) : recipeList.map(r => (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              className="w-full text-start px-3 py-2 rounded-lg border border-border bg-secondary/40 hover:bg-secondary text-sm font-medium transition-colors"
            >
              {r.name}
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {Array.isArray(r.ingredients) ? `${r.ingredients.length} ingredient${r.ingredients.length === 1 ? '' : 's'}` : ''}
              </p>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── "How do you want to add this meal?" chooser ────────────────────────
// Shown when a user taps an empty meal slot. Three ways in: Photo-AI
// (snap the plate), Recipe (their saved recipes), or Manual (type the
// macros). Mirrors the entry points on the Nutrition page's log form.
function AddMethodSheet({ open, mealLabel, onPhoto, onRecipe, onManual, onClose }) {
  if (!open) return null;
  const options = [
    { key: 'photo',  label: 'Photo-AI', desc: 'Snap a photo of your plate', Icon: Camera,  onClick: onPhoto,  tint: 'text-violet-500 bg-violet-500/10' },
    { key: 'recipe', label: 'Recipe',   desc: 'Pick from your saved recipes', Icon: ChefHat, onClick: onRecipe, tint: 'text-emerald-500 bg-emerald-500/10' },
    { key: 'manual', label: 'Manual',   desc: 'Enter the macros by hand',   Icon: Pencil,  onClick: onManual, tint: 'text-sky-500 bg-sky-500/10' },
  ];
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      onClick={onClose}
      className="fixed inset-0 z-[10000] bg-black/60 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div
        initial={{ y: 24 }} animate={{ y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-card border border-border rounded-2xl shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-heading font-bold text-sm">Add {mealLabel?.toLowerCase() || 'meal'}</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-3 space-y-2">
          {options.map(({ key, label, desc, Icon, onClick, tint }) => (
            <button
              key={key}
              onClick={onClick}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-border bg-secondary/40 hover:bg-secondary transition-colors text-start"
            >
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tint}`}>
                <Icon className="w-4 h-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm">{label}</span>
                <span className="block text-[11px] text-muted-foreground">{desc}</span>
              </span>
              <ChevRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Manual meal entry sub-modal ────────────────────────────────────────
// Compact name + core-macros form. Saves a `food_snapshot` on the plan
// cell (same shape a Photo-AI result produces), so the grid renders the
// name and the macros ride along for anything that reads them later.
function ManualMealModal({ open, mealLabel, onSave, onClose }) {
  const [name, setName] = useState('');
  const [values, setValues] = useState(emptyNutrients);
  const [showMicros, setShowMicros] = useState(false);

  useEffect(() => {
    if (open) { setName(''); setValues(emptyNutrients()); setShowMicros(false); }
  }, [open]);

  if (!open) return null;

  const canSave = name.trim().length > 0;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

  // Plain render helper (not a nested component) so the inputs aren't
  // remounted each keystroke — that would drop focus mid-typing.
  const renderInput = (f) => (
    <div key={f.key}>
      <label className={`text-[11px] font-bold uppercase tracking-wide ${f.color}`}>{f.label}</label>
      <div className="mt-1 flex items-center rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-primary/40">
        <input
          type="number"
          inputMode="decimal"
          value={values[f.key]}
          onChange={(e) => setValues(v => ({ ...v, [f.key]: e.target.value }))}
          placeholder="0"
          className="w-full px-3 py-2 rounded-lg bg-transparent text-sm focus:outline-none"
        />
        <span className="pe-3 text-[10px] text-muted-foreground shrink-0">{f.unit}</span>
      </div>
    </div>
  );

  const handleSave = () => {
    const snapshot = { name: name.trim() };
    for (const f of MANUAL_ALL_FIELDS) snapshot[f.key] = num(values[f.key]);
    onSave(snapshot);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      onClick={onClose}
      className="fixed inset-0 z-[10001] bg-black/60 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div
        initial={{ y: 24 }} animate={{ y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h3 className="font-heading font-bold text-sm">Add {mealLabel || 'Meal'} Manually</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Meal name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mealLabel === 'Breakfast' ? 'e.g. Eggs & toast' : 'e.g. Chicken & rice'}
              autoFocus
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Macros — always shown. */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Macros</p>
            <div className="grid grid-cols-2 gap-2">
              {MANUAL_MACRO_FIELDS.map(renderInput)}
            </div>
          </div>

          {/* Vitamins & minerals — collapsed by default so the common
              case stays fast, but every nutrient is one tap away. */}
          <div>
            <button
              type="button"
              onClick={() => setShowMicros(s => !s)}
              className="w-full flex items-center justify-between px-1 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
            >
              Vitamins &amp; minerals
              <ChevronDown className={`w-4 h-4 transition-transform ${showMicros ? 'rotate-180' : ''}`} />
            </button>
            {showMicros && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                {MANUAL_MICRO_FIELDS.map(renderInput)}
              </div>
            )}
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border shrink-0">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            Add to {mealLabel?.toLowerCase() || 'plan'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main planner modal ────────────────────────────────────────────────
export default function WeeklyMealPlannerModal({ open, onClose, userProfile, onStartOnboarding }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useBodyScrollLock(open);
  const [anchor, setAnchor] = useState(() => new Date());
  const [pickerSlot, setPickerSlot] = useState(null); // { date, mealType } → recipe picker
  const [addSlot, setAddSlot]       = useState(null); // { date, mealType, label } → method chooser
  const [manualSlot, setManualSlot] = useState(null); // { date, mealType, label } → manual form
  const [detailPlan, setDetailPlan] = useState(null); // { plan, date, mealType } → read-only detail view
  const [photoBusy, setPhotoBusy]   = useState(false);
  // Custom horizontal scroll indicator metrics (pct = position 0..1,
  // ratio = viewport/content). Replaces the native scrollbar so the
  // slide bar sits centered under the calendar instead of pinned left.
  const [scrollMeta, setScrollMeta] = useState({ pct: 0, ratio: 1 });
  // Two tabs: the 7-day grid ('planner') and the Nutrition Plans browser
  // ('plans'), which was folded in here from its own modal.
  const [tab, setTab] = useState('planner');

  // Horizontal-scroll centering: keep today's column in the middle of the
  // viewport when the current week is shown, so the user opens straight
  // onto "today" rather than Monday scrolled off-screen.
  const scrollRef = useRef(null);
  const todayRef  = useRef(null);
  // Photo-AI: hidden file input + the slot the photo is being added to.
  const photoInputRef  = useRef(null);
  const photoTargetRef = useRef(null);

  const ws = useMemo(() => weekStart(anchor), [anchor]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(ws, i)),
    [ws],
  );
  const startStr = isoDay(days[0]);
  const endStr   = isoDay(days[6]);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['mealPlans', user?.id, startStr, endStr],
    queryFn:  () => mealPlans.listInRange(user.id, startStr, endStr),
    enabled:  !!user?.id && open,
    staleTime: 30_000,
  });

  const { data: recipeList = [] } = useQuery({
    queryKey: ['nutritionRecipes', user?.id],
    queryFn:  () => recipes.listMine(user.id),
    enabled:  !!user?.id && open,
    staleTime: 5 * 60_000,
  });

  const recipesById = useMemo(() => {
    const m = new Map();
    for (const r of recipeList) m.set(r.id, r);
    return m;
  }, [recipeList]);

  // Plans keyed by `${date}-${mealType}` for O(1) cell lookup.
  const planMap = useMemo(() => {
    const m = new Map();
    for (const p of plans) m.set(`${p.plan_date}-${p.meal_type}`, p);
    return m;
  }, [plans]);

  const upsertMutation = useMutation({
    mutationFn: (args) => mealPlans.upsert(args),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['mealPlans', user?.id, startStr, endStr] }),
    onError:    () => toast.error('Could not save plan.'),
  });

  const removeMutation = useMutation({
    mutationFn: (id) => mealPlans.remove(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['mealPlans', user?.id, startStr, endStr] }),
    onError:    () => toast.error('Could not remove plan.'),
  });

  const handlePick = (recipe) => {
    if (!pickerSlot) return;
    upsertMutation.mutate({
      user,
      planDate: pickerSlot.date,
      mealType: pickerSlot.mealType,
      recipeId: recipe.id,
    });
    setPickerSlot(null);
  };

  // Drag-to-scroll for mouse / trackpad. Touch keeps native horizontal
  // panning (touch-action: pan-x below), so we skip touch pointers here.
  // `moved` lets the meal-slot buttons ignore the click that ends a drag.
  const drag = useRef({ down: false, moved: false, startX: 0, startScroll: 0 });

  const onGridPointerDown = (e) => {
    if (e.pointerType === 'touch') return;
    const c = scrollRef.current;
    if (!c) return;
    drag.current = { down: true, moved: false, startX: e.clientX, startScroll: c.scrollLeft };
  };
  const onGridPointerMove = (e) => {
    const d = drag.current;
    if (!d.down) return;
    const c = scrollRef.current;
    if (!c) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 5) return; // let small movements stay a click
    d.moved = true;
    c.scrollLeft = d.startScroll - dx;
  };
  const endGridDrag = () => { drag.current.down = false; };

  // Recompute the custom scroll-indicator geometry from the container.
  // rAF-throttled so a burst of scroll events coalesces to one state update
  // per frame instead of re-rendering the whole modal on every event.
  const scrollRaf = useRef(0);
  const updateScrollMeta = () => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const c = scrollRef.current;
      if (!c) return;
      const max = c.scrollWidth - c.clientWidth;
      setScrollMeta({
        pct:   max > 0 ? c.scrollLeft / max : 0,
        ratio: c.scrollWidth > 0 ? Math.min(1, c.clientWidth / c.scrollWidth) : 1,
      });
    });
  };

  // Center today's column in the horizontal scroll whenever the planner
  // tab shows the current week's grid. rAF so we measure after layout.
  useEffect(() => {
    if (!open || tab !== 'planner' || isLoading) return;
    const id = requestAnimationFrame(() => {
      const c = scrollRef.current;
      const tEl = todayRef.current;
      if (c && tEl) {
        const cRect = c.getBoundingClientRect();
        const tRect = tEl.getBoundingClientRect();
        const delta = (tRect.left - cRect.left) - (c.clientWidth - tRect.width) / 2;
        c.scrollLeft += delta;
      }
      updateScrollMeta();
    });
    return () => cancelAnimationFrame(id);
  }, [open, tab, isLoading, ws]);

  const finiteOr = (val, fb) => {
    const n = Number(val);
    return Number.isFinite(n) ? n : fb;
  };

  // Photo-AI: recognize the plate, then drop the result on the target
  // slot as a food_snapshot (no recipe row needed).
  const handlePhotoFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    const target = photoTargetRef.current;
    photoTargetRef.current = null;
    if (!file || !target) return;
    setPhotoBusy(true);
    const res = await recognizeMealPhoto(file);
    setPhotoBusy(false);
    if (!res?.ok) {
      const err = res?.error;
      if (err === 'NOT_FOOD') toast.error("That doesn't look like food — try another photo.");
      else if (err === 'RATE_LIMIT') toast.error('Hit the rate limit — try again in a moment.');
      else if (err === 'PIPELINE_MISSING') toast.error("Photo recognition isn't enabled yet.");
      else toast.error('Could not recognize meal. Try again.');
      return;
    }
    const r = res.result || {};
    const snapshot = {
      name:      (typeof r.food_name === 'string' && r.food_name.trim()) || 'Meal',
      calories:  finiteOr(r.calories,  0),
      protein_g: finiteOr(r.protein_g, 0),
      carbs_g:   finiteOr(r.carbs_g,   0),
      fat_g:     finiteOr(r.fat_g,     0),
      fiber_g:   finiteOr(r.fiber_g,   0),
    };
    upsertMutation.mutate({ user, planDate: target.date, mealType: target.mealType, foodSnapshot: snapshot });
    logToDiaryIfToday(target.date, snapshot, target.mealType);
    toast.success(`Added: ${r.food_name || 'meal'}`);
  };

  // Refresh the diary-backed surfaces (Nutrition page total + dashboard rings)
  // after a planner meal is synced to / removed from today's diary.
  const invalidateDiary = () => {
    const today = isoDay(new Date());
    queryClient.invalidateQueries({ queryKey: ['nutritionLogs', user?.email, today] });
    queryClient.invalidateQueries({ queryKey: ['nutritionLogsRecent', user?.email] });
  };

  // A meal planned for TODAY is a meal eaten today — mirror it into the diary
  // so it counts toward calories, Nutritional Values, and the dashboard rings.
  // Idempotent per slot (notes:'planner'), so re-adding replaces rather than
  // double-counts. Future-dated plans stay plan-only.
  const logToDiaryIfToday = (planDate, snap, mealType) => {
    if (!snap || planDate !== isoDay(new Date())) return;
    syncPlannerDiaryLog({ user, date: planDate, mealType, snapshot: snap })
      .then(invalidateDiary)
      .catch(() => {});
  };

  const handleManualSave = (snapshot) => {
    if (!manualSlot) return;
    upsertMutation.mutate({
      user,
      planDate: manualSlot.date,
      mealType: manualSlot.mealType,
      foodSnapshot: snapshot,
    });
    logToDiaryIfToday(manualSlot.date, snapshot, manualSlot.mealType);
    setManualSlot(null);
  };

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[9999] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 24 }} animate={{ y: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-4xl bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
          style={{ maxHeight: '92vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-primary shrink-0" />
              <h2 className="font-heading font-bold text-base leading-tight">Weekly Plan &amp; Plans</h2>
            </div>
            <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tab switcher — Weekly plan grid vs. Nutrition Plans browser */}
          <div className="flex gap-1 p-1 mx-4 my-2 bg-secondary rounded-lg shrink-0">
            {[
              { id: 'planner', label: 'Weekly Plan' },
              { id: 'plans',   label: 'Nutritional Plans' },
            ].map(tb => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  tab === tb.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {tab === 'plans' ? (
            /* Nutrition Plans — folded in from the old standalone modal.
               px-4/pt-4 so PlanDetail's negative-margin hero bleeds right. */
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 pt-4 pb-6">
              <NutritionPlansPanel userProfile={userProfile} onStartOnboarding={onStartOnboarding} />
            </div>
          ) : (
          <>
          {/* Week nav */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
            <button
              onClick={() => setAnchor(addDays(ws, -7))}
              className="w-8 h-8 rounded-full bg-secondary/60 flex items-center justify-center hover:bg-secondary"
              aria-label="Previous week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold tabular-nums">
              {format(days[0], 'MMM d')} – {format(days[6], 'MMM d, yyyy')}
            </span>
            <button
              onClick={() => setAnchor(addDays(ws, 7))}
              className="w-8 h-8 rounded-full bg-secondary/60 flex items-center justify-center hover:bg-secondary"
              aria-label="Next week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Grid — horizontal scroll on mobile, grid on desktop.
              Native scrollbar hidden; a centered custom indicator below
              reflects scroll position. */}
          <div
            ref={scrollRef}
            onScroll={updateScrollMeta}
            onPointerDown={onGridPointerDown}
            onPointerMove={onGridPointerMove}
            onPointerUp={endGridDrag}
            onPointerLeave={endGridDrag}
            style={{ touchAction: 'pan-x' }}
            className="flex-1 overflow-x-auto overflow-y-auto scrollbar-hide p-3 cursor-grab active:cursor-grabbing select-none"
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-2 min-w-[700px]">
                {days.map(d => {
                  const dateStr = isoDay(d);
                  const isToday = dateStr === isoDay(new Date());
                  return (
                    <div key={dateStr} ref={isToday ? todayRef : undefined} className="flex flex-col">
                      <div className={`text-center pb-2 mb-1 border-b border-border/60 ${isToday ? 'text-primary font-bold' : ''}`}>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {format(d, 'EEE')}
                        </p>
                        <p className={`font-heading font-bold text-base ${isToday ? 'text-primary' : ''}`}>
                          {format(d, 'd')}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        {MEAL_SLOTS.map(slot => {
                          const cellKey = `${dateStr}-${slot.key}`;
                          const plan = planMap.get(cellKey);
                          const recipe = plan?.recipe_id ? recipesById.get(plan.recipe_id) : null;
                          return (
                            <button
                              key={slot.key}
                              onClick={() => {
                                // Ignore the click that ends a drag-scroll.
                                if (drag.current.moved) { drag.current.moved = false; return; }
                                if (plan) {
                                  // Meals with a food_snapshot (Photo-AI / manual) open a
                                  // read-only detail view with the photo + metrics + Delete.
                                  // Recipe-only slots keep the quick confirm-remove.
                                  if (plan.food_snapshot) {
                                    setDetailPlan({ plan, date: dateStr, mealType: slot.key });
                                  } else if (confirm('Remove this meal?')) {
                                    removeMutation.mutate(plan.id);
                                    // If this slot was mirrored into today's diary, un-log it too.
                                    if (dateStr === isoDay(new Date())) {
                                      removePlannerDiaryLog({ user, date: dateStr, mealType: slot.key })
                                        .then(invalidateDiary)
                                        .catch(() => {});
                                    }
                                  }
                                } else {
                                  setAddSlot({ date: dateStr, mealType: slot.key, label: slot.label });
                                }
                              }}
                              className={`w-full min-h-[58px] rounded-lg px-1.5 py-1.5 text-start text-[10px] font-medium transition-colors flex flex-col ${
                                plan
                                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-foreground'
                                  : 'bg-secondary/40 border border-dashed border-border text-muted-foreground hover:bg-secondary/60'
                              }`}
                            >
                              <span className="text-[10px] flex items-center gap-1">
                                <span aria-hidden="true">{slot.emoji}</span>
                                <span className="opacity-70">{slot.label}</span>
                              </span>
                              {plan ? (
                                <span className="font-bold text-foreground truncate mt-0.5 text-[11px] leading-tight">
                                  {recipe?.name || plan.food_snapshot?.name || '—'}
                                </span>
                              ) : (
                                <span className="flex items-center gap-0.5 mt-0.5 text-muted-foreground/60">
                                  <Plus className="w-2.5 h-2.5" /> Add
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Centered scroll indicator — only when the grid overflows.
              Track is centered under the calendar; the thumb inside
              tracks the horizontal scroll position. */}
          {scrollMeta.ratio < 0.999 && (
            <div className="flex justify-center pb-3 pt-1 shrink-0">
              <div className="relative h-1.5 w-24 rounded-full bg-border/50 overflow-hidden">
                <div
                  className="absolute top-0 h-full rounded-full bg-muted-foreground/50 transition-[left] duration-75"
                  style={{
                    width: `${scrollMeta.ratio * 100}%`,
                    left:  `${scrollMeta.pct * (1 - scrollMeta.ratio) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
          </>
          )}
        </motion.div>

        {/* Hidden file input driving the Photo-AI path. */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoFile}
        />

        {/* Step 1 — how do you want to add this meal? */}
        <AddMethodSheet
          open={!!addSlot}
          mealLabel={addSlot?.label}
          onPhoto={() => {
            photoTargetRef.current = { date: addSlot.date, mealType: addSlot.mealType };
            setAddSlot(null);
            photoInputRef.current?.click();
          }}
          onRecipe={() => { setPickerSlot({ date: addSlot.date, mealType: addSlot.mealType }); setAddSlot(null); }}
          onManual={() => { setManualSlot(addSlot); setAddSlot(null); }}
          onClose={() => setAddSlot(null)}
        />

        <RecipePickerModal
          open={!!pickerSlot}
          recipes={recipeList}
          onPick={handlePick}
          onClose={() => setPickerSlot(null)}
        />

        <ManualMealModal
          open={!!manualSlot}
          mealLabel={manualSlot?.label}
          onSave={handleManualSave}
          onClose={() => setManualSlot(null)}
        />

        {/* Read-only detail — the photo + full metrics for a planned/logged
            meal, with a Delete action that also un-logs the diary counterpart. */}
        <PhotoMealResultModal
          open={!!detailPlan}
          readOnly
          imageUrl={detailPlan?.plan?.food_snapshot?.image_url || null}
          result={(() => {
            const s = detailPlan?.plan?.food_snapshot || {};
            return {
              food_name:        s.name || 'Meal',
              calories:         s.calories,
              protein_g:        s.protein_g,
              carbs_g:          s.carbs_g,
              fat_g:            s.fat_g,
              fiber_g:          s.fiber_g,
              sugar_g:          s.sugar_g,
              sodium_mg:        s.sodium_mg,
              items:            Array.isArray(s.items) ? s.items : [],
              portion_estimate: s.portion_estimate || null,
              confidence:       s.confidence || null,
            };
          })()}
          onClose={() => setDetailPlan(null)}
          onDelete={() => {
            const dp = detailPlan;
            if (!dp) return;
            removeMutation.mutate(dp.plan.id);
            const snap = dp.plan.food_snapshot || {};
            if (snap.log_id) {
              // Photo-AI / diary-mirrored meal — remove the real diary log too.
              removeDiaryLog(snap.log_id).then(invalidateDiary).catch(() => {});
            } else if (dp.date === isoDay(new Date())) {
              // Planner-originated diary log (notes:'planner').
              removePlannerDiaryLog({ user, date: dp.date, mealType: dp.mealType })
                .then(invalidateDiary).catch(() => {});
            }
            setDetailPlan(null);
          }}
        />

        {/* Photo-AI recognition spinner overlay. */}
        {photoBusy && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="fixed inset-0 z-[10002] bg-black/70 flex flex-col items-center justify-center gap-3"
          >
            <Loader2 className="w-7 h-7 animate-spin text-white" />
            <p className="text-white text-sm font-medium">Recognizing your meal…</p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
