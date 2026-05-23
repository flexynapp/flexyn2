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

  if (!user?.id || !memory || dismissed) return null;

  const summary = summarizeMemoryLog(memory.log, language);
  const dateStr = (() => {
    try {
      const d = new Date(memory.log?.date || memory.log?.created_at || memory.log?.created_date);
      return format(d, 'MMM d, yyyy');
    } catch { return ''; }
  })();

  const handleDismiss = (e) => {
    e?.stopPropagation();
    writeDismissedToday(user?.id);
    setDismissed(true);
  };

  const handleTap = () => {
    // No "replay this workout" RPC yet — for V1, just navigate the
    // user to the workout page. Future enhancement: pre-fill the
    // workout exercises from this log so the user can repeat the
    // session with one tap.
    navigate('/workout');
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-purple-500/5 via-transparent to-rose-500/5">
          <button
            onClick={handleTap}
            className="w-full text-start px-4 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors"
          >
            <div className="shrink-0 w-9 h-9 rounded-full bg-purple-500/12 text-purple-500 flex items-center justify-center">
              <Calendar className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-500">
                  {tFallback(`memory.label.${memory.yearLabel.replace(/\s+/g, '_')}`, memory.yearLabel)}
                </span>
                {dateStr && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    · {dateStr}
                  </span>
                )}
              </div>
              <p className="text-sm font-heading font-bold leading-tight mt-0.5 truncate">
                {summary || tFallback('memory.youTrained', 'You trained on this day')}
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                {tFallback('memory.replayHint', 'Hit the gym today to top it.')}
              </p>
            </div>
            <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
          </button>
          <button
            onClick={handleDismiss}
            className="absolute top-2 end-2 p-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
            aria-label={tFallback('memory.dismiss', 'Dismiss for today')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
