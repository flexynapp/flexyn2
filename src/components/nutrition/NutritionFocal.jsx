// src/components/nutrition/NutritionFocal.jsx
//
// Nutrition's hero, option D (kegan, 2026-09-27): today's calories against
// the day's target in one ring, the sentence that says what that means now,
// and a quieter row for protein and water.
//
// It replaces two things. The five-slide shortcut carousel (Scan, Recipes,
// History, Plans, Planner) was feature advertising, and every one of those
// doors is still one tap away in the quick-access row under this block. And
// CalorieTopBar, whose "left" figure was this ring's number drawn a second
// way, with a gradient fill and specks drifting across it.
//
// Someone who has not logged food today sees an honest empty state: no
// "0 kcal", no zero-width bar, an icon in the ring and a sentence that says
// what logging a meal does. Water rows live in the same table (meal_type
// NULL, food_name 'Water…'); they are excluded from the meal count, so a
// glass of water does not flip the page out of its empty state.
//
// The target is useNutritionTargets, the same number MacroNutrientBox,
// MineralsVitaminsBox and the dashboard widgets show. It is always present:
// with no demographics it is the flat 2,000 kcal default, which the rest of
// the page already treats as the target.
//
// No next-step row here. Option D's next step is "a moment from your own
// data", and a page that holds only today's rows has no moment to offer
// that the ring is not already saying. An advert in its place is exactly
// what D removes.

import React, { useMemo } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { useNutritionTargets } from '@/hooks/useNutritionTargets';
import { dailyWaterGoalOz } from '@/lib/waterGoal';
import { isWaterEntry, waterEntryOz } from '@/lib/waterEntries';
import { fuelSummary, fuelHeadline, fuelDetail, ringShare } from '@/lib/focalGoal';
import FocalHero from '@/components/glance/FocalHero';
import FocalRing from '@/components/glance/FocalRing';
import GlanceStatRow, { StatMeter } from '@/components/glance/GlanceStatRow';

const WATER_UNIT_LABEL = { oz: 'oz', ml: 'ml', L: 'L' };

export default function NutritionFocal({ entries = [], userProfile = {}, waterUnit = 'oz', ozToDisplay = (oz) => oz, onLogMeal }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const targets = useNutritionTargets(userProfile);

  const meals = useMemo(() => (entries || []).filter((e) => !isWaterEntry(e)), [entries]);
  const waterOz = useMemo(() => (entries || []).filter(isWaterEntry).reduce((s, e) => s + waterEntryOz(e), 0), [entries]);
  const s = useMemo(() => fuelSummary({ meals, targets }), [meals, targets]);

  const t = (desc) => {
    if (!desc) return null;
    const vars = {};
    for (const [k, v] of Object.entries(desc.vars || {})) vars[k] = typeof v === 'number' ? fmt(v) : v;
    return tFallback(desc.key, desc.fallback, vars);
  };

  const numeral = 'font-display tabular-nums text-foreground';
  const caption = 'kicker';

  const figure = s.logged ? (
    <FocalRing
      share={ringShare(s.kcal, s.target)}
      advance={s.kcal}
      label={tFallback('nutrition.focal.ring.aria', '{n} of {target} kcal today', { n: fmt(s.kcal), target: fmt(s.target) })}
    >
      <span className={numeral} style={{ fontSize: 'clamp(1.75rem, 8.5vw, 2.25rem)' }}>{fmt(s.kcal)}</span>
      <span className={`${caption} mt-1 px-3`}>{tFallback('nutrition.focal.ring.ofTarget', 'of {n} kcal', { n: fmt(s.target) })}</span>
    </FocalRing>
  ) : (
    <FocalRing share={0} advance={s.kcal}>
      <UtensilsCrossed className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
    </FocalRing>
  );

  const action = !s.logged && onLogMeal ? (
    <button
      type="button"
      onClick={onLogMeal}
      className="self-start min-h-[44px] inline-flex items-center text-label font-bold text-primary hover:text-primary/80 active:text-primary/80 transition-colors"
    >
      {tFallback('nutrition.focal.logMeal', 'Log a meal')}
    </button>
  ) : null;

  const waterGoal = dailyWaterGoalOz(userProfile);
  const unit = WATER_UNIT_LABEL[waterUnit] || 'oz';
  const cells = [
    s.logged && s.proteinTarget > 0 && {
      id: 'protein',
      label: tFallback('nutrition.glance.protein', 'Protein'),
      value: fmt(s.protein),
      unit: 'g',
      visual: <StatMeter share={s.protein / s.proteinTarget} label={tFallback('nutrition.glance.proteinMeter', 'Protein against your target')} />,
      sub: tFallback('nutrition.glance.ofGrams', 'of {n} g', { n: fmt(s.proteinTarget) }),
    },
    waterOz > 0 && waterGoal > 0 && {
      id: 'water',
      label: tFallback('nutrition.glance.water', 'Water'),
      value: fmt(ozToDisplay(waterOz)),
      unit,
      visual: <StatMeter share={waterOz / waterGoal} label={tFallback('nutrition.glance.waterMeter', 'Water against your daily goal')} />,
      sub: tFallback('nutrition.glance.ofWater', 'of {n} {unit}', { n: fmt(ozToDisplay(waterGoal)), unit }),
    },
  ];

  return (
    <div className="flex flex-col" style={{ gap: 'var(--fluid-section)' }}>
      <FocalHero figure={figure} headline={t(fuelHeadline(s))} detail={t(fuelDetail(s))} action={action} />
      <GlanceStatRow cells={cells} />
    </div>
  );
}
