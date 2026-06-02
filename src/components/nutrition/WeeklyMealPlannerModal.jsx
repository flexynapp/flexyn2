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
  X, ChevronLeft, ChevronRight, Loader2, Plus, Download,
  CalendarDays, ShoppingCart, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, addDays, startOfWeek } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import * as mealPlans from '@/lib/data/mealPlans';
import * as recipes from '@/lib/data/nutritionRecipes';

const MEAL_SLOTS = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { key: 'lunch',     label: 'Lunch',     emoji: '🥗' },
  { key: 'dinner',    label: 'Dinner',    emoji: '🍽️' },
  { key: 'snack',     label: 'Snack',     emoji: '🍎' },
];

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

// ── Grocery-list sub-modal ─────────────────────────────────────────────
function GroceryListModal({ open, items, onClose }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const W = 600, H = Math.max(400, 160 + (items.length || 1) * 36);
    canvas.width = W; canvas.height = H;

    // Background gradient — emerald → cyan (matches WeeklyRecapShareCard).
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#064e3b');
    bg.addColorStop(1, '#0c4a6e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('Grocery list', 32, 56);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '14px sans-serif';
    ctx.fillText(`${items.length} item${items.length === 1 ? '' : 's'}`, 32, 80);

    // Items
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    items.forEach((it, i) => {
      const y = 130 + i * 36;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(46, y - 6, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      const label = `${it.name}${it.total_grams ? `  ·  ${it.total_grams}g` : ''}`;
      ctx.fillText(label, 66, y);
    });

    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px sans-serif';
    ctx.fillText('Generated by Flexyn', 32, H - 24);
  }, [open, items]);

  if (!open) return null;

  const handleDownload = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `flexyn-grocery-${Date.now()}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'My grocery list' });
          return;
        } catch { /* fall through */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      onClick={onClose}
      className="fixed inset-0 z-[10000] bg-black/60 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div
        initial={{ y: 24 }} animate={{ y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-card border border-border rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-heading font-bold text-sm flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-emerald-500" /> Grocery list
          </h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {items.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No uncompleted meals planned — add some recipes to the grid first.
            </p>
          ) : (
            <>
              <ul className="space-y-1.5 mb-4">
                {items.map((it, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2 text-sm px-2 py-1.5 rounded-md bg-secondary/40">
                    <span className="font-medium text-foreground">{it.name}</span>
                    {it.total_grams > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {it.total_grams}g
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <canvas ref={canvasRef} className="w-full rounded-lg shadow-md mb-3" />
              <button
                onClick={handleDownload}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-500 text-white font-bold text-sm hover:bg-emerald-600 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download / share
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main planner modal ────────────────────────────────────────────────
export default function WeeklyMealPlannerModal({ open, onClose }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [anchor, setAnchor] = useState(() => new Date());
  const [pickerSlot, setPickerSlot] = useState(null); // { date, mealType }
  const [groceryOpen, setGroceryOpen] = useState(false);

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

  const groceryItems = useMemo(
    () => mealPlans.buildGroceryList(plans, recipesById),
    [plans, recipesById],
  );

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
              <CalendarDays className="w-4 h-4 text-primary" />
              <h2 className="font-heading font-bold text-base">Weekly meal planner</h2>
            </div>
            <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

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

          {/* Grid — horizontal scroll on mobile, grid on desktop */}
          <div className="flex-1 overflow-y-auto p-3">
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
                    <div key={dateStr} className="flex flex-col">
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
                                if (plan) {
                                  if (confirm('Remove this meal?')) removeMutation.mutate(plan.id);
                                } else {
                                  setPickerSlot({ date: dateStr, mealType: slot.key });
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

          {/* Footer — grocery list CTA */}
          <div className="px-4 py-3 border-t border-border shrink-0">
            <button
              onClick={() => setGroceryOpen(true)}
              disabled={plans.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              <ShoppingCart className="w-4 h-4" />
              Generate grocery list
              {plans.length > 0 && <Check className="w-3 h-3 opacity-70" />}
            </button>
          </div>
        </motion.div>

        <RecipePickerModal
          open={!!pickerSlot}
          recipes={recipeList}
          onPick={handlePick}
          onClose={() => setPickerSlot(null)}
        />

        <GroceryListModal
          open={groceryOpen}
          items={groceryItems}
          onClose={() => setGroceryOpen(false)}
        />
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
