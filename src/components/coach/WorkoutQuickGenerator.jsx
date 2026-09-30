// src/components/coach/WorkoutQuickGenerator.jsx
//
// Tap-only workout generator — the "Quick pick" tab of the generate surface,
// for users who'd rather pick pills than type a goal into the chat. Pick a
// TYPE (Strength / Cardio / HIIT) and the relevant options, and it builds a
// session. Reuses CoachPlanCard so Save / Start behave exactly like the chat.

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Sparkles, RefreshCw, Dumbbell, Footprints, Flame } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as cycleLogs from '@/lib/data/cycleLogs';
import { computeCycleState } from '@/lib/cyclePhase';
import { buildTrainingModifiers, FEEL_OPTIONS, profileAge } from '@/lib/aiCoach/trainingModifiers';
import { loadRestrictions } from '@/lib/nutritionPlans';
import { listActiveInjuries, getExcludedMuscleGroups } from '@/lib/data/injuries';
import {
  generateWorkout,
  FOCUS_OPTIONS,
  EQUIPMENT_OPTIONS,
  DURATION_OPTIONS,
  SKILL_OPTIONS,
} from '@/lib/aiCoach/workoutGenerator';
import { sessionToPlan, buildCardioSession, buildHiitSession, CARDIO_STYLES } from '@/lib/aiCoach/planBuilder';
import CoachPlanCard from '@/components/coach/CoachPlanCard';
import { reportError } from '@/lib/reportError';

const TYPE_OPTIONS = [
  { id: 'strength', label: 'Strength', Icon: Dumbbell },
  { id: 'cardio',   label: 'Cardio',   Icon: Footprints },
  { id: 'hiit',     label: 'HIIT',     Icon: Flame },
];

