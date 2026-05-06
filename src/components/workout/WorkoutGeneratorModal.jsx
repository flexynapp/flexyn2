// src/components/workout/WorkoutGeneratorModal.jsx
//
// Picks parameters and generates a personalized workout via the AI generator.
// User can preview the result, regenerate, or load it into the workout form
// to start lifting.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, RefreshCw, Play } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import {
  generateWorkout,
  FOCUS_OPTIONS,
  EQUIPMENT_OPTIONS,
  DURATION_OPTIONS,
  SKILL_OPTIONS,
} from '@/lib/aiCoach/workoutGenerator';

export default function WorkoutGeneratorModal({ open, onClose, onUseWorkout, userProfile = {} }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const [focus, setFocus] = useState('full_body');
  const [duration, setDuration] = useState(45);
  const [equipment, setEquipment] = useState('gym');
  const [skill, setSkill] = useState('intermediate');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const workout = await generateWorkout({
        user,
        focus,
        durationMinutes: duration,
        equipment,
        skillLevel: skill,
        bodyweightLbs: Number(userProfile?.weight_lbs) || 165,
      });
      setResult(workout);
    } catch (err) {
      console.error('[generator] failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleUse = () => {
    if (!result || !onUseWorkout) return;
    onUseWorkout(result);
    onClose();
    setResult(null);
  };

  const handleClose = () => {
    onClose();
    setResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0">
        <div className="p-5 sm:p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary via-fuchsia-500 to-violet-500 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              {tFallback('generator.title', 'Generate Workout')}
            </DialogTitle>
          </DialogHeader>

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

                <div className="flex gap-2">
                  <Button onClick={handleGenerate} variant="outline" className="flex-1 gap-2">
                    <RefreshCw className="w-4 h-4" />
                    {tFallback('generator.regenerate', 'Regenerate')}
                  </Button>
                  <Button onClick={handleUse} className="flex-1 gap-2">
                    <Play className="w-4 h-4" />
                    {tFallback('generator.use', 'Use this')}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
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
