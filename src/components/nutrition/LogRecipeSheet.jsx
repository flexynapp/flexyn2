// src/components/nutrition/LogRecipeSheet.jsx
//
// Board D of the Penpot page "Recipes" — the tap that did not exist.
//
// A saved recipe could only reach the diary through the Weekly Meal Planner:
// from the Recipes hub itself, tapping a recipe opened the EDIT form. So the
// promise the builder is sold on — "build one once, log it in a tap forever" —
// had no tap. This sheet is it: meal slot, servings, done.
//
// It does NOT write the row. `onLog` hands the payload back to the Nutrition
// page's existing save mutation, which already owns quest credit, XP, the
// first-meal celebration and cache invalidation. A second write path here
// would be a second set of all four, drifting apart quietly.
//
// TODO(i18n): the whole Recipes surface is English-only today; new copy here
// matches that rather than half-translating one sheet.

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { X, Loader2 } from 'lucide-react';
import { recipeLogPayload, servingsOf } from '@/lib/data/nutritionRecipes';
import { servingsLabel } from '@/lib/recipeFormat';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';
import { MEAL_TYPES } from '@/components/nutrition/MealTypePicker';

// Half-serving granularity, floored at a half and capped well above any real
// meal. The cap exists for the same reason the builder clamps its inputs: a
// stuck stepper should not be able to write four figures into a diary.
const STEP = 0.5;
const MAX_SERVINGS = 20;

export default function LogRecipeSheet({
  open, recipe, date, defaultMealType = 'snack', busy = false, onLog, onClose,
}) {
  const { tFallback } = useLanguage();
  useBodyScrollLock(open);
  const [servings, setServings] = useState(1);
  const [mealType, setMealType] = useState(defaultMealType);

  // Reset per recipe, not per open — reopening the same recipe should not
  // remember a serving count the user abandoned last time.
  useEffect(() => {
    if (!open) return;
    setServings(1);
    setMealType(defaultMealType);
  }, [open, recipe?.id, defaultMealType]);

  if (!open || !recipe) return null;

  const payload = recipeLogPayload({ recipe, servings, mealType, date });
  const total = servingsOf(recipe);
  // `date` is the Nutrition page's local yyyy-MM-dd key, so compare as
  // strings against the same format — parsing one back into a Date
  // re-introduces the UTC shift the key format exists to avoid. Per the
  // i18n rules this format() stays unlocalised: it is a key, not text.
  const isToday = !date || date === format(new Date(), 'yyyy-MM-dd');
  // Not .toLowerCase(): German capitalises its nouns, so lower-casing a
  // translated meal name is only correct in English. The list itself is
  // MealTypePicker's — this file declared a second copy of the same four.
  const mealEn = MEAL_TYPES.find((m) => m.id === mealType)?.label;
  const mealLabel = mealEn
    ? tFallback(`nutrition.form.${mealType}`, mealEn)
    : tFallback('logRecipeSheet.diary', 'diary');
  const servingsText = tFallback(
    `logRecipeSheet.servings.${servings === 1 ? 'one' : 'other'}`,
    servings === 1 ? '{n} serving' : '{n} servings',
    { n: servings },
  );

  const bump = (delta) => setServings((s) => {
    const next = Math.round((s + delta) * 2) / 2;
    return Math.min(MAX_SERVINGS, Math.max(STEP, next));
  });

  const submit = (count) => {
    if (busy) return;
    onLog?.(recipeLogPayload({ recipe, servings: count, mealType, date }), {
      recipe, servings: count, mealType,
    });
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[10000] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-xl safe-sheet-bottom"
        >
          <div className="flex items-start justify-between px-4 pt-4">
            <div className="min-w-0">
              <h2 className="font-heading font-bold text-base">{tFallback("logRecipeSheet.logThisRecipe", "Log this recipe")}</h2>
              <p className="text-caption text-muted-foreground mt-0.5 truncate">
                {recipe.name} · {servingsLabel(recipe)} saved
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label={tFallback("common.close", "Close")}
              className="w-7 h-7 shrink-0 rounded-full bg-secondary flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="px-4 pt-4">
            <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-2">{tFallback("hub.share.meal", "Meal")}</p>
            <div className="grid grid-cols-4 gap-2">
              {MEAL_TYPES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMealType(m.id)}
                  aria-pressed={mealType === m.id}
                  className={`h-9 rounded-lg border text-caption font-semibold transition-colors ${
                    mealType === m.id
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-secondary/40 text-muted-foreground'
                  }`}
                >
                  {tFallback(`nutrition.form.${m.id}`, m.label)}
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 pt-6">
            <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-2">{tFallback("nutrition.form.servings", "Servings")}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => bump(-STEP)}
                disabled={servings <= STEP}
                aria-label={tFallback("logRecipeSheet.oneLessServing", "One less serving")}
                className="w-11 h-11 rounded-lg border border-border bg-secondary/40 text-base font-bold disabled:opacity-40"
              >
                –
              </button>
              <span className="w-16 text-center font-heading text-xl font-bold tabular-nums">
                {servings}
              </span>
              <button
                type="button"
                onClick={() => bump(STEP)}
                disabled={servings >= MAX_SERVINGS}
                aria-label={tFallback("logRecipeSheet.oneMoreServing", "One more serving")}
                className="w-11 h-11 rounded-lg border border-border bg-secondary/40 text-base font-bold disabled:opacity-40"
              >
                +
              </button>
              <div className="flex-1 text-end">
                <p className="font-heading text-xl font-bold tabular-nums text-orange-500">
                  {payload.calories}
                </p>
                {/* Rounded for reading — the row that gets written keeps the
                    tenth. Showing 28.8P here beside a 29P on the list row
                    reads as two different numbers for the same food. */}
                <p className="text-micro text-muted-foreground">
                  cal · {Math.round(payload.protein_g)}P
                  {' · '}{Math.round(payload.carbs_g)}C
                  {' · '}{Math.round(payload.fat_g)}F
                </p>
              </div>
            </div>
          </div>

          <div className="px-4 pt-6 pb-4">
            <button
              type="button"
              onClick={() => submit(servings)}
              disabled={busy}
              className="w-full h-12 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {tFallback('logRecipeSheet.logTo', 'Log to {meal}', { meal: mealLabel })}
            </button>

            {/* Meal-prepped the whole tray? One tap for the lot, rather than
                eight presses of the stepper. Hidden when it would repeat the
                button above. */}
            {total > 1 && servings !== total && (
              <button
                type="button"
                onClick={() => submit(total)}
                disabled={busy}
                className="w-full mt-3 text-caption font-semibold text-info disabled:opacity-60"
              >
                Meal-prepped? Log all {total} servings
              </button>
            )}

            {/* The Nutrition page has a date picker, so this sheet can be
                logging to a past day. Say which. */}
            <p className="mt-3 text-micro text-muted-foreground text-center">
              {isToday
                ? tFallback('logRecipeSheet.landsToday', 'Lands in today’s Nutrition log. Editable there like any meal.')
                : tFallback('logRecipeSheet.landsThatDay', 'Lands in that day’s Nutrition log. Editable there like any meal.')}
            </p>
            <p className="sr-only" aria-live="polite">
              {tFallback('logRecipeSheet.servingsCalories', '{servings}, {n} calories', {
                servings: servingsText, n: payload.calories,
              })}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
