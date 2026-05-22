// src/components/nutrition/NutritionPlansModal.jsx
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, Clock, Flame, Beef, Pill, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PLAN_TEMPLATES, PLAN_COLORS, scalePlan, filterPlans, loadRestrictions } from '@/lib/nutritionPlans';

/* ─── Macro bar ──────────────────────────────────────────────────────────── */
function MacroBar({ protein, carbs, fat }) {
  const total = protein * 4 + carbs * 4 + fat * 9 || 1;
  const pPct = Math.round((protein * 4 / total) * 100);
  const cPct = Math.round((carbs   * 4 / total) * 100);
  const fPct = 100 - pPct - cPct;
  return (
    <div className="flex rounded-full overflow-hidden h-2 gap-px">
      <div className="bg-red-500   transition-all" style={{ width: `${pPct}%` }} title={`Protein ${pPct}%`} />
      <div className="bg-blue-500  transition-all" style={{ width: `${cPct}%` }} title={`Carbs ${cPct}%`} />
      <div className="bg-yellow-500 transition-all" style={{ width: `${fPct}%` }} title={`Fat ${fPct}%`} />
    </div>
  );
}

function MacroPill({ label, value, unit = 'g', color }) {
  return (
    <div className={`flex flex-col items-center px-3 py-1.5 rounded-xl ${color}`}>
      <span className="text-[10px] font-medium opacity-70">{label}</span>
      <span className="font-heading font-bold text-sm leading-tight">{value}{unit}</span>
    </div>
  );
}

