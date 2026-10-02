// src/components/nutrition/MacroNutrientBox.jsx
//
// WHY TILES DISAPPEAR RATHER THAN READING ZERO
//
// Every tile here used to render unconditionally, so a nutrient with nothing
// behind it drew "0.0g · 0%" over a zero-width bar. CLAUDE.md is explicit
// that a section with no data must not render as zeros — a 0 reads as a
// failure the user did not commit, and "0 kcal" at someone who has not
// logged food is the app calling them lazy. `WeeklyDebriefCard.jsx:478`
// already gates its macro bar on `macroKcal > 0` for exactly this reason;
// this is the same rule applied per tile.
//
// It was not hypothetical here. Until 2026-09-27 `sugar_g` and
// `cholesterol_mg` had no column in `nutrition_logs`, so every save dropped
// them and those two tiles read 0.0g/0mg for every user since launch.
// Migration 20260927174000 added the columns; rows logged before it still
// carry NULL there. See docs/nutrition-meal-logging-audit.md.
//
// Older photo-AI rows kept sugar inside `ai_meta.sugar_g` (a jsonb column,
// so it survived), which is why the sum below falls back to it.
//
// The count of tiles is therefore decided by DATA, which is what makes
// `grid-cols-N` wrong here and `tileRow()` right — a grid packs a partial
// row into its leading columns and leaves a dead cell beside it.

import React, { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { useNutritionTargets } from '@/hooks/useNutritionTargets';
import { useLanguage } from '@/lib/LanguageContext';
import { useSettings } from '@/lib/SettingsContext';
import { tileRow } from '@/lib/tileRows';
import NutrientRing from './NutrientRing';
import NutrientIcon from './NutrientIcon';
import TransText from '@/components/TransText';

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
  const { t, tFallback } = useLanguage();
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
        // Photo-AI rows logged before the sugar_g column existed carry
        // sugar only in ai_meta, so fall back to it.
        sugar_g:        acc.sugar_g        + (Number(entry.sugar_g ?? entry.ai_meta?.sugar_g) || 0),
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

  // Only nutrients with something behind them get a tile. See the head note.
  const visible = useMemo(() => MACROS.filter(m => totals[m.key] > 0), [totals]);
  const { row, item } = tileRow({ gap: 3, cols: 2, smCols: 4 });

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
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          {tFallback('nutrition.untracked.macros', 'Nothing logged yet today. Log a meal to see your macros.')}
        </p>
      ) : (
      <motion.div
        className={row}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {visible.map(macro => {
          const actual = totals[macro.key];
          const daily = dailyValues[macro.key] || 100;
          const percentOfDaily = Math.min((actual / daily) * 100, 100);

          return (
            <motion.div key={macro.key} variants={itemVariants} className={item}>
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
      )}
      {/* Net carbs — carbs minus fiber. Standard for keto / low-carb
          tracking. Quiet single-line label so users who don't care
          about the metric aren't distracted.
          Gated on carbs for the same reason the tiles are: with nothing
          logged this line read a permanent "0.0 g", which is a claim rather
          than an absence. */}
      {totals.carbs_g > 0 && (
      <div className="mt-3 pt-3 border-t border-border/40">
        <div className="flex items-center justify-between">
          <span className="kicker flex items-center gap-1.5">
            <TransText k="macroNutrientBox.netCarbs" en="Net carbs {formula}"
              values={{ formula: <span className="font-normal normal-case opacity-70">{tFallback("macroNutrientBox.netCarbsFormula", "(carbs − fiber)")}</span> }} />
            <button
              type="button"
              onClick={() => setNetCarbsInfo((v) => !v)}
              aria-label={tFallback("macroNutrientBox.whatAreNetCarbs", "What are net carbs?")}
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
      )}
    </Card>
  );
}