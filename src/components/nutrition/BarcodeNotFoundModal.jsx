// src/components/nutrition/BarcodeNotFoundModal.jsx
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PackageSearch, Save, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/LanguageContext';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { create as createFoodItem } from '@/lib/data/foodItems';
import { containsProfanity } from '@/lib/profanityFilter';
import { toast } from '@/lib/toast';

const NUTRIENT_FIELDS = [
  { key: 'calories',      label: 'Calories',     unit: 'cal', color: '#f97316', required: true },
  { key: 'protein_g',     label: 'Protein',       unit: 'g',    color: '#ef4444' },
  { key: 'carbs_g',       label: 'Carbohydrates', unit: 'g',    color: '#3b82f6' },
  { key: 'fat_g',         label: 'Total Fat',     unit: 'g',    color: '#eab308' },
  { key: 'fiber_g',       label: 'Fiber',         unit: 'g',    color: '#22c55e' },
  { key: 'sugar_g',       label: 'Sugar',         unit: 'g',    color: '#a855f7' },
  { key: 'sodium_mg',     label: 'Sodium',        unit: 'mg',   color: '#ec4899' },
  { key: 'cholesterol_mg',label: 'Cholesterol',   unit: 'mg',   color: '#06b6d4' },
];

const VITAMIN_FIELDS = [
  { key: 'calcium_mg',     label: 'Calcium',     unit: 'mg' },
  { key: 'iron_mg',        label: 'Iron',        unit: 'mg' },
  { key: 'magnesium_mg',   label: 'Magnesium',   unit: 'mg' },
  { key: 'potassium_mg',   label: 'Potassium',   unit: 'mg' },
  { key: 'vitamin_a_iu',   label: 'Vitamin A',   unit: 'IU' },
  { key: 'vitamin_c_mg',   label: 'Vitamin C',   unit: 'mg' },
  { key: 'vitamin_d_iu',   label: 'Vitamin D',   unit: 'IU' },
  { key: 'vitamin_b12_mcg',label: 'Vitamin B12', unit: 'mcg' },
];

const EMPTY_NUTRIENTS = Object.fromEntries(NUTRIENT_FIELDS.map(f => [f.key, '']));
const EMPTY_VITAMINS  = Object.fromEntries(VITAMIN_FIELDS.map(f => [f.key, '']));