/* ─── Plan card (list view) ──────────────────────────────────────────────── */
function PlanCard({ plan, scaled, onSelect, colors }) {
  const macros = scaled.scaledMacros || scaled.baseMacros;
  const kcal   = scaled.scaledCalories || scaled.baseCalories;
  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ scale: 1.015, y: -2 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      className="w-full text-start"
    >
      <Card className="overflow-hidden border border-border/60 shadow-sm">
        {/* Gradient header */}
        <div className={`bg-gradient-to-br ${colors.card} px-4 pt-4 pb-3`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-2xl leading-none shrink-0">{plan.icon}</span>
              <div className="min-w-0">
                <h3 className="font-heading font-bold text-base leading-tight truncate">{plan.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{plan.tagline}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 ms-2 rtl:scale-x-[-1]" />
          </div>

          {/* Goal badges */}
          <div className="flex gap-1.5 mt-2.5 flex-wrap">
            {plan.goalFit.map(g => (
              <span key={g} className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${colors.badge}`}>
                {g}
              </span>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div className="px-4 py-3 bg-card">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Flame className="w-3 h-3" />
              <span className="font-heading font-bold text-foreground">{kcal}</span>
              <span>kcal/day</span>
            </div>
            <div className="flex gap-1 text-[10px] text-muted-foreground">
              <span className="text-red-500 font-medium">{macros.protein}g P</span>
              <span>·</span>
              <span className="text-blue-500 font-medium">{macros.carbs}g C</span>
              <span>·</span>
              <span className="text-yellow-500 font-medium">{macros.fat}g F</span>
            </div>
          </div>
          <MacroBar protein={macros.protein} carbs={macros.carbs} fat={macros.fat} />
        </div>
      </Card>
    </motion.button>
  );
}

/* ─── Meal row (detail view) ─────────────────────────────────────────────── */
function MealRow({ meal, colors }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-start hover:bg-secondary/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-heading font-semibold text-sm">{meal.name}</p>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{meal.time}</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <Flame className="w-3 h-3 text-orange-500" />
            <span className="text-[10px] font-medium text-orange-600">{meal.kcal} kcal</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex gap-1 text-[10px]">
            <span className="text-red-500 font-medium">{meal.macros.p}g P</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-blue-500 font-medium">{meal.macros.c}g C</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-yellow-500 font-medium">{meal.macros.f}g F</span>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-4 pb-3 border-t border-border/40 bg-secondary/10">
              {/* Mobile macro row */}
              <div className="sm:hidden flex gap-2 pt-2 pb-1">
                <span className="text-[10px] text-red-500 font-medium">{meal.macros.p}g P</span>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] text-blue-500 font-medium">{meal.macros.c}g C</span>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] text-yellow-500 font-medium">{meal.macros.f}g F</span>
              </div>
              <div className="space-y-1.5 pt-2">
                {meal.ingredients.map((ing, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-1.5 shrink-0" />
                    <div className="flex-1 flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">{ing.name}</span>
                      <span className={`text-xs font-semibold ${colors.badge.split(' ')[1] || 'text-primary'}`}>{ing.amount}</span>
                      {ing.note && <span className="text-xs text-muted-foreground">— {ing.note}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Supplement card ────────────────────────────────────────────────────── */
function SupplementCard({ supp, colors }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 bg-gradient-to-br ${colors.card} border border-border/40`}>
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none shrink-0">{supp.icon}</span>
        <div className="min-w-0">
          <p className="font-heading font-semibold text-sm leading-tight">{supp.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{supp.dose} · {supp.timing}</p>
          <p className="text-xs mt-0.5 font-medium opacity-80">{supp.benefit}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Detail view ────────────────────────────────────────────────────────── */
function PlanDetail({ plan, scaled, onBack, colors }) {
  const macros = scaled.scaledMacros || scaled.baseMacros;
  const kcal   = scaled.scaledCalories || scaled.baseCalories;
  return (
    <motion.div
      key="detail"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.22 }}
    >
      {/* Hero */}
      <div className={`bg-gradient-to-br ${colors.card} -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 pt-5 pb-5`}>
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> All plans
        </button>
        <div className="flex items-start gap-3">
          <span className="text-4xl leading-none">{plan.icon}</span>
          <div>
            <h2 className="font-heading font-bold text-xl">{plan.name}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{plan.tagline}</p>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {plan.goalFit.map(g => (
                <span key={g} className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${colors.badge}`}>
                  {g}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Macro summary */}
        <div className="mt-4 p-3 rounded-xl bg-background/40 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-orange-500" />
              <span className="font-heading font-bold text-lg">{kcal}</span>
              <span className="text-xs text-muted-foreground">kcal/day</span>
            </div>
            <div className="flex gap-2">
              <MacroPill label="Protein" value={macros.protein} color="bg-red-500/15 text-red-600 dark:text-red-400" />
              <MacroPill label="Carbs"   value={macros.carbs}   color="bg-blue-500/15 text-blue-600 dark:text-blue-400" />
              <MacroPill label="Fat"     value={macros.fat}     color="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400" />
            </div>
          </div>
          <MacroBar protein={macros.protein} carbs={macros.carbs} fat={macros.fat} />
        </div>
      </div>

      {/* Meals */}
      <div className="mt-5">
        <h3 className="font-heading font-bold text-base mb-3 flex items-center gap-2">
          <Beef className="w-4 h-4" /> Daily Meals
          <span className="text-xs font-normal text-muted-foreground">— tap to expand ingredients</span>
        </h3>
        <div className="space-y-2">
          {scaled.meals.map(meal => (
            <MealRow key={meal.id} meal={meal} colors={colors} />
          ))}
        </div>
      </div>

      {/* Supplements */}
      {plan.supplements?.length > 0 && (
        <div className="mt-6">
          <h3 className="font-heading font-bold text-base mb-3 flex items-center gap-2">
            <Pill className="w-4 h-4" /> Recommended Supplements
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {plan.supplements.map((s, i) => (
              <SupplementCard key={i} supp={s} colors={colors} />
            ))}
          </div>
        </div>
      )}

      <div className="h-8" />
    </motion.div>
  );
}

/* ─── Main modal ─────────────────────────────────────────────────────────── */
export default function NutritionPlansModal({ open, onClose, userProfile }) {
  const [selected, setSelected] = useState(null);

  const restrictions = useMemo(() => loadRestrictions(userProfile), [userProfile]);
  const targetCalories = userProfile?.daily_calorie_target || userProfile?.calories || null;

  const availablePlans = useMemo(() => filterPlans(restrictions), [restrictions]);
  const filteredOut    = PLAN_TEMPLATES.length - availablePlans.length;

  const scaledPlans = useMemo(
    () => availablePlans.map(p => ({ plan: p, scaled: scalePlan(p, targetCalories) })),
    [availablePlans, targetCalories]
  );

  const selectedEntry = useMemo(
    () => scaledPlans.find(e => e.plan.id === selected),
    [scaledPlans, selected]
  );

  const handleClose = () => {
    setSelected(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/60 z-50"
          />

          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="fixed inset-x-0 bottom-0 z-50 bg-background rounded-t-2xl max-h-[92dvh] flex flex-col"
            style={{ boxShadow: '0 -8px 40px rgba(0,0,0,0.25)' }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 pb-3 shrink-0">
              <div>
                <h2 className="font-heading font-bold text-xl">Nutrition Plans</h2>
                {!selected && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {availablePlans.length} plan{availablePlans.length !== 1 ? 's' : ''} match your profile
                    {filteredOut > 0 && ` · ${filteredOut} filtered by restrictions`}
                  </p>
                )}
              </div>
              <button onClick={handleClose} className="p-2 rounded-full hover:bg-secondary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 pb-6">
              <AnimatePresence mode="wait">
                {!selected ? (
                  <motion.div
                    key="list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.18 }}
                  >
                    {/* Restriction notice */}
                    {restrictions.length > 0 && (
                      <div className="mb-4 px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/20 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">Filtered for your restrictions:</span>{' '}
                          {restrictions.join(', ').replace(/_/g, '-')}
                        </p>
                      </div>
                    )}

                    {/* Calorie context */}
                    {targetCalories && (
                      <div className="mb-4 px-3 py-2.5 rounded-xl bg-orange-500/5 border border-orange-500/20 flex items-start gap-2">
                        <Flame className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">Scaled to your target:</span>{' '}
                          {targetCalories} kcal/day — all macros adjusted proportionally
                        </p>
                      </div>
                    )}

                    {availablePlans.length === 0 ? (
                      <div className="text-center py-12">
                        <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                        <p className="font-heading font-semibold">No plans match your restrictions</p>
                        <p className="text-sm text-muted-foreground mt-1">Try adjusting your dietary restrictions in Edit Goals.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {scaledPlans.map(({ plan, scaled }) => (
                          <PlanCard
                            key={plan.id}
                            plan={plan}
                            scaled={scaled}
                            colors={PLAN_COLORS[plan.color]}
                            onSelect={() => setSelected(plan.id)}
                          />
                        ))}
                      </div>
                    )}
                  </motion.div>
                ) : selectedEntry ? (
                  <PlanDetail
                    key="detail"
                    plan={selectedEntry.plan}
                    scaled={selectedEntry.scaled}
                    colors={PLAN_COLORS[selectedEntry.plan.color]}
                    onBack={() => setSelected(null)}
                  />
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
