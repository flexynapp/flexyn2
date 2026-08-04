// src/components/nutrition/PhotoMealResultModal.jsx
//
// The result screen for Photo-AI. After a meal photo is recognized this
// modal replaces the old toast-and-prefill flow: it shows the photo the
// user took, the estimated dish + portion + confidence, a swipeable macro
// panel (core Calories/P/C/F → swipe left for Fiber/Sugar/Sodium), and a
// per-ingredient breakdown. The user can Edit the totals inline, then Save
// — which logs the meal through the normal path so daily calories, macros,
// and the dashboard Nutrition/Recovery cards all update.
//
// Also doubles as a read-only detail view (`readOnly`) for re-opening an
// already-saved meal — same photo + metrics layout, but with the Edit /
// Save footer swapped for Done (+ optional Delete via `onDelete`).

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Pencil, Check, Save, Loader2, Sparkles, Utensils, Trash2, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

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
          className={`h-8 w-16 text-center text-base font-bold tabular-nums ${color}`}
        />
      ) : (
        <p className={`font-heading font-bold tabular-nums ${color} ${big ? 'text-3xl' : 'text-xl'}`}>
          {num(value)}<span className="text-micro font-semibold align-top ms-0.5">{unit}</span>
        </p>
      )}
      <p className="mt-0.5 text-micro font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

