// src/components/nutrition/RecipeBuilderModal.jsx
//
// Multi-ingredient recipe builder. Users can save "my chicken rice
// bowl" with N ingredients + macros, then log the saved recipe in
// one tap from the LogMealForm.
//
// Each ingredient carries a name, an amount with a customizable unit
// (g / oz / cup / …), and calories + P/C/F. Beyond the macros, a
// recipe-level "More nutrients" section records ANY nutritional value
// — fiber, sodium, or any vitamin/mineral — via presets or a fully
// custom nutrient. Prep directions and community publishing round it
// out. Totals computed live via sumIngredients (pure helper).

import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Loader2, Save, ChefHat, ChevronDown, ImagePlus, Camera } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import * as recipes from '@/lib/data/nutritionRecipes';
import {
  INGREDIENT_UNITS, DEFAULT_UNIT, MICRO_PRESETS, MICRO_UNITS,
} from '@/lib/data/nutritionRecipes';
import { db } from '@/api/db';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';
import { reportError } from '@/lib/reportError';

// Factory rather than module-level shared object so each row gets a
// fresh reference — eliminates a class of subtle aliasing bugs and
// makes resets independent. (Audit 11 #33.)
const newEmptyIngredient = () => ({
  name: '', amount: '', unit: DEFAULT_UNIT,
  calories: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '',
});

// Per-input cap so a stuck stepper / pasted phone number can't produce
// totals like the screenshot's "2555555555555555300 C G". Returns the
// CAP as a string when over-budget so the field visibly snaps to the
// max (rather than silently dropping the keystroke).
function clampRecipeNumber(raw, max) {
  if (raw === '' || raw == null) return '';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  if (n < 0) return '0';
  if (n > max) return String(max);
  return raw;
}

// Small captioned numeric field — the caption below each input replaces
// throwaway placeholder text (the old "kcal" ghost the user asked us to
// drop) with a persistent label that survives typing.
function NumField({ caption, value, onChange, max, className = '' }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <Input
        type="number" inputMode="decimal" min="0" max={max}
        value={value}
        onChange={(e) => onChange(clampRecipeNumber(e.target.value, max))}
        // text-base prevents iOS Safari from zooming the viewport when the
        // field is focused (any font-size below 16px triggers the auto-zoom).
        className="h-8 text-base text-center px-1 w-full"
      />
      <span className="kicker mt-0.5">{caption}</span>
    </div>
  );
}

