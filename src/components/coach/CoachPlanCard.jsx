// src/components/coach/CoachPlanCard.jsx
//
// Interactive plan attached to an AI Coach reply. Renders the sectioned
// Cardio/Strength view and lets the user act on it without leaving the chat:
//   • Save as regimen  — persists it to their Regimens (both shapes)
//   • Start workout    — (single session only) hands off to the Workout page
//
// Feedback is INLINE (a subtle "Saved ✓" state), not a toast — toasts are
// suppressed app-wide except errors.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Play, Save, Check, Loader2, Flame, ChevronRight } from 'lucide-react';
import StarterPlanView from '@/components/workout/StarterPlanView';
import { toast } from '@/lib/toast';

export default function CoachPlanCard({ plan, onSaveRegimen, onStartWorkout }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!plan) return null;
  const isSession = plan.kind === 'session';
  // Cardio sessions have no strength-logger handoff (plan.workout is null) —
  // they're logged via the Cardio tracker, so only "Save as regimen" applies.
  const startable = isSession && !!plan.workout && !!onStartWorkout;

  const handleSave = async () => {
    if (saved || saving || !onSaveRegimen) return;
    setSaving(true);
    try {
      await onSaveRegimen(plan.regimenPayload);
      setSaved(true);
    } catch (err) {
      toast.error(`Couldn't save — ${err?.message || 'try again'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-3 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/5 via-fuchsia-500/5 to-violet-500/10 p-3"
    >
      <div className="mb-2.5 px-0.5">
        <p className="font-heading font-bold text-[15px] leading-tight">{plan.title}</p>
        {plan.subtitle && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{plan.subtitle}</p>
        )}
      </div>

      <StarterPlanView
        regimen={{ exercises: plan.exercises }}
        cardioDefaultOpen
        strengthDefaultOpen={isSession}
      />

      {/* Training-load → nutrition: what this plan costs to fuel. Deep-links to
          the Nutrition Plans section to tune the diet plan around it. */}
      {plan.fuel && plan.fuel.runDays > 0 && (
        <button
          type="button"
          onClick={() => navigate('/nutrition?plans=1')}
          className="mt-2.5 w-full flex items-center gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-start transition-colors hover:bg-amber-500/10"
        >
          <span className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Flame className="w-4 h-4" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold leading-tight">Fuel your training</span>
            <span className="block text-[11px] text-muted-foreground mt-0.5">
              ~+{plan.fuel.perRunDayKcal} kcal · +{plan.fuel.addCarbsG}g carbs on run days
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      )}

      <div className="mt-3 flex gap-2">
        {startable && (
          <button
            type="button"
            onClick={() => onStartWorkout(plan.workout)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm py-2.5 transition-opacity active:opacity-80"
          >
            <Play className="w-4 h-4" />
            Start workout
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || saved}
          className={[
            'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold text-sm py-2.5 transition-colors',
            startable ? 'flex-1' : 'w-full',
            saved
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-secondary text-foreground hover:bg-secondary/80 disabled:opacity-60',
          ].join(' ')}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <Check className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saved ? 'Saved to Regimens' : 'Save as regimen'}
        </button>
      </div>
    </motion.div>
  );
}
