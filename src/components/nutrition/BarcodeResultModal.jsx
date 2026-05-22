import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { X, CheckCircle2, Flame, Beef, Wheat, Droplets, Activity } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

const MACRO_ROWS = [
  { key: 'calories',       labelKey: 'nutrition.macros.calories',    unit: 'kcal', color: '#f97316', bg: 'rgba(249,115,22,0.1)',  icon: Flame },
  { key: 'protein_g',      labelKey: 'nutrition.macros.protein',     unit: 'g',    color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   icon: Beef },
  { key: 'carbs_g',        labelKey: 'nutrition.macros.carbs',       unit: 'g',    color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  icon: Wheat },
  { key: 'fat_g',          labelKey: 'nutrition.macros.fat',         unit: 'g',    color: '#eab308', bg: 'rgba(234,179,8,0.1)',   icon: Droplets },
  { key: 'fiber_g',        labelKey: 'nutrition.macros.fiber',       unit: 'g',    color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   icon: Activity },
  { key: 'sugar_g',        labelKey: 'nutrition.macros.sugar',       unit: 'g',    color: '#a855f7', bg: 'rgba(168,85,247,0.1)',  icon: Activity },
  { key: 'sodium_mg',      labelKey: 'nutrition.macros.sodium',      unit: 'mg',   color: '#ec4899', bg: 'rgba(236,72,153,0.1)',  icon: Activity },
  { key: 'cholesterol_mg', labelKey: 'nutrition.macros.cholesterol', unit: 'mg',   color: '#06b6d4', bg: 'rgba(6,182,212,0.1)',   icon: Activity },
];

const DV = {
  calories: 2000,
  protein_g: 50,
  carbs_g: 300,
  fat_g: 78,
  fiber_g: 28,
  sugar_g: 50,
  sodium_mg: 2300,
  cholesterol_mg: 300,
};

const KEY_MAP = {
  calories: 'calories',
  protein_g: 'protein',
  carbs_g: 'carbs',
  fat_g: 'fat',
  fiber_g: 'fiber',
  sugar_g: 'sugar',
  sodium_mg: 'sodium',
  cholesterol_mg: 'cholesterol',
};

const VITAMIN_ROWS = [
  { key: 'calcium_mg',     label: 'Calcium',     unit: 'mg', dv: 1300 },
  { key: 'iron_mg',        label: 'Iron',        unit: 'mg', dv: 18   },
  { key: 'magnesium_mg',   label: 'Magnesium',   unit: 'mg', dv: 420  },
  { key: 'potassium_mg',   label: 'Potassium',   unit: 'mg', dv: 4700 },
  { key: 'vitamin_a_iu',   label: 'Vitamin A',   unit: 'IU', dv: 5000 },
  { key: 'vitamin_c_mg',   label: 'Vitamin C',   unit: 'mg', dv: 90   },
  { key: 'vitamin_d_iu',   label: 'Vitamin D',   unit: 'IU', dv: 800  },
  { key: 'vitamin_b12_mcg',label: 'Vitamin B12', unit: 'mcg',dv: 2.4  },
];

const SOURCE_LABELS = {
  openfoodfacts: 'Open Food Facts',
  usda:          'USDA FoodData Central',
  community:     '👥 Community Submitted',
};

function resolveVal(macroKey, n) {
  const v = n[KEY_MAP[macroKey]];
  return v != null ? v : null;
}

