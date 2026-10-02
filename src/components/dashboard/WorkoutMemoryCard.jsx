// src/components/dashboard/WorkoutMemoryCard.jsx
//
// "This day last year" memory card on the Dashboard. Surfaces a
// historical workout from the same calendar day in a past year so
// returning users feel their progress over time. Strava + Instagram
// have demonstrated this pattern; it's evergreen delight without
// requiring the user to seek anything out.
//
// Per-user, per-day localStorage dismissal so we don't re-show on
// every refresh. Self-hides when no historical match for today.

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Calendar, X, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { findWorkoutMemory, summarizeMemoryLog } from '@/lib/workoutMemories';
import { parseLocalDate } from '@/lib/dateUtils';
import { getDateLocale } from '@/lib/dateLocales';

const DISMISS_KEY = (userId, dayKey) => `flexyn.memoryDismissed.${userId || 'anon'}.${dayKey}`;
const TODAY_KEY = () => format(new Date(), 'yyyy-MM-dd');

function readDismissedToday(userId) {
  try { return localStorage.getItem(DISMISS_KEY(userId, TODAY_KEY())) === '1'; }
  catch { return false; }
}
function writeDismissedToday(userId) {
  try { localStorage.setItem(DISMISS_KEY(userId, TODAY_KEY()), '1'); }
  catch { /* best-effort */ }
}

export default function WorkoutMemoryCard({ logs = [] }) {
  const { user } = useAuth();
  const { tFallback, language } = useLanguage();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => readDismissedToday(user?.id));

  const memory = useMemo(() => findWorkoutMemory(logs), [logs]);

  // Validate the memory has the minimum shape we need (a log with at
  // least one exercise). A corrupt row that survives findWorkoutMemory
  // would otherwise render an empty card with a dead-end CTA.
  const isValid = memory?.log
    && Array.isArray(memory.log.exercises)
    && memory.log.exercises.length > 0;
  if (!user?.id || !isValid || dismissed) return null;

  const summary = summarizeMemoryLog(memory.log, language);
  const dateLocale = getDateLocale(language);
  const dateStr = (() => {
    try {
      // parseLocalDate so 'YYYY-MM-DD' DATE columns aren't shifted to
      // UTC midnight (which renders as the previous local day in
      // negative-offset zones). Pass locale so non-English users see
      // their month names.
      const d = parseLocalDate(memory.log?.date || memory.log?.created_at || memory.log?.created_date);
      if (!d) return '';
      return format(d, 'MMM d, yyyy', { locale: dateLocale });
    } catch { return ''; }
  })();

  const handleDismiss = (e) => {
    e?.stopPropagation();
    writeDismissedToday(user?.id);
    setDismissed(true);
  };

  const handleTap = () => {
    // Forward the memory log via location state so the Workout page
    // can seed the active session with the same exercises — closes the
    // UX gap where the card said "Hit the gym today to top it" but
    // delivered a blank Workout screen with no link to the log it
    // referenced. (Audit 08 #M-5.)
    if (memory?.log) {
      // Workout reads `repeatFromLog` (the same key WorkoutSavedList sends).
      // This sent `repeatLog`, which nothing read, so the button opened an
      // empty Workout page instead of the session it promised to repeat.
      navigate('/workout', { state: { repeatFromLog: memory.log } });
    } else {
      navigate('/workout');
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
      >
        <Card className="relative overflow-hidden border-border/60 bg-primary/5">
          <button
            onClick={handleTap}
            // cq-stack — same [icon][text] squeeze as the suggestion card.
            className="w-full text-start px-4 py-3 flex items-center gap-3 hover:bg-secondary/30 active:bg-secondary/50 transition-colors cq-stack"
          >
            <div className="shrink-0 w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Calendar className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="kicker text-primary">
                  {tFallback(`memory.label.${memory.yearLabel.replace(/\s+/g, '_')}`, memory.yearLabel)}
                </span>
                {dateStr && (
                  <span className="text-micro text-muted-foreground tabular-nums">
                    · {dateStr}
                  </span>
                )}
              </div>
              <p className="text-sm font-heading font-bold leading-tight mt-0.5 truncate">
                {summary || tFallback('memory.youTrained', 'You trained on this day')}
              </p>
              <p className="text-micro text-muted-foreground leading-snug mt-0.5">
                {tFallback('memory.replayHint', 'Hit the gym today to top it.')}
              </p>
            </div>
            <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
          </button>
          <button
            onClick={handleDismiss}
            // -m-1.5 expands the tap target to ~44pt (iOS HIG min) without
            // changing the visual layout. Bare p-1 was 22px — below the
            // accessible-touch threshold and easy to mis-tap when the
            // primary card CTA sits right next to it.
            className="absolute top-2 end-2 p-2.5 -m-1.5 rounded-sm text-muted-foreground/70 hover:text-foreground active:text-foreground hover:bg-foreground/5 active:bg-foreground/10 transition-colors"
            aria-label={tFallback('memory.dismiss', 'Dismiss for today')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
