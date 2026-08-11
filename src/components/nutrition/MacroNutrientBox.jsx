import React, { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { useNutritionTargets } from '@/hooks/useNutritionTargets';
import { useLanguage } from '@/lib/LanguageContext';
import { useSettings } from '@/lib/SettingsContext';
import NutrientRing from './NutrientRing';
import NutrientIcon from './NutrientIcon';

const MACROS = [
  { key: 'calories',       labelKey: 'nutrition.macros.calories',    unit: 'cal', color: 'from-orange-400 to-orange-600', textColor: 'text-orange-600', bgColor: 'bg-orange-50 dark:bg-orange-950/20' },
  { key: 'protein_g',      labelKey: 'nutrition.macros.protein',     unit: 'g',    color: 'from-red-400 to-red-600',       textColor: 'text-red-600',    bgColor: 'bg-red-50 dark:bg-red-950/20' },
  { key: 'carbs_g',        labelKey: 'nutrition.macros.carbs',       unit: 'g',    color: 'from-blue-400 to-blue-600',     textColor: 'text-blue-600',   bgColor: 'bg-blue-50 dark:bg-blue-950/20' },
  { key: 'fat_g',          labelKey: 'nutrition.macros.fat',         unit: 'g',    color: 'from-yellow-400 to-yellow-600', textColor: 'text-yellow-600', bgColor: 'bg-yellow-50 dark:bg-yellow-950/20' },
  { key: 'sodium_mg',      labelKey: 'nutrition.macros.sodium',      unit: 'mg',   color: 'from-pink-400 to-pink-600',     textColor: 'text-pink-600',   bgColor: 'bg-pink-50 dark:bg-pink-950/20' },
  { key: 'fiber_g',        labelKey: 'nutrition.macros.fiber',       unit: 'g',    color: 'from-green-400 to-green-600',   textColor: 'text-green-600',  bgColor: 'bg-green-50 dark:bg-green-950/20' },
  { key: 'sugar_g',        labelKey: 'nutrition.macros.sugar',       unit: 'g',    color: 'from-purple-400 to-purple-600', textColor: 'text-purple-600', bgColor: 'bg-purple-50 dark:bg-purple-950/20' },
  { key: 'cholesterol_mg', labelKey: 'nutrition.macros.cholesterol', unit: 'mg',   color: 'from-cyan-400 to-cyan-600',     textColor: 'text-cyan-600',   bgColor: 'bg-cyan-50 dark:bg-cyan-950/20' },
];

export default function MacroNutrientBox({ entries = [], userProfile = {} }) {
  const { t } = useLanguage();
  const { nutrientRingView } = useSettings();
  const [netCarbsInfo, setNetCarbsInfo] = useState(false);
  const totals = useMemo(() => {
    return entries.reduce(
      (acc, entry) => ({
        // Fall back to old column names (protein/carbs/fat/fiber/sodium) for rows
        // saved before migration 006 added the _g/_mg suffixed columns.
        calories:       acc.calories       + (entry.calories                           || 0),
        protein_g:      acc.protein_g      + (entry.protein_g      ?? entry.protein    ?? 0),
        carbs_g:        acc.carbs_g        + (entry.carbs_g        ?? entry.carbs      ?? 0),
        fat_g:          acc.fat_g          + (entry.fat_g          ?? entry.fat        ?? 0),
        sodium_mg:      acc.sodium_mg      + (entry.sodium_mg      ?? entry.sodium     ?? 0),
        fiber_g:        acc.fiber_g        + (entry.fiber_g        ?? entry.fiber      ?? 0),
        sugar_g:        acc.sugar_g        + (entry.sugar_g                            || 0),
        cholesterol_mg: acc.cholesterol_mg + (entry.cholesterol_mg                    || 0),
      }),
      {
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        sodium_mg: 0,
        fiber_g: 0,
        sugar_g: 0,
        cholesterol_mg: 0,
      }
    );
  }, [entries]);

  const dailyValues = useNutritionTargets(userProfile);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.06,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <Card className="p-4 border-none shadow-sm">
      <h3 className="font-heading font-bold mb-3">{t('nutrition.nutritionalValues')}</h3>
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {MACROS.map(macro => {
          const actual = totals[macro.key];
          const daily = dailyValues[macro.key] || 100;
          const percentOfDaily = Math.min((actual / daily) * 100, 100);

          return (
            <motion.div key={macro.key} variants={itemVariants}>
              {nutrientRingView ? (
                /* ── Ring view ── */
                <div className={`${macro.bgColor} rounded-lg p-3 h-full flex flex-col items-center text-center`}>
                  <div className="flex items-center justify-center gap-1.5 mb-2 w-full min-w-0">
                    <NutrientIcon nutrientKey={macro.key} className={`w-3.5 h-3.5 shrink-0 ${macro.textColor}`} />
                    <p className="text-xs text-muted-foreground truncate">{t(macro.labelKey)}</p>
                  </div>
                  <div className={`relative ${macro.textColor}`}>
                    <NutrientRing percent={percentOfDaily} size={52} />
                    <span
                      className={`absolute inset-0 flex items-center justify-center text-micro font-bold ${macro.textColor}`}
                    >
                      {Math.round(percentOfDaily)}%
                    </span>
                  </div>
                  <p className={`font-heading font-bold text-sm ${macro.textColor} mt-2`}>
                    {actual.toFixed(macro.key === 'calories' ? 0 : 1)}{macro.unit}
                  </p>
                </div>
              ) : (
                /* ── Bar view (default) ── */
                <div className={`${macro.bgColor} rounded-lg p-3 h-full`}>
                  <div className="flex items-center gap-1.5 mb-1 min-w-0">
                    <NutrientIcon nutrientKey={macro.key} className={`w-3.5 h-3.5 shrink-0 ${macro.textColor}`} />
                    <p className="text-xs text-muted-foreground truncate">{t(macro.labelKey)}</p>
                  </div>
                  <p className={`font-heading font-bold text-lg ${macro.textColor}`}>
                    {actual.toFixed(macro.key === 'calories' ? 0 : 1)}{macro.unit}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 mb-2">{Math.round(percentOfDaily)}%</p>
                  <div className="w-full h-1.5 bg-black/10 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full ${macro.textColor.replace('text-', 'bg-')}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${percentOfDaily}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </motion.div>
      {/* Net carbs — carbs minus fiber. Standard for keto / low-carb
          tracking. Quiet single-line label so users who don't care
          about the metric aren't distracted. */}
      <div className="mt-3 pt-3 border-t border-border/40">
        <div className="flex items-center justify-between">
          <span className="text-micro font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            Net carbs <span className="font-normal normal-case opacity-70">(carbs − fiber)</span>
            <button
              type="button"
              onClick={() => setNetCarbsInfo((v) => !v)}
              aria-label="What are net carbs?"
              className="w-4 h-4 rounded-full border border-border/60 bg-background/80 flex items-center justify-center text-muted-foreground/60 hover:text-foreground active:text-foreground hover:border-border transition-colors shrink-0"
            >
              <span className="text-micro font-bold leading-none italic">i</span>
            </button>
          </span>
          <span className="text-xs font-bold tabular-nums text-blue-600">
            {Math.max(0, totals.carbs_g - totals.fiber_g).toFixed(1)} g
          </span>
        </div>
        {netCarbsInfo && (
          <p className="text-micro text-foreground/70 mt-2 leading-snug">
            Net carbs = total carbs − fiber. Fiber isn't digested or absorbed, so it doesn't raise blood sugar — subtracting it leaves the carbs your body actually uses for energy. It's the standard metric for keto and low-carb tracking.
          </p>
        )}
      </div>
    </Card>
  );
}