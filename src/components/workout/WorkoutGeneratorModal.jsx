// src/components/workout/WorkoutGeneratorModal.jsx
//
// Picks parameters and generates a personalized workout via the AI generator.
// User can preview the result, regenerate, or load it into the workout form
// to start lifting.

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, RefreshCw, Play, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import {
  generateWorkout,
  FOCUS_OPTIONS,
  EQUIPMENT_OPTIONS,
  DURATION_OPTIONS,
  SKILL_OPTIONS,
} from '@/lib/aiCoach/workoutGenerator';

// Plain framer-motion portal (NOT Radix). Same pattern as
// ProfanityWarningDialog — known to work in every browser/viewport.
// We swapped off Radix Dialog because clicking "Generate Workout" was
// firing the setState handler but the Radix portal content never
// became visible (no visible UI even though the wrapper mounted).
export default function WorkoutGeneratorModal({ open, onClose, onUseWorkout, onSaveAsRegimen, userProfile = {} }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const [focus, setFocus] = useState('full_body');
  const [duration, setDuration] = useState(45);
  const [equipment, setEquipment] = useState('gym');
  const [skill, setSkill] = useState('intermediate');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      // Pass a seed nonce so "Regenerate" returns a different plan
      // each time. Without this the underlying generator is
      // deterministic given identical params (user/focus/duration/...)
      // and "Regenerate" was returning the same workout repeatedly.
      // The generator only uses seed if it accepts it; extra prop is
      // safe to pass for backward compatibility. (Audit 09 #H-2.)
      const workout = await generateWorkout({
        user,
        focus,
        durationMinutes: duration,
        equipment,
        skillLevel: skill,
        bodyweightLbs: Number(userProfile?.weight_lbs) || 165,
        seed: Date.now(),
      });
      setResult(workout);
    } catch (err) {
      // Surface the failure so the user understands why the form
      // suddenly emptied. Previously the catch was a silent
      // console.error and the modal returned to the blank state with
      // no explanation. (Audit 09 #C-6.)
      console.error('[generator] failed:', err);
      toast.error(`Couldn't generate a workout — ${err?.message || 'try again'}`);
    } finally {
      setGenerating(false);
    }
  };

  const [savingRegimen, setSavingRegimen] = useState(false);
  const [savedAsRegimen, setSavedAsRegimen] = useState(false);

  const handleUse = () => {
    if (!result || !onUseWorkout) return;
    onUseWorkout(result);
    onClose();
    setResult(null);
  };

  const handleSaveAsRegimen = async () => {
    if (!result || !onSaveAsRegimen || savedAsRegimen) return;
    setSavingRegimen(true);
    try {
      await onSaveAsRegimen(result);
      // Disable the save button after success so a second tap doesn't
      // create a duplicate regimen. The button label flips to
      // "Saved ✓" via savedAsRegimen state below. Reset only on
      // close/regenerate. (Audit 09 #H-1.)
      setSavedAsRegimen(true);
    } finally {
      setSavingRegimen(false);
    }
  };

  const handleClose = () => {
    onClose();
    setResult(null);
    setSavedAsRegimen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="generator-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
          >
            <button
              onClick={handleClose}
              aria-label="Close"
              className="absolute top-3 right-3 z-10 p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-4 sm:p-6">
              <div className="mb-4 pr-8">
                <h2 className="font-heading font-bold text-lg flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary via-fuchsia-500 to-violet-500 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  {tFallback('generator.title', 'Generate Workout')}
                </h2>
              </div>

          {!result && !generating && (
            <>
              <Pillset
                label={tFallback('generator.focus', 'Focus')}
                options={FOCUS_OPTIONS}
                value={focus}
                onChange={setFocus}
              />
              <Pillset
                label={tFallback('generator.duration', 'Duration')}
                options={DURATION_OPTIONS}
                value={duration}
                onChange={setDuration}
              />
              <Pillset
                label={tFallback('generator.equipment', 'Equipment')}
                options={EQUIPMENT_OPTIONS}
                value={equipment}
                onChange={setEquipment}
              />
              <Pillset
                label={tFallback('generator.skill', 'Experience')}
                options={SKILL_OPTIONS}
                value={skill}
                onChange={setSkill}
              />

              <Button
                onClick={handleGenerate}
                className="w-full mt-2 gap-2"
                size="lg"
              >
                <Sparkles className="w-4 h-4" />
                {tFallback('generator.generate', 'Generate')}
              </Button>
              <p className="text-[11px] text-muted-foreground mt-3 text-center leading-relaxed">
                {tFallback('generator.disclaimer', "Personalized using your last 60 days of workout history. Not a substitute for a coach if you have injuries or special needs.")}
              </p>
            </>
          )}

          {generating && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
              <p className="font-heading font-semibold">
                {tFallback('generator.thinking', 'Building your workout…')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {tFallback('generator.thinkingDesc', 'Reading your training history.')}
              </p>
            </div>
          )}

          <AnimatePresence>
            {result && !generating && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="mb-4 p-4 rounded-xl bg-gradient-to-br from-primary/10 via-fuchsia-500/5 to-violet-500/10 border border-primary/20">
                  <p className="font-heading font-bold text-lg leading-tight">{result.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {result.exercises.length} exercises · {result.duration_minutes} min
                  </p>
                </div>

                <div className="space-y-2 mb-5">
                  {result.exercises.map((ex, i) => (
                    <div key={i} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <p className="font-heading font-bold text-sm">{ex.name}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{ex.group}</p>
                      </div>
                      <p className="text-xs tabular-nums">
                        {ex.sets.length} × {ex.sets[0].reps} reps
                        {ex.sets[0].weight > 0 && ` @ ${ex.sets[0].weight} lb`}
                        <span className="text-muted-foreground"> · {Math.round(ex.restSec)}s rest</span>
                      </p>
                      {ex.note && (
                        <p className="text-[11px] text-muted-foreground mt-1 italic">{ex.note}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={handleGenerate} variant="outline" className="gap-2">
                    <RefreshCw className="w-4 h-4" />
                    {tFallback('generator.regenerate', 'Regenerate')}
                  </Button>
                  <Button onClick={handleUse} className="gap-2">
                    <Play className="w-4 h-4" />
                    {tFallback('generator.use', 'Use this')}
                  </Button>
                  {onSaveAsRegimen && (
                    <Button
                      onClick={handleSaveAsRegimen}
                      variant="secondary"
                      disabled={savingRegimen || savedAsRegimen}
                      className="col-span-2 gap-2"
                    >
                      {savingRegimen ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      {savedAsRegimen
                        ? tFallback('generator.savedAsRegimen', 'Saved ✓')
                        : tFallback('generator.saveAsRegimen', 'Save as Regimen')}
                    </Button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Pillset({ label, options, value, onChange }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              value === opt.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border text-foreground hover:border-primary/50 hover:bg-secondary'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
