// src/components/nutrition/NutritionPlansModal.jsx
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, Clock, Flame, Beef, Pill, ClipboardList, Sparkles, ArrowLeftRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PLAN_TEMPLATES, scalePlan, adaptPlan, loadRestrictions } from '@/lib/nutritionPlans';
import { useNutritionTargets } from '@/hooks/useNutritionTargets';
import { isNutritionOnboardingComplete } from '@/lib/nutritionOnboardingGate';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';
import TransText from '@/components/TransText';

/* ─── Macro bar ──────────────────────────────────────────────────────────── */
function MacroBar({ protein, carbs, fat }) {
  const total = protein * 4 + carbs * 4 + fat * 9 || 1;
  const pPct = Math.round((protein * 4 / total) * 100);
  const cPct = Math.round((carbs   * 4 / total) * 100);
  const fPct = 100 - pPct - cPct;
  return (
    <div className="flex rounded-full overflow-hidden h-2 gap-px">
      <div className="bg-destructive   transition-all" style={{ width: `${pPct}%` }} title={`Protein ${pPct}%`} />
      <div className="bg-info  transition-all" style={{ width: `${cPct}%` }} title={`Carbs ${cPct}%`} />
      <div className="bg-primary transition-all" style={{ width: `${fPct}%` }} title={`Fat ${fPct}%`} />
    </div>
  );
}

/* ─── Plan card (list view) ──────────────────────────────────────────────── */
function PlanCard({ plan, scaled, onSelect, fitsGoal }) {
  const { tFallback } = useLanguage();
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
      {/* Flat, hairline border, no gradient and no per-plan hue. The header
          used to be `bg-gradient-to-br from-<hue>-500/20` over five colours
          keyed straight off the raw Tailwind palette — a decorative gradient
          and a fifth, sixth, seventh hue, all three of which the composition
          rules ban. Plans are told apart by their icon and their goal badge. */}
      <Card className="border border-border p-4">
        <div className="flex items-start gap-2">
          <span className="text-xl leading-none shrink-0">{plan.icon}</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-heading font-bold text-base leading-tight truncate">{tFallback(`nutrition.plan.${plan.id}.name`, plan.name)}</h3>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tFallback(`nutrition.plan.${plan.id}.tagline`, plan.tagline)}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 rtl:scale-x-[-1]" />
        </div>

        <div className="flex gap-1.5 mt-2 flex-wrap items-center">
          {plan.goalFit.map(g => (
            <span key={g} className="text-micro font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
              {g}
            </span>
          ))}
          {fitsGoal && (
            <span className="inline-flex items-center gap-1 text-micro font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
              matches your goal
            </span>
          )}
          {plan.swapCount > 0 && (
            <span className="inline-flex items-center gap-1 text-micro font-semibold px-2 py-0.5 rounded-full bg-success/15 text-success dark:text-success">
              <Sparkles className="w-2.5 h-2.5" />
              adapted for you
            </span>
          )}
        </div>

        {/* The split leads, because the split is the ONLY thing that differs.
            scalePlan multiplies every plan up to the same target, so
            `scaledCalories === targetCalories` by construction — that figure
            is identical on all seven cards and used to be the largest thing
            on each of them. Keto's 26g of carbs against Plant Power's 270g is
            what a browser is actually choosing between. */}
        <div className="flex items-end gap-6 mt-6">
          {[['protein', 'P', 'text-destructive'], ['carbs', 'C', 'text-info'], ['fat', 'F', 'text-primary']].map(([k, letter, tint]) => (
            <div key={k} className="flex items-baseline gap-0.5">
              <span className="font-heading font-bold text-xl tabular-nums">{macros[k]}</span>
              <span className={`text-xs font-bold ${tint}`}>g {letter}</span>
            </div>
          ))}
        </div>
        <div className="mt-2">
          <MacroBar protein={macros.protein} carbs={macros.carbs} fat={macros.fat} />
        </div>
        <p className="text-micro text-muted-foreground mt-2">
          {tFallback('nutritionPlansModal.sameOnEvery', '{n} cal/day. Your target, the same on every plan', { n: kcal })}
        </p>
      </Card>
    </motion.button>
  );
}

