// src/components/nutrition/WeeklyMealPlannerModal.jsx
//
// The weekly meal planner: a day strip and ONE open day.
//
// It was a 7-column grid at min-w-[700px] inside a 390pt viewport, so
// Fri/Sat/Sun sat behind a horizontal drag and each 89.7pt cell truncated
// its meal name near 14 characters — production names run to 52. The strip
// gives each meal the full column, which is what lets a name, its calories
// and its macros all render, and it lets the day report what it adds up to.
//
//   Day strip   7 chips, filled by SLOTS USED out of four (never by meals,
//               which a 3-meal slot would overflow).
//   Open day    total against the goal-driven target, then one group per
//               slot. A slot is a GROUP HEADER, not a box: a second dinner
//               is a second row under the same header, up to SLOT_CAPACITY.
//
// The grocery list is gone. It could only ever draw from a saved recipe,
// and across 63 profiles production held one recipe with one ingredient —
// so its CTA, the single full-width primary on this tab, was wired to
// nothing. See docs and the Penpot board "Plans — proposed".
//
// Tap an empty slot → how do you want to add this? (Photo-AI / recipe /
// manual). Tap a planned meal → its detail, or a remove sheet when there is
// no snapshot to show.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  X, ChevronLeft, ChevronRight, ChevronDown, Loader2, Plus,
  CalendarDays, Camera, ChefHat, Pencil, ChevronRight as ChevRight,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { format, addDays, startOfWeek } from 'date-fns';
import { useDateFormatter, useNumberFormatter } from '@/lib/intl';
import { useAuth } from '@/lib/AuthContext';
import * as mealPlans from '@/lib/data/mealPlans';
import * as recipes from '@/lib/data/nutritionRecipes';
import { calculateDailyValues } from '@/lib/nutritionDefaults';
import { plannerSnapshot } from '@/lib/recipeFormat';
import { syncPlannerDiaryLog, removePlannerDiaryLog, remove as removeDiaryLog } from '@/lib/data/nutrition';
import { recognizeMealPhoto } from '@/lib/data/photoMealRecognition';
import { NutritionPlansPanel } from '@/components/nutrition/NutritionPlansModal';
import PhotoMealResultModal from '@/components/nutrition/PhotoMealResultModal';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

const MEAL_SLOTS = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { key: 'lunch',     label: 'Lunch',     emoji: '🥗' },
  { key: 'dinner',    label: 'Dinner',    emoji: '🍽️' },
  { key: 'snack',     label: 'Snack',     emoji: '🍎' },
];

// Full nutrient set for manual meal entry — mirrors LogMealForm so the
// planner can capture any nutrient, not just the four headline macros.
const MANUAL_MACRO_FIELDS = [
  { key: 'calories',       label: 'Calories',    unit: 'cal', color: 'text-primary' },
  { key: 'protein_g',      label: 'Protein',     unit: 'g',    color: 'text-destructive' },
  { key: 'carbs_g',        label: 'Carbs',       unit: 'g',    color: 'text-info' },
  { key: 'fat_g',          label: 'Fat',         unit: 'g',    color: 'text-primary' },
  { key: 'fiber_g',        label: 'Fiber',       unit: 'g',    color: 'text-success' },
  { key: 'sugar_g',        label: 'Sugar',       unit: 'g',    color: 'text-primary' },
  { key: 'sodium_mg',      label: 'Sodium',      unit: 'mg',   color: 'text-primary' },
  { key: 'cholesterol_mg', label: 'Cholesterol', unit: 'mg',   color: 'text-info' },
];
const MANUAL_MICRO_FIELDS = [
  { key: 'iron_mg',         label: 'Iron',        unit: 'mg',  color: 'text-destructive' },
  { key: 'magnesium_mg',    label: 'Magnesium',   unit: 'mg',  color: 'text-success' },
  { key: 'calcium_mg',      label: 'Calcium',     unit: 'mg',  color: 'text-slate-600' },
  { key: 'potassium_mg',    label: 'Potassium',   unit: 'mg',  color: 'text-primary' },
  { key: 'vitamin_a_iu',    label: 'Vitamin A',   unit: 'IU',  color: 'text-primary' },
  { key: 'vitamin_c_mg',    label: 'Vitamin C',   unit: 'mg',  color: 'text-destructive' },
  { key: 'vitamin_d_iu',    label: 'Vitamin D',   unit: 'IU',  color: 'text-primary' },
  { key: 'vitamin_b12_mcg', label: 'Vitamin B12', unit: 'mcg', color: 'text-primary' },
];
const MANUAL_ALL_FIELDS = [...MANUAL_MACRO_FIELDS, ...MANUAL_MICRO_FIELDS];
const slotLabelKey = (slot) => `mealPlanner.slot.${slot.key ?? slot.mealType}`;
const emptyNutrients = () => MANUAL_ALL_FIELDS.reduce((acc, f) => { acc[f.key] = ''; return acc; }, {});

