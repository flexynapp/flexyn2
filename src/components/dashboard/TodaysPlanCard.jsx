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

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { startOfDay } from 'date-fns';
import { parseLocalDate } from '@/lib/dateUtils';
import { useLanguage } from '@/lib/LanguageContext';

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

// Infer a short label for a regimen from its name + exercises
function inferDayLabel(regimen) {
  const name = (regimen.name || '').toLowerCase();
  // First try the regimen name — common patterns
  if (/push/i.test(name))       return { label: 'Push Day', emoji: '💪', color: 'text-orange-500', bg: 'bg-orange-500/10' };
  if (/pull/i.test(name))       return { label: 'Pull Day', emoji: '🔱', color: 'text-blue-500',   bg: 'bg-blue-500/10' };
  if (/leg/i.test(name))        return { label: 'Legs Day', emoji: '🦵', color: 'text-green-500',  bg: 'bg-green-500/10' };
  if (/upper/i.test(name))      return { label: 'Upper Body', emoji: '💪', color: 'text-violet-500', bg: 'bg-violet-500/10' };
  if (/lower/i.test(name))      return { label: 'Lower Body', emoji: '🦵', color: 'text-emerald-500', bg: 'bg-emerald-500/10' };
  if (/chest/i.test(name))      return { label: 'Chest Day', emoji: '🏋️', color: 'text-orange-500', bg: 'bg-orange-500/10' };
  if (/back/i.test(name))       return { label: 'Back Day', emoji: '🔱', color: 'text-blue-500',   bg: 'bg-blue-500/10' };
  if (/shoulder/i.test(name))   return { label: 'Shoulder Day', emoji: '🪨', color: 'text-amber-500', bg: 'bg-amber-500/10' };
  if (/arm/i.test(name))        return { label: 'Arms Day', emoji: '💪', color: 'text-rose-500',   bg: 'bg-rose-500/10' };
  if (/cardio/i.test(name))     return { label: 'Cardio Day', emoji: '🏃', color: 'text-cyan-500',  bg: 'bg-cyan-500/10' };
  if (/core|ab/i.test(name))    return { label: 'Core Day', emoji: '🎯', color: 'text-primary',    bg: 'bg-primary/10' };
  if (/full|total/i.test(name)) return { label: 'Full Body', emoji: '⚡', color: 'text-primary',   bg: 'bg-primary/10' };

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
  if (mapped === 'Push') return { label: 'Push Day', emoji: '💪', color: 'text-orange-500', bg: 'bg-orange-500/10' };
  if (mapped === 'Pull') return { label: 'Pull Day', emoji: '🔱', color: 'text-blue-500',   bg: 'bg-blue-500/10' };
  if (mapped === 'Legs') return { label: 'Legs Day', emoji: '🦵', color: 'text-green-500',  bg: 'bg-green-500/10' };

  return { label: regimen.name || 'Workout Day', emoji: '🏋️', color: 'text-primary', bg: 'bg-primary/10' };
}

export default function TodaysPlanCard({ regimens = [], logs = [], hasWorkedOutToday = false }) {
  const navigate = useNavigate();
  const { tFallback } = useLanguage();

  const todaysPlan = useMemo(() => {
    if (!regimens.length) return null;
    // Only useful if there are at least 2 distinct regimens (a rotation)
    const active = regimens.filter(r => !r.archived);
    if (active.length < 2) return null;

    const today = startOfDay(new Date()).getTime();

    // parseLocalDate now comes from @/lib/dateUtils (shared helper) —
    // previously this component re-implemented the function inline,
    // which would drift from the canonical version over time.

    // Build a map: regimenName → last date used
    const lastUsed = {};
    logs.forEach(log => {
      const name = log.regimen_name;
      if (!name) return;
      const d = parseLocalDate(log.date);
      if (!d || isNaN(d.getTime())) return;
      const ts = d.getTime();
      if (!lastUsed[name] || ts > lastUsed[name]) lastUsed[name] = ts;
    });

    // Match log regimen names to regimen objects (fuzzy)
    const scored = active.map(r => ({
      regimen: r,
      last: lastUsed[r.name] ?? 0,
    }));

    // The regimen due next = the one used least recently
    // (or never used, which means it's definitely due)
    scored.sort((a, b) => a.last - b.last);
    // Defensive — early returns above ensure `active.length >= 2`, so
    // `scored[0]` is always defined under normal flow. Guard anyway
    // for the corrupt-data case where `active.map(...)` returns rows
    // without a `regimen` field (e.g. a future schema change). Bailing
    // here is better than rendering undefined.regimen down the tree.
    const top = scored[0];
    if (!top || !top.regimen) return null;
    const due = top.regimen;
    const dueLastTs = Number.isFinite(top.last) ? top.last : 0;
    const doneToday = dueLastTs >= today;

    return { regimen: due, doneToday, info: inferDayLabel(due) };
  }, [regimens, logs]);

  if (!todaysPlan) return null;

  const { regimen, doneToday, info } = todaysPlan;
  // Translate the inferred day label via a slug derived from the
  // English fallback ("Push Day" → "push-day"). Translators fill the
  // `todaysPlan.label.*` keys in i18n part files; English-only users
  // get the inline fallback so the surface never shows a key code.
  const labelSlug = (info.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const translatedLabel = tFallback(`todaysPlan.label.${labelSlug}`, info.label);
  const exerciseCount = regimen.exercises?.length || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="overflow-hidden border-border/60">
        <button
          onClick={() => navigate('/workout', { state: { selectedRegimenId: regimen.id } })}
          className="w-full text-start px-3 py-2 flex items-center gap-2.5 hover:bg-secondary/40 transition-colors"
        >
          <div className={`shrink-0 w-7 h-7 rounded-full ${info.bg} flex items-center justify-center text-sm`}>
            {doneToday ? <CheckCircle2 className={`w-3.5 h-3.5 ${info.color}`} /> : info.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-[9px] font-bold uppercase tracking-[0.16em] ${info.color}`}>
                {doneToday
                  ? tFallback('todaysPlan.completed', 'Completed ✓')
                  : tFallback('todaysPlan.kicker', "Today's Plan")}
              </span>
            </div>
            <p className="text-xs font-heading font-bold leading-tight mt-0.5 truncate">
              {doneToday
                ? `${info.emoji} ${tFallback('todaysPlan.doneFmt', '{label} — done!', { label: translatedLabel })}`
                : `${info.emoji} ${translatedLabel}`}
            </p>
            <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 truncate">
              {regimen.name}
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
      </Card>
    </motion.div>
  );
}
