// src/components/workout/ProgramTemplatePicker.jsx
//
// Card picker for the 6 canonical built-in programs. Tap a card →
// clones the template into the user's personal regimens row (with
// is_template=true + template_id set) → navigates to it. Removes
// the blank-slate friction that kills new-user activation.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Check } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { PROGRAM_TEMPLATES } from '@/lib/programTemplates';

// Clone ONE session/day of a program into a regimens-row `exercises`
// JSONB array. Each exercise carries BOTH:
//   - sets[]: an array with the prescribed set count, blank weight/reps,
//     and a per-set reps_target — startFromRegimen reads this to seed the
//     workout with the right number of sets + rep targets (Audit task 8).
//   - target_sets / target_reps: scalar mirrors so RegimenDetailView /
//     RegimenStorePage (which read the scalar fields) render "3 × 5".
// Multi-day programs previously flattened EVERY day into a single
// regimen; we now create one regimen per day instead (see handlePick).
function cloneSessionExercises(session) {
  return (session.exercises || []).map((ex) => {
    const setCount = ex.sets || 3;
    return {
      name:         ex.name,
      displayName:  ex.name,
      target_sets:  setCount,
      target_reps:  ex.reps_target ?? null,
      sets: Array.from({ length: setCount }, () => ({
        weight: null,
        reps:   null,
        reps_target: ex.reps_target ?? null,
      })),
    };
  });
}

function LevelBadge({ level }) {
  const palette = {
    beginner:     { bg: 'bg-emerald-500/15', text: 'text-emerald-500' },
    intermediate: { bg: 'bg-amber-500/15',   text: 'text-amber-500'   },
    advanced:     { bg: 'bg-rose-500/15',    text: 'text-rose-500'    },
  }[level] || { bg: 'bg-secondary', text: 'text-muted-foreground' };
  return (
    <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${palette.bg} ${palette.text}`}>
      {level}
    </span>
  );
}

export default function ProgramTemplatePicker({ onCreated }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(null);

  const handlePick = async (template) => {
    if (creating || !user?.id || !user?.email) return;
    setCreating(template.id);
    try {
      // One regimen row PER session/day. Programs are multi-day by nature
      // (Push/Pull/Legs, Workout A/B, …); flattening every day into a
      // single regimen produced an unusable mega-session. A single-session
      // template stays one regimen named after the program. (Audit task 8.)
      const sessions = Array.isArray(template.sessions) && template.sessions.length > 0
        ? template.sessions
        : [{ name: '', exercises: [] }];
      const rows = sessions.map((session) => ({
        created_by:  user.email,
        user_id:     user.id,
        name:        sessions.length > 1 && session.name
          ? `${template.name} — ${session.name}`
          : template.name,
        description: template.summary,
        exercises:   cloneSessionExercises(session),
        is_template: true,
        template_id: template.id,
      }));
      const { data, error } = await supabase
        .from('regimens')
        .insert(rows)
        .select('id');
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['regimens', user.email] });
      toast.success(tFallback('programs.cloned', `${template.name} added — start training!`));
      // Navigate to the first created day so the user lands somewhere useful.
      onCreated?.(data?.[0]?.id);
    } catch (err) {
      console.warn('[ProgramTemplatePicker] insert failed:', err);
      toast.error(tFallback('programs.cloneFailed', 'Could not create program — try again.'));
    } finally {
      setCreating(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="px-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
          {tFallback('programs.kicker', 'Built-in programs')}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {tFallback('programs.subtitle', 'Proven programming. Tap a card to get started.')}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PROGRAM_TEMPLATES.map((t) => {
          const isBusy = creating === t.id;
          return (
            <motion.button
              key={t.id}
              whileTap={{ scale: 0.98 }}
              onClick={() => handlePick(t)}
              disabled={!!creating}
              className="text-start p-3 rounded-2xl border border-border bg-card hover:bg-secondary/40 transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <h4 className="font-heading font-bold text-sm">{t.name}</h4>
                <LevelBadge level={t.level} />
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug mb-2">{t.tagline}</p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {t.days} {t.days === 1 ? 'day/wk' : 'days/wk'} · {t.sessions.length} sessions
                </span>
                <span className="text-[10px] font-bold text-primary inline-flex items-center gap-1">
                  {isBusy ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {tFallback('programs.adding', 'Adding…')}
                    </>
                  ) : (
                    <>
                      <Check className="w-3 h-3" />
                      {tFallback('programs.add', 'Add')}
                    </>
                  )}
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
