// src/components/workout/ProgramTemplatePicker.jsx
//
// Card picker for the 6 canonical built-in programs. Tap a card →
// clones the template into the user's personal regimens row (with
// is_template=true + template_id set) → navigates to it. Removes
// the blank-slate friction that kills new-user activation.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { PROGRAM_TEMPLATES } from '@/lib/programTemplates';

// Cloning shape: a regimens row's `exercises` JSONB holds an array of
// session-objects. We mirror the template's shape but blank set values
// (weight/reps) so the user enters fresh numbers session-by-session.
function cloneTemplateExercises(template) {
  const out = [];
  for (const session of template.sessions || []) {
    for (const ex of session.exercises || []) {
      out.push({
        name:         ex.name,
        displayName:  ex.name,
        sets: Array.from({ length: ex.sets || 3 }, () => ({
          weight: null,
          reps:   null,
          reps_target: ex.reps_target ?? null,
        })),
      });
    }
  }
  return out;
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
      const { data, error } = await supabase
        .from('regimens')
        .insert({
          created_by:  user.email,
          user_id:     user.id,
          name:        template.name,
          description: template.summary,
          exercises:   cloneTemplateExercises(template),
          is_template: true,
          template_id: template.id,
        })
        .select('id')
        .single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['regimens', user.email] });
      toast.success(tFallback('programs.cloned', `${template.name} added — start training!`));
      onCreated?.(data?.id);
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
