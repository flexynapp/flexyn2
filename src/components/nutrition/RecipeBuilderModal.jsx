// src/components/nutrition/RecipeBuilderModal.jsx
//
// Multi-ingredient recipe builder. Users can save "my chicken rice
// bowl" with N ingredients + macros, then log the saved recipe in
// one tap from the LogMealForm.
//
// Minimal v1: name + servings + an editable ingredient table. Each
// ingredient row has name + grams + calories + protein + carbs + fat
// + fiber. Totals computed live via sumIngredients (pure helper).

import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Loader2, Save, ChefHat } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import * as recipes from '@/lib/data/nutritionRecipes';
import { db } from '@/api/db';

const EMPTY_INGREDIENT = { name: '', grams: '', calories: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' };

export default function RecipeBuilderModal({ open, onClose, editingRecipe = null }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName]         = useState('');
  const [servings, setServings] = useState('1');
  const [ingredients, setIngredients] = useState([EMPTY_INGREDIENT]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingRecipe) {
      setName(editingRecipe.name || '');
      setServings(String(editingRecipe.servings ?? 1));
      setIngredients(Array.isArray(editingRecipe.ingredients) && editingRecipe.ingredients.length > 0
        ? editingRecipe.ingredients
        : [EMPTY_INGREDIENT]);
    } else {
      setName('');
      setServings('1');
      setIngredients([EMPTY_INGREDIENT]);
    }
  }, [open, editingRecipe?.id]);

  const updateIngredient = (i, patch) => {
    setIngredients(curr => curr.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  };
  const removeIngredient = (i) => {
    setIngredients(curr => curr.length > 1 ? curr.filter((_, idx) => idx !== i) : curr);
  };
  const addIngredient = () => setIngredients(curr => [...curr, EMPTY_INGREDIENT]);

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
        grams:       Number(i.grams)       || 0,
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
            <Input
              type="number" inputMode="decimal"
              min="1"
              step="0.5"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              placeholder="Servings"
              className="h-9 text-center"
            />
          </div>
          <div className="flex-1 overflow-y-auto px-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Ingredients</p>
            <div className="space-y-2">
              {ingredients.map((ing, i) => (
                <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                  <Input
                    value={ing.name}
                    onChange={(e) => updateIngredient(i, { name: e.target.value })}
                    placeholder="Ingredient"
                    className="h-8 text-xs col-span-5"
                  />
                  <Input type="number" inputMode="decimal" value={ing.grams}   onChange={(e) => updateIngredient(i, { grams:   e.target.value })} placeholder="g"     className="h-8 text-xs col-span-1 text-center" />
                  <Input type="number" inputMode="decimal" value={ing.calories} onChange={(e) => updateIngredient(i, { calories: e.target.value })} placeholder="kcal"  className="h-8 text-xs col-span-2 text-center" />
                  <Input type="number" inputMode="decimal" value={ing.protein_g} onChange={(e) => updateIngredient(i, { protein_g: e.target.value })} placeholder="P"   className="h-8 text-xs col-span-1 text-center" />
                  <Input type="number" inputMode="decimal" value={ing.carbs_g}   onChange={(e) => updateIngredient(i, { carbs_g: e.target.value })}   placeholder="C"   className="h-8 text-xs col-span-1 text-center" />
                  <Input type="number" inputMode="decimal" value={ing.fat_g}     onChange={(e) => updateIngredient(i, { fat_g: e.target.value })}     placeholder="F"   className="h-8 text-xs col-span-1 text-center" />
                  <button
                    onClick={() => removeIngredient(i)}
                    aria-label="Remove"
                    className="col-span-1 h-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
                    disabled={ingredients.length === 1}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
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

            {/* Live totals — pure compute via sumIngredients */}
            <div className="mt-4 p-3 rounded-lg bg-secondary/40 grid grid-cols-4 gap-2 text-center">
              {[
                { k: 'calories',   l: 'kcal', txt: 'text-orange-500' },
                { k: 'protein_g',  l: 'P g',  txt: 'text-red-500' },
                { k: 'carbs_g',    l: 'C g',  txt: 'text-blue-500' },
                { k: 'fat_g',      l: 'F g',  txt: 'text-yellow-500' },
              ].map(({ k, l, txt }) => (
                <div key={k}>
                  <p className={`font-heading text-base font-bold tabular-nums ${txt}`}>
                    {Math.round(totals[k] || 0)}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{l}</p>
                </div>
              ))}
            </div>
            {Number(servings) > 1 && (
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                Per serving: {Math.round((totals.calories || 0) / Number(servings))} kcal ·
                {' '}{Math.round((totals.protein_g || 0) / Number(servings))} P ·
                {' '}{Math.round((totals.carbs_g   || 0) / Number(servings))} C ·
                {' '}{Math.round((totals.fat_g     || 0) / Number(servings))} F
              </p>
            )}
          </div>
          <div className="px-4 py-3 border-t border-border">
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {editingRecipe ? 'Update recipe' : 'Save recipe'}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
