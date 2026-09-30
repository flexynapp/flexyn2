// src/components/dashboard/TodaysPlanCard.jsx
//
// "Today is your Pull day" — infers today's scheduled workout from the
// user's regimen rotation. Uses workout log history to determine which
// regimen in a multi-regimen split is due next.
//
// Renders null when:
//   - User has no regimens
//   - User has only 1 regimen (no rotation to infer)
//   - User already worked out today (done state instead)

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import {
  ArrowRight, CheckCircle2, ChevronDown,
  Dumbbell, Grip, Footprints, Mountain, HeartPulse, Target, Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/lib/LanguageContext';
import { translateExerciseName } from '@/lib/exerciseTranslations';
import ExerciseFormPanel from '@/components/exercise/ExerciseFormPanel';
import { findDueRegimen } from '@/lib/todaysPlan';
import { cardioSessionName, cardioSessionSummary, starterPlanName } from '@/lib/starterPlanText';

// Map exercise muscle groups → plan day label
const MUSCLE_TO_LABEL = {
  chest:      'Push',
  triceps:    'Push',
  shoulders:  'Push',
  back:       'Pull',
  biceps:     'Pull',
  lats:       'Pull',
  traps:      'Pull',
  legs:       'Legs',
  quads:      'Legs',
  hamstrings: 'Legs',
  glutes:     'Legs',
  calves:     'Legs',
  core:       'Core',
  abs:        'Core',
  full:       'Full Body',
};

// Infer a short label for a regimen from its name + exercises.
//
// These used to carry an `emoji` (💪 🔱 🦵 🏋️ 🪨 🏃 🎯 ⚡) rendered as the
// card's icon. Emoji-as-iconography is one of the loudest generated-UI
// tells and it's also just worse: glyphs render differently on every OS,
// ignore `currentColor` so they can't take the accent, ignore font
// weight, and sit on their own baseline. Lucide icons inherit all of it.
//
// The colour assignments were also arbitrary — Arms Day was
// text-destructive, i.e. "danger", for no reason. Colour now tracks the
// budget's meaning: primary for pressing/effort work, info for the
// pulling and cardio days, success for lower body.
function inferDayLabel(regimen) {
  const name = (regimen.name || '').toLowerCase();
  // First try the regimen name — common patterns
  if (/push/i.test(name))       return { label: 'Push Day', Icon: Dumbbell, color: 'text-primary', bg: 'bg-primary/10' };
  if (/pull/i.test(name))       return { label: 'Pull Day', Icon: Grip, color: 'text-info',   bg: 'bg-info/10' };
  if (/leg/i.test(name))        return { label: 'Legs Day', Icon: Footprints, color: 'text-success',  bg: 'bg-success/10' };
  if (/upper/i.test(name))      return { label: 'Upper Body', Icon: Dumbbell, color: 'text-primary', bg: 'bg-primary/10' };
  if (/lower/i.test(name))      return { label: 'Lower Body', Icon: Footprints, color: 'text-success', bg: 'bg-success/10' };
  if (/chest/i.test(name))      return { label: 'Chest Day', Icon: Dumbbell, color: 'text-primary', bg: 'bg-primary/10' };
  if (/back/i.test(name))       return { label: 'Back Day', Icon: Grip, color: 'text-info',   bg: 'bg-info/10' };
  if (/shoulder/i.test(name))   return { label: 'Shoulder Day', Icon: Mountain, color: 'text-primary', bg: 'bg-primary/10' };
  if (/arm/i.test(name))        return { label: 'Arms Day', Icon: Dumbbell, color: 'text-primary',   bg: 'bg-primary/10' };
  if (/cardio/i.test(name))     return { label: 'Cardio Day', Icon: HeartPulse, color: 'text-info',  bg: 'bg-info/10' };
  if (/core|ab/i.test(name))    return { label: 'Core Day', Icon: Target, color: 'text-primary',    bg: 'bg-primary/10' };
  if (/full|total/i.test(name)) return { label: 'Full Body', Icon: Zap, color: 'text-primary',   bg: 'bg-primary/10' };

  // Fall back to dominant muscle group from exercises
  const muscles = (regimen.exercises || []).flatMap(ex =>
    ex.muscle_groups?.length ? ex.muscle_groups : (ex.muscle_group ? [ex.muscle_group] : [])
  );
  const freq = {};
  muscles.forEach(m => {
    const key = m.toLowerCase();
    freq[key] = (freq[key] || 0) + 1;
  });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
  const mapped = MUSCLE_TO_LABEL[top];
  if (mapped === 'Push') return { label: 'Push Day', Icon: Dumbbell, color: 'text-primary', bg: 'bg-primary/10' };
  if (mapped === 'Pull') return { label: 'Pull Day', Icon: Grip, color: 'text-info',   bg: 'bg-info/10' };
  if (mapped === 'Legs') return { label: 'Legs Day', Icon: Footprints, color: 'text-success',  bg: 'bg-success/10' };

  return { label: regimen.name || 'Workout Day', Icon: Dumbbell, color: 'text-primary', bg: 'bg-primary/10' };
}

export default function TodaysPlanCard({ regimens = [], logs = [], hasWorkedOutToday = false }) {
  const navigate = useNavigate();
  const { tFallback, language } = useLanguage();
  const [listOpen, setListOpen] = useState(false);

  const todaysPlan = useMemo(() => {
    const due = findDueRegimen(regimens, logs);
    return due ? { ...due, info: inferDayLabel(due.regimen) } : null;
  }, [regimens, logs]);

  if (!todaysPlan) return null;

  const { regimen, doneToday, info } = todaysPlan;
  // Translate the inferred day label via a slug derived from the
  // English fallback ("Push Day" → "push_day"). The fallback branch of
  // inferDayLabel returns the REGIMEN'S OWN NAME, which is user data — its
  // slug matches no key, tFallback returns it untouched, and that is right.
  //
  // UNDERSCORE, not hyphen. Every key scan in this repo matches [\w.]+, so
  // `todaysPlan.label.push-day` would be invisible to the audit — which is
  // exactly how these thirteen keys went missing: the lookup shipped, the
  // keys never did, and nothing could see it because a computed key cannot
  // be checked statically either.
  const labelSlug = (info.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
  const translatedLabel = tFallback(`todaysPlan.label.${labelSlug}`, info.label);
  const exercises = Array.isArray(regimen.exercises) ? regimen.exercises : [];
  const exerciseCount = exercises.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <Card className="overflow-hidden border-border/60">
        <button
          onClick={() => navigate('/workout', { state: { startRegimen: regimen } })}
          className="w-full text-start px-3 py-2 flex items-center gap-2.5 hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
        >
          <div className={`shrink-0 w-7 h-7 rounded-full ${info.bg} flex items-center justify-center`}>
            {doneToday
              ? <CheckCircle2 className={`w-3.5 h-3.5 ${info.color}`} />
              : <info.Icon className={`w-3.5 h-3.5 ${info.color}`} aria-hidden="true" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {/* Was 'Completed ✓' — the glyph duplicated the CheckCircle2
                  already showing in the badge to its left, and baked a
                  symbol into a translatable string. */}
              <span className={`text-micro font-bold tracking-[0.1em] ${info.color}`}>
                {doneToday
                  ? tFallback('todaysPlan.completed', 'Completed')
                  : tFallback('todaysPlan.kicker', "Today's Plan")}
              </span>
            </div>
            {/* The label used to be prefixed with the same emoji that the
                badge renders — the icon said it once, the text said it
                again. The badge carries it now. */}
            <p className="text-xs font-heading font-bold leading-tight mt-0.5 truncate">
              {doneToday
                ? tFallback('todaysPlan.doneFmt', '{label}, done!', { label: translatedLabel })
                : translatedLabel}
            </p>
            <p className="text-micro text-muted-foreground leading-snug mt-0.5 truncate">
              {starterPlanName(regimen.name, tFallback)}
              {exerciseCount > 0 && ` · ${exerciseCount} ${tFallback(
                exerciseCount === 1 ? 'todaysPlan.exerciseOne' : 'todaysPlan.exerciseMany',
                exerciseCount === 1 ? 'exercise' : 'exercises'
              )}`}
            </p>
          </div>
          {!doneToday && (
            <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground rtl:scale-x-[-1]" />
          )}
        </button>

        {/* What's actually in today's session, and how to do it.

            A SIBLING of the navigation button, never a child of it — the row
            above is one big <button>, and nesting the disclosure inside it
            would be invalid HTML and would swallow the tap into a navigation.

            Collapsed by default, so the widget's resting height grows by one
            32px row and nothing else. This is a dashboard widget whose job is
            to be glanceable; the exercise list is a second question ("what am
            I actually doing?") that only the person asking it should pay for.
            The count in the line above is what makes the disclosure worth
            opening, so it stays the summary. */}
        {exercises.length > 0 && (
          <div className="border-t border-border/60">
            <button
              type="button"
              onClick={() => setListOpen((o) => !o)}
              aria-expanded={listOpen}
              className="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
            >
              <span className="flex-1 min-w-0 text-micro font-semibold text-muted-foreground">
                {tFallback('todaysPlan.whatsInIt', "What's in it")}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform ${listOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {listOpen && (
              // Hairline dividers, not a card per exercise. These are
              // read-only rows inside a widget shell, and the house rule is
              // that a card marks a discrete user-arranged object — nesting
              // one per lift here would be a card in a card.
              <ul className="px-3 pb-2.5 divide-y divide-border/40">
                {exercises.map((ex, i) => (
                  <li key={i} className="py-2 first:pt-0">
                    <div className="flex items-baseline gap-2">
                      <span className="flex-1 min-w-0 text-label font-semibold truncate">
                        {ex.kind === 'cardio'
                          ? cardioSessionName(ex, tFallback)
                          : (ex.displayName || translateExerciseName(ex.name, language))}
                      </span>
                      {ex.kind === 'cardio' ? (
                        (ex.session || ex.detail) && (
                          <span className="shrink-0 font-mono text-micro font-bold tabular-nums text-muted-foreground">
                            {cardioSessionSummary(ex, tFallback, language)}
                          </span>
                        )
                      ) : ex.target_sets > 0 && ex.target_reps > 0 && (
                        <span className="shrink-0 font-mono text-micro font-bold tabular-nums text-muted-foreground">
                          {ex.target_sets} × {ex.target_reps}
                        </span>
                      )}
                    </div>
                    <ExerciseFormPanel
                      exerciseName={ex.name || ex.displayName}
                      className="mt-1.5"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
