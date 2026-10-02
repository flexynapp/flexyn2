// src/components/nutrition/BarcodeNotFoundModal.jsx
//
// The only way to add a food to the shared catalogue, and it starts with a
// camera. This sheet opens when `lookupBarcode` misses on both tiers
// (community `food_items`, then Open Food Facts) — there is no other entry
// point, no manual barcode field, and nothing anywhere else in the app that
// files one of these. A loose apple has no barcode and therefore no route in;
// the recipe builder is the alternative, and it writes a private recipe.
//
// ── THE COPY USED TO SAY SOMETHING ELSE ───────────────────────────────────
//
// Until 2026-08-12 the intro read "Enter the nutritional info from the label
// and we'll save it for everyone", over a button reading "Save for Everyone".
// That was true of the code migration 343 REPLACED. It now files a row in
// `food_item_requests` and an admin has to approve it before a shared record
// exists, so the promise was one the app no longer keeps — while the toast
// underneath it correctly said "Sent for review". Two claims, same tap,
// contradicting each other.
//
// Whoever changed the behaviour changed the two toasts and left thirty
// hardcoded English literals alone, which is also why this file is now
// converted in full rather than one string at a time. See CLAUDE.md on
// half-converted i18n, and docs/nutrition-food-database-audit.md.
//
// The nutrient LABELS come from `nutrition.macros.*` / `nutrition.minerals.*`
// / `nutrition.vitamins.*` with `t()`, because those keys already ship — no
// point forking a second English copy of the word "Calcium".
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PackageSearch, Send, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/LanguageContext';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { requestFoodItem } from '@/lib/data/foodItemRequests';
import { useAuth } from '@/lib/AuthContext';
import { containsProfanity } from '@/lib/profanityFilter';
import { toast } from '@/lib/toast';

const NUTRIENT_FIELDS = [
  { key: 'calories',      labelKey: 'nutrition.macros.calories',    unit: 'cal', color: '#f97316', required: true },
  { key: 'protein_g',     labelKey: 'nutrition.macros.protein',     unit: 'g',   color: '#ef4444' },
  { key: 'carbs_g',       labelKey: 'nutrition.macros.carbs',       unit: 'g',   color: '#3b82f6' },
  { key: 'fat_g',         labelKey: 'nutrition.macros.fat',         unit: 'g',   color: '#eab308' },
  { key: 'fiber_g',       labelKey: 'nutrition.macros.fiber',       unit: 'g',   color: '#22c55e' },
  { key: 'sugar_g',       labelKey: 'nutrition.macros.sugar',       unit: 'g',   color: '#a855f7' },
  { key: 'sodium_mg',     labelKey: 'nutrition.macros.sodium',      unit: 'mg',  color: '#ec4899' },
  { key: 'cholesterol_mg',labelKey: 'nutrition.macros.cholesterol', unit: 'mg',  color: '#06b6d4' },
];

const VITAMIN_FIELDS = [
  { key: 'calcium_mg',     labelKey: 'nutrition.minerals.calcium',   unit: 'mg' },
  { key: 'iron_mg',        labelKey: 'nutrition.minerals.iron',      unit: 'mg' },
  { key: 'magnesium_mg',   labelKey: 'nutrition.minerals.magnesium', unit: 'mg' },
  { key: 'potassium_mg',   labelKey: 'nutrition.minerals.potassium', unit: 'mg' },
  { key: 'vitamin_a_iu',   labelKey: 'nutrition.vitamins.a',         unit: 'IU' },
  { key: 'vitamin_c_mg',   labelKey: 'nutrition.vitamins.c',         unit: 'mg' },
  { key: 'vitamin_d_iu',   labelKey: 'nutrition.vitamins.d',         unit: 'IU' },
  { key: 'vitamin_b12_mcg',labelKey: 'nutrition.vitamins.b12',       unit: 'mcg' },
];

const EMPTY_NUTRIENTS = Object.fromEntries(NUTRIENT_FIELDS.map(f => [f.key, '']));
const EMPTY_VITAMINS  = Object.fromEntries(VITAMIN_FIELDS.map(f => [f.key, '']));

