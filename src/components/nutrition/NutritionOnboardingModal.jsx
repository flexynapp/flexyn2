// src/components/nutrition/NutritionOnboardingModal.jsx
import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingDown, Minus, TrendingUp, Calendar, Activity, Check, ArrowRight, ArrowLeft, AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { db } from '@/api/db';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { DIETARY_RESTRICTIONS, ALLERGENS, ALLERGEN_IDS, parseCustomTerms, persistRestrictions } from '@/lib/nutritionPlans';
import { nutritionOnboardedKey } from '@/lib/nutritionOnboardingGate';
import { OnboardingCoachButton, OnboardingCoachSheet } from '@/components/onboarding/OnboardingCoach';
import { NUTRITION_STEP_IDS } from '@/lib/aiCoach/onboardingCoach';

const GOALS = [
  { id: 'lose',     icon: TrendingDown, color: 'text-info',   bg: 'bg-info/10',   titleKey: 'nutritionOnboarding.goal.lose.title',     descKey: 'nutritionOnboarding.goal.lose.desc' },
  { id: 'maintain', icon: Minus,        color: 'text-success', bg: 'bg-success/10', titleKey: 'nutritionOnboarding.goal.maintain.title', descKey: 'nutritionOnboarding.goal.maintain.desc' },
  { id: 'gain',     icon: TrendingUp,   color: 'text-primary',  bg: 'bg-primary/10',  titleKey: 'nutritionOnboarding.goal.gain.title',     descKey: 'nutritionOnboarding.goal.gain.desc' },
];

const ACTIVITY_LEVELS = [
  { id: 'sedentary', titleKey: 'nutritionOnboarding.activity.sedentary.title', descKey: 'nutritionOnboarding.activity.sedentary.desc' },
  { id: 'light',     titleKey: 'nutritionOnboarding.activity.light.title',     descKey: 'nutritionOnboarding.activity.light.desc' },
  { id: 'moderate',  titleKey: 'nutritionOnboarding.activity.moderate.title',  descKey: 'nutritionOnboarding.activity.moderate.desc' },
  { id: 'very',      titleKey: 'nutritionOnboarding.activity.very.title',      descKey: 'nutritionOnboarding.activity.very.desc' },
  { id: 'extra',     titleKey: 'nutritionOnboarding.activity.extra.title',     descKey: 'nutritionOnboarding.activity.extra.desc' },
];

// Pure helpers — duplicated from nutritionDefaults so the preview screen can render
// without round-tripping through the saved profile.
function mifflinStJeor({ weightKg, heightCm, age, gender }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (gender === 'female') return base - 161;
  if (gender === 'male') return base + 5;
  return base - 78;
}
const ACTIVITY_MULTIPLIERS = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, extra: 1.9 };

