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
        // text-[16px] prevents iOS Safari from zooming the viewport when the
        // field is focused (any font-size below 16px triggers the auto-zoom).
        className="h-8 text-[16px] text-center px-1 w-full"
      />
      <span className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-muted-foreground/70">{caption}</span>
    </div>
  );
}

export default function RecipeBuilderModal({ open, onClose, editingRecipe = null }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName]         = useState('');
  const [servings, setServings] = useState('1');
  const [ingredients, setIngredients] = useState(() => [newEmptyIngredient()]);
  const [directions, setDirections] = useState('');
  const [micros, setMicros] = useState([]);       // [{ key, label, amount, unit, custom }]
  const [microsOpen, setMicrosOpen] = useState(false);
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
      setImageUrl(editingRecipe.image_url || '');
    } else {
      setName('');
      setServings('1');
      setIngredients([newEmptyIngredient()]);
      setDirections('');
      setMicros([]);
      setMicrosOpen(false);
      setImageUrl('');
    }
  }, [open, editingRecipe?.id, editingRecipe?.name, editingRecipe?.ingredients?.length]);

  const handlePickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploadingImage(true);
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file, bucket: 'uploads' });
      setImageUrl(file_url);
    } catch (err) {
      toast.error(err?.message || "Couldn't upload that image.");
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
    if (!name.trim()) { toast.error('Give the recipe a name.'); return; }
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
      toast.error('Add at least one ingredient.');
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
      toast.success(editingRecipe ? 'Recipe updated.' : 'Recipe saved.');
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
      toast.error(`Couldn't save: ${err?.message || 'try again'}`);
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
            <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-4 pb-3 grid grid-cols-3 gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              placeholder="Recipe name"
              maxLength={60}
              className="col-span-2 h-9"
            />
            <div className="flex flex-col items-center">
              <Input
                type="number" inputMode="decimal"
                min="1" step="0.5"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                className="h-9 text-center w-full"
              />
              <span className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-muted-foreground/70">servings</span>
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
                <img src={imageUrl} alt="Recipe" className="w-full h-40 object-cover" />
                <div className="absolute top-2 end-2 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Change photo"
                    className="w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageUrl('')}
                    aria-label="Remove photo"
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
                className="w-full flex items-center justify-center gap-2 h-16 mb-3 rounded-lg border border-dashed border-border text-sm font-semibold text-muted-foreground hover:bg-secondary/40"
              >
                {uploadingImage
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                  : <><ImagePlus className="w-4 h-4" /> Add food photo</>}
              </button>
            )}

            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Ingredients</p>
            <div className="space-y-2">
              {ingredients.map((ing, i) => (
                <div key={i} className="rounded-lg border border-border/70 p-2 space-y-1.5">
                  {/* Row 1 — name + delete */}
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={ing.name}
                      onChange={(e) => updateIngredient(i, { name: e.target.value })}
                      placeholder="Ingredient"
                      className="h-8 text-[16px] flex-1"
                    />
                    <button
                      onClick={() => removeIngredient(i)}
                      aria-label="Remove ingredient"
                      className="w-8 h-8 shrink-0 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center disabled:opacity-40"
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
                          className="h-8 text-[16px] text-center px-1 w-full"
                        />
                        <select
                          value={recipes.normalizeUnit(ing.unit)}
                          onChange={(e) => updateIngredient(i, { unit: e.target.value })}
                          aria-label="Unit"
                          className="h-8 rounded-md border border-input bg-background text-[13px] px-1 shrink-0"
                        >
                          {INGREDIENT_UNITS.map(u => (
                            <option key={u.value} value={u.value}>{u.label}</option>
                          ))}
                        </select>
                      </div>
                      <span className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-muted-foreground/70">amount</span>
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
              className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 rounded-md border border-dashed border-border text-xs font-bold uppercase tracking-wide text-muted-foreground hover:bg-secondary/40"
            >
              <Plus className="w-3.5 h-3.5" /> Add ingredient
            </button>

            {/* Directions */}
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mt-4 mb-1">Directions</p>
            <textarea
              value={directions}
              onChange={(e) => setDirections(e.target.value.slice(0, 4000))}
              placeholder="Step 1: …&#10;Step 2: …"
              rows={3}
              className="w-full rounded-md border border-input bg-background text-[16px] p-2 resize-y min-h-[64px]"
            />

            {/* More nutrients — recipe-level custom values (vitamins/minerals/anything) */}
            <button
              type="button"
              onClick={() => setMicrosOpen(o => !o)}
              className="mt-4 w-full flex items-center justify-between py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
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
                      placeholder="Nutrient"
                      readOnly={!m.custom}
                      className={`h-8 text-[16px] flex-1 ${!m.custom ? 'bg-secondary/40' : ''}`}
                    />
                    <Input
                      type="number" inputMode="decimal" min="0" max="100000"
                      value={m.amount}
                      onChange={(e) => updateMicro(i, { amount: clampRecipeNumber(e.target.value, 100000) })}
                      className="h-8 text-[16px] text-center w-16"
                    />
                    <select
                      value={m.unit}
                      onChange={(e) => updateMicro(i, { unit: e.target.value })}
                      aria-label="Nutrient unit"
                      className="h-8 rounded-md border border-input bg-background text-[13px] px-1"
                    >
                      {MICRO_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <button
                      onClick={() => removeMicro(i)}
                      aria-label="Remove nutrient"
                      className="w-8 h-8 shrink-0 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
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
                        className="px-2 py-1 rounded-full border border-border text-[11px] font-semibold text-muted-foreground hover:bg-secondary/50"
                      >
                        + {p.label}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={addCustomMicro}
                  className="w-full flex items-center justify-center gap-1 py-1.5 rounded-md border border-dashed border-border text-[11px] font-bold uppercase tracking-wide text-muted-foreground hover:bg-secondary/40"
                >
                  <Plus className="w-3.5 h-3.5" /> Custom nutrient
                </button>
              </div>
            )}

            {/* Live totals — pure compute via sumIngredients */}
            <div className="mt-4 p-3 rounded-lg bg-secondary/40 grid grid-cols-4 gap-2 text-center">
              {[
                { k: 'calories',   l: 'cal', unit: '',  txt: 'text-orange-500' },
                { k: 'protein_g',  l: 'P',   unit: 'g', txt: 'text-red-500' },
                { k: 'carbs_g',    l: 'C',   unit: 'g', txt: 'text-blue-500' },
                { k: 'fat_g',      l: 'F',   unit: 'g', txt: 'text-yellow-500' },
              ].map(({ k, l, unit, txt }) => (
                <div key={k}>
                  <p className={`font-heading text-base font-bold tabular-nums ${txt}`}>
                    {Math.round(totals[k] || 0)}{unit && <span className="text-[10px] font-bold ms-0.5">{unit.toUpperCase()}</span>}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{l}</p>
                </div>
              ))}
            </div>
            {Number(servings) > 1 && (() => {
              // Floor at 1 to avoid division-by-zero / negative servings
              // producing Infinity / NaN in the live per-serving display.
              const safeServings = Math.max(1, Number(servings) || 1);
              return (
                <p className="text-[10px] text-muted-foreground text-center mt-2">
                  Per serving: {Math.round((totals.calories || 0) / safeServings)} cal ·
                  {' '}{Math.round((totals.protein_g || 0) / safeServings)} P ·
                  {' '}{Math.round((totals.carbs_g   || 0) / safeServings)} C ·
                  {' '}{Math.round((totals.fat_g     || 0) / safeServings)} F
                </p>
              );
            })()}
          </div>

          <div className="px-4 py-3 border-t border-border">
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
