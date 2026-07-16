// src/components/nutrition/PhotoMealResultModal.jsx
//
// The result screen for Photo-AI. After a meal photo is recognized this
// modal replaces the old toast-and-prefill flow: it shows the photo the
// user took, the estimated dish + portion + confidence, a swipeable macro
// panel (core Calories/P/C/F → swipe left for Fiber/Sugar/Sodium), and a
// per-ingredient breakdown. The user can Edit the totals inline, then Save
// — which logs the meal through the normal path so daily calories, macros,
// and the dashboard Nutrition/Recovery cards all update.

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Pencil, Check, Save, Loader2, Sparkles, Utensils } from 'lucide-react';
import { Input } from '@/components/ui/input';

const num = (v) => {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

// The macros the modal reads/writes. food_name is handled separately.
const MACRO_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg'];

// One stat tile — read-only, or an inline number input in edit mode.
function Tile({ label, value, unit, color, editing, onChange, big = false }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl bg-secondary/40 ${big ? 'py-3' : 'py-2.5'}`}>
      {editing ? (
        <Input
          type="number" inputMode="decimal" min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-8 w-16 text-center text-[16px] font-bold tabular-nums ${color}`}
        />
      ) : (
        <p className={`font-heading font-bold tabular-nums ${color} ${big ? 'text-3xl' : 'text-xl'}`}>
          {num(value)}<span className="text-[11px] font-semibold align-top ms-0.5">{unit}</span>
        </p>
      )}
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

export default function PhotoMealResultModal({ open, imageUrl, result, saving, onClose, onSave }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [vals, setVals] = useState({});
  const [slide, setSlide] = useState(0);
  const trackRef = useRef(null);

  // (Re)hydrate from the recognized result each time a new one opens.
  useEffect(() => {
    if (!open || !result) return;
    setEditing(false);
    setSlide(0);
    setName(result.food_name || 'Meal');
    setVals({
      calories:  result.calories  ?? '',
      protein_g: result.protein_g ?? '',
      carbs_g:   result.carbs_g   ?? '',
      fat_g:     result.fat_g     ?? '',
      fiber_g:   result.fiber_g   ?? '',
      sugar_g:   result.sugar_g   ?? '',
      sodium_mg: result.sodium_mg ?? '',
    });
  }, [open, result]);

  if (!open || !result) return null;

  const items = Array.isArray(result.items) ? result.items : [];
  const confidence = ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : null;
  const confColor = confidence === 'high' ? 'bg-emerald-500' : confidence === 'low' ? 'bg-amber-500' : 'bg-sky-500';
  const setVal = (k, v) => setVals((p) => ({ ...p, [k]: v }));

  const handleSave = () => {
    const entry = { food_name: (name || 'Meal').trim() };
    for (const k of MACRO_KEYS) entry[k] = num(vals[k]);
    onSave?.(entry);
  };

  const onTrackScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setSlide(Math.round(el.scrollLeft / el.clientWidth));
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[9999] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl flex flex-col"
          style={{ maxHeight: '94vh' }}
        >
          {/* Photo banner + overlay */}
          <div className="relative h-44 shrink-0 bg-black">
            {imageUrl
              ? <img src={imageUrl} alt="Your meal" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-white/40"><Utensils className="w-8 h-8" /></div>}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/20" />
            <button onClick={onClose} aria-label="Close" className="absolute top-3 end-3 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
            <div className="absolute top-3 start-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1">
              <Sparkles className="w-3 h-3 text-white" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-white">Photo-AI</span>
            </div>
            <div className="absolute bottom-0 inset-x-0 p-3">
              {editing ? (
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 80))}
                  className="h-9 text-[16px] font-semibold bg-white/95"
                  placeholder="Meal name"
                />
              ) : (
                <h2 className="font-heading font-bold text-white text-lg leading-tight drop-shadow">{name}</h2>
              )}
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                {result.portion_estimate && (
                  <span className="text-[11px] text-white/90 drop-shadow">{result.portion_estimate}</span>
                )}
                {confidence && (
                  <span className={`inline-flex items-center gap-1 rounded-full ${confColor} px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white`}>
                    {confidence} confidence
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Swipeable macro panel: slide 0 = core, slide 1 = more */}
            <div
              ref={trackRef}
              onScroll={onTrackScroll}
              className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none]"
              style={{ scrollbarWidth: 'none' }}
            >
              <div className="snap-center shrink-0 basis-full min-w-full px-4 pt-4">
                <Tile big label="Calories" unit="" color="text-orange-500" editing={editing} value={vals.calories} onChange={(v) => setVal('calories', v)} />
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Tile label="Protein" unit="g" color="text-red-500"    editing={editing} value={vals.protein_g} onChange={(v) => setVal('protein_g', v)} />
                  <Tile label="Carbs"   unit="g" color="text-blue-500"   editing={editing} value={vals.carbs_g}   onChange={(v) => setVal('carbs_g', v)} />
                  <Tile label="Fat"     unit="g" color="text-yellow-500" editing={editing} value={vals.fat_g}     onChange={(v) => setVal('fat_g', v)} />
                </div>
              </div>
              <div className="snap-center shrink-0 basis-full min-w-full px-4 pt-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2 text-center">More nutrients</p>
                <div className="grid grid-cols-3 gap-2">
                  <Tile label="Fiber"  unit="g"  color="text-emerald-500" editing={editing} value={vals.fiber_g}   onChange={(v) => setVal('fiber_g', v)} />
                  <Tile label="Sugar"  unit="g"  color="text-pink-500"    editing={editing} value={vals.sugar_g}   onChange={(v) => setVal('sugar_g', v)} />
                  <Tile label="Sodium" unit="mg" color="text-violet-500"  editing={editing} value={vals.sodium_mg} onChange={(v) => setVal('sodium_mg', v)} />
                </div>
              </div>
            </div>
            {/* Slide dots + hint */}
            <div className="flex items-center justify-center gap-1.5 mt-2.5">
              {[0, 1].map((i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${slide === i ? 'w-4 bg-primary' : 'w-1.5 bg-border'}`} />
              ))}
            </div>
            {slide === 0 && (
              <p className="text-[10px] text-muted-foreground text-center mt-1">Swipe for fiber, sugar &amp; sodium →</p>
            )}

            {/* Per-ingredient breakdown */}
            {items.length > 0 && (
              <div className="px-4 pt-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Ingredients</p>
                <div className="space-y-1.5">
                  {items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{it.name || 'Item'}</p>
                        {it.amount && <p className="text-[11px] text-muted-foreground">{it.amount}</p>}
                      </div>
                      <div className="text-end shrink-0">
                        <p className="text-sm font-bold tabular-nums text-orange-500">{num(it.calories)}<span className="text-[10px] ms-0.5">cal</span></p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          {num(it.protein_g)}P · {num(it.carbs_g)}C · {num(it.fat_g)}F
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.notes && (
              <p className="px-4 pt-3 text-[11px] text-muted-foreground italic">{result.notes}</p>
            )}
            <div className="h-3" />
          </div>

          {/* Footer — Edit toggle + Save */}
          <div className="px-4 py-3 border-t border-border flex gap-2">
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className={`flex-1 h-11 rounded-lg border text-sm font-bold flex items-center justify-center gap-1.5 ${
                editing ? 'border-primary text-primary bg-primary/10' : 'border-border text-foreground'
              }`}
            >
              {editing ? <><Check className="w-4 h-4" /> Done</> : <><Pencil className="w-4 h-4" /> Edit</>}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-[1.4] h-11 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save meal
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
