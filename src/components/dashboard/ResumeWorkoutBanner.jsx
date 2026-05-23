// src/components/dashboard/ResumeWorkoutBanner.jsx
//
// "Continue where you left off" banner — shown at the top of the
// Dashboard when there's an in-progress workout the user paused (by
// navigating away from /workout without saving). Tap "Continue" to
// jump back into the workout with all logged sets intact. Tap × to
// discard the draft.
//
// Mid-workout interruptions happen constantly — phone call, kid runs
// in, set-rest is over and user puts phone down. Without this, the
// user loses their progress when they return. With it, the app
// respects that life happens. Strava and MyFitnessPal both do this
// for cardio/meals; Flexyn does it for workouts.
//
// Auto-discards drafts older than 24h on next mount (stale drafts
// confuse users more than missing ones).

import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, X, History } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { useWorkoutSessions } from '@/hooks/useWorkoutSessions';
import { getDateLocale } from '@/lib/dateLocales';
import { useAuth } from '@/lib/AuthContext';

const STALE_MS = 24 * 60 * 60 * 1000; // 24h

export default function ResumeWorkoutBanner() {
  const { tFallback, language } = useLanguage();
  const navigate = useNavigate();
  const dateLocale = getDateLocale(language);
  const { user } = useAuth();
  const { sessions, removeSession } = useWorkoutSessions(user?.id);
  const [confirmDiscardId, setConfirmDiscardId] = useState(null);
  // Hold the discard-confirm timeout ID so we can clear it on subsequent
  // taps + on unmount. Without this, every tap that flipped state to
  // "confirm?" leaked an untracked setTimeout — if the user tapped the X
  // again to confirm (or the banner unmounted), the timeout still fired
  // ~3s later and called setState on an unmounted component (React
  // warning in dev, slow leak in prod).
  const discardTimeoutRef = useRef(null);

  // Auto-evict stale (>24h) sessions on mount — keeping them around
  // makes the banner act like an annoying "you have nothing to do"
  // reminder rather than the friendly resume affordance it's meant
  // to be.
  useEffect(() => {
    const now = Date.now();
    for (const s of sessions) {
      const ts = s.pausedAt ? new Date(s.pausedAt).getTime() : 0;
      if (!ts || now - ts > STALE_MS) {
        removeSession(s.id);
      }
    }

  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup any pending auto-revert when the banner unmounts (route
  // change, session removed, parent re-render). MUST be declared
  // before the early-return below — rules-of-hooks requires every
  // hook to run on every render in the same order.
  useEffect(() => {
    return () => {
      if (discardTimeoutRef.current) {
        clearTimeout(discardTimeoutRef.current);
        discardTimeoutRef.current = null;
      }
    };
  }, []);

  // Pick the most recent live (non-stale) session. We deliberately
  // show one banner at a time — stacking multiple resume banners
  // would feel cluttered. Power users with two paused workouts can
  // resume one, then see the next on their next Dashboard visit.
  const live = sessions
    .filter(s => {
      const ts = s.pausedAt ? new Date(s.pausedAt).getTime() : 0;
      return ts && Date.now() - ts <= STALE_MS;
    })
    .sort((a, b) => new Date(b.pausedAt) - new Date(a.pausedAt));
  const session = live[0];

  if (!session) return null;

  const exCount = (session.exercises || []).length;
  const setCount = (session.exercises || [])
    .reduce((sum, ex) => sum + (ex.sets?.filter(s => s.weight || s.reps).length || 0), 0);
  const title = session.selectedRegimen?.name
    || tFallback('workout.resumeFallbackTitle', 'Paused workout');
  const relative = formatDistanceToNow(new Date(session.pausedAt), { addSuffix: true, locale: dateLocale });

  const handleResume = () => {
    try { navigator.vibrate?.(10); } catch { /* ignore */ }
    // Workout.jsx detects the resumable session on mount by matching
    // activeSessionId — we pass the id via router state so it knows
    // which paused session to hydrate.
    navigate('/workout', { state: { resumeSessionId: session.id } });
  };

  const handleDiscard = (e) => {
    e.stopPropagation();
    // Cancel any in-flight auto-revert before transitioning state —
    // the previous timeout would otherwise fire ~3s later and call
    // setState on a (potentially) unmounted component.
    if (discardTimeoutRef.current) {
      clearTimeout(discardTimeoutRef.current);
      discardTimeoutRef.current = null;
    }
    if (confirmDiscardId === session.id) {
      removeSession(session.id);
      setConfirmDiscardId(null);
    } else {
      setConfirmDiscardId(session.id);
      // Auto-revert the confirm state after 3s if user doesn't tap
      // again (so an accidental tap doesn't leave the banner in a
      // weird "tap × to confirm" state forever).
      discardTimeoutRef.current = setTimeout(() => {
        setConfirmDiscardId((cur) => (cur === session.id ? null : cur));
        discardTimeoutRef.current = null;
      }, 3000);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        onClick={handleResume}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleResume(); } }}
        className="flex items-center gap-3 p-3 mb-3 rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent cursor-pointer hover:border-primary/50 transition-colors"
        aria-label={`${tFallback('workout.resumeKicker', 'Resume')} ${title}`}
      >
        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <History className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">
            {tFallback('workout.resumeKicker', 'Resume')}
          </p>
          <p className="text-sm font-heading font-bold truncate">{title}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {exCount > 0 && `${exCount} ${tFallback(exCount === 1 ? 'workout.resumeExerciseOne' : 'workout.resumeExerciseMany', exCount === 1 ? 'exercise' : 'exercises')}`}
            {setCount > 0 && ` · ${setCount} ${tFallback(setCount === 1 ? 'workout.resumeSetOne' : 'workout.resumeSetMany', setCount === 1 ? 'set logged' : 'sets logged')}`}
            {' · '}{relative}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDiscard}
          className={`p-2 rounded-lg text-xs font-medium transition-colors shrink-0 ${
            confirmDiscardId === session.id
              ? 'text-destructive bg-destructive/10'
              : 'text-muted-foreground hover:bg-secondary'
          }`}
          aria-label={confirmDiscardId === session.id
            ? tFallback('workout.resumeDiscardConfirmAria', 'Tap again to confirm discard')
            : tFallback('workout.resumeDiscardAria', 'Discard paused workout')}
        >
          {confirmDiscardId === session.id ? (
            <span className="text-[11px] font-bold">{tFallback('common.confirm', 'Confirm?')}</span>
          ) : (
            <X className="w-4 h-4" />
          )}
        </button>
        <ArrowRight className="w-4 h-4 text-primary shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />
      </motion.div>
    </AnimatePresence>
  );
}