function weekStart(date) {
  // ISO week (Mon as start) so Sun stays at the END, not start.
  return startOfWeek(date, { weekStartsOn: 1 });
}

// `isoDay` stays on date-fns deliberately: this is a KEY — it is the
// `plan_date` column, the cell lookup key and the react-query key — so it
// must NOT move with the locale. Every date the user READS goes through
// useDateFormatter() below instead; date-fns `format()` binds no locale, so
// "Mon"/"Aug 11" survived every translation pass on a 15-language app.
function isoDay(date) {
  return format(date, 'yyyy-MM-dd');
}

// ── Recipe-picker sub-modal ────────────────────────────────────────────
function RecipePickerModal({ open, recipes: recipeList, onPick, onClose }) {
  const { tFallback } = useLanguage();
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
          <h3 className="font-heading font-bold text-sm">{tFallback("weeklyMealPlannerModal.pickARecipe", "Pick a recipe")}</h3>
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
              className="w-full text-start px-3 py-2 rounded-lg border border-border bg-secondary/40 hover:bg-secondary active:bg-secondary text-sm font-medium transition-colors"
            >
              {r.name}
              <p className="text-micro text-muted-foreground mt-0.5">
                {Array.isArray(r.ingredients) ? `${r.ingredients.length} ingredient${r.ingredients.length === 1 ? '' : 's'}` : ''}
              </p>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── The slot is at capacity ───────────────────────────────────────────
// A cap that only refuses is a worse cap. SLOT_CAPACITY is three because TWO
// is the floor a plan template needs — snack1 and snack2 both map to `snack`
// — and past three a day stops being a plan and becomes a record. The record
// already exists and has no cap: syncPlannerDiaryLog mirrors planner meals
// into nutrition_logs. So this names the rule and then offers both ways
// through it, rather than saying no and stopping there.
function SlotFullSheet({ open, label, items, recipesById, isToday, onReplace, onLogToDiary, onClose }) {
  const { tFallback } = useLanguage();
  if (!open) return null;
  const total = Math.round(mealPlans.dayTotals(items).calories);
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      onClick={onClose}
      className="fixed inset-0 z-[10001] bg-black/60 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div
        initial={{ y: 24 }} animate={{ y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-card border border-border rounded-2xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between ps-4 pe-2 py-2 border-b border-border shrink-0">
          <h3 className="font-heading font-bold text-sm">
            {tFallback('weeklyMealPlannerModal.slotIsFull', '{label} is full', { label })}
          </h3>
          <button
            onClick={onClose}
            aria-label={tFallback("common.close", "Close")}
            className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-muted-foreground leading-snug">
            {tFallback(
              'weeklyMealPlannerModal.slotFullLead',
              '{n} meals is the most one slot holds. Past that a day stops being a plan and starts being a diary, and you already have one.',
              { n: mealPlans.SLOT_CAPACITY },
            )}
          </p>

          <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
            {tFallback('weeklyMealPlannerModal.replaceOne', 'Replace one of them')}
          </p>
          <div className="space-y-1.5">
            {items.map(plan => {
              const recipe = plan.recipe_id ? recipesById.get(plan.recipe_id) : null;
              const kcal = Number(plan.food_snapshot?.calories);
              return (
                <button
                  key={plan.id}
                  onClick={() => onReplace(plan)}
                  className="w-full flex items-center justify-between gap-3 text-start px-3 py-2.5 rounded-lg border border-border bg-secondary/40 hover:bg-secondary active:bg-secondary transition-colors"
                >
                  <span className="text-sm font-medium min-w-0">
                    {recipe?.name || plan.food_snapshot?.name || '—'}
                  </span>
                  {Number.isFinite(kcal) && kcal > 0 && (
                    <span className="text-micro font-semibold text-muted-foreground shrink-0 tabular-nums">{kcal} cal</span>
                  )}
                </button>
              );
            })}
          </div>
          {total > 0 && (
            <p className="text-micro text-primary font-semibold text-end mt-2 tabular-nums">
              {tFallback('weeklyMealPlannerModal.calInSlot', '{n} cal in {label}', { n: total, label: String(label).toLowerCase() })}
            </p>
          )}

          {/* Only offered where it is true. On a future date there is no
              "today's diary" to divert into, and the cap is on the PLAN
              rather than on what the user is allowed to eat. */}
          {isToday && (
            <button
              onClick={onLogToDiary}
              className="w-full flex items-center gap-3 text-start px-3 py-3 mt-6 rounded-xl border border-border bg-secondary/40 hover:bg-secondary active:bg-secondary transition-colors"
            >
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm">
                  {tFallback('weeklyMealPlannerModal.logToDiary', "Log it to today's diary instead")}
                </span>
                <span className="block text-micro text-muted-foreground mt-0.5">
                  {tFallback('weeklyMealPlannerModal.diaryNoCap', 'The diary has no cap. Planner meals already mirror into it.')}
                </span>
              </span>
              <ChevRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" />
            </button>
          )}
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
  const { tFallback } = useLanguage();
  if (!open) return null;
  const options = [
    { key: 'photo',  label: 'Photo-AI', desc: 'Snap a photo of your plate', Icon: Camera,  onClick: onPhoto,  tint: 'text-primary bg-primary/10' },
    { key: 'recipe', label: 'Recipe',   desc: 'Pick from your saved recipes', Icon: ChefHat, onClick: onRecipe, tint: 'text-success bg-success/10' },
    { key: 'manual', label: 'Manual',   desc: 'Enter the macros by hand',   Icon: Pencil,  onClick: onManual, tint: 'text-info bg-info/10' },
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
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-border bg-secondary/40 hover:bg-secondary active:bg-secondary transition-colors text-start"
            >
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tint}`}>
                <Icon className="w-4 h-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm">{tFallback(`mealPlanner.add.${key}.label`, label)}</span>
                <span className="block text-micro text-muted-foreground">{tFallback(`mealPlanner.add.${key}.desc`, desc)}</span>
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
  const { tFallback } = useLanguage();
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
      <label className={`text-micro font-bold uppercase tracking-wide ${f.color}`}>{tFallback(`nutrient.${f.key.replace(/_(g|mg|mcg|iu)$/, '')}`, f.label)}</label>
      <div className="mt-1 flex items-center rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-primary/40">
        <input
          type="number"
          inputMode="decimal"
          value={values[f.key]}
          onChange={(e) => setValues(v => ({ ...v, [f.key]: e.target.value }))}
          placeholder="0"
          className="w-full px-3 py-2 rounded-lg bg-transparent text-sm focus:outline-none"
        />
        <span className="pe-3 text-micro text-muted-foreground shrink-0">{f.unit}</span>
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
            <label className="text-micro font-bold uppercase tracking-wide text-muted-foreground">{tFallback("photoMealResultModal.mealName", "Meal name")}</label>
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
            <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-2">{tFallback("weeklyMealPlannerModal.macros", "Macros")}</p>
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
              className="w-full flex items-center justify-between px-1 py-1 text-micro font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
            >
              {tFallback("nutrition.vitaminsAndMinerals", "Vitamins & Minerals")}
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
  const { tFallback } = useLanguage();

  // The four meal slots are a module-scope const, so their labels cannot be
  // translated where they are declared. Resolved here instead, at the point
  // they are READ — which means every downstream hand-off (the add sheet, the
  // remove confirm, the full-slot sheet) already carries the translated
  // string rather than each needing its own lookup.
  const slotLabel = (slot) => tFallback(slotLabelKey(slot), slot.label);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fmtDate = useDateFormatter();
  const fmtNum  = useNumberFormatter();
  useBodyScrollLock(open);
  const [anchor, setAnchor] = useState(() => new Date());
  const [pickerSlot, setPickerSlot] = useState(null); // { date, mealType } → recipe picker
  const [addSlot, setAddSlot]       = useState(null); // { date, mealType, label } → method chooser
  const [manualSlot, setManualSlot] = useState(null); // { date, mealType, label } → manual form
  const [detailPlan, setDetailPlan] = useState(null); // { plan, date, mealType } → read-only detail view
  const [removePlan, setRemovePlan] = useState(null); // { plan, date, mealType, label } → confirm removal
  const [fullSlot, setFullSlot]     = useState(null); // { label, mealType, items } → the slot is at capacity
  const [photoBusy, setPhotoBusy]   = useState(false);
  // Two tabs: the week ('planner') and the Nutrition Plans browser
  // ('plans'), which was folded in here from its own modal.
  const [tab, setTab] = useState('planner');

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

  // One day is open at a time. The week used to be a 700pt grid inside a
  // 390pt viewport — 89.7pt columns that truncated every meal name near 14
  // characters and put Fri/Sat/Sun behind a horizontal drag. A day strip plus
  // one open day gives each meal the full column, which is what lets a name,
  // its calories and its macros all render.
  const [selectedISO, setSelectedISO] = useState(() => isoDay(new Date()));
  // Keep the selection inside the visible week when the arrows move it.
  const selectedDate = useMemo(
    () => (selectedISO >= startStr && selectedISO <= endStr) ? selectedISO : startStr,
    [selectedISO, startStr, endStr],
  );

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

  // Plans keyed by `${date}-${mealType}`. The value is a LIST: since migration
  // 355 a slot holds up to mealPlans.SLOT_CAPACITY meals, because a real day
  // carries two dinners and every plan template needs two in one slot (snack1
  // and snack2 both map to `snack`).
  //
  // This was `m.set(key, p)` — last write wins — which is precisely how the
  // 2026-08-11 incident hid 6 of 8 production rows.
  const planMap = useMemo(() => {
    const m = new Map();
    for (const p of plans) {
      const k = `${p.plan_date}-${p.meal_type}`;
      const list = m.get(k);
      if (list) list.push(p); else m.set(k, [p]);
    }
    return m;
  }, [plans]);

  // How full each day is, for the strip. Counts SLOTS USED, never meals — a
  // slot holding three meals would otherwise overflow its own indicator.
  const slotsUsedByDate = useMemo(() => {
    const m = new Map();
    for (const key of planMap.keys()) {
      const d = key.slice(0, 10);
      m.set(d, (m.get(d) || 0) + 1);
    }
    return m;
  }, [planMap]);

  // The same goal-driven target the rest of the nutrition UI shows. Onboarding
  // stores the inputs, not a calorie number, so this must be derived.
  const targetCalories = useMemo(
    () => calculateDailyValues(userProfile)?.calories || null,
    [userProfile],
  );

  const selectedPlans = useMemo(
    () => MEAL_SLOTS.map(s => ({ slot: s, items: planMap.get(`${selectedDate}-${s.key}`) || [] })),
    [planMap, selectedDate],
  );
  const dayTotal = useMemo(
    () => mealPlans.dayTotals(selectedPlans.flatMap(s => s.items)),
    [selectedPlans],
  );

  const upsertMutation = useMutation({
    mutationFn: (args) => mealPlans.upsert(args),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['mealPlans', user?.id, startStr, endStr] }),
    // The slot cap is a trigger (migration 355), so a full slot arrives here as
    // 23514 rather than being prevented. Say which rule was hit — "Could not
    // save plan" on a deliberate limit reads as the app being broken.
    onError:    (err) => toast.error(
      mealPlans.isSlotFull(err)
        ? tFallback('weeklyMealPlannerModal.slotFullShort', 'That slot already holds {n} meals.', { n: mealPlans.SLOT_CAPACITY })
        : tFallback('weeklyMealPlannerModal.couldNotSave', 'Could not save plan.')),
  });

  const removeMutation = useMutation({
    mutationFn: (id) => mealPlans.remove(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['mealPlans', user?.id, startStr, endStr] }),
    onError:    () => toast.error(tFallback('weeklyMealPlannerModal.couldNotRemove', 'Could not remove plan.')),
  });

  // Applying a plan template. A template IS one day's meals — breakfast,
  // lunch, snack1, dinner, snack2 — so it lands on the OPEN DAY rather than
  // spreading across the week, and it replaces that day rather than
  // interleaving with what is already there.
  //
  // snack1 and snack2 both map to the single `snack` slot, which is exactly
  // why no template could be applied whole until migration 355 lifted
  // one-plan-per-slot. Five meals into four slots, snack holding two, inside
  // the cap of three.
  // Applying runs several sequential round trips, and the button stayed live
  // throughout, so a double tap on a slow network applied the plan twice (or
  // tripped the slot cap halfway, leaving a half-duplicated day). A ref, not
  // isPending, because two taps can land before the re-render that flips it.
  const applyingPlanRef = useRef(false);
  const applyPlanMutation = useMutation({
    mutationFn: async (scaledPlan) => {
      for (const p of plans.filter(p => p.plan_date === selectedDate)) {
        await mealPlans.remove(p.id);
      }
      for (const { mealType, foodSnapshot } of mealPlans.planMealsToSlots(scaledPlan)) {
        await mealPlans.upsert({ user, planDate: selectedDate, mealType, foodSnapshot });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealPlans', user?.id, startStr, endStr] });
      setTab('planner');
      toast.success(tFallback('weeklyMealPlannerModal.planApplied', 'Added to your day'));
    },
    onError: (err) => toast.error(
      mealPlans.isSlotFull(err)
        ? tFallback('weeklyMealPlannerModal.slotFullShort', 'That slot already holds {n} meals.', { n: mealPlans.SLOT_CAPACITY })
        : tFallback('weeklyMealPlannerModal.couldNotApply', 'Could not add that plan.')),
  });

  // A planned recipe stores BOTH the id and a snapshot of what was planned.
  //
  // The id alone was the whole row: migration 123 deliberately omits the FK so
  // deleting a recipe cannot delete someone's plan — but with nothing else
  // stored, the surviving plan rendered as a bare "—". The plan outlived the
  // recipe and carried none of it. The snapshot is what the cell falls back to,
  // and it is the same shape the manual and photo paths already write.
  const handlePick = (recipe) => {
    if (!pickerSlot) return;
    const snapshot = plannerSnapshot(recipe);
    const { date, mealType } = pickerSlot;
    upsertMutation.mutate({
      user,
      planDate: date,
      mealType,
      recipeId: recipe.id,
      foodSnapshot: snapshot,
    }, {
      // A recipe planned for TODAY is a meal eaten today, exactly as a manual
      // or photo entry is. This path was the only one of the three that
      // skipped the diary mirror, so planning a recipe for today quietly
      // counted for nothing. It mirrors only once the plan row has saved, so
      // a failed save cannot leave a diary entry behind with no plan.
      onSuccess: () => logToDiaryIfToday(date, snapshot, mealType),
    });
    setPickerSlot(null);
  };

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
      // The same five errors the Log Meal flow reports, on the same keys.
      // SERVER_MISCONFIGURED joins PIPELINE_MISSING here because Nutrition.jsx
      // already pairs them and they mean one thing to a user: not set up yet.
      if (err === 'NOT_FOOD') toast.error(tFallback('nutrition.photoAi.notFood', "That doesn't look like food. Try another photo."));
      else if (err === 'RATE_LIMIT') toast.error(tFallback('nutrition.photoAi.rateLimit', 'Hit the rate limit. Try again in a moment.'));
      else if (err === 'PIPELINE_MISSING' || err === 'SERVER_MISCONFIGURED') toast.error(tFallback('nutrition.photoAi.notEnabled', "Photo recognition isn't enabled yet."));
      else toast.error(tFallback('nutrition.photoAi.failed', 'Could not recognize meal. Try again.'));
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
    // The success line used to fire right here, before the save was even
    // sent, so a failed save said "Added" and then an error on top of it.
    upsertMutation.mutate(
      { user, planDate: target.date, mealType: target.mealType, foodSnapshot: snapshot },
      {
        onSuccess: () => {
          logToDiaryIfToday(target.date, snapshot, target.mealType);
          toast.success(tFallback('nutrition.plannerPhotoAdded', 'Added {name}', { name: snapshot.name }));
        },
      },
    );
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
    const { date, mealType } = manualSlot;
    upsertMutation.mutate(
      { user, planDate: date, mealType, foodSnapshot: snapshot },
      { onSuccess: () => logToDiaryIfToday(date, snapshot, mealType) },
    );
    setManualSlot(null);
  };

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[9999] bg-black/55 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
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
              <h2 className="font-heading font-bold text-base leading-tight">
                {tFallback('weeklyMealPlannerModal.title', 'Plans')}
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label={tFallback("common.close", "Close")}
              className="w-11 h-11 -me-2 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Two halves of one surface. It used to be titled "Weekly Plan &
              Plans" over tabs reading "Weekly Plan" and "Nutritional Plans" —
              the whole named after one of its halves, and that half named
              twice. The sheet is Plans; these are what it holds. */}
          <div className="flex gap-1 p-1 mx-4 my-2 bg-secondary rounded-lg shrink-0">
            {[
              { id: 'planner', label: tFallback('weeklyMealPlannerModal.tabWeek', 'This week') },
              { id: 'plans',   label: tFallback('weeklyMealPlannerModal.tabPlans', 'Meal plans') },
            ].map(tb => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  tab === tb.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground active:text-foreground'
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
              <NutritionPlansPanel
                userProfile={userProfile}
                onStartOnboarding={onStartOnboarding}
                onApplyPlan={(scaledPlan) => {
                  if (applyingPlanRef.current) return;
                  applyingPlanRef.current = true;
                  applyPlanMutation.mutate(scaledPlan, {
                    onSettled: () => { applyingPlanRef.current = false; },
                  });
                }}
              />
            </div>
          ) : (
          <>
          {/* Week nav */}
          <div className="flex items-center justify-between px-4 py-2 shrink-0">
            <button
              onClick={() => setAnchor(addDays(ws, -7))}
              className="w-11 h-11 -ms-2 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
              aria-label={tFallback('weeklyMealPlannerModal.previousWeek', 'Previous week')}
            >
              <ChevronLeft className="w-4 h-4 rtl:scale-x-[-1]" />
            </button>
            <span className="text-sm font-bold tabular-nums">
              {fmtDate(days[0], { month: 'short', day: 'numeric' })} – {fmtDate(days[6], { month: 'short', day: 'numeric' })}
            </span>
            <button
              onClick={() => setAnchor(addDays(ws, 7))}
              className="w-11 h-11 -me-2 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
              aria-label={tFallback('weeklyMealPlannerModal.nextWeek', 'Next week')}
            >
              <ChevronRight className="w-4 h-4 rtl:scale-x-[-1]" />
            </button>
          </div>

          {/* Day strip. Seven chips across the column — 47.7pt at 390px and
              45.6pt on a 375px SE, both clear of the 44pt tap floor. The bar
              under each counts SLOTS USED out of four, never MEALS, so a slot
              holding three cannot overflow its own indicator. This replaces a
              700pt grid that needed a horizontal drag to reach Fri/Sat/Sun. */}
          <div className="flex gap-1 px-4 pb-2 shrink-0">
            {days.map(d => {
              const iso = isoDay(d);
              const sel = iso === selectedDate;
              const used = slotsUsedByDate.get(iso) || 0;
              return (
                <button
                  key={iso}
                  onClick={() => setSelectedISO(iso)}
                  aria-current={sel ? 'date' : undefined}
                  className={`flex-1 min-w-0 rounded-lg py-2 flex flex-col items-center gap-1 transition-colors ${
                    sel ? 'bg-primary text-primary-foreground' : 'bg-card border border-border hover:bg-secondary active:bg-secondary'
                  }`}
                >
                  <span className={`text-micro font-semibold uppercase tracking-wide ${sel ? 'opacity-80' : 'text-muted-foreground'}`}>
                    {fmtDate(d, { weekday: 'short' })}
                  </span>
                  <span className="font-heading font-bold text-base leading-none">
                    {fmtDate(d, { day: 'numeric' })}
                  </span>
                  <span className={`h-1 w-6 rounded-full overflow-hidden ${sel ? 'bg-primary-foreground/30' : 'bg-border'}`}>
                    <span
                      className={`block h-full rounded-full ${sel ? 'bg-primary-foreground' : 'bg-success'}`}
                      style={{ width: `${Math.min(1, used / MEAL_SLOTS.length) * 100}%` }}
                    />
                  </span>
                </button>
              );
            })}
          </div>

          {/* The open day. Everything the 89.7pt cell had to throw away. */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <h3 className="font-heading font-bold text-base">
                    {fmtDate(new Date(`${selectedDate}T00:00:00`), { weekday: 'long', month: 'short', day: 'numeric' })}
                  </h3>
                  {selectedDate === isoDay(new Date()) && (
                    <span className="text-micro font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                      {tFallback('weeklyMealPlannerModal.today', 'Today')}
                    </span>
                  )}
                </div>

                {/* A day with no numbers behind it must not render as a zero —
                    "0 cal" at someone who has planned nothing is the app
                    calling them lazy. `counted` is meals carrying macros, which
                    a recipe-backed plan does not have. */}
                {dayTotal.counted > 0 && (
                  <div className="mt-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-heading font-bold text-2xl tabular-nums">
                        {fmtNum(Math.round(dayTotal.calories))}
                      </span>
                      {targetCalories
                        ? <span className="text-xs text-muted-foreground">/ {fmtNum(targetCalories)} cal</span>
                        : <span className="text-xs text-muted-foreground">cal</span>}
                      {targetCalories && (
                        <span className={`text-xs font-bold ms-auto ${
                          dayTotal.calories > targetCalories ? 'text-destructive' : 'text-success'}`}>
                          {dayTotal.calories > targetCalories
                            ? tFallback('weeklyMealPlannerModal.overBy', '{n} over', { n: fmtNum(Math.round(dayTotal.calories - targetCalories)) })
                            : tFallback('weeklyMealPlannerModal.leftOver', '{n} left', { n: fmtNum(Math.round(targetCalories - dayTotal.calories)) })}
                        </span>
                      )}
                    </div>
                    {targetCalories && (
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-2">
                        <div
                          className={`h-full rounded-full ${dayTotal.calories > targetCalories ? 'bg-destructive' : 'bg-primary'}`}
                          style={{ width: `${Math.min(100, (dayTotal.calories / targetCalories) * 100)}%` }}
                        />
                      </div>
                    )}
                    <div className="flex gap-2 mt-2 text-micro">
                      <span className="text-destructive font-medium">{Math.round(dayTotal.protein)}g P</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-info font-medium">{Math.round(dayTotal.carbs)}g C</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-primary font-medium">{Math.round(dayTotal.fat)}g F</span>
                    </div>
                  </div>
                )}

                {dayTotal.meals === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {tFallback('weeklyMealPlannerModal.nothingPlanned', 'Nothing planned yet. Add a meal below.')}
                  </p>
                )}

                {/* One group per slot. The label is a GROUP HEADER, not a box:
                    a second dinner is a second row under the same header, which
                    the old 89.7pt cell could never show. */}
                <div className="mt-6 space-y-2">
                  {selectedPlans.map(({ slot, items }) => {
                    const slotTotal = mealPlans.dayTotals(items);
                    const openAdd = () => setAddSlot({ date: selectedDate, mealType: slot.key, label: slotLabel(slot) });
                    if (items.length === 0) {
                      return (
                        <button
                          key={slot.key}
                          onClick={openAdd}
                          className="w-full min-h-[48px] flex items-center gap-2 px-3 rounded-lg border border-dashed border-border text-start hover:bg-secondary/60 active:bg-secondary/60 transition-colors"
                        >
                          <span aria-hidden="true">{slot.emoji}</span>
                          <span className="text-sm font-medium text-muted-foreground">{slotLabel(slot)}</span>
                          <span className="ms-auto inline-flex items-center gap-1 text-xs font-bold text-primary">
                            <Plus className="w-3.5 h-3.5" />
                            {tFallback('weeklyMealPlannerModal.add', 'Add')}
                          </span>
                        </button>
                      );
                    }
                    return (
                      <div key={slot.key}>
                        <div className="flex items-baseline gap-2 px-1 pb-1">
                          <span aria-hidden="true" className="text-micro">{slot.emoji}</span>
                          <span className="text-micro font-bold uppercase tracking-wide text-muted-foreground">{slotLabel(slot)}</span>
                          {items.length > 1 && (
                            <span className="ms-auto text-micro font-bold text-primary tabular-nums">
                              {items.length} · {fmtNum(Math.round(slotTotal.calories))} cal
                            </span>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {items.map(plan => {
                            const recipe = plan.recipe_id ? recipesById.get(plan.recipe_id) : null;
                            const snap = plan.food_snapshot;
                            const kcal = Number(snap?.calories);
                            return (
                              <button
                                key={plan.id}
                                onClick={() => {
                                  if (snap) {
                                    setDetailPlan({ plan, date: selectedDate, mealType: slot.key });
                                  } else {
                                    setRemovePlan({ plan, date: selectedDate, mealType: slot.key, label: slotLabel(slot) });
                                  }
                                }}
                                className="w-full text-start px-3 py-2.5 rounded-lg bg-card border border-border hover:bg-secondary/40 active:bg-secondary/40 transition-colors"
                              >
                                <div className="flex items-start gap-2">
                                  <span className="flex-1 min-w-0 text-sm font-medium leading-snug">
                                    {recipe?.name || snap?.name || '—'}
                                  </span>
                                  {Number.isFinite(kcal) && kcal > 0 && (
                                    <span className="text-xs font-bold tabular-nums shrink-0">{fmtNum(kcal)} cal</span>
                                  )}
                                  <ChevRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 rtl:scale-x-[-1]" />
                                </div>
                                {snap && (
                                  <div className="flex gap-1.5 mt-1 text-micro">
                                    <span className="text-destructive font-medium">{Math.round(Number(snap.protein_g) || 0)}P</span>
                                    <span className="text-muted-foreground">·</span>
                                    <span className="text-info font-medium">{Math.round(Number(snap.carbs_g) || 0)}C</span>
                                    <span className="text-muted-foreground">·</span>
                                    <span className="text-primary font-medium">{Math.round(Number(snap.fat_g) || 0)}F</span>
                                  </div>
                                )}
                              </button>
                            );
                          })}
                          {items.length < mealPlans.SLOT_CAPACITY ? (
                            <button
                              onClick={openAdd}
                              className="w-full min-h-[40px] flex items-center justify-center gap-1 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-secondary/60 active:bg-secondary/60 transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              {tFallback('weeklyMealPlannerModal.addAnother', 'Add another')}
                            </button>
                          ) : (
                            // A cap that only refuses is worse than one that
                            // offers a way through. Tapping this opens the
                            // sheet rather than doing nothing.
                            <button
                              onClick={() => setFullSlot({ label: slotLabel(slot), mealType: slot.key, items })}
                              className="w-full min-h-[40px] flex items-center justify-center rounded-lg text-micro font-semibold text-muted-foreground hover:bg-secondary/60 active:bg-secondary/60 transition-colors"
                            >
                              {tFallback('weeklyMealPlannerModal.slotFull', '{label} is full, {n} of {max}', { label: slotLabel(slot), n: items.length, max: mealPlans.SLOT_CAPACITY })}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
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

        {/* Removing a meal with no snapshot to show. The last native
            confirm() in this flow lived here — unstyled, untranslatable, and
            the only browser dialog left anywhere in the planner. */}
        {removePlan && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            onClick={() => setRemovePlan(null)}
            className="fixed inset-0 z-[10001] bg-black/60 flex items-end sm:items-center justify-center p-4"
          >
            <motion.div
              initial={{ y: 24 }} animate={{ y: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md bg-card border border-border rounded-2xl p-4"
            >
              <h3 className="font-heading font-bold text-sm">
                {recipesById.get(removePlan.plan.recipe_id)?.name
                  || tFallback('weeklyMealPlannerModal.thisMeal', 'This meal')}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {tFallback('weeklyMealPlannerModal.removeFrom', 'Remove it from {label}?', { label: removePlan.label })}
              </p>
              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => setRemovePlan(null)}
                  className="flex-1 min-h-[44px] rounded-xl bg-secondary text-foreground font-semibold text-sm"
                >
                  {tFallback('weeklyMealPlannerModal.keep', 'Keep')}
                </button>
                <button
                  onClick={() => {
                    const r = removePlan;
                    setRemovePlan(null);
                    removeMutation.mutate(r.plan.id);
                    // Only a meal mirrored into TODAY's diary needs un-logging.
                    if (r.date === isoDay(new Date())) {
                      removePlannerDiaryLog({ user, date: r.date, mealType: r.mealType })
                        .then(invalidateDiary)
                        .catch(() => {});
                    }
                  }}
                  className="flex-1 min-h-[44px] rounded-xl border border-destructive/60 text-destructive font-semibold text-sm"
                >
                  {tFallback('weeklyMealPlannerModal.remove', 'Remove')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        <SlotFullSheet
          open={!!fullSlot}
          label={fullSlot?.label}
          items={fullSlot?.items || []}
          recipesById={recipesById}
          isToday={selectedDate === isoDay(new Date())}
          onReplace={async (plan) => {
            const slot = fullSlot;
            setFullSlot(null);
            // Free the space BEFORE offering to fill it — the cap is a
            // trigger, so opening the add flow first would just earn a 23514.
            await removeMutation.mutateAsync(plan.id);
            if (selectedDate === isoDay(new Date())) {
              removePlannerDiaryLog({ user, date: selectedDate, mealType: slot.mealType })
                .then(invalidateDiary)
                .catch(() => {});
            }
            setAddSlot({ date: selectedDate, mealType: slot.mealType, label: slotLabel(slot) });
          }}
          onLogToDiary={() => { setFullSlot(null); onClose(); }}
          onClose={() => setFullSlot(null)}
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
