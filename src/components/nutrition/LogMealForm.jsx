import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, History, ImageIcon, Loader2, Repeat } from 'lucide-react';
import NutrientIcon, { MealPlateIcon } from './NutrientIcon';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/api/db';
import { useProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import { toast } from '@/lib/toast';

// TABS are built inside the component to support t()

const NUTRIENT_FIELDS = [
  { key: 'calories',       labelKey: 'nutrition.macros.calories',    placeholder: '0', unit: 'cal', textColor: 'text-orange-600', bgColor: 'bg-orange-50 dark:bg-orange-950/20' },
  { key: 'protein_g',      labelKey: 'nutrition.macros.protein',     placeholder: '0', unit: 'g',    textColor: 'text-red-600',    bgColor: 'bg-red-50 dark:bg-red-950/20' },
  { key: 'carbs_g',        labelKey: 'nutrition.macros.carbs',       placeholder: '0', unit: 'g',    textColor: 'text-blue-600',   bgColor: 'bg-blue-50 dark:bg-blue-950/20' },
  { key: 'fat_g',          labelKey: 'nutrition.macros.fat',         placeholder: '0', unit: 'g',    textColor: 'text-yellow-600', bgColor: 'bg-yellow-50 dark:bg-yellow-950/20' },
  { key: 'sodium_mg',      labelKey: 'nutrition.macros.sodium',      placeholder: '0', unit: 'mg',   textColor: 'text-pink-600',   bgColor: 'bg-pink-50 dark:bg-pink-950/20' },
  { key: 'fiber_g',        labelKey: 'nutrition.macros.fiber',       placeholder: '0', unit: 'g',    textColor: 'text-green-600',  bgColor: 'bg-green-50 dark:bg-green-950/20' },
  { key: 'sugar_g',        labelKey: 'nutrition.macros.sugar',       placeholder: '0', unit: 'g',    textColor: 'text-purple-600', bgColor: 'bg-purple-50 dark:bg-purple-950/20' },
  { key: 'cholesterol_mg', labelKey: 'nutrition.macros.cholesterol', placeholder: '0', unit: 'mg',   textColor: 'text-cyan-600',   bgColor: 'bg-cyan-50 dark:bg-cyan-950/20' },
];

const VITAMIN_FIELDS = [
  { key: 'iron_mg',         labelKey: 'nutrition.minerals.iron',      placeholder: '0', unit: 'mg',  textColor: 'text-red-600',     bgColor: 'bg-red-50 dark:bg-red-950/20' },
  { key: 'magnesium_mg',    labelKey: 'nutrition.minerals.magnesium', placeholder: '0', unit: 'mg',  textColor: 'text-emerald-600', bgColor: 'bg-emerald-50 dark:bg-emerald-950/20' },
  { key: 'calcium_mg',      labelKey: 'nutrition.minerals.calcium',   placeholder: '0', unit: 'mg',  textColor: 'text-slate-600',   bgColor: 'bg-slate-50 dark:bg-slate-950/20' },
  { key: 'potassium_mg',    labelKey: 'nutrition.minerals.potassium', placeholder: '0', unit: 'mg',  textColor: 'text-yellow-600',  bgColor: 'bg-yellow-50 dark:bg-yellow-950/20' },
  { key: 'vitamin_a_iu',    labelKey: 'nutrition.vitamins.a',         placeholder: '0', unit: 'IU',  textColor: 'text-orange-600',  bgColor: 'bg-orange-50 dark:bg-orange-950/20' },
  { key: 'vitamin_c_mg',    labelKey: 'nutrition.vitamins.c',         placeholder: '0', unit: 'mg',  textColor: 'text-rose-600',    bgColor: 'bg-rose-50 dark:bg-rose-950/20' },
  { key: 'vitamin_d_iu',    labelKey: 'nutrition.vitamins.d',         placeholder: '0', unit: 'IU',  textColor: 'text-amber-600',   bgColor: 'bg-amber-50 dark:bg-amber-950/20' },
  { key: 'vitamin_b12_mcg', labelKey: 'nutrition.vitamins.b12',       placeholder: '0', unit: 'mcg', textColor: 'text-purple-600',  bgColor: 'bg-purple-50 dark:bg-purple-950/20' },
];

// Sanity caps so a typo (or repeated tap on a stepper) can't produce
// a nutrition entry like "2,555,555,555,555,553,005,300 kcal" — the
// reported screenshot bug. The caps are deliberately generous (one
// meal hitting these values is implausible) so they only catch garbage
// input, not power users with high macros. Vitamins use IU/mcg with
// orders-of-magnitude larger natural ranges than g/kcal, so they get
// their own bucket.
const NUTRIENT_MAX = {
  calories:        10000,
  protein_g:       1000,
  carbs_g:         1000,
  fat_g:           1000,
  fiber_g:         500,
  sugar_g:         500,
  sodium_mg:       50000,
  cholesterol_mg:  10000,
  iron_mg:         500,
  magnesium_mg:    5000,
  calcium_mg:      10000,
  potassium_mg:    20000,
  vitamin_a_iu:    1000000,
  vitamin_c_mg:    10000,
  vitamin_d_iu:    100000,
  vitamin_b12_mcg: 10000,
};
const DEFAULT_MAX = 99999;

function clampNutrient(key, raw) {
  if (raw === '' || raw == null) return '';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  if (n < 0) return '0';
  const cap = NUTRIENT_MAX[key] ?? DEFAULT_MAX;
  if (n > cap) return String(cap);
  return raw;
}

function NutrientTile({ field, value, onChange, t }) {
  return (
    <div className={`${field.bgColor} rounded-lg p-3`}>
      <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
        <NutrientIcon nutrientKey={field.key} className={`w-3.5 h-3.5 shrink-0 ${field.textColor}`} />
        <p className="text-xs text-muted-foreground truncate">
          {t(field.labelKey)}
          <span className="ms-1 opacity-60">({field.unit})</span>
        </p>
      </div>
      <Input
        type="number" inputMode="decimal"
        min="0"
        max={NUTRIENT_MAX[field.key] ?? DEFAULT_MAX}
        step="0.1"
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(field.key, clampNutrient(field.key, e.target.value))}
        className={`h-8 text-sm font-heading font-bold border-0 bg-white/60 dark:bg-black/20 ${field.textColor} placeholder:text-muted-foreground/40 focus-visible:ring-1`}
      />
    </div>
  );
}

