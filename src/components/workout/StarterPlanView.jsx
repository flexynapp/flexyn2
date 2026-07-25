// src/components/workout/StarterPlanView.jsx
//
// Explorable, sectioned view of a starter regimen. Groups exercises into
// collapsible "Cardio Plan" and "Strength Plan" dropdowns; cardio items show
// their real session detail (distance / pace / intervals), strength items show
// sets × reps + the muscles worked. Used by the onboarding reveal and the
// Workout-page starter hero so the "plan" reads like a plan, not a flat list.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Dumbbell, Footprints } from 'lucide-react';

const CARDIO_MODALITIES = new Set(['Running', 'Cycling', 'Jump Rope', 'Rowing']);
const isCardio = (ex) => ex?.kind === 'cardio' || CARDIO_MODALITIES.has(ex?.name);

function Section({ title, subtitle, Icon, hue, items, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!items.length) return null;
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-start"
      >
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `hsl(${hue} / 0.14)`, color: `hsl(${hue})` }}
        >
          <Icon className="w-[18px] h-[18px]" strokeWidth={2.2} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-heading font-bold text-[15px] leading-tight">{title}</span>
          <span className="block text-[11px] text-muted-foreground mt-0.5">{subtitle}</span>
        </span>
        <span
          className="text-[11px] font-bold tabular-nums rounded-full px-2 py-0.5 me-1"
          style={{ background: `hsl(${hue} / 0.12)`, color: `hsl(${hue})` }}
        >
          {items.length}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-muted-foreground shrink-0">
          <ChevronDown className="w-4 h-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-2.5 pb-2.5 space-y-1.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function StarterPlanView({ regimen, cardioDefaultOpen = true, strengthDefaultOpen = true }) {
  const exercises = Array.isArray(regimen?.exercises) ? regimen.exercises : [];
  const cardio = exercises.filter(isCardio);
  const strength = exercises.filter((e) => !isCardio(e));

  return (
    <div className="space-y-2.5">
      <Section
        title="Cardio Plan"
        subtitle={`${cardio.length} running session${cardio.length === 1 ? '' : 's'} / week`}
        Icon={Footprints}
        hue="217 91% 60%"
        items={cardio}
        defaultOpen={cardioDefaultOpen}
      >
        {cardio.map((ex, i) => (
          <div key={`c-${i}`} className="flex items-center gap-3 rounded-xl bg-secondary/40 px-3 py-2.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'hsl(217 91% 60%)' }} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[13px] leading-tight truncate">{ex.displayName || ex.name}</p>
              {ex.detail && <p className="text-[11px] text-muted-foreground mt-0.5">{ex.detail}</p>}
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="Strength Plan"
        subtitle={`${strength.length} lift${strength.length === 1 ? '' : 's'}`}
        Icon={Dumbbell}
        hue="26 95% 56%"
        items={strength}
        defaultOpen={strengthDefaultOpen}
      >
        {strength.map((ex, i) => (
          <div key={`s-${i}`} className="flex items-center gap-3 rounded-xl bg-secondary/40 px-3 py-2.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'hsl(26 95% 56%)' }} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[13px] leading-tight truncate">{ex.displayName || ex.name}</p>
              {Array.isArray(ex.muscle_groups) && ex.muscle_groups.length > 0 && (
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{ex.muscle_groups.slice(0, 3).join(' · ')}</p>
              )}
            </div>
            <span className="font-mono text-[11px] font-bold text-foreground/70 shrink-0 tabular-nums">
              {ex.target_sets} × {ex.target_reps}
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}
