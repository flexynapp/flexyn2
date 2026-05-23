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
import { startOfDay, parseISO } from 'date-fns';

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

  const todaysPlan = useMemo(() => {
    if (!regimens.length) return null;
    // Only useful if there are at least 2 distinct regimens (a rotation)
    const active = regimens.filter(r => !r.archived);
    if (active.length < 2) return null;

    const today = startOfDay(new Date()).getTime();
    const parseLocalDate = (s) => {
      if (!s) return null;
      const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      try { return parseISO(s); } catch { return null; }
    };

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
    const due = scored[0].regimen;

    // If it was used today, it's actually done
    const dueLastTs = scored[0].last;
    const doneToday = dueLastTs >= today;

    return { regimen: due, doneToday, info: inferDayLabel(due) };
  }, [regimens, logs]);

  if (!todaysPlan) return null;

  const { regimen, doneToday, info } = todaysPlan;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="overflow-hidden border-border/60">
        <button
          onClick={() => navigate('/workout', { state: { selectedRegimenId: regimen.id } })}
          className="w-full text-start px-4 py-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors"
        >
          <div className={`shrink-0 w-9 h-9 rounded-full ${info.bg} flex items-center justify-center text-base`}>
            {doneToday ? <CheckCircle2 className={`w-4.5 h-4.5 ${info.color}`} /> : info.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-[0.18em] ${info.color}`}>
                {doneToday ? 'Completed ✓' : "Today's Plan"}
              </span>
            </div>
            <p className="text-sm font-heading font-bold leading-tight mt-0.5">
              {doneToday ? `${info.emoji} ${info.label} — done!` : `${info.emoji} ${info.label}`}
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 truncate">
              {regimen.name}{regimen.exercises?.length ? ` · ${regimen.exercises.length} exercises` : ''}
            </p>
          </div>
          {!doneToday && (
            <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </Card>
    </motion.div>
  );
}