export default function LogMealForm({ newEntry, setNewEntry, onPhotoAI, isRecognizing, onLog, isLogging, onReLog, defaultOpen = false }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const TABS = [
    { id: 'nutrients', label: t('nutrition.nutritionalValues') },
    { id: 'vitamins', label: t('nutrition.vitaminsAndMinerals') },
    { id: 'history', label: (<span className="inline-flex items-center justify-center gap-1"><History className="w-3.5 h-3.5" /> {tFallback('nutrition.historyTab', 'History')}</span>) },
  ];
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState('nutrients');
  const [slideDir, setSlideDir] = useState(1);
  const [reloggingId, setReloggingId] = useState(null);

  // Previously-logged meals, pulled (copied) from the same history data the
  // Meal History page reads. Shared query key so the two stay in sync. This is
  // a read-only mirror — the "Re-Log" action logs the meal fresh into today,
  // it doesn't write back to history here.
  const { data: historyRaw = [], isLoading: historyLoading } = useQuery({
    queryKey: ['nutritionHistory', user?.email],
    queryFn: () => db.entities.NutritionLog.filter({ created_by: user.email }, '-created_at', 300),
    enabled: !!user?.email && open && activeTab === 'history',
    staleTime: 60_000,
  });

  // Newest-first, de-duplicated by food name (one row per distinct meal), water
  // excluded — a compact "log it again" list rather than every raw entry.
  const historyMeals = useMemo(() => {
    const isWater = (e) => {
      const n = (e?.food_name || '').toString();
      return n === 'Water' || /^Water\|/.test(n);
    };
    const seen = new Set();
    const out = [];
    for (const e of historyRaw) {
      if (isWater(e)) continue;
      const key = (e.food_name || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        id:        e.id,
        food_name: e.food_name,
        image_url: e.image_url || null,
        calories:  Number(e.calories) || 0,
        protein_g: Number(e.protein_g ?? e.protein) || 0,
        carbs_g:   Number(e.carbs_g ?? e.carbs) || 0,
        fat_g:     Number(e.fat_g ?? e.fat) || 0,
        fiber_g:   Number(e.fiber_g ?? e.fiber) || 0,
        sodium_mg: Number(e.sodium_mg ?? e.sodium) || 0,
        sugar_g:   Number(e?.ai_meta?.sugar_g) || 0,
      });
      if (out.length >= 40) break;
    }
    return out;
  }, [historyRaw]);

  const handleReLog = (meal) => {
    if (!onReLog || reloggingId) return;
    setReloggingId(meal.id);
    onReLog(meal);
    // Brief lock so a double-tap can't double-log; the toast confirms success.
    setTimeout(() => setReloggingId(null), 800);
  };

  // Allow parent to imperatively open the form (e.g. from dashboard deep-link)
  React.useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  const handleTabChange = (tabId) => {
    const fromIdx = TABS.findIndex(t => t.id === activeTab);
    const toIdx = TABS.findIndex(t => t.id === tabId);
    setSlideDir(toIdx > fromIdx ? 1 : -1);
    setActiveTab(tabId);
  };

  const handleChange = (key, value) => {
    setNewEntry(prev => ({ ...prev, [key]: value }));
  };

  const foodNameGuard = useProfanityGuard((val) => handleChange('food_name', val));

  // Ref-based in-flight guard. The parent's `isLogging` prop comes
  // from the React Query mutation's `isPending`, which flips true
  // asynchronously — a rapid double-tap could fire `onLog()` twice
  // before the disabled state propagated, creating two identical
  // meal entries. The ref guard ignores the second tap immediately
  // and clears once the parent confirms isLogging dropped back to
  // false. (Audit 11 #9.)
  const submittingRef = useRef(false);
  useEffect(() => {
    if (!isLogging) submittingRef.current = false;
  }, [isLogging]);

  const handleLog = () => {
    if (submittingRef.current || isLogging) return;
    if (hasAnyProfanity(newEntry.food_name)) {
      toast.error(t('nutrition.profanityWarning') || 'Please remove inappropriate language from food name before saving.');
      return;
    }
    submittingRef.current = true;
    try {
      onLog();
    } catch (err) {
      // Reset the in-flight guard if onLog throws synchronously —
      // otherwise the user can never retry without remounting.
      submittingRef.current = false;
      throw err;
    }
  };

  const slideVariants = {
    enter: (dir) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
  };

  return (
    <Card className="p-4 border-none shadow-sm">
      {/* Collapsible header — doubles as the primary "Log Meal" CTA, so it's
          sized up and the toggle is a filled badge for clear visibility. */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between py-1"
      >
        <h3 className="font-heading font-bold text-lg flex items-center gap-2 min-w-0">
          <MealPlateIcon className="w-5 h-5 shrink-0 text-primary" />
          <span className="truncate">{t('nutrition.logMealForm')}</span>
        </h3>
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground shadow-sm"
        >
          <Plus className="w-5 h-5" strokeWidth={2.5} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
      {open && (
      <motion.div
        key="form-body"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.25, ease: 'easeInOut' }}
        style={{ overflow: 'hidden' }}
      >
      <div className="pt-4">

      {/* Food name */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('nutrition.foodName')}</label>
        <Input
          value={newEntry.food_name}
          onChange={(e) => foodNameGuard.handleChange(e.target.value)}
          placeholder={t('nutrition.foodNamePlaceholder')}
        />
      </div>

      {/* Slide tabs */}
      <div className="flex gap-1 p-1 bg-secondary rounded-lg mb-4 border border-border">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === tab.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Slide content */}
      <div className="overflow-hidden mb-4">
        <AnimatePresence mode="wait" custom={slideDir}>
          <motion.div
            key={activeTab}
            custom={slideDir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: 'easeInOut' }}
          >
            {activeTab === 'history' ? (
              <div>
                {historyLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : historyMeals.length === 0 ? (
                  <div className="text-center py-8">
                    <History className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="font-heading font-semibold text-sm">No meal history yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Meals you log show up here so you can re-log them in one tap.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {historyMeals.map(meal => (
                      <div key={meal.id} className="flex items-center gap-2.5 rounded-xl border border-border px-2.5 py-2">
                        {/* Thumbnail (photo meals) or placeholder */}
                        {meal.image_url ? (
                          <img loading="lazy" src={meal.image_url} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                            <ImageIcon className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-heading font-semibold text-sm leading-tight truncate">{meal.food_name}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {meal.calories > 0 && (
                              <span className="text-micro font-bold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400">{Math.round(meal.calories)} cal</span>
                            )}
                            {meal.protein_g > 0 && (
                              <span className="text-micro font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400">{Math.round(meal.protein_g)}g P</span>
                            )}
                            {meal.carbs_g > 0 && (
                              <span className="text-micro font-bold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">{Math.round(meal.carbs_g)}g C</span>
                            )}
                            {meal.fat_g > 0 && (
                              <span className="text-micro font-bold px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">{Math.round(meal.fat_g)}g F</span>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="text-xs h-8 shrink-0"
                          onClick={() => handleReLog(meal)}
                          disabled={reloggingId === meal.id}
                        >
                          {reloggingId === meal.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <><Repeat className="w-3.5 h-3.5 me-1" /> Re-Log</>}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(activeTab === 'nutrients' ? NUTRIENT_FIELDS : VITAMIN_FIELDS).map(field => (
                  <NutrientTile
                    key={field.key}
                    field={field}
                    value={newEntry[field.key] ?? ''}
                    onChange={handleChange}
                    t={t}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Actions */}
      {activeTab !== 'history' && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={onPhotoAI} className="flex-1" disabled={isRecognizing}>
            {isRecognizing
              ? <Loader2 className="w-4 h-4 me-2 animate-spin" />
              : <span className="me-2 text-base leading-none">📸</span>}
            {isRecognizing ? tFallback('nutrition.reading', 'Reading…') : tFallback('nutrition.photoAi', 'Photo-AI')}
          </Button>
          <Button onClick={handleLog} className="flex-1" disabled={isLogging}>
            {/* Plate + plus reads as "add a meal" at a glance — the plate
                says what's being logged, the plus says it's an addition. */}
            <span className="inline-flex items-center gap-0.5 me-1.5">
              <MealPlateIcon className="w-4 h-4" />
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            </span>
            {t('nutrition.logMeal')}
          </Button>
        </div>
      )}
      <ProfanityWarningDialog open={foodNameGuard.open} onContinue={foodNameGuard.onContinue} />
      </div>
      </motion.div>
      )}
      </AnimatePresence>
    </Card>
  );
}