export default function RecipeBuilderModal({ open, onClose, editingRecipe = null, seedRecipe = null }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName]         = useState('');
  const [servings, setServings] = useState('1');
  const [ingredients, setIngredients] = useState(() => [newEmptyIngredient()]);
  const [directions, setDirections] = useState('');
  const [micros, setMicros] = useState([]);       // [{ key, label, amount, unit, custom }]
  const [microsOpen, setMicrosOpen] = useState(false);
  // Directions, nutrients and totals sit behind one disclosure. Ingredients
  // are the work of this screen and were competing with the finish for the
  // same altitude; on a 390px phone that is most of a viewport of chrome
  // between the last ingredient and the button that saves it.
  const [finishOpen, setFinishOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  // Resync deeply from editingRecipe when its contents change, not just
  // its id. Previously the deps `[open, editingRecipe?.id]` meant that
  // editing the same recipe twice (open → edit ingredient locally →
  // close without saving → re-open same recipe) showed the stale local
  // edits instead of the canonical server state. (Audit 11 #33.)
  useEffect(() => {
    if (!open) return;
    // A seed comes from "from a meal you logged" on the empty state — an
    // unsaved draft, so it fills the form exactly like a new recipe would but
    // with the diary row already in row one.
    if (!editingRecipe && seedRecipe) {
      setName(seedRecipe.name || '');
      setServings(String(seedRecipe.servings ?? 1));
      setIngredients(Array.isArray(seedRecipe.ingredients) && seedRecipe.ingredients.length > 0
        ? seedRecipe.ingredients.map(r => ({ ...newEmptyIngredient(), ...r }))
        : [newEmptyIngredient()]);
      setDirections('');
      setMicros([]);
      setMicrosOpen(false);
      setFinishOpen(false);
      setImageUrl(seedRecipe.image_url || '');
      return;
    }
    if (editingRecipe) {
      setName(editingRecipe.name || '');
      setServings(String(editingRecipe.servings ?? 1));
      setIngredients(Array.isArray(editingRecipe.ingredients) && editingRecipe.ingredients.length > 0
        // Map legacy `grams`-only rows onto the amount+unit shape.
        ? editingRecipe.ingredients.map(r => ({
            ...newEmptyIngredient(),
            ...r,
            amount: r.amount ?? r.grams ?? '',
            unit: recipes.normalizeUnit(r.unit),
          }))
        : [newEmptyIngredient()]);
      setDirections(editingRecipe.directions || '');
      const loadedMicros = Array.isArray(editingRecipe.micros) ? editingRecipe.micros : [];
      setMicros(loadedMicros.map(m => ({ ...m, amount: m.amount ?? '' })));
      setMicrosOpen(loadedMicros.length > 0);
      // An existing recipe usually HAS a finish, so open the disclosure when
      // there is something behind it to see.
      setFinishOpen(!!editingRecipe.directions || loadedMicros.length > 0);
      setImageUrl(editingRecipe.image_url || '');
    } else {
      setName('');
      setServings('1');
      setIngredients([newEmptyIngredient()]);
      setDirections('');
      setMicros([]);
      setMicrosOpen(false);
      setFinishOpen(false);
      setImageUrl('');
    }
  }, [open, seedRecipe, editingRecipe?.id, editingRecipe?.name, editingRecipe?.ingredients?.length]);

  const handlePickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploadingImage(true);
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file, bucket: 'uploads' });
      setImageUrl(file_url);
    } catch (err) {
      toast.error(err?.message || tFallback('recipeBuilder.imageUploadFailed', "Couldn't upload that image."));
    } finally {
      setUploadingImage(false);
    }
  };

  const updateIngredient = (i, patch) => {
    setIngredients(curr => curr.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  };
  const removeIngredient = (i) => {
    setIngredients(curr => curr.length > 1 ? curr.filter((_, idx) => idx !== i) : curr);
  };
  const addIngredient = () => setIngredients(curr => [...curr, newEmptyIngredient()]);

  // ── Micros (recipe-level custom nutrients) ──
  const addPresetMicro = (preset) => {
    setMicros(curr => curr.some(m => m.key === preset.key)
      ? curr
      : [...curr, { key: preset.key, label: preset.label, amount: '', unit: preset.unit }]);
  };
  const addCustomMicro = () => {
    setMicros(curr => [...curr, { key: '', label: '', amount: '', unit: 'mg', custom: true }]);
  };
  const updateMicro = (i, patch) => {
    setMicros(curr => curr.map((m, idx) => idx === i ? { ...m, ...patch } : m));
  };
  const removeMicro = (i) => setMicros(curr => curr.filter((_, idx) => idx !== i));

  const totals = recipes.sumIngredients(
    ingredients.map(i => Object.fromEntries(
      Object.entries(i).map(([k, v]) => [k, v === '' ? 0 : Number(v)])
    ))
  );

  const handleSave = async () => {
    if (!name.trim()) { toast.error(tFallback('recipeBuilder.nameRequired', 'Give the recipe a name.')); return; }
    const cleanIngredients = ingredients
      .filter(i => i.name?.trim())
      .map(i => ({
        name:        i.name.trim(),
        amount:      Number(i.amount)      || 0,
        unit:        recipes.normalizeUnit(i.unit),
        grams:       Number(i.amount)      || 0,  // legacy mirror for older readers
        calories:    Number(i.calories)    || 0,
        protein_g:   Number(i.protein_g)   || 0,
        carbs_g:     Number(i.carbs_g)     || 0,
        fat_g:       Number(i.fat_g)       || 0,
        fiber_g:     Number(i.fiber_g)     || 0,
      }));
    if (cleanIngredients.length === 0) {
      toast.error(tFallback('recipeBuilder.needIngredient', 'Add at least one ingredient.'));
      return;
    }
    setSaving(true);
    try {
      await recipes.upsert({
        id:           editingRecipe?.id,
        user,
        name,
        servings:     Number(servings) || 1,
        ingredients:  cleanIngredients,
        directions,
        micros,
        imageUrl,
      });
      queryClient.invalidateQueries({ queryKey: ['nutritionRecipes', user?.id] });
      toast.success(editingRecipe
        ? tFallback('recipeBuilder.updated', 'Recipe updated.')
        : tFallback('recipeBuilder.saved', 'Recipe saved.'));
      // Achievement signal — only fire on first-time creation, not edits.
      // The server-side guard re-checks the unlock state idempotently,
      // so an extra invocation is safe but wasteful.
      if (!editingRecipe?.id) {
        db.functions.invoke('updateUserXpAndAchievements', {
          xp_gained: 25,
          action_type: 'recipe_created',
          action_data: { name },
        }).catch(() => {});
      }
      onClose?.();
    } catch (err) {
      reportError(err, { feature: 'recipes.save' });
      toast.error(tFallback('notice.recipeSaveFailed', "Couldn't save the recipe. Try again."));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  const presetsToOffer = MICRO_PRESETS.filter(p => !micros.some(m => m.key === p.key));

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[9999] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl flex flex-col"
          style={{ maxHeight: '92vh' }}
        >
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="font-heading font-bold text-base flex items-center gap-2">
              <ChefHat className="w-4 h-4" /> {editingRecipe ? 'Edit recipe' : 'New recipe'}
            </h2>
            <button onClick={onClose} aria-label={tFallback("common.close", "Close")} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-4 pb-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              placeholder={tFallback("recipeBuilderModal.recipeName", "Recipe name")}
              maxLength={60}
              aria-label={tFallback("recipeBuilderModal.recipeName", "Recipe name")}
              className="h-10 text-base"
            />
            {/* Stepper AND field. The stepper is the common case — servings is
                a small count, and it is the divisor under every figure on the
                recipe, so a fat-fingered "40" silently divides the lot by ten.
                But a stepper ALONE made a 12-serving batch cook 22 taps, which
                is why the field stays: tap for one or two, type for a tray. */}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => setServings((s) => String(Math.max(1, (Number(s) || 1) - 0.5)))}
                aria-label={tFallback("recipeBuilderModal.fewerServings", "Fewer servings")}
                className="w-10 h-10 shrink-0 rounded-md border border-input bg-background text-base font-bold"
              >
                –
              </button>
              <Input
                type="number" inputMode="decimal" min="1" max="99" step="0.5"
                value={servings}
                onChange={(e) => setServings(clampRecipeNumber(e.target.value, 99))}
                aria-label={tFallback("nutrition.form.servings", "Servings")}
                className="w-14 h-10 text-base text-center px-1"
              />
              <button
                type="button"
                onClick={() => setServings((s) => String(Math.min(99, (Number(s) || 1) + 0.5)))}
                aria-label={tFallback("recipeBuilderModal.moreServings", "More servings")}
                className="w-10 h-10 shrink-0 rounded-md border border-input bg-background text-base font-bold"
              >
                +
              </button>
              <p className="flex-1 text-micro text-muted-foreground text-end">
                servings · figures below are
                <br />for the WHOLE recipe
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {/* Food image */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePickImage}
            />
            {imageUrl ? (
              <div className="relative mb-3 rounded-lg overflow-hidden border border-border">
                <img src={imageUrl} alt={tFallback('recipeBuilder.photoAlt', 'Recipe')} className="w-full h-40 object-cover" />
                <div className="absolute top-2 end-2 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={tFallback('recipeBuilder.changePhoto', 'Change photo')}
                    className="w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageUrl('')}
                    aria-label={tFallback('recipeBuilder.removePhoto', 'Remove photo')}
                    className="w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="w-full flex items-center justify-center gap-2 h-16 mb-3 rounded-lg border border-dashed border-border text-sm font-semibold text-muted-foreground hover:bg-secondary/40 active:bg-secondary/40"
              >
                {uploadingImage
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> {tFallback('recipeBuilder.uploading', 'Uploading…')}</>
                  : <><ImagePlus className="w-4 h-4" /> {tFallback('recipeBuilder.addPhoto', 'Add food photo')}</>}
              </button>
            )}

            <p className="eyebrow mb-2">{tFallback('recipeBuilder.ingredients', 'Ingredients')}</p>
            <div className="space-y-2">
              {ingredients.map((ing, i) => (
                <div key={i} className="rounded-lg border border-border/70 p-2 space-y-1.5">
                  {/* Row 1 — name + delete */}
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={ing.name}
                      onChange={(e) => updateIngredient(i, { name: e.target.value })}
                      placeholder={tFallback("recipeBuilderModal.ingredient", "Ingredient")}
                      className="h-8 text-base flex-1"
                    />
                    <button
                      onClick={() => removeIngredient(i)}
                      aria-label={tFallback("recipeBuilderModal.removeIngredient", "Remove ingredient")}
                      className="w-8 h-8 shrink-0 rounded-md text-muted-foreground hover:text-destructive active:text-destructive hover:bg-destructive/10 active:bg-destructive/10 flex items-center justify-center disabled:opacity-40"
                      disabled={ingredients.length === 1}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Row 2 — amount+unit, cal, P, C, F */}
                  <div className="flex items-start gap-1.5">
                    <div className="flex flex-col items-center basis-[34%]">
                      <div className="flex items-center gap-1 w-full">
                        <Input
                          type="number" inputMode="decimal" min="0" max="10000"
                          value={ing.amount}
                          onChange={(e) => updateIngredient(i, { amount: clampRecipeNumber(e.target.value, 10000) })}
                          className="h-8 text-base text-center px-1 w-full"
                        />
                        <select
                          value={recipes.normalizeUnit(ing.unit)}
                          onChange={(e) => updateIngredient(i, { unit: e.target.value })}
                          aria-label={tFallback("nutrition.unit", "Unit")}
                          className="h-8 rounded-md border border-input bg-background text-label px-1 shrink-0"
                        >
                          {INGREDIENT_UNITS.map(u => (
                            <option key={u.value} value={u.value}>{u.label}</option>
                          ))}
                        </select>
                      </div>
                      <span className="kicker mt-0.5">amount</span>
                    </div>
                    <NumField caption="cal" value={ing.calories}  max={10000} onChange={(v) => updateIngredient(i, { calories: v })}  className="flex-1" />
                    <NumField caption="P"   value={ing.protein_g} max={1000}  onChange={(v) => updateIngredient(i, { protein_g: v })} className="flex-1" />
                    <NumField caption="C"   value={ing.carbs_g}   max={1000}  onChange={(v) => updateIngredient(i, { carbs_g: v })}   className="flex-1" />
                    <NumField caption="F"   value={ing.fat_g}     max={1000}  onChange={(v) => updateIngredient(i, { fat_g: v })}     className="flex-1" />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addIngredient}
              className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 rounded-md border border-dashed border-border text-xs font-bold uppercase tracking-wide text-muted-foreground hover:bg-secondary/40 active:bg-secondary/40"
            >
              <Plus className="w-3.5 h-3.5" /> {tFallback("recipeBuilderModal.addIngredient", "Add ingredient")}
            </button>

            {/* The finish — directions, nutrients and totals. One disclosure,
                because ingredients are what this screen is for and everything
                here is the last five percent. */}
            <button
              type="button"
              onClick={() => setFinishOpen(o => !o)}
              aria-expanded={finishOpen}
              className="mt-6 w-full flex items-center justify-between py-2 border-t border-border text-label font-semibold text-muted-foreground"
            >
              <span>{tFallback("recipeBuilderModal.directionsNutrientsTotals", "Directions, nutrients & totals")}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${finishOpen ? 'rotate-180' : ''}`} />
            </button>

            {finishOpen && (
            <>
            {/* Directions */}
            <p className="eyebrow mt-2 mb-1">{tFallback("recipeBuilderModal.directions", "Directions")}</p>
            <textarea
              value={directions}
              onChange={(e) => setDirections(e.target.value.slice(0, 4000))}
              placeholder={tFallback("recipeBuilderModal.step110Step2", "Step 1: …&#10;Step 2: …")}
              rows={3}
              className="w-full rounded-md border border-input bg-background text-base p-2 resize-y min-h-[64px]"
            />

            {/* More nutrients — recipe-level custom values (vitamins/minerals/anything) */}
            <button
              type="button"
              onClick={() => setMicrosOpen(o => !o)}
              className="eyebrow mt-4 w-full flex items-center justify-between py-1.5"
            >
              <span>More nutrients · vitamins, minerals &amp; more</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${microsOpen ? 'rotate-180' : ''}`} />
            </button>
            {microsOpen && (
              <div className="space-y-2 pb-1">
                {micros.map((m, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={m.label}
                      onChange={(e) => updateMicro(i, { label: e.target.value })}
                      placeholder={tFallback("recipeBuilderModal.nutrient", "Nutrient")}
                      readOnly={!m.custom}
                      className={`h-8 text-base flex-1 ${!m.custom ? 'bg-secondary/40' : ''}`}
                    />
                    <Input
                      type="number" inputMode="decimal" min="0" max="100000"
                      value={m.amount}
                      onChange={(e) => updateMicro(i, { amount: clampRecipeNumber(e.target.value, 100000) })}
                      className="h-8 text-base text-center w-16"
                    />
                    <select
                      value={m.unit}
                      onChange={(e) => updateMicro(i, { unit: e.target.value })}
                      aria-label={tFallback("recipeBuilderModal.nutrientUnit", "Nutrient unit")}
                      className="h-8 rounded-md border border-input bg-background text-label px-1"
                    >
                      {MICRO_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <button
                      onClick={() => removeMicro(i)}
                      aria-label={tFallback("recipeBuilderModal.removeNutrient", "Remove nutrient")}
                      className="w-8 h-8 shrink-0 rounded-md text-muted-foreground hover:text-destructive active:text-destructive hover:bg-destructive/10 active:bg-destructive/10 flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {presetsToOffer.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {presetsToOffer.map(p => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => addPresetMicro(p)}
                        className="px-2 py-1 rounded-full border border-border text-micro font-semibold text-muted-foreground hover:bg-secondary/50 active:bg-secondary/50"
                      >
                        + {tFallback(`nutrient.${p.key.replace(/_(g|mg|mcg)$/, '')}`, p.label)}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={addCustomMicro}
                  className="w-full flex items-center justify-center gap-1 py-1.5 rounded-md border border-dashed border-border text-micro font-bold uppercase tracking-wide text-muted-foreground hover:bg-secondary/40 active:bg-secondary/40"
                >
                  <Plus className="w-3.5 h-3.5" /> {tFallback("recipeBuilderModal.customNutrient", "Custom nutrient")}
                </button>
              </div>
            )}

            {/* Live totals — pure compute via sumIngredients */}
            <p className="eyebrow mt-4 mb-1">{tFallback("recipeBuilderModal.recipeTotal", "Recipe total")}</p>
            <div className="p-3 rounded-lg bg-secondary/40 grid grid-cols-4 gap-2 text-center">
              {[
                { k: 'calories',   l: 'cal', unit: '',  txt: 'text-orange-500' },
                { k: 'protein_g',  l: 'P',   unit: 'g', txt: 'text-red-500' },
                { k: 'carbs_g',    l: 'C',   unit: 'g', txt: 'text-blue-500' },
                { k: 'fat_g',      l: 'F',   unit: 'g', txt: 'text-yellow-500' },
              ].map(({ k, l, unit, txt }) => (
                <div key={k}>
                  <p className={`font-heading text-base font-bold tabular-nums ${txt}`}>
                    {Math.round(totals[k] || 0)}{unit && <span className="text-micro font-bold ms-0.5">{unit.toUpperCase()}</span>}
                  </p>
                  <p className="kicker">{l}</p>
                </div>
              ))}
            </div>
            {Number(servings) > 1 && (() => {
              // Floor at 1 to avoid division-by-zero / negative servings
              // producing Infinity / NaN in the live per-serving display.
              const safeServings = Math.max(1, Number(servings) || 1);
              return (
                <p className="text-micro text-muted-foreground text-center mt-2">
                  Per serving: {Math.round((totals.calories || 0) / safeServings)} cal ·
                  {' '}{Math.round((totals.protein_g || 0) / safeServings)} P ·
                  {' '}{Math.round((totals.carbs_g   || 0) / safeServings)} C ·
                  {' '}{Math.round((totals.fat_g     || 0) / safeServings)} F
                </p>
              );
            })()}
            </>
            )}
          </div>

          {/* The running total pins above Save whether or not the disclosure
              is open — it is the number you watch while you type, and it used
              to scroll away with everything else. */}
          <div className="px-4 py-3 border-t border-border safe-sheet-bottom">
            <div className="flex items-baseline justify-between mb-2">
              <p className="kicker">
                Total {Math.round(totals.calories || 0)} cal ·
                {' '}{Math.round(totals.protein_g || 0)}P ·
                {' '}{Math.round(totals.carbs_g || 0)}C ·
                {' '}{Math.round(totals.fat_g || 0)}F
              </p>
              <p className="text-micro font-bold text-orange-500 tabular-nums shrink-0 ms-2">
                {Math.round((totals.calories || 0) / Math.max(1, Number(servings) || 1))} / serving
              </p>
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Save className="w-4 h-4 me-2" />}
              {editingRecipe ? 'Update recipe' : 'Save recipe'}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