/* ─── Meal row (detail view) ─────────────────────────────────────────────── */
function MealRow({ meal }) {
  const { tFallback } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-start hover:bg-secondary/30 active:bg-secondary/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-heading font-semibold text-sm">{meal.name}</p>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-micro text-muted-foreground">{meal.time}</span>
            <span className="text-micro text-muted-foreground">·</span>
            <Flame className="w-3 h-3 text-primary" />
            <span className="text-micro font-medium text-primary">{meal.kcal} cal</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex gap-1 text-micro">
            <span className="text-destructive font-medium">{meal.macros.p}g P</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-info font-medium">{meal.macros.c}g C</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-primary font-medium">{meal.macros.f}g F</span>
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
                <span className="text-micro text-destructive font-medium">{meal.macros.p}g P</span>
                <span className="text-micro text-muted-foreground">·</span>
                <span className="text-micro text-info font-medium">{meal.macros.c}g C</span>
                <span className="text-micro text-muted-foreground">·</span>
                <span className="text-micro text-primary font-medium">{meal.macros.f}g F</span>
              </div>
              <div className="space-y-1.5 pt-2">
                {meal.ingredients.map((ing, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${ing.swapped ? 'bg-success' : 'bg-primary/60'}`} />
                    <div className="flex-1 flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">{ing.name}</span>
                      <span className="text-xs font-semibold text-primary">{ing.amount}</span>
                      {ing.note && <span className="text-xs text-muted-foreground">— {ing.note}</span>}
                      {ing.swapped && (
                        <span className="inline-flex items-center gap-1 text-micro font-semibold text-success dark:text-success bg-success/10 px-1.5 py-0.5 rounded-full">
                          <ArrowLeftRight className="w-2.5 h-2.5" />
                          swapped from {ing.swappedFrom}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Step-by-step directions */}
              {meal.directions?.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-border/40">
                  <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-1.5">{tFallback("nutritionPlansModal.directions", "Directions")}</p>
                  <ol className="space-y-1.5">
                    {meal.directions.map((step, i) => (
                      <li key={i} className="flex gap-2 text-xs text-foreground/80 leading-snug">
                        <span className="font-bold shrink-0 text-primary">{i + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Supplement card ────────────────────────────────────────────────────── */
function SupplementCard({ supp }) {
  return (
    <div className="rounded-xl px-3 py-2.5 bg-card border border-border">
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none shrink-0">{supp.icon}</span>
        <div className="min-w-0">
          <p className="font-heading font-semibold text-sm leading-tight">{supp.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{supp.dose} · {supp.timing}</p>
          <p className="text-xs mt-0.5 font-medium opacity-80">{supp.benefit}</p>
          {supp.swapped && (
            <span className="inline-flex items-center gap-1 text-micro font-semibold text-success dark:text-success bg-success/10 px-1.5 py-0.5 rounded-full mt-1">
              <ArrowLeftRight className="w-2.5 h-2.5" />
              swapped from {supp.swappedFrom}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Detail view ────────────────────────────────────────────────────────── */
function PlanDetail({ plan, scaled, onBack, onApply }) {
  const { tFallback } = useLanguage();
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
      {/* Hero. Flat — the gradient bled edge to edge via negative margins,
          and the macro box under it carried backdrop-blur-sm. Both are on
          the published list of signals used to spot generated UI. */}
      <div className="-mx-4 sm:-mx-6 px-4 sm:px-6 pb-6 border-b border-border">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground active:text-foreground mb-3 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5 rtl:scale-x-[-1]" /> {tFallback("nutritionPlansModal.allPlans", "All plans")}
        </button>
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none">{plan.icon}</span>
          <div>
            <h2 className="font-heading font-bold text-xl">{tFallback(`nutrition.plan.${plan.id}.name`, plan.name)}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{tFallback(`nutrition.plan.${plan.id}.tagline`, plan.tagline)}</p>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {plan.goalFit.map(g => (
                <span key={g} className="text-micro font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                  {g}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Macro summary. Same inversion as the card: the split is what this
            plan IS, and the calorie figure is the target every plan shares. */}
        <div className="mt-6 p-3 rounded-xl bg-card border border-border">
          <div className="flex items-end gap-6">
            {[['protein', 'P', 'text-destructive'], ['carbs', 'C', 'text-info'], ['fat', 'F', 'text-primary']].map(([k, letter, tint]) => (
              <div key={k} className="flex items-baseline gap-0.5">
                <span className="font-heading font-bold text-2xl tabular-nums">{macros[k]}</span>
                <span className={`text-sm font-bold ${tint}`}>g {letter}</span>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <MacroBar protein={macros.protein} carbs={macros.carbs} fat={macros.fat} />
          </div>
          <p className="text-micro text-muted-foreground mt-2">
            {tFallback('nutritionPlansModal.scaledToTarget', '{n} cal/day · scaled to your target', { n: kcal })}
          </p>
        </div>
      </div>

      {/* Meals */}
      <div className="mt-5">
        <h3 className="font-heading font-bold text-base mb-3 flex items-center gap-2">
          <Beef className="w-4 h-4" /> {tFallback("nutritionPlansModal.dailyMeals", "Daily Meals")}
          <span className="text-xs font-normal text-muted-foreground">— tap to expand ingredients</span>
        </h3>
        <div className="space-y-2">
          {scaled.meals.map(meal => (
            <MealRow key={meal.id} meal={meal} />
          ))}
        </div>
      </div>

      {/* Supplements */}
      {plan.supplements?.length > 0 && (
        <div className="mt-6">
          <h3 className="font-heading font-bold text-base mb-3 flex items-center gap-2">
            <Pill className="w-4 h-4" /> {tFallback("nutritionPlansModal.recommendedSupplements", "Recommended Supplements")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {plan.supplements.map((s, i) => (
              <SupplementCard key={i} supp={s} />
            ))}
          </div>
        </div>
      )}

      {/* A catalog you cannot act on is a brochure. This was the only screen
          in the flow with nothing to press — you could read five meals, every
          ingredient, the directions and four supplements, and then had to go
          key it in by hand. It is offered only where there is a day to apply
          it TO, which is the planner. */}
      {onApply && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => onApply(scaled)}
            className="w-full min-h-[48px] rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-opacity"
          >
            {tFallback('nutritionPlansModal.addToDay', 'Add these meals to your day')}
          </button>
        </div>
      )}

      <div className="h-8" />
    </motion.div>
  );
}

/* ─── Reusable content panel (list + detail) ─────────────────────────────────
 * The plans browser without any sheet chrome, so it can render both inside
 * the standalone modal AND as a tab inside the Weekly Planner. Manages its
 * own selected-plan state. Wrap it in a container with `px-4 sm:px-6` +
 * top padding so PlanDetail's negative-margin hero bleeds correctly. */
export function NutritionPlansPanel({ userProfile, onStartOnboarding, trainingFuel, onApplyFuel, onApplyPlan }) {
  const { tFallback } = useLanguage();
  const [selected, setSelected] = useState(null);

  // Plans are tailored to goals + dietary restrictions, both captured in
  // nutrition onboarding. Until that's done we don't know the user's
  // restrictions, so surfacing plans would show off-limits foods (e.g.
  // dairy to a dairy-free user). Gate the whole panel on completion.
  // NOTE: this gate reads the COMPLETION flag only. A session dismissal of
  // the onboarding wizard must not unlock plans — the user still hasn't told
  // us their restrictions.
  const hasOnboarded = useMemo(
    () => isNutritionOnboardingComplete(userProfile, userProfile?.id),
    [userProfile],
  );

  const restrictions   = useMemo(() => loadRestrictions(userProfile), [userProfile]);
  // Use the SAME goal-driven calorie target the rest of the nutrition UI shows
  // (CalorieTopBar / MacroNutrientBox via calculateDailyValues). Onboarding
  // saves the goal/activity inputs, not a stored calorie number, so reading a
  // `daily_calorie_target` field left plans stuck at the 2000 kcal base.
  const targetCalories = useNutritionTargets(userProfile)?.calories || null;

  // Every plan is offered — adapted to the user's restrictions by swapping
  // off-limits ingredients for compliant, nutrient-matched alternatives.
  //
  // Ordered by goal fit. Each template already declares a `goalFit` and it was
  // rendered as a badge but never used to rank anything, so the list came out
  // in fixed template order: someone cutting was shown "Lean Muscle Builder"
  // (gain / maintain) first and had to scroll past two bulking plans to reach
  // "Fat Loss Protocol". Plans that don't fit are still offered — the module's
  // philosophy is adapt-don't-hide, and a user is allowed to pick whatever
  // they like — they just stop leading the list. Sort is stable, so the
  // curated order survives within each group.
  const nutritionGoal = userProfile?.nutrition_goal || null;
  const scaledPlans = useMemo(() => {
    const entries = PLAN_TEMPLATES.map(p => {
      const adapted = adaptPlan(p, restrictions);
      return {
        plan: adapted,
        scaled: scalePlan(adapted, targetCalories),
        fitsGoal: !!nutritionGoal && (p.goalFit || []).includes(nutritionGoal),
      };
    });
    return [...entries].sort((a, b) => Number(b.fitsGoal) - Number(a.fitsGoal));
  }, [restrictions, targetCalories, nutritionGoal]);
  const totalSwaps = useMemo(
    () => scaledPlans.reduce((n, e) => n + (e.plan.swapCount || 0), 0),
    [scaledPlans]
  );

  const selectedEntry = useMemo(
    () => scaledPlans.find(e => e.plan.id === selected),
    [scaledPlans, selected]
  );

  // Onboarding gate — shown before any plan is generated.
  if (!hasOnboarded) {
    return (
      <div className="text-center py-12 px-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <ClipboardList className="w-7 h-7 text-primary" />
        </div>
        <p className="font-heading font-bold text-lg">{tFallback("nutritionPlansModal.setUpYourNutritionFirst", "Set up your nutrition first")}</p>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-xs mx-auto leading-snug">
          Meal plans are built around your goals and dietary restrictions. Finish your nutrition setup and we'll only show plans that actually fit you.
        </p>
        {onStartOnboarding && (
          <button
            onClick={onStartOnboarding}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-opacity"
          >
            {tFallback("nutritionPlansModal.startNutritionSetup", "Start nutrition setup")}
            <ChevronRight className="w-4 h-4 rtl:scale-x-[-1]" />
          </button>
        )}
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {!selected ? (
        <motion.div
          key="list"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, x: -30 }}
          transition={{ duration: 0.18 }}
        >
          {/* Say what the cards are actually distinguishing. Every plan is
              scaled to the same target, so the calorie figure is identical on
              all seven — the split is the choice. */}
          <p className="text-xs text-muted-foreground mb-1">
            {PLAN_TEMPLATES.length} plans · every one tailored to you
          </p>
          <p className="text-xs font-semibold mb-4">
            {tFallback('nutritionPlansModal.differInSplit', 'They differ in the split, not the total.')}
          </p>

          {/* Training-fuel banner — ties the running plan's load to the diet:
              how many extra calories/carbs to add on run days, applied via
              calorie cycling. Only shows when the user is actually running. */}
          {trainingFuel && trainingFuel.runDays > 0 && (
            <div className="mb-4 rounded-2xl border border-primary/25 bg-primary/5 p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-8 h-8 rounded-lg bg-primary/15 text-primary dark:text-primary flex items-center justify-center shrink-0">
                  <Flame className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <p className="font-heading font-bold text-sm leading-tight">{tFallback("coach.plan.fuel", "Fuel your training")}</p>
                  <p className="text-micro text-muted-foreground">
                    ~{trainingFuel.runDays} run{trainingFuel.runDays === 1 ? '' : 's'}/week · ≈{trainingFuel.weeklyKcal.toLocaleString()} kcal burned
                  </p>
                </div>
              </div>
              <p className="text-xs text-foreground/80 leading-snug">
                <TransText
                  k="nutritionPlansModal.runDayFuel"
                  en="Add {kcal} and {carbs} on run days so you fuel the work and recover. Protein and fat stay put."
                  values={{
                    kcal:  <b className="text-primary dark:text-primary">+{trainingFuel.perRunDayKcal} kcal</b>,
                    carbs: <b className="text-primary dark:text-primary">+{trainingFuel.addCarbsG}g carbs</b>,
                  }}
                />
              </p>
              {onApplyFuel && (
                <button
                  type="button"
                  onClick={onApplyFuel}
                  className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary text-white font-semibold text-sm py-2.5 hover:bg-primary/90 active:bg-primary/90 transition-colors"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  {tFallback("nutritionPlansModal.setTrainingDayFuel", "Set training-day fuel")}
                </button>
              )}
            </div>
          )}

          {/* Adaptation notice — plans are swapped, not hidden. */}
          {restrictions.length > 0 && (
            <div className="mb-4 px-3 py-2.5 rounded-xl bg-success/5 border border-success/20 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-success shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{tFallback("nutritionPlansModal.adaptedForYourDiet", "Adapted for your diet:")}</span>{' '}
                {restrictions.join(', ').replace(/_/g, '-')}
                {totalSwaps > 0 && (
                  <> — {totalSwaps} ingredient{totalSwaps !== 1 ? 's' : ''} swapped for compliant, nutrient-matched picks.</>
                )}
              </p>
            </div>
          )}

          {/* Calorie context */}
          {targetCalories && (
            <div className="mb-4 px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/20 flex items-start gap-2">
              <Flame className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{tFallback("nutritionPlansModal.scaledToYourTarget", "Scaled to your target:")}</span>{' '}
                {targetCalories} cal/day — all macros adjusted proportionally
              </p>
            </div>
          )}

          <div className="space-y-3">
            {scaledPlans.map(({ plan, scaled, fitsGoal }) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                scaled={scaled}
                fitsGoal={fitsGoal}
                onSelect={() => setSelected(plan.id)}
              />
            ))}
          </div>
        </motion.div>
      ) : selectedEntry ? (
        <PlanDetail
          key="detail"
          plan={selectedEntry.plan}
          scaled={selectedEntry.scaled}
          onBack={() => setSelected(null)}
          onApply={onApplyPlan}
        />
      ) : null}
    </AnimatePresence>
  );
}

/* ─── Main modal ─────────────────────────────────────────────────────────── */
export default function NutritionPlansModal({ open, onClose, userProfile, onStartOnboarding, trainingFuel, onApplyFuel }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const handleClose = () => {
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
              <h2 className="font-heading font-bold text-xl">{tFallback("nutrition.nutritionPlans", "Nutrition Plans")}</h2>
              <button onClick={handleClose} className="p-2 rounded-full hover:bg-secondary active:bg-secondary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 pb-6">
              <NutritionPlansPanel userProfile={userProfile} onStartOnboarding={onStartOnboarding} trainingFuel={trainingFuel} onApplyFuel={onApplyFuel} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