export default function WorkoutQuickGenerator({ userProfile = {}, onSaveRegimen, onStartWorkout }) {
  const { user } = useAuth();
  const { tFallback, language } = useLanguage();
  const [type, setType] = useState('strength');
  const [focus, setFocus] = useState('full_body');
  const [cardioStyle, setCardioStyle] = useState('easy');
  // Start from what the user told onboarding (mig 384) when it is one of
  // this picker's own options; otherwise the old 45 min / full gym.
  const [duration, setDuration] = useState(
    () => DURATION_OPTIONS.some(o => o.id === userProfile?.session_minutes) ? userProfile.session_minutes : 45,
  );
  const [equipment, setEquipment] = useState(
    () => EQUIPMENT_OPTIONS.some(o => o.id === userProfile?.training_equipment) ? userProfile.training_equipment : 'gym',
  );
  const [skill, setSkill] = useState('intermediate');
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState(null);
  // Optional daily check-in. Null = not answered, in which case the cycle
  // phase (if any) supplies a much smaller nudge on its own.
  const [feel, setFeel] = useState(null);

  // Cycle context is STRICTLY opt-in: the query only runs when the profile
  // flag is on, so for everyone else no cycle data is read and the generator
  // receives no phase at all.
  const cycleEnabled = !!userProfile?.cycle_tracking_enabled;
  const { data: cycleRows = [] } = useQuery({
    queryKey: ['cycleLogs', user?.id],
    queryFn:  () => cycleLogs.listMine(user.id),
    enabled:  !!user?.id && cycleEnabled,
    staleTime: 5 * 60_000,
  });
  const cycleState = cycleEnabled && cycleRows.length > 0
    ? computeCycleState(cycleRows.map(r => r.start_date), userProfile?.cycle_length_days)
    : null;

  // Active injuries. generateWorkout has always accepted excludeMuscleGroups
  // and injuries.js has always exported getExcludedMuscleGroups (synergists
  // and all), but nothing ever connected them — so a user with a logged
  // shoulder injury was still handed Overhead Press. This is the wire.
  // ['injuries','active',uid] — the key InjuryForm's mutations invalidate by
  // prefix. Under the old ['activeInjuries', uid] nothing invalidated it, so a
  // just-logged injury did not reach the generator until the staleTime expired.
  const { data: activeInjuries = [] } = useQuery({
    queryKey: ['injuries', 'active', user?.id],
    queryFn:  () => listActiveInjuries(),
    enabled:  !!user?.id,
    staleTime: 5 * 60_000,
  });

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const bodyweightLbs = Number(userProfile?.weight_lbs) || 165;
      // Computed ONCE, above the branch. These used to live inside the
      // strength `else`, so the HIIT branch generated with none of them —
      // an injured user got a full-body circuit that could program the group
      // they reported hurt, which is the exact defect the comment above says
      // this wiring exists to prevent. Cardio takes none of it: it builds a
      // fixed cardio block rather than selecting exercises.
      const modifiers = buildTrainingModifiers({
        cycleState,
        feel,
        goal:          userProfile?.fitness_goals_arr || userProfile?.fitness_goals,
        nutritionGoal: userProfile?.nutrition_goal,
        weeklyRateLbs: userProfile?.weekly_rate_lbs,
        age:           profileAge(userProfile),
        // Allergies + dietary restrictions, so a fuel suggestion never names
        // something the user can't eat. loadRestrictions falls back to the
        // localStorage copy when the profile column isn't populated.
        restrictions:  loadRestrictions(userProfile),
        // The plan notes render on CoachPlanCard, so they have to speak the
        // user's language. `tFallback` has exactly the signature the pure
        // modules expect — see coachI18n.js.
        t: tFallback,
        language,
      });
      const excludeMuscleGroups = getExcludedMuscleGroups(activeInjuries);
      const demographics = {
        gender:        userProfile?.gender,
        age:           profileAge(userProfile),
        activityLevel: userProfile?.activity_level,
      };

      let next;
      if (type === 'cardio') {
        next = buildCardioSession({ style: cardioStyle, durationMinutes: duration, skillLevel: skill });
      } else if (type === 'hiit') {
        next = await buildHiitSession({
          user, durationMinutes: duration, equipment, skillLevel: skill, bodyweightLbs,
          excludeMuscleGroups, modifiers, demographics,
        });
      } else {
        const workout = await generateWorkout({
          user, focus, durationMinutes: duration, equipment, skillLevel: skill, bodyweightLbs, seed: Date.now(),
          modifiers, excludeMuscleGroups, demographics,
        });
        next = sessionToPlan(workout);
      }
      setPlan(next);
    } catch (err) {
      reportError(err, { feature: 'coach.quick-generate' });
      toast.error(tFallback('notice.generateFailed', "Couldn't build the workout. Try again."));
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
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-secondary text-foreground font-semibold text-sm py-2.5 hover:bg-secondary/80 active:bg-secondary/80 transition-colors"
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
                : 'bg-background border-border text-foreground hover:border-primary/50 hover:bg-secondary active:bg-secondary'
            }`}
          >
            <Icon className="w-4 h-4" />
            {tFallback(`generator.type.${id}`, label)}
          </button>
        ))}
      </div>

      {/* Contextual options */}
      {type === 'strength' && (
        <Pillset label={tFallback('generator.focus', 'Focus')} options={FOCUS_OPTIONS} value={focus} onChange={setFocus} keyPrefix="routines.focus." />
      )}
      {isCardio && (
        <Pillset label={tFallback('generator.style', 'Style')} options={CARDIO_STYLES} value={cardioStyle} onChange={setCardioStyle} keyPrefix="coach.cardioStyle." />
      )}

      <Pillset label={tFallback('generator.duration', 'Duration')} options={DURATION_OPTIONS} value={duration} onChange={setDuration} keyPrefix="generator.duration." />

      {!isCardio && (
        <Pillset label={tFallback('generator.equipment', 'Equipment')} options={EQUIPMENT_OPTIONS} value={equipment} onChange={setEquipment} keyPrefix="generator.equipment." />
      )}

      <Pillset label={tFallback('generator.skill', 'Experience')} options={SKILL_OPTIONS} value={skill} onChange={setSkill} keyPrefix="generator.skill." />

      {/* Daily check-in. Optional and tappable-off. This is the signal the
          research actually supports — what you report today beats what a
          predicted cycle phase says about you, so answering it overrides the
          phase nudge entirely. Shown for everyone, not just cycle trackers. */}
      {!isCardio && (
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {tFallback('generator.feel', 'How do you feel today?')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {FEEL_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={feel === opt.id}
                title={tFallback(opt.hintKey, opt.hint)}
                onClick={() => setFeel(feel === opt.id ? null : opt.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  feel === opt.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border text-foreground hover:border-primary/50 hover:bg-secondary active:bg-secondary'
                }`}
              >
                <span aria-hidden="true">{opt.emoji}</span> {tFallback(opt.labelKey, opt.label)}
              </button>
            ))}
          </div>
          {cycleState && !feel && (
            <p className="text-micro text-muted-foreground mt-1.5 leading-snug">
              {cycleState.phaseMeta.emoji} {cycleState.phaseMeta.label} phase · day {cycleState.dayOfCycle}.
              {' '}{tFallback('generator.feelOverride', 'Answer above and it will use that instead.')}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        className="w-full mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm py-3 transition-opacity active:opacity-80"
      >
        <Sparkles className="w-4 h-4" />
        {tFallback('generator.generate', 'Generate')}
      </button>
      <p className="text-micro text-muted-foreground mt-3 text-center leading-relaxed">
        {isCardio
          ? tFallback('generator.cardioNote', 'Saves to your Regimens. Run it live from the Cardio tab.')
          : isHiit
            ? tFallback('generator.hiitNote', 'A minimal-rest circuit. Start it live or save it to repeat.')
            : tFallback('generator.disclaimer', 'Personalized using your last 60 days of workout history. Not a substitute for a coach if you have injuries or special needs.')}
      </p>
    </div>
  );
}

function Pillset({ label, options, value, onChange, keyPrefix }) {
  const { tFallback } = useLanguage();
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
                : 'bg-background border-border text-foreground hover:border-primary/50 hover:bg-secondary active:bg-secondary'
            }`}
          >
            {keyPrefix ? tFallback(`${keyPrefix}${opt.id}`, opt.label) : opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