export default function PhotoMealResultModal({ open, imageUrl, result, saving, onClose, onSave, readOnly = false, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [vals, setVals] = useState({});
  // Editable copy of the per-ingredient breakdown. When it holds any rows the
  // core macros (calories/protein/carbs/fat) are the SUM of the ingredients —
  // so adding a missing ingredient in Edit mode makes the totals grow.
  const [editItems, setEditItems] = useState([]);
  const [slide, setSlide] = useState(0);
  const trackRef = useRef(null);
  const kbInset = useKeyboardInset();
  // Lock the page behind the modal so only the modal scrolls.
  useBodyScrollLock(open && !!result);

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
    setEditItems(
      Array.isArray(result.items)
        ? result.items.map((it) => ({
            name:      it?.name   || '',
            amount:    it?.amount || '',
            calories:  it?.calories  ?? '',
            protein_g: it?.protein_g ?? '',
            carbs_g:   it?.carbs_g   ?? '',
            fat_g:     it?.fat_g     ?? '',
          }))
        : [],
    );
  }, [open, result]);

  // While editing, keep the core-macro totals in lockstep with the ingredient
  // list (the ingredients are the source of truth once there's at least one).
  useEffect(() => {
    if (!editing || editItems.length === 0) return;
    setVals((prev) => ({
      ...prev,
      calories:  editItems.reduce((s, it) => s + num(it.calories),  0),
      protein_g: editItems.reduce((s, it) => s + num(it.protein_g), 0),
      carbs_g:   editItems.reduce((s, it) => s + num(it.carbs_g),   0),
      fat_g:     editItems.reduce((s, it) => s + num(it.fat_g),     0),
    }));
  }, [editItems, editing]);

  if (!open || !result) return null;

  const confidence = ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : null;
  const confColor = confidence === 'high' ? 'bg-success' : confidence === 'low' ? 'bg-primary' : 'bg-info';
  const setVal = (k, v) => setVals((p) => ({ ...p, [k]: v }));

  // Ingredients drive the core macros when present, so those tiles are read-only
  // in Edit mode (you change them by editing the ingredients). Fiber/sugar/sodium
  // aren't itemised, so they stay directly editable.
  const hasItems = editItems.length > 0;
  const coreEditable = editing && !hasItems;

  const blankItem = () => ({ name: '', amount: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' });
  const updateItem = (i, k, v) => setEditItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const removeItem = (i) => setEditItems((prev) => prev.filter((_, idx) => idx !== i));
  const addItem = () => setEditItems((prev) => {
    // Seeding the first row from the current totals keeps a meal that has no
    // itemised breakdown (e.g. a manual entry) from losing its macros the
    // moment the ingredient list becomes the source of truth.
    if (prev.length === 0) {
      const base = {
        name:      (name || 'Meal').trim() || 'Meal',
        amount:    result.portion_estimate || '',
        calories:  num(vals.calories),
        protein_g: num(vals.protein_g),
        carbs_g:   num(vals.carbs_g),
        fat_g:     num(vals.fat_g),
      };
      const baseHasMacros = base.calories || base.protein_g || base.carbs_g || base.fat_g;
      return baseHasMacros ? [base, blankItem()] : [blankItem()];
    }
    return [...prev, blankItem()];
  });

  const handleSave = () => {
    const cleanItems = editItems
      .map((it) => ({
        name:      (it.name || '').trim(),
        amount:    (it.amount || '').trim(),
        calories:  num(it.calories),
        protein_g: num(it.protein_g),
        carbs_g:   num(it.carbs_g),
        fat_g:     num(it.fat_g),
      }))
      // Drop fully-empty rows (a stray "Add ingredient" the user didn't fill in).
      .filter((it) => it.name || it.calories || it.protein_g || it.carbs_g || it.fat_g);

    const entry = { food_name: (name || 'Meal').trim() };
    if (cleanItems.length > 0) {
      entry.calories  = cleanItems.reduce((s, it) => s + it.calories,  0);
      entry.protein_g = cleanItems.reduce((s, it) => s + it.protein_g, 0);
      entry.carbs_g   = cleanItems.reduce((s, it) => s + it.carbs_g,   0);
      entry.fat_g     = cleanItems.reduce((s, it) => s + it.fat_g,     0);
    } else {
      entry.calories  = num(vals.calories);
      entry.protein_g = num(vals.protein_g);
      entry.carbs_g   = num(vals.carbs_g);
      entry.fat_g     = num(vals.fat_g);
    }
    entry.fiber_g   = num(vals.fiber_g);
    entry.sugar_g   = num(vals.sugar_g);
    entry.sodium_mg = num(vals.sodium_mg);
    entry.items     = cleanItems;
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
          {/* Photo banner + overlay — the photo fills the whole banner. Meals
              with no saved photo get a warm gradient instead of stark black. */}
          <div
            className="relative h-44 shrink-0 overflow-hidden bg-black"
            style={imageUrl ? undefined : { background: 'linear-gradient(135deg, hsl(24 90% 55% / 0.45), hsl(265 70% 55% / 0.4))' }}
          >
            {imageUrl
              ? <img src={imageUrl} alt="Your meal" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-white/60"><Utensils className="w-10 h-10" /></div>}
            <div className={`absolute inset-0 bg-gradient-to-t ${imageUrl ? 'from-black/75 via-black/10 to-black/20' : 'from-black/50 via-transparent to-black/10'}`} />
            <button onClick={onClose} aria-label="Close" className="absolute top-3 end-3 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
            {/* Photo-AI badge — hidden on the read-only detail view of a
                meal that has no photo (a manually logged entry), where it
                would be misleading. */}
            {(!readOnly || imageUrl) && (
              <div className="absolute top-3 start-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1">
                <Sparkles className="w-3 h-3 text-white" />
                <span className="text-micro font-bold uppercase tracking-wide text-white">Photo-AI</span>
              </div>
            )}
            <div className="absolute bottom-0 inset-x-0 p-3">
              {editing ? (
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 80))}
                  className="h-9 text-base font-semibold bg-white/95"
                  placeholder="Meal name"
                />
              ) : (
                <h2 className="font-heading font-bold text-white text-lg leading-tight drop-shadow">{name}</h2>
              )}
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                {result.portion_estimate && (
                  <span className="text-micro text-white/90 drop-shadow">{result.portion_estimate}</span>
                )}
                {confidence && (
                  <span className={`inline-flex items-center gap-1 rounded-full ${confColor} px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-white`}>
                    {confidence} confidence
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            className="flex-1 overflow-y-auto"
            style={{ paddingBottom: kbInset ? kbInset + 24 : undefined }}
          >
            {/* Swipeable macro panel: slide 0 = core, slide 1 = more */}
            <div
              ref={trackRef}
              onScroll={onTrackScroll}
              className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none]"
              style={{ scrollbarWidth: 'none' }}
            >
              <div className="snap-center shrink-0 basis-full min-w-full px-4 pt-4">
                <Tile big label="Calories" unit="" color="text-primary" editing={coreEditable} value={vals.calories} onChange={(v) => setVal('calories', v)} />
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Tile label="Protein" unit="g" color="text-destructive"    editing={coreEditable} value={vals.protein_g} onChange={(v) => setVal('protein_g', v)} />
                  <Tile label="Carbs"   unit="g" color="text-info"   editing={coreEditable} value={vals.carbs_g}   onChange={(v) => setVal('carbs_g', v)} />
                  <Tile label="Fat"     unit="g" color="text-primary" editing={coreEditable} value={vals.fat_g}     onChange={(v) => setVal('fat_g', v)} />
                </div>
                {editing && hasItems && (
                  <p className="mt-2 text-micro text-muted-foreground text-center">
                    Calories, protein, carbs &amp; fat total up from your ingredients below.
                  </p>
                )}
              </div>
              <div className="snap-center shrink-0 basis-full min-w-full px-4 pt-4">
                <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-2 text-center">More nutrients</p>
                <div className="grid grid-cols-3 gap-2">
                  <Tile label="Fiber"  unit="g"  color="text-success" editing={editing} value={vals.fiber_g}   onChange={(v) => setVal('fiber_g', v)} />
                  <Tile label="Sugar"  unit="g"  color="text-primary"    editing={editing} value={vals.sugar_g}   onChange={(v) => setVal('sugar_g', v)} />
                  <Tile label="Sodium" unit="mg" color="text-primary"  editing={editing} value={vals.sodium_mg} onChange={(v) => setVal('sodium_mg', v)} />
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
              <p className="text-micro text-muted-foreground text-center mt-1">Swipe for fiber, sugar &amp; sodium →</p>
            )}

            {/* Per-ingredient breakdown. In Edit mode every row is editable and
                you can add/remove ingredients; the core macros re-total live. */}
            {(editing || editItems.length > 0) && (
              <div className="px-4 pt-4">
                <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Ingredients</p>

                {editing ? (
                  <div className="space-y-2">
                    {editItems.map((it, i) => (
                      <div key={i} className="rounded-lg border border-border/70 p-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={it.name}
                            onChange={(e) => updateItem(i, 'name', e.target.value.slice(0, 60))}
                            placeholder="Ingredient name"
                            className="h-8 flex-1 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => removeItem(i)}
                            aria-label="Remove ingredient"
                            className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <Input
                          value={it.amount}
                          onChange={(e) => updateItem(i, 'amount', e.target.value.slice(0, 40))}
                          placeholder="Amount / unit — e.g. 1 cup, 100 g"
                          className="h-8 w-full text-sm"
                        />
                        <div className="grid grid-cols-4 gap-1.5">
                          {[
                            { k: 'calories',  lbl: 'Cal', color: 'text-primary' },
                            { k: 'protein_g', lbl: 'P',   color: 'text-destructive' },
                            { k: 'carbs_g',   lbl: 'C',   color: 'text-info' },
                            { k: 'fat_g',     lbl: 'F',   color: 'text-primary' },
                          ].map(({ k, lbl, color }) => (
                            <div key={k} className="flex flex-col items-center">
                              <label className={`text-micro font-bold uppercase tracking-wide ${color}`}>{lbl}</label>
                              <Input
                                type="number" inputMode="decimal" min="0"
                                value={it[k]}
                                onChange={(e) => updateItem(i, k, e.target.value)}
                                placeholder="0"
                                className="h-8 w-full text-center text-sm tabular-nums px-1"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addItem}
                      className="w-full h-10 rounded-lg border border-dashed border-primary/50 text-primary text-sm font-bold flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" /> Add ingredient
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {editItems.map((it, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{it.name || 'Item'}</p>
                          {it.amount && <p className="text-micro text-muted-foreground">{it.amount}</p>}
                        </div>
                        <div className="text-end shrink-0">
                          <p className="text-sm font-bold tabular-nums text-primary">{num(it.calories)}<span className="text-micro ms-0.5">cal</span></p>
                          <p className="text-micro text-muted-foreground tabular-nums">
                            {num(it.protein_g)}P · {num(it.carbs_g)}C · {num(it.fat_g)}F
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {result.notes && (
              <p className="px-4 pt-3 text-micro text-muted-foreground italic">{result.notes}</p>
            )}
            <div className="h-3" />
          </div>

          {/* Footer — read-only detail (Delete? + Done) vs. Edit + Save. */}
          {readOnly ? (
            <div className="px-4 py-3 border-t border-border flex gap-2">
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="flex-1 h-11 rounded-lg border border-destructive/40 text-destructive text-sm font-bold flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex-[1.4] h-11 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" /> Done
              </button>
            </div>
          ) : (
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
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
