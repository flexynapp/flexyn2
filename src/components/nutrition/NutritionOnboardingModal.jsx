// src/components/nutrition/NutritionOnboardingModal.jsx
import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingDown, Minus, TrendingUp, Calendar, Activity, Check, ArrowRight, ArrowLeft, AlertTriangle, ShieldCheck } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { db } from '@/api/db';
import { toast } from 'sonner';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { DIETARY_RESTRICTIONS, persistRestrictions } from '@/lib/nutritionPlans';

const GOALS = [
  { id: 'lose',     icon: TrendingDown, color: 'text-blue-500',   bg: 'bg-blue-500/10',   titleKey: 'nutritionOnboarding.goal.lose.title',     descKey: 'nutritionOnboarding.goal.lose.desc' },
  { id: 'maintain', icon: Minus,        color: 'text-emerald-500', bg: 'bg-emerald-500/10', titleKey: 'nutritionOnboarding.goal.maintain.title', descKey: 'nutritionOnboarding.goal.maintain.desc' },
  { id: 'gain',     icon: TrendingUp,   color: 'text-orange-500',  bg: 'bg-orange-500/10',  titleKey: 'nutritionOnboarding.goal.gain.title',     descKey: 'nutritionOnboarding.goal.gain.desc' },
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
  const birth = userProfile.birthday ? new Date(userProfile.birthday) : null;
  const age = (() => {
    if (!birth || isNaN(birth.getTime())) return userProfile.age || 30;
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

export default function NutritionOnboardingModal({ open, userProfile, onComplete }) {
  const { t } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState(null);
  const [targetWeight, setTargetWeight] = useState('');
  const [targetDate, setTargetDate] = useState(format(addDays(new Date(), 90), 'yyyy-MM-dd'));
  const [activity, setActivity] = useState('moderate');
  const [dietaryRestrictions, setDietaryRestrictions] = useState([]);
  const [saving, setSaving] = useState(false);

  const toggleRestriction = (id) => {
    setDietaryRestrictions(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    );
  };

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
    return true;
  })();

  const totalSteps = 5; // 0=goal, 1=target, 2=activity, 3=restrictions, 4=preview
  const next = () => setStep(s => Math.min(s + 1, totalSteps - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

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
      if (dietaryRestrictions.length > 0) {
        payload.dietary_restrictions = dietaryRestrictions;
        persistRestrictions(dietaryRestrictions);
      }
      await db.auth.updateMe(payload);
      try { localStorage.setItem('fn-nutrition-onboarded', 'true'); } catch { /* ignore */ }
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

  const handleSkip = async () => {
    // localStorage fallback so the modal won't re-open even if the DB column
    // is missing (e.g. migration 004 not yet applied to this Supabase project).
    try { localStorage.setItem('fn-nutrition-onboarded', 'true'); } catch { /* ignore */ }
    try { await db.auth.updateMe({ nutrition_onboarding_complete: true }); } catch { /* ignore */ }
    onComplete?.();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleSkip(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        {/* Progress bar */}
        <div className="w-full h-1 bg-secondary">
          <motion.div
            className="h-full bg-primary"
            animate={{ width: `${((step + 1) / totalSteps) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Note: Radix DialogContent ships its own close X in the top-right
            corner. We previously added a second one here which created a
            duplicate-X bug; relying on the built-in keeps a single button. */}

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
                        className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
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
                  <Card className="p-4 bg-emerald-500/5 border-emerald-500/20">
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
                        className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-heading font-semibold text-sm">{t(a.titleKey)}</p>
                            <p className="text-xs text-muted-foreground">{t(a.descKey)}</p>
                          </div>
                          {selected && <Check className="w-5 h-5 text-primary shrink-0 ml-2" />}
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
                  Dietary Restrictions
                </h2>
                <p className="text-sm text-muted-foreground mb-1">Select all that apply — or skip if you have none.</p>
                <p className="text-xs text-muted-foreground mb-4">We'll filter nutrition plans that don't fit your restrictions.</p>
                <div className="grid grid-cols-2 gap-2">
                  {DIETARY_RESTRICTIONS.map(r => {
                    const selected = dietaryRestrictions.includes(r.id);
                    return (
                      <motion.button
                        key={r.id}
                        onClick={() => toggleRestriction(r.id)}
                        whileTap={{ scale: 0.97 }}
                        className={`flex items-center gap-2.5 p-3 rounded-xl border-2 text-left transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                      >
                        <span className="text-xl leading-none shrink-0">{r.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-heading font-semibold text-xs leading-tight">{r.label}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{r.desc}</p>
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

            {/* STEP 4 — Preview */}
            {step === 4 && preview && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-heading font-bold text-xl mb-1">{t('nutritionOnboarding.step.preview.title')}</h2>
                <p className="text-sm text-muted-foreground mb-4">{t('nutritionOnboarding.step.preview.subtitle')}</p>

                {preview.warning === 'tooAggressive' && (
                  <Card className="p-3 mb-4 bg-amber-500/10 border-amber-500/30">
                    <div className="flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        {t('nutritionOnboarding.warning.tooAggressive')}
                      </p>
                    </div>
                  </Card>
                )}

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <Card className="p-3 bg-orange-500/5">
                    <p className="text-xs text-muted-foreground">{t('nutrition.macros.calories')}</p>
                    <p className="font-heading font-bold text-2xl text-orange-600">{preview.calories}</p>
                    <p className="text-[10px] text-muted-foreground">kcal/day</p>
                  </Card>
                  <Card className="p-3 bg-red-500/5">
                    <p className="text-xs text-muted-foreground">{t('nutrition.macros.protein')}</p>
                    <p className="font-heading font-bold text-2xl text-red-600">{preview.protein_g}g</p>
                  </Card>
                  <Card className="p-3 bg-blue-500/5">
                    <p className="text-xs text-muted-foreground">{t('nutrition.macros.carbs')}</p>
                    <p className="font-heading font-bold text-2xl text-blue-600">{preview.carbs_g}g</p>
                  </Card>
                  <Card className="p-3 bg-yellow-500/5">
                    <p className="text-xs text-muted-foreground">{t('nutrition.macros.fat')}</p>
                    <p className="font-heading font-bold text-2xl text-yellow-600">{preview.fat_g}g</p>
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
                <ArrowLeft className="w-4 h-4 mr-1" />
                {t('common.back')}
              </Button>
            )}
            {step < totalSteps - 1 ? (
              <Button onClick={next} disabled={!canAdvance} className="flex-1">
                {t('common.next')}
                <ArrowRight className="w-4 h-4 ml-1" />
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