export default function BarcodeNotFoundModal({ barcode, onCancel, onSubmit }) {
  const { tFallback } = useLanguage();
  const kbInset = useKeyboardInset();
  useBodyScrollLock(true);
  const [tab, setTab] = useState('nutrients');
  const [name, setName] = useState('');
  const [servingLabel, setServingLabel] = useState('1 serving');
  const [nutrients, setNutrients] = useState(EMPTY_NUTRIENTS);
  const [vitamins, setVitamins] = useState(EMPTY_VITAMINS);
  const [saving, setSaving] = useState(false);

  const setN = (key, val) => setNutrients(prev => ({ ...prev, [key]: val }));
  const setV = (key, val) => setVitamins(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Please enter the food name.');
      return;
    }
    if (containsProfanity(name)) {
      toast.error('Please use an appropriate food name.');
      return;
    }
    if (!nutrients.calories && nutrients.calories !== 0) {
      toast.error('Calories are required.');
      return;
    }

    setSaving(true);
    try {
      // Build the nutrition + vitamins objects from string inputs
      const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
      const nutritionRecord = {
        calories:    num(nutrients.calories),
        protein:     num(nutrients.protein_g),
        carbs:       num(nutrients.carbs_g),
        fat:         num(nutrients.fat_g),
        fiber:       num(nutrients.fiber_g),
        sugar:       num(nutrients.sugar_g),
        sodium:      num(nutrients.sodium_mg),
        cholesterol: num(nutrients.cholesterol_mg),
      };
      const vitaminsRecord = Object.fromEntries(
        VITAMIN_FIELDS.map(f => [f.key, num(vitamins[f.key])])
      );

      // Save to the shared community FoodItem entity.
      //
      // Write BOTH shapes: the rich jsonb payload (`nutrition` /
      // `vitamins` / `source` — added by the food_items jsonb
      // migration) AND the flat legacy columns from 001_initial_schema
      // (calories / protein / carbs / fat / fiber / sodium) so readers
      // on either side of the migration get real numbers. On a host
      // without the jsonb columns, the entity layer's 42703
      // strip-and-retry drops those keys but the flat columns still
      // land — previously the WHOLE nutrition payload was silently
      // dropped and re-scans logged 0-calorie meals.
      const saved = await createFoodItem({
        barcode,
        name: name.trim(),
        serving_label: servingLabel.trim() || '1 serving',
        // Flat legacy columns (001_initial_schema.sql food_items)
        calories: num(nutrients.calories)  ?? 0,
        protein:  num(nutrients.protein_g) ?? 0,
        carbs:    num(nutrients.carbs_g)   ?? 0,
        fat:      num(nutrients.fat_g)     ?? 0,
        fiber:    num(nutrients.fiber_g)   ?? 0,
        sodium:   num(nutrients.sodium_mg) ?? 0,
        // Rich jsonb columns (community-barcode migration)
        nutrition:  nutritionRecord,
        vitamins:   vitaminsRecord,
        source:     'user_submitted',
      });

      // Only claim "available for everyone" when the jsonb payload
      // actually landed — strip-and-retry means a pre-migration host
      // returns a row WITHOUT the `nutrition` key, and community-wide
      // read access ships with the same migration.
      const richSaved = !!(saved && saved.nutrition);
      toast.success(richSaved
        ? tFallback('nutrition.barcode.savedForEveryone', "Food item saved! It's now available for all users who scan this barcode.")
        : tFallback('nutrition.barcode.savedToLog', 'Food item saved — you can log it now.'));

      // Return the product in the same shape as lookupBarcode() so the caller
      // can immediately show BarcodeResultModal without a second lookup.
      onSubmit({
        barcode,
        name: name.trim(),
        servingLabel: servingLabel.trim() || '1 serving',
        source: 'community',
        nutrition: nutritionRecord,
        vitamins:  vitaminsRecord,
      });
    } catch (err) {
      toast.error('Could not save food item. Please try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
        onClick={onCancel}
      >
        <motion.div
          key="modal"
          initial={{ y: 60, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 60, opacity: 0, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[92vh] flex flex-col"
          style={{
            background: 'hsl(var(--card))',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.3)',
            border: '1px solid hsl(var(--border))',
          }}
        >
          {/* Header */}
          <div className="relative px-5 pt-5 pb-4 shrink-0">
            <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-4 sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                  <PackageSearch className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <h2 className="font-heading font-bold text-lg leading-tight">
                    Food Item Not Found
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Barcode: <code className="font-mono">{barcode}</code>
                  </p>
                </div>
              </div>
              <button
                onClick={onCancel}
                className="shrink-0 p-1.5 rounded-full hover:bg-muted active:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
              This barcode isn't in any of our databases yet. Enter the nutritional info from the label and we'll save it for everyone.
            </p>
          </div>

          {/* Food name + serving */}
          <div className="px-5 pb-3 space-y-3 shrink-0">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                Food Name <span className="text-destructive">*</span>
              </label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Organic Almond Butter"
                className="h-10"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                Serving Size
              </label>
              <Input
                value={servingLabel}
                onChange={e => setServingLabel(e.target.value)}
                placeholder="e.g. 2 tbsp (32g)"
                className="h-10"
              />
            </div>
          </div>

          {/* Tab picker */}
          <div className="px-5 shrink-0">
            <div className="flex gap-1 p-1 bg-secondary rounded-lg border border-border">
              {[
                { id: 'nutrients', label: 'Nutrient Values' },
                { id: 'vitamins',  label: 'Vitamins & Minerals' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    tab === t.id
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground active:text-foreground'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable field area. Pad the bottom by the keyboard height so a
              focused field scrolls into view WITHIN this container instead of
              the browser scrolling the whole page (which would expose the app
              behind the sheet). */}
          <div
            className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
            style={{ paddingBottom: kbInset ? kbInset + 24 : undefined }}
          >
            <AnimatePresence mode="wait">
              {tab === 'nutrients' ? (
                <motion.div
                  key="nutrients"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-2"
                >
                  {NUTRIENT_FIELDS.map(field => (
                    <div key={field.key} className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: field.color }}
                      />
                      <label className="text-sm font-medium flex-1">
                        {field.label}
                        {field.required && <span className="text-destructive ms-0.5">*</span>}
                      </label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number" inputMode="decimal"
                          min="0"
                          value={nutrients[field.key]}
                          onChange={e => setN(field.key, e.target.value)}
                          onKeyDown={e => ['-','e','E','+'].includes(e.key) && e.preventDefault()}
                          placeholder="—"
                          className="h-8 w-24 text-end text-sm"
                        />
                        <span className="text-xs text-muted-foreground w-8">{field.unit}</span>
                      </div>
                    </div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="vitamins"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-2"
                >
                  <p className="text-xs text-muted-foreground mb-3">
                    All vitamin and mineral fields are optional. Leave blank if not listed on the label.
                  </p>
                  {VITAMIN_FIELDS.map(field => (
                    <div key={field.key} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0 bg-emerald-500/60" />
                      <label className="text-sm font-medium flex-1">{field.label}</label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number" inputMode="decimal"
                          min="0"
                          value={vitamins[field.key]}
                          onChange={e => setV(field.key, e.target.value)}
                          onKeyDown={e => ['-','e','E','+'].includes(e.key) && e.preventDefault()}
                          placeholder="—"
                          className="h-8 w-24 text-end text-sm"
                        />
                        <span className="text-xs text-muted-foreground w-8">{field.unit}</span>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Tab hint */}
          {tab === 'nutrients' && (
            <div className="px-5 pb-2 shrink-0">
              <button
                onClick={() => setTab('vitamins')}
                className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground active:text-foreground transition-colors py-1"
              >
                Add vitamins & minerals (optional)
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="px-5 pt-2 pb-6 flex gap-3 shrink-0 border-t border-border">
            <Button
              variant="outline"
              className="flex-1 h-11 font-heading font-semibold"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 h-11 font-heading font-semibold gap-2"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                  />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save for Everyone
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}