export default function BarcodeNotFoundModal({ barcode, onCancel, onSubmit }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
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
      toast.error(tFallback('nutrition.foodDb.request.needName', 'Enter the food name.'));
      return;
    }
    if (containsProfanity(name)) {
      toast.error(tFallback('nutrition.foodDb.request.badName', 'Please use an appropriate food name.'));
      return;
    }
    if (!nutrients.calories && nutrients.calories !== 0) {
      toast.error(tFallback('nutrition.foodDb.request.needCalories', 'Calories are required.'));
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

      // REQUEST it — do not publish it.
      //
      // This used to call createFoodItem() and write straight into
      // `public.food_items`, which every future scanner then reads. That is
      // exactly the shape that made MyFitnessPal's catalogue what it is:
      // anyone can add an entry, no source, no review, and the same product
      // ends up in there five times with five different calorie counts.
      //
      // So it now files a row in `food_item_requests` for approval, the same
      // way Report a Bug files a `bug_reports` row (migration 343 — this said
      // 342, which is the cross-user row-injection RLS fix). An admin
      // approves it and only then does a food_items row exist — carrying
      // is_verified = true, because a human actually read it.
      //
      // **That is enforced in this file, not in the database.** Measured
      // against production 2026-08-12: a real non-admin authenticated user
      // can still `INSERT` straight into `public.food_items` with
      // `is_verified = TRUE, source = 'member_request'` — the exact shape
      // `approve_food_item_request` produces — and a third user then reads it
      // by barcode. 343 changed the client and left the table's INSERT policy
      // alone. The migration that closes it is in
      // docs/nutrition-food-database-audit.md; until it is applied, treat
      // `is_verified` as self-assigned rather than reviewed.
      //
      // The user is NOT made to wait, which is the part that matters. The
      // onSubmit below hands the product straight back to the scanner flow so
      // they can log it into their own diary right now. Their diary is
      // theirs; only the SHARED catalogue is gated.
      const { alreadyQueued } = await requestFoodItem({
        barcode,
        name: name.trim(),
        servingLabel: servingLabel.trim() || '1 serving',
        nutrition: nutritionRecord,
        vitamins:  vitaminsRecord,
        user,
      });

      toast.success(alreadyQueued
        ? tFallback('nutrition.foodDb.request.alreadyQueued', 'Someone already asked for this one. It’s in the queue. Logged for you now.')
        : tFallback('nutrition.foodDb.request.sent', 'Sent for review. Logged for you now, and everyone gets it once it’s approved.'));

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
      toast.error(tFallback('nutrition.foodDb.request.failed', 'Could not send the request. Please try again.'));
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
                    {tFallback('nutrition.foodDb.request.title', 'Not in the catalogue yet')}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {tFallback('nutrition.foodDb.request.barcode', 'Barcode')}:{' '}
                    <code className="font-mono">{barcode}</code>
                  </p>
                </div>
              </div>
              <button
                onClick={onCancel}
                className="shrink-0 p-1.5 rounded-full hover:bg-muted active:bg-muted transition-colors"
                aria-label={t('common.cancel')}
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
              {tFallback(
                'nutrition.foodDb.request.intro',
                'No database we check knows this barcode. Enter what the label says and we will send it for review. You can log it for yourself right away.',
              )}
            </p>
          </div>

          {/* Food name + serving */}
          <div className="px-5 pb-3 space-y-3 shrink-0">
            <div>
              <label className="kicker mb-1.5 block">
                {tFallback('nutrition.foodDb.request.name', 'Food name')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={tFallback('nutrition.foodDb.request.namePlaceholder', 'e.g. Organic Almond Butter')}
                className="h-10"
              />
            </div>
            <div>
              <label className="kicker mb-1.5 block">
                {tFallback('nutrition.foodDb.request.serving', 'Serving size')}
              </label>
              <Input
                value={servingLabel}
                onChange={e => setServingLabel(e.target.value)}
                placeholder={tFallback('nutrition.foodDb.request.servingPlaceholder', 'e.g. 2 tbsp (32g)')}
                className="h-10"
              />
            </div>
          </div>

          {/* Tab picker */}
          <div className="px-5 shrink-0">
            <div className="flex gap-1 p-1 bg-secondary rounded-lg border border-border">
              {[
                { id: 'nutrients', label: tFallback('nutrition.foodDb.request.tabNutrients', 'Nutrient values') },
                { id: 'vitamins',  label: tFallback('nutrition.foodDb.request.tabVitamins', 'Vitamins & minerals') },
              ].map(tb => (
                <button
                  key={tb.id}
                  onClick={() => setTab(tb.id)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    tab === tb.id
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground active:text-foreground'
                  }`}
                >
                  {tb.label}
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
                  {/* A blank field is stored as unknown, not as zero, and the
                      form has to say so — `parseFloat('')` becomes null in the
                      `nutrition` jsonb on purpose. Until 2026-08-12 the READ
                      side then substituted the flat column's `DEFAULT 0` back
                      over that null, so four blanks on the catalogue's White
                      Claw row were being served to every scanner as hard
                      zeros. Fixed in foodLookup.js; this line is the half of
                      it the user can see. */}
                  <p className="text-xs text-muted-foreground mb-3 leading-snug">
                    {tFallback(
                      'nutrition.foodDb.request.blankIsUnknown',
                      'Leave a field blank if the label does not list it. A blank is kept as unknown, not as zero.',
                    )}
                  </p>
                  {NUTRIENT_FIELDS.map(field => (
                    <div key={field.key} className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: field.color }}
                      />
                      <label className="text-sm font-medium flex-1">
                        {t(field.labelKey)}
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
                  <p className="text-xs text-muted-foreground mb-3 leading-snug">
                    {tFallback('nutrition.foodDb.request.vitaminsOptional', 'All of these are optional.')}{' '}
                    {tFallback(
                      'nutrition.foodDb.request.blankIsUnknown',
                      'Leave a field blank if the label does not list it. A blank is kept as unknown, not as zero.',
                    )}
                  </p>
                  {VITAMIN_FIELDS.map(field => (
                    <div key={field.key} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0 bg-emerald-500/60" />
                      <label className="text-sm font-medium flex-1">{t(field.labelKey)}</label>
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
                {tFallback('nutrition.foodDb.request.addVitamins', 'Add vitamins & minerals (optional)')}
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
              {t('common.cancel')}
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
                  {tFallback('nutrition.foodDb.request.submitting', 'Sending…')}
                </>
              ) : (
                <>
                  {/* NOT "Save for Everyone". This button files a request; an
                      admin approval is what publishes. See the head comment. */}
                  <Send className="w-4 h-4" />
                  {tFallback('nutrition.foodDb.request.submit', 'Send for review')}
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}