function computePreview({ userProfile, goal, targetLbs, targetDate, activity }) {
  // Parse birthday as a LOCAL date — `new Date('YYYY-MM-DD')` is UTC
  // midnight, which for users west of UTC reads back as the previous
  // calendar day in local time. That shifts derived age by ±1 day at
  // the birthday boundary, which then flips BMR → wrong daily-calorie
  // target persisted to weekly_rate_lbs / target_weight_lbs.
  const parseLocalYMD = (s) => {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const birth = parseLocalYMD(userProfile.birthday);
  const age = (() => {
    if (!birth) return userProfile.age || 30;
    const now = new Date();
    let years = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
    return years;
  })();
  const weightLbs = userProfile.weight_lbs || 180;
  const heightInches = userProfile.height_inches || 70;
  const gender = userProfile.gender || 'male';
  const weightKg = weightLbs * 0.453592;
  const heightCm = heightInches * 2.54;

  const bmr = mifflinStJeor({ weightKg, heightCm, age, gender });
  const tdee = bmr * (ACTIVITY_MULTIPLIERS[activity] ?? 1.55);

  let weeklyRate = 0;
  if (goal !== 'maintain' && targetLbs && targetDate) {
    const t = new Date(targetDate);
    if (!isNaN(t.getTime())) {
      const weeks = (t.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7);
      if (weeks > 0) weeklyRate = (parseFloat(targetLbs) - weightLbs) / weeks;
    }
  }
  // Clamp
  if (weeklyRate < 0) weeklyRate = Math.max(weeklyRate, Math.max(-(weightLbs * 0.01), -2.0));
  if (weeklyRate > 0) weeklyRate = Math.min(weeklyRate, 1.5);

  const dailyDelta = (weeklyRate * 3500) / 7;
  let calories = Math.round(tdee + dailyDelta);
  const minCalories = gender === 'female' ? 1200 : 1500;
  let warning = null;
  if (calories < minCalories) {
    warning = 'tooAggressive';
    calories = minCalories;
  }

  const proteinPerLb = goal === 'lose' ? 1.0 : goal === 'gain' ? 0.9 : 0.8;
  const protein_g = Math.round(weightLbs * proteinPerLb);
  const fatKcal = calories * 0.25;
  const fatFloor_g = Math.round(weightLbs * 0.35);
  const fat_g = Math.max(Math.round(fatKcal / 9), fatFloor_g);
  const carbs_g = Math.round(Math.max(calories - protein_g * 4 - fat_g * 9, 0) / 4);

  return { calories, protein_g, carbs_g, fat_g, weeklyRate, tdee: Math.round(tdee), warning };
}

export default function NutritionOnboardingModal({ open, userProfile, onComplete, onDismiss }) {
  const { t } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Per-user localStorage key per CLAUDE.md convention. Previously
  // wrote bare `fn-nutrition-onboarded` which meant User A completing
  // onboarding caused User B (on the same device) to never see the
  // modal. Wave 57 caught this.
  const onboardedKey = nutritionOnboardedKey(user?.id);
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState(null);
  const [targetWeight, setTargetWeight] = useState('');
  const [targetDate, setTargetDate] = useState(format(addDays(new Date(), 90), 'yyyy-MM-dd'));
  const [activity, setActivity] = useState('moderate');
  // Pre-fill from the saved profile (edit mode) — split the stored merged list
  // back into diets vs allergens so both steps show current selections.
  const _saved = userProfile?.dietary_restrictions || [];
  const [dietaryRestrictions, setDietaryRestrictions] = useState(
    () => _saved.filter(id => DIETARY_RESTRICTIONS.some(d => d.id === id)),
  );
  const [allergens, setAllergens] = useState(
    () => _saved.filter(id => ALLERGEN_IDS.includes(id)),
  );
  // Free-text restrictions the user types (e.g. "shrimp" but not all shellfish).
  const [customRestrictions, setCustomRestrictions] = useState(() => parseCustomTerms(_saved));
  const [customInput, setCustomInput] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleRestriction = (id) => {
    setDietaryRestrictions(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    );
  };
  const toggleAllergen = (id) => {
    setAllergens(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };
  const addCustom = () => {
    const term = customInput.trim().toLowerCase();
    if (term.length > 1 && !customRestrictions.includes(term)) {
      setCustomRestrictions(prev => [...prev, term]);
    }
    setCustomInput('');
  };
  const removeCustom = (term) => setCustomRestrictions(prev => prev.filter(t => t !== term));

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const minDateStr = format(addDays(new Date(), 7), 'yyyy-MM-dd'); // require at least 1 week out

  // Convert displayed target weight back to lbs for storage / preview.
  const targetLbs = useMemo(() => {
    if (!targetWeight) return null;
    const n = parseFloat(targetWeight);
    if (isNaN(n)) return null;
    if (weightUnit === 'kg') return n / 0.453592;
    if (weightUnit === 'stone') return n * 14;
    return n;
  }, [targetWeight, weightUnit]);

  const preview = useMemo(() => {
    if (!goal) return null;
    return computePreview({ userProfile, goal, targetLbs, targetDate, activity });
  }, [userProfile, goal, targetLbs, targetDate, activity]);

  // Validation per step
  const canAdvance = (() => {
    if (step === 0) return !!goal;
    if (step === 1) {
      if (goal === 'maintain') return true;
      if (!targetLbs || !targetDate) return false;
      const currentLbs = userProfile.weight_lbs || 0;
      if (goal === 'lose' && targetLbs >= currentLbs) return false;
      if (goal === 'gain' && targetLbs <= currentLbs) return false;
      const t = new Date(targetDate);
      if (isNaN(t.getTime()) || t.getTime() < new Date(minDateStr).getTime()) return false;
      return true;
    }
    if (step === 2) return !!activity;
    if (step === 3) return true; // restrictions are optional
    if (step === 4) return true; // allergens are optional
    return true;
  })();

  const totalSteps = 6; // 0=goal, 1=target, 2=activity, 3=restrictions, 4=allergens, 5=preview
  const next = () => setStep(s => Math.min(s + 1, totalSteps - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

  /* ── AI Coach ──────────────────────────────────────────────
     Same coach as the initial onboarding flow, pointed at this step.
     The draft it reads is deliberately narrow — the two weights are
     what lets it suggest a target date that lands inside a
     sustainable rate instead of just describing what one is.        */
  const [coachOpen, setCoachOpen] = useState(false);
  const coachStepId = NUTRITION_STEP_IDS[step];
  const coachDraft = useMemo(() => ({
    goal,
    activity,
    currentLbs: userProfile?.weight_lbs || null,
    targetLbs,
  }), [goal, activity, userProfile?.weight_lbs, targetLbs]);
  const applyCoachSuggestion = (apply) => {
    if (!apply || typeof apply.field !== 'string') return;
    // Unknown fields are ignored rather than written blindly — a new
    // suggestion type must not be able to poke an arbitrary key in here.
    if (apply.field === 'goal') setGoal(apply.value);
    else if (apply.field === 'activity') setActivity(apply.value);
    else if (apply.field === 'targetDate') setTargetDate(apply.value);
    else return;
    setCoachOpen(false);
  };

  const handleSubmit = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      const payload = {
        nutrition_onboarding_complete: true,
        nutrition_goal: goal,
        activity_level: activity,
        weekly_rate_lbs: preview.weeklyRate,
      };
      if (goal !== 'maintain') {
        payload.target_weight_lbs = targetLbs;
        payload.target_date = targetDate;
      } else {
        payload.target_weight_lbs = null;
        payload.target_date = null;
      }
      // Store diets + allergens + any custom free-text terms together — the
      // substitution engine treats them uniformly (all hard exclusions it
      // guarantees never appear). Custom terms are prefixed `custom:`.
      const combined = [
        ...dietaryRestrictions,
        ...allergens,
        ...customRestrictions.map(t => `custom:${t}`),
      ];
      payload.dietary_restrictions = combined;
      persistRestrictions(combined);
      await db.auth.updateMe(payload);
      try { localStorage.setItem(onboardedKey, 'true'); } catch { /* ignore */ }
      // Update the userProfile cache OPTIMISTICALLY so the parent's
      // auto-open useEffect sees nutrition_onboarding_complete=true
      // BEFORE its background refetch lands. Without this, the modal
      // close + immediate re-render race could re-fire the auto-open
      // path while the cached profile still showed onboarding=false,
      // leaving the user trapped on step 0 with the "saved" toast
      // visible — exactly the screenshot bug.
      try {
        queryClient.setQueriesData(
          { queryKey: ['userProfile'] },
          (prev) => prev ? { ...prev, nutrition_onboarding_complete: true } : prev,
        );
      } catch { /* ignore — cache shape mismatch isn't fatal */ }
      toast.success(t('nutritionOnboarding.toast.saved'));
    } catch (err) {
      console.error('Nutrition onboarding save failed:', err);
      // Still close — don't trap the user if the DB column is missing or the
      // network is flaky. They can revisit settings later.
      toast.error('Could not save your plan — you can set it up later in Settings.');
    } finally {
      setSaving(false);
      onComplete?.();
    }
  };

  // EXPLICIT Skip — the user actively chose to defer setup. Marks
  // onboarding as complete so the modal won't auto-open again.
  const handleSkip = async () => {
    try { localStorage.setItem(onboardedKey, 'true'); } catch { /* ignore */ }
    try { await db.auth.updateMe({ nutrition_onboarding_complete: true }); } catch { /* ignore */ }
    onComplete?.();
  };

  // Dismiss WITHOUT marking complete — for backdrop / Esc / top-right X
  // taps. Previously every dismissal called handleSkip which permanently
  // flipped nutrition_onboarding_complete=true, so a single misclick
  // locked the user into the default 2000 kcal goals FOREVER with no path
  // back to onboarding. The modal can re-open on next visit if completion
  // never happened. (Audit 11 #1.)
  //
  // `onDismiss` is what records the session-scoped "don't ask again this
  // session" flag; it is deliberately a DIFFERENT callback from
  // `onComplete` so the parent can tell "closed it" apart from "finished
  // it". Falls back to onComplete for any caller that hasn't wired it.
  const handleDismissWithoutCompleting = () => {
    (onDismiss || onComplete)?.();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleDismissWithoutCompleting(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden" title="Set your nutrition targets">
        {/* Progress bar */}
        <div className="w-full h-1 bg-secondary">
          <motion.div
            className="h-full bg-primary"
            animate={{ width: `${((step + 1) / totalSteps) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Invisible 44px hit-target overlay sitting on top of Radix's
            built-in close X. The default Close button's hit area is
            ~16px which is well under iOS's 44px touch minimum — the
            screenshot feedback ("hit the X button like five times")
            was the missed-tap symptom. This transparent button covers
            the corner so any tap in the X region reliably dismisses,
            while Radix's icon stays the visible affordance. */}
        <button
          type="button"
          onClick={handleDismissWithoutCompleting}
          aria-label="Close"
          className="absolute end-0 top-0 z-20 w-12 h-12 bg-transparent touch-manipulation"
        />

        {/* Coach trigger, tucked in beside the close X. It sits at end-12
            because the X owns the corner itself and its hit target is a
            full 48px — overlapping them would make the coach button
            occasionally dismiss the modal instead. */}
        <OnboardingCoachButton
          size="sm"
          onClick={() => setCoachOpen(true)}
          className="absolute end-12 top-2 z-30"
        />

        <OnboardingCoachSheet
          open={coachOpen}
          onClose={() => setCoachOpen(false)}
          stepId={coachStepId}
          draft={coachDraft}
          onApply={applyCoachSuggestion}
        />


        <div className="p-6">
          <AnimatePresence mode="wait">
            {/* STEP 0 — Goal */}
            {step === 0 && (
              <motion.div
                key="step0"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-heading font-bold text-xl mb-1">{t('nutritionOnboarding.step.goal.title')}</h2>
                <p className="text-sm text-muted-foreground mb-5">{t('nutritionOnboarding.step.goal.subtitle')}</p>
                <div className="space-y-2">
                  {GOALS.map(g => {
                    const Icon = g.icon;
                    const selected = goal === g.id;
                    return (
                      <motion.button
                        key={g.id}
                        onClick={() => setGoal(g.id)}
                        whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                        className={`w-full text-start p-4 rounded-lg border-2 transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full ${g.bg} flex items-center justify-center`}>
                            <Icon className={`w-5 h-5 ${g.color}`} />
                          </div>
                          <div className="flex-1">
                            <p className="font-heading font-semibold">{t(g.titleKey)}</p>
                            <p className="text-xs text-muted-foreground">{t(g.descKey)}</p>
                          </div>
                          {selected && <Check className="w-5 h-5 text-primary" />}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* STEP 1 — Target weight + date (skipped UI for maintain, but step still exists) */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-heading font-bold text-xl mb-1">{t('nutritionOnboarding.step.target.title')}</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  {goal === 'maintain'
                    ? t('nutritionOnboarding.step.target.subtitleMaintain')
                    : t('nutritionOnboarding.step.target.subtitle')}
                </p>

                {goal !== 'maintain' && (
                  <>
                    <label className="text-sm font-medium mb-2 block">
                      {t('nutritionOnboarding.step.target.weightLabel')} ({weightUnit})
                    </label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder={t('nutritionOnboarding.step.target.weightPlaceholder')}
                      value={targetWeight}
                      onChange={(e) => setTargetWeight(e.target.value)}
                      className="mb-4"
                    />

                    <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      {t('nutritionOnboarding.step.target.dateLabel')}
                    </label>
                    <Input
                      type="date"
                      value={targetDate}
                      min={minDateStr}
                      onChange={(e) => setTargetDate(e.target.value)}
                      className="mb-2"
                    />
                    <p className="text-xs text-muted-foreground">{t('nutritionOnboarding.step.target.dateHint')}</p>
                  </>
                )}

                {goal === 'maintain' && (
                  <Card className="p-4 bg-success/5 border-success/20">
                    <p className="text-sm">{t('nutritionOnboarding.step.target.maintainBody')}</p>
                  </Card>
                )}
              </motion.div>
            )}

            {/* STEP 2 — Activity level */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-heading font-bold text-xl mb-1 flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  {t('nutritionOnboarding.step.activity.title')}
                </h2>
                <p className="text-sm text-muted-foreground mb-5">{t('nutritionOnboarding.step.activity.subtitle')}</p>
                <div className="space-y-2">
                  {ACTIVITY_LEVELS.map(a => {
                    const selected = activity === a.id;
                    return (
                      <motion.button
                        key={a.id}
                        onClick={() => setActivity(a.id)}
                        whileTap={{ scale: 0.99 }}
                        className={`w-full text-start p-3 rounded-lg border-2 transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-heading font-semibold text-sm">{t(a.titleKey)}</p>
                            <p className="text-xs text-muted-foreground">{t(a.descKey)}</p>
                          </div>
                          {selected && <Check className="w-5 h-5 text-primary shrink-0 ms-2" />}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* STEP 3 — Dietary Restrictions */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-heading font-bold text-xl mb-1 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" />
                  Diet &amp; Lifestyle
                </h2>
                <p className="text-sm text-muted-foreground mb-1">Follow a particular way of eating? Select all that apply.</p>
                <p className="text-xs text-muted-foreground mb-4">Food allergies come next — we'll adapt every plan to fit both.</p>
                <div className="grid grid-cols-2 gap-2">
                  {DIETARY_RESTRICTIONS.map(r => {
                    const selected = dietaryRestrictions.includes(r.id);
                    return (
                      <motion.button
                        key={r.id}
                        onClick={() => toggleRestriction(r.id)}
                        whileTap={{ scale: 0.97 }}
                        className={`flex items-center gap-2.5 p-3 rounded-xl border-2 text-start transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                      >
                        <span className="text-xl leading-none shrink-0">{r.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-heading font-semibold text-xs leading-tight">{r.label}</p>
                          <p className="text-micro text-muted-foreground mt-0.5 leading-tight">{r.desc}</p>
                        </div>
                        {selected && <Check className="w-4 h-4 text-primary shrink-0" />}
                      </motion.button>
                    );
                  })}
                </div>
                {dietaryRestrictions.length > 0 && (
                  <p className="text-xs text-primary font-medium mt-3 text-center">
                    {dietaryRestrictions.length} restriction{dietaryRestrictions.length > 1 ? 's' : ''} selected
                  </p>
                )}
              </motion.div>
            )}

            {/* STEP 4 — Food Allergies */}
            {step === 4 && (
              <motion.div
                key="step4-allergens"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-heading font-bold text-xl mb-1 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  Allergies &amp; Intolerances
                </h2>
                <p className="text-sm text-muted-foreground mb-1">
                  Select any that apply — we'll make sure these <span className="font-semibold text-foreground">never</span> appear in a plan.
                </p>
                <p className="text-xs text-muted-foreground mb-4">The complete set of major food allergens.</p>
                <div className="grid grid-cols-2 gap-2">
                  {ALLERGENS.map(a => {
                    const selected = allergens.includes(a.id);
                    return (
                      <motion.button
                        key={a.id}
                        onClick={() => toggleAllergen(a.id)}
                        whileTap={{ scale: 0.97 }}
                        className={`flex items-center gap-2.5 p-3 rounded-xl border-2 text-start transition-colors ${selected ? 'border-destructive bg-destructive/5' : 'border-border hover:border-destructive/40'}`}
                      >
                        <span className="text-xl leading-none shrink-0">{a.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-heading font-semibold text-xs leading-tight">{a.label}</p>
                          <p className="text-micro text-muted-foreground mt-0.5 leading-tight">{a.desc}</p>
                        </div>
                        {selected && <Check className="w-4 h-4 text-destructive shrink-0" />}
                      </motion.button>
                    );
                  })}
                </div>
                {allergens.length > 0 && (
                  <p className="text-xs text-destructive font-medium mt-3 text-center">
                    {allergens.length} allergen{allergens.length === 1 ? '' : 's'} — guaranteed excluded from every plan
                  </p>
                )}

                {/* Custom / free-text exclusions — for anything not in the list
                    (e.g. shrimp but not all shellfish, cilantro, a nightshade). */}
                <div className="mt-4 pt-4 border-t border-border/50">
                  <p className="text-xs font-semibold text-foreground mb-1.5">Something else to avoid?</p>
                  <div className="flex gap-2">
                    <input
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
                      placeholder="e.g. shrimp, cilantro, mushrooms"
                      className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-destructive/40"
                    />
                    <button
                      type="button"
                      onClick={addCustom}
                      disabled={customInput.trim().length < 2}
                      className="px-3 py-2 rounded-lg bg-destructive text-white text-sm font-semibold disabled:opacity-40 transition-opacity"
                    >
                      Add
                    </button>
                  </div>
                  {customRestrictions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {customRestrictions.map(term => (
                        <span key={term} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-destructive/10 text-destructive dark:text-destructive text-xs font-medium">
                          {term}
                          <button type="button" onClick={() => removeCustom(term)} aria-label={`Remove ${term}`} className="w-4 h-4 rounded-full hover:bg-destructive/20 flex items-center justify-center">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* STEP 5 — Preview */}
            {step === 5 && preview && (
              <motion.div
                key="step5"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-heading font-bold text-xl mb-1">{t('nutritionOnboarding.step.preview.title')}</h2>
                <p className="text-sm text-muted-foreground mb-4">{t('nutritionOnboarding.step.preview.subtitle')}</p>

                {preview.warning === 'tooAggressive' && (
                  <Card className="p-3 mb-4 bg-primary/10 border-primary/30">
                    <div className="flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <p className="text-xs text-primary dark:text-primary">
                        {t('nutritionOnboarding.warning.tooAggressive')}
                      </p>
                    </div>
                  </Card>
                )}

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <Card className="p-3 bg-primary/5">
                    <p className="text-xs text-muted-foreground">{t('nutrition.macros.calories')}</p>
                    <p className="font-heading font-bold text-2xl text-primary">{preview.calories}</p>
                    <p className="text-micro text-muted-foreground">cal/day</p>
                  </Card>
                  <Card className="p-3 bg-destructive/5">
                    <p className="text-xs text-muted-foreground">{t('nutrition.macros.protein')}</p>
                    <p className="font-heading font-bold text-2xl text-destructive">{preview.protein_g}g</p>
                  </Card>
                  <Card className="p-3 bg-info/5">
                    <p className="text-xs text-muted-foreground">{t('nutrition.macros.carbs')}</p>
                    <p className="font-heading font-bold text-2xl text-info">{preview.carbs_g}g</p>
                  </Card>
                  <Card className="p-3 bg-primary/5">
                    <p className="text-xs text-muted-foreground">{t('nutrition.macros.fat')}</p>
                    <p className="font-heading font-bold text-2xl text-primary">{preview.fat_g}g</p>
                  </Card>
                </div>

                {preview.weeklyRate !== 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    {t('nutritionOnboarding.step.preview.rate', { rate: Math.abs(preview.weeklyRate).toFixed(2) })}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Nav buttons */}
          <div className="flex gap-2 mt-6">
            {step > 0 && (
              <Button variant="outline" onClick={back} disabled={saving} className="flex-1">
                <ArrowLeft className="w-4 h-4 me-1 rtl:scale-x-[-1]" />
                {t('common.back')}
              </Button>
            )}
            {step < totalSteps - 1 ? (
              <Button onClick={next} disabled={!canAdvance} className="flex-1">
                {t('common.next')}
                <ArrowRight className="w-4 h-4 ms-1 rtl:scale-x-[-1]" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={saving} className="flex-1">
                {saving ? t('common.saving') : t('nutritionOnboarding.cta.finish')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}