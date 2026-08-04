import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { calculateDailyValues } from '@/lib/nutritionDefaults';
import { useLanguage } from '@/lib/LanguageContext';
import { useSettings } from '@/lib/SettingsContext';
import NutrientRing from './NutrientRing';
import NutrientIcon from './NutrientIcon';

const VITAMINS_MINERALS = [
  { key: 'iron_mg',         labelKey: 'nutrition.minerals.iron',      unit: 'mg',  color: 'from-red-300 to-red-500',         textColor: 'text-red-600',     bgColor: 'bg-red-50 dark:bg-red-950/20' },
  { key: 'magnesium_mg',    labelKey: 'nutrition.minerals.magnesium', unit: 'mg',  color: 'from-emerald-400 to-emerald-600', textColor: 'text-emerald-600', bgColor: 'bg-emerald-50 dark:bg-emerald-950/20' },
  { key: 'calcium_mg',      labelKey: 'nutrition.minerals.calcium',   unit: 'mg',  color: 'from-slate-400 to-slate-600',     textColor: 'text-slate-600',   bgColor: 'bg-slate-50 dark:bg-slate-950/20' },
  { key: 'potassium_mg',    labelKey: 'nutrition.minerals.potassium', unit: 'mg',  color: 'from-yellow-300 to-yellow-500',   textColor: 'text-yellow-600',  bgColor: 'bg-yellow-50 dark:bg-yellow-950/20' },
  { key: 'vitamin_a_iu',    labelKey: 'nutrition.vitamins.a',         unit: 'IU',  color: 'from-orange-300 to-orange-500',   textColor: 'text-orange-600',  bgColor: 'bg-orange-50 dark:bg-orange-950/20' },
  { key: 'vitamin_c_mg',    labelKey: 'nutrition.vitamins.c',         unit: 'mg',  color: 'from-rose-400 to-rose-600',       textColor: 'text-rose-600',    bgColor: 'bg-rose-50 dark:bg-rose-950/20' },
  { key: 'vitamin_d_iu',    labelKey: 'nutrition.vitamins.d',         unit: 'IU',  color: 'from-amber-300 to-amber-500',     textColor: 'text-amber-600',   bgColor: 'bg-amber-50 dark:bg-amber-950/20' },
  { key: 'vitamin_b12_mcg', labelKey: 'nutrition.vitamins.b12',       unit: 'mcg', color: 'from-purple-400 to-purple-600',   textColor: 'text-purple-600',  bgColor: 'bg-purple-50 dark:bg-purple-950/20' },
];

export default function MineralsVitaminsBox({ entries = [], userProfile = {} }) {
  const { t } = useLanguage();
  const { nutrientRingView } = useSettings();
  const dailyValues = useMemo(() => calculateDailyValues(userProfile), [userProfile]);

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, entry) => ({
        iron_mg: acc.iron_mg + (entry.iron_mg || 0),
        magnesium_mg: acc.magnesium_mg + (entry.magnesium_mg || 0),
        calcium_mg: acc.calcium_mg + (entry.calcium_mg || 0),
        potassium_mg: acc.potassium_mg + (entry.potassium_mg || 0),
        vitamin_a_iu: acc.vitamin_a_iu + (entry.vitamin_a_iu || 0),
        vitamin_c_mg: acc.vitamin_c_mg + (entry.vitamin_c_mg || 0),
        vitamin_d_iu: acc.vitamin_d_iu + (entry.vitamin_d_iu || 0),
        vitamin_b12_mcg: acc.vitamin_b12_mcg + (entry.vitamin_b12_mcg || 0),
      }),
      {
        iron_mg: 0,
        magnesium_mg: 0,
        calcium_mg: 0,
        potassium_mg: 0,
        vitamin_a_iu: 0,
        vitamin_c_mg: 0,
        vitamin_d_iu: 0,
        vitamin_b12_mcg: 0,
      }
    );
  }, [entries]);

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
      <h3 className="font-heading font-bold mb-3">{t('nutrition.vitamins.title')} & {t('nutrition.minerals.title')}</h3>
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {VITAMINS_MINERALS.map(item => {
          const actual = totals[item.key];
          const daily = dailyValues[item.key] || 100;
          const percentOfDaily = Math.min((actual / daily) * 100, 100);

          return (
            <motion.div key={item.key} variants={itemVariants}>
              {nutrientRingView ? (
                /* ── Ring view ── */
                <div className={`${item.bgColor} rounded-lg p-3 h-full flex flex-col items-center text-center`}>
                  <div className="flex items-center justify-center gap-1.5 mb-2 w-full min-w-0">
                    <NutrientIcon nutrientKey={item.key} className={`w-3.5 h-3.5 shrink-0 ${item.textColor}`} />
                    <p className="text-xs text-muted-foreground truncate">{t(item.labelKey)}</p>
                  </div>
                  <div className={`relative ${item.textColor}`}>
                    <NutrientRing percent={percentOfDaily} size={52} />
                    <span
                      className={`absolute inset-0 flex items-center justify-center text-micro font-bold ${item.textColor}`}
                    >
                      {Math.round(percentOfDaily)}%
                    </span>
                  </div>
                  <p className={`font-heading font-bold text-sm ${item.textColor} mt-2`}>
                    {actual.toFixed(0)}{item.unit}
                  </p>
                </div>
              ) : (
                /* ── Bar view (default) ── */
                <div className={`${item.bgColor} rounded-lg p-3 h-full`}>
                  <div className="flex items-center gap-1.5 mb-1 min-w-0">
                    <NutrientIcon nutrientKey={item.key} className={`w-3.5 h-3.5 shrink-0 ${item.textColor}`} />
                    <p className="text-xs text-muted-foreground truncate">{t(item.labelKey)}</p>
                  </div>
                  <p className={`font-heading font-bold text-lg ${item.textColor}`}>
                    {actual.toFixed(0)}{item.unit}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 mb-2">{Math.round(percentOfDaily)}%</p>
                  <div className="w-full h-1.5 bg-black/10 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full ${item.textColor.replace('text-', 'bg-')}`}
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
    </Card>
  );
}