export default function BarcodeResultModal({ product, onCancel, onLog, isLogging }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState('macros');
  if (!product) return null;
  const n = product.nutrition;
  const vitamins = product.vitamins || {};
  const hasVitamins = Object.values(vitamins).some(v => v != null);

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
          className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
          style={{
            background: 'hsl(var(--card))',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.3)',
            border: '1px solid hsl(var(--border))',
          }}
        >
          {/* Header */}
          <div className="relative px-5 pt-5 pb-3">
            <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-4 sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">
                  {t('nutrition.scannedProduct')}
                </p>
                <h2 className="font-heading font-bold text-xl leading-tight line-clamp-2">
                  {product.name}
                </h2>
                {product.servingLabel && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('nutrition.perServing')} · {product.servingLabel}
                  </p>
                )}
                {product.source && SOURCE_LABELS[product.source] && (
                  <p className="text-xs text-muted-foreground/70 mt-0.5">
                    📡 {SOURCE_LABELS[product.source]}
                  </p>
                )}
              </div>
              <button
                onClick={onCancel}
                className="shrink-0 mt-0.5 p-1.5 rounded-full hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Calories hero */}
          <div className="mx-5 mb-4 rounded-xl p-4 flex items-center gap-4" style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.2)' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(249,115,22,0.2)' }}>
              <Flame className="w-6 h-6" style={{ color: '#f97316' }} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('nutrition.macros.calories')}</p>
              <p className="font-heading font-bold text-3xl" style={{ color: '#f97316' }}>
                {n.calories != null ? Math.round(n.calories) : '—'}
                <span className="text-base text-muted-foreground font-normal ms-1">kcal</span>
              </p>
            </div>
            <div className="ms-auto text-end shrink-0">
              <p className="text-xs text-muted-foreground">% DV</p>
              <p className="font-heading font-bold text-lg">
                {n.calories != null ? Math.round((n.calories / DV.calories) * 100) : '—'}%
              </p>
            </div>
          </div>

          {/* Tab picker */}
          {hasVitamins && (
            <div className="px-5 mb-3">
              <div className="flex gap-1 p-1 bg-secondary rounded-lg border border-border">
                {[
                  { id: 'macros',   label: 'Nutrients' },
                  { id: 'vitamins', label: 'Vitamins & Minerals' },
                ].map(tb => (
                  <button
                    key={tb.id}
                    onClick={() => setTab(tb.id)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      tab === tb.id
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tb.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Content grid */}
          <AnimatePresence mode="wait">
            {tab === 'macros' ? (
              <motion.div key="macros" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="px-5 pb-2 grid grid-cols-2 gap-2">
                {MACRO_ROWS.filter(m => m.key !== 'calories').map((macro, idx) => {
                  const val = resolveVal(macro.key, n);
                  const pct = val != null ? Math.min((val / DV[macro.key]) * 100, 100) : 0;

                  return (
                    <motion.div
                       key={macro.key}
                       initial={{ opacity: 0, y: 8 }}
                       animate={{ opacity: 1, y: 0 }}
                       transition={{ delay: 0.05 * idx }}
                       className="rounded-xl p-3"
                       style={{ background: macro.bg, border: `1px solid ${macro.color}33` }}
                     >
                       <div className="flex justify-between items-center mb-1.5">
                         <p className="text-xs text-muted-foreground">{t(macro.labelKey)}</p>
                         <p className="text-xs font-medium" style={{ color: macro.color }}>
                           {Math.round(pct)}% DV
                         </p>
                       </div>
                      <p className="font-heading font-bold text-base" style={{ color: macro.color }}>
                        {val != null ? (val < 10 ? val.toFixed(1) : Math.round(val)) : '—'}
                        <span className="text-xs text-muted-foreground font-normal ms-0.5">{macro.unit}</span>
                      </p>
                      <div className="mt-2 w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.1)' }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                          className="h-full rounded-full"
                          style={{ background: macro.color }}
                        />
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            ) : (
              <motion.div key="vitamins" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="px-5 pb-2 grid grid-cols-2 gap-2">
                {VITAMIN_ROWS.map((vit, idx) => {
                  const val = vitamins[vit.key];
                  const pct = val != null ? Math.min((val / vit.dv) * 100, 100) : 0;
                  return (
                    <motion.div
                      key={vit.key}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.04 * idx }}
                      className="rounded-xl p-3 bg-emerald-500/5 border border-emerald-500/20"
                    >
                      <div className="flex justify-between items-center mb-1.5">
                        <p className="text-xs text-muted-foreground">{vit.label}</p>
                        <p className="text-xs font-medium text-emerald-500">
                          {val != null ? `${Math.round(pct)}% DV` : '—'}
                        </p>
                      </div>
                      <p className="font-heading font-bold text-base text-emerald-500">
                        {val != null ? (val < 10 ? val.toFixed(1) : Math.round(val)) : '—'}
                        <span className="text-xs text-muted-foreground font-normal ms-0.5">{vit.unit}</span>
                      </p>
                      <div className="mt-2 w-full h-1 rounded-full overflow-hidden bg-black/10">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                          className="h-full rounded-full bg-emerald-500"
                        />
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Actions */}
          <div className="px-5 pt-3 pb-6 flex gap-3">
            <Button
              variant="outline"
              className="flex-1 h-12 font-heading font-semibold"
              onClick={onCancel}
              disabled={isLogging}
            >
              {t('common.cancel')}
            </Button>
            <Button
              className="flex-1 h-12 font-heading font-semibold gap-2"
              onClick={onLog}
              disabled={isLogging}
            >
              {isLogging ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                  />
                  {t('nutrition.logging')}
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {t('nutrition.logMeal')}
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}