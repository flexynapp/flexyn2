// src/components/coach/WorkoutQuickGenerator.jsx
//
// Tap-only workout generator — the "Quick pick" tab of the generate surface,
// for users who'd rather pick pills than type a goal into the chat. Pick a
// TYPE (Strength / Cardio / HIIT) and the relevant options, and it builds a
// session. Reuses CoachPlanCard so Save / Start behave exactly like the chat.

import React, { useState } from 'react';
import { Loader2, Sparkles, RefreshCw, Dumbbell, Footprints, Flame } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import {
  generateWorkout,
  FOCUS_OPTIONS,
  EQUIPMENT_OPTIONS,
  DURATION_OPTIONS,
  SKILL_OPTIONS,
} from '@/lib/aiCoach/workoutGenerator';
import { sessionToPlan, buildCardioSession, buildHiitSession, CARDIO_STYLES } from '@/lib/aiCoach/planBuilder';
import CoachPlanCard from '@/components/coach/CoachPlanCard';

const TYPE_OPTIONS = [
  { id: 'strength', label: 'Strength', Icon: Dumbbell },
  { id: 'cardio',   label: 'Cardio',   Icon: Footprints },
  { id: 'hiit',     label: 'HIIT',     Icon: Flame },
];

export default function WorkoutQuickGenerator({ userProfile = {}, onSaveRegimen, onStartWorkout }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const [type, setType] = useState('strength');
  const [focus, setFocus] = useState('full_body');
  const [cardioStyle, setCardioStyle] = useState('easy');
  const [duration, setDuration] = useState(45);
  const [equipment, setEquipment] = useState('gym');
  const [skill, setSkill] = useState('intermediate');
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const bodyweightLbs = Number(userProfile?.weight_lbs) || 165;
      let next;
      if (type === 'cardio') {
        next = buildCardioSession({ style: cardioStyle, durationMinutes: duration, skillLevel: skill });
      } else if (type === 'hiit') {
        next = await buildHiitSession({ user, durationMinutes: duration, equipment, skillLevel: skill, bodyweightLbs });
      } else {
        const workout = await generateWorkout({
          user, focus, durationMinutes: duration, equipment, skillLevel: skill, bodyweightLbs, seed: Date.now(),
        });
        next = sessionToPlan(workout);
      }
      setPlan(next);
    } catch (err) {
      toast.error(`Couldn't generate — ${err?.message || 'try again'}`);
    } finally {
      setGenerating(false);
    }
  };

  if (generating) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-9 h-9 animate-spin text-primary mb-3" />
        <p className="font-heading font-semibold text-sm">
          {tFallback('generator.thinking', 'Building your workout…')}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {tFallback('generator.thinkingDesc', 'Reading your training history.')}
        </p>
      </div>
    );
  }

  if (plan) {
    return (
      <div className="pt-1">
        <CoachPlanCard plan={plan} onSaveRegimen={onSaveRegimen} onStartWorkout={onStartWorkout} />
        <button
          type="button"
          onClick={() => setPlan(null)}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-secondary text-foreground font-semibold text-sm py-2.5 hover:bg-secondary/80 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {tFallback('generator.tweak', 'Change picks')}
        </button>
      </div>
    );
  }

  const isCardio = type === 'cardio';
  const isHiit = type === 'hiit';

  return (
    <div className="pt-1">
      {/* Type */}
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {tFallback('generator.type', 'Type')}
      </p>
      <div className="flex gap-1.5 mb-4">
        {TYPE_OPTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setType(id)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-semibold transition-all ${
              type === id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border text-foreground hover:border-primary/50 hover:bg-secondary'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Contextual options */}
      {type === 'strength' && (
        <Pillset label={tFallback('generator.focus', 'Focus')} options={FOCUS_OPTIONS} value={focus} onChange={setFocus} />
      )}
      {isCardio && (
        <Pillset label={tFallback('generator.style', 'Style')} options={CARDIO_STYLES} value={cardioStyle} onChange={setCardioStyle} />
      )}

      <Pillset label={tFallback('generator.duration', 'Duration')} options={DURATION_OPTIONS} value={duration} onChange={setDuration} />

      {!isCardio && (
        <Pillset label={tFallback('generator.equipment', 'Equipment')} options={EQUIPMENT_OPTIONS} value={equipment} onChange={setEquipment} />
      )}

      <Pillset label={tFallback('generator.skill', 'Experience')} options={SKILL_OPTIONS} value={skill} onChange={setSkill} />

      <button
        type="button"
        onClick={handleGenerate}
        className="w-full mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm py-3 transition-opacity active:opacity-80"
      >
        <Sparkles className="w-4 h-4" />
        {tFallback('generator.generate', 'Generate')}
      </button>
      <p className="text-[11px] text-muted-foreground mt-3 text-center leading-relaxed">
        {isCardio
          ? tFallback('generator.cardioNote', 'Saves to your Regimens — run it live from the Cardio tab.')
          : isHiit
            ? tFallback('generator.hiitNote', 'A minimal-rest circuit. Start it live or save it to repeat.')
            : tFallback('generator.disclaimer', 'Personalized using your last 60 days of workout history. Not a substitute for a coach if you have injuries or special needs.')}
      </p>
    </div>
  );
}

function Pillset({ label, options, value, onChange }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
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
