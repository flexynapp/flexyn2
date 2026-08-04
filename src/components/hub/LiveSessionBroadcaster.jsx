// src/components/hub/LiveSessionBroadcaster.jsx
//
// The "Go Live" experience for the streamer.
// Creates a hub_live_sessions record and broadcasts exercise state via
// Supabase Realtime so followers see updates in near-real-time.
// No video — this is a live data/presence stream of the workout in progress.

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Radio, StopCircle, ChevronUp, ChevronDown, Users, Loader2, Check } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import * as hubLiveSessions from '@/lib/data/hubLiveSessions';
import { db } from '@/api/db';
import { toast } from '@/lib/toast';
import { format } from 'date-fns';

export default function LiveSessionBroadcaster({ onClose }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const [phase, setPhase]       = useState('setup');   // 'setup' | 'live' | 'ending'
  const [title, setTitle]       = useState('Live Workout');
  const [sessionId, setSessionId] = useState(null);
  const [exercise, setExercise] = useState('');
  const [set, setSet]           = useState(1);
  const [reps, setReps]         = useState(0);
  const [viewers, setViewers]   = useState(0);
  // Set history — accumulates as the user logs sets during the live
  // session. Without this, the entire workout was discarded when the
  // session ended (the user reported "I tested the live stream, but
  // there's no log that it ever happened"). On end we serialize this
  // into a workout_log row.
  const [history, setHistory]   = useState([]); // [{ exercise, set, reps }]
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const channelRef              = useRef(null);
  const broadcastTimerRef       = useRef(null);
  // Tracks mount state so an async startSession that resolves after the
  // modal closed doesn't leave an orphaned live session + leaked channel.
  const mountedRef              = useRef(true);

  // Broadcast current state over Realtime channel (throttled to 2s)
  const broadcast = useCallback((sessionId, ex, s, r) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'activity',
      payload: { exercise: ex, set: s, reps: r, host: user?.username || 'Athlete' },
    });
    hubLiveSessions.updateActivity(sessionId, {
      currentExercise: ex || null,
      currentSet: s,
      currentReps: r,
    }).catch(() => {});
  }, [user]);

  const startBroadcastLoop = useCallback((sid, ex, s, r) => {
    if (broadcastTimerRef.current) clearInterval(broadcastTimerRef.current);
    broadcastTimerRef.current = setInterval(() => {
      broadcast(sid, ex, s, r);
    }, 3000);
  }, [broadcast]);

  const goLive = async () => {
    if (!user?.email) return;
    setPhase('starting');
    try {
      const sid = await hubLiveSessions.startSession(user.email, title);
      // Modal closed mid-await → don't strand a started-but-never-ended
      // session (and skip the channel subscribe that the unmount cleanup
      // already ran past).
      if (!mountedRef.current) {
        hubLiveSessions.endSession(sid).catch(() => {});
        return;
      }
      setSessionId(sid);
      setSessionStartedAt(new Date());

      // Subscribe to Realtime presence to count viewers
      const channel = supabase.channel(`live-session-${sid}`, {
        config: { broadcast: { self: false } },
      });
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          setViewers(Object.keys(state).length);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.track({ host: user.email, role: 'host' });
          }
        });
      channelRef.current = channel;

      setPhase('live');
      toast.success('🔴 You\'re live! Your followers can see your workout.');
    } catch (err) {
      toast.error('Could not start live session — try again.');
      setPhase('setup');
    }
  };

  // Commit the current set to history. The user taps this between
  // each set so the workout is preserved when the session ends.
  const logCurrentSet = () => {
    if (!exercise.trim() || !reps) {
      toast.error('Enter an exercise and reps first.');
      return;
    }
    setHistory(h => [...h, { exercise: exercise.trim(), set, reps }]);
    setSet(s => s + 1);
    setReps(0);
    try { navigator.vibrate?.(8); } catch { /* ignore */ }
  };

  const endLive = async () => {
    setPhase('ending');
    if (broadcastTimerRef.current) clearInterval(broadcastTimerRef.current);
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    if (sessionId) {
      await hubLiveSessions.endSession(sessionId).catch(() => {});
    }
    // Persist the accumulated set history as a workout_log so the
    // session shows up in the user's workout history (and counts toward
    // streak / XP / weekly volume). Skip if no sets were logged so we
    // don't write empty workout rows. The user gets a toast either way
    // — "saved as workout" vs. "no sets logged so nothing saved" —
    // because the previous silent-discard behavior was the reported bug.
    let savedToHistory = false;
    if (history.length > 0 && user?.email) {
      try {
        // Group consecutive sets by exercise name into the standard
        // workout_log shape: { exercises: [{ name, sets: [{set, reps}] }] }.
        const grouped = [];
        for (const h of history) {
          const last = grouped[grouped.length - 1];
          if (last && last.name === h.exercise) {
            last.sets.push({ set: h.set, reps: h.reps, weight: null });
          } else {
            grouped.push({ name: h.exercise, sets: [{ set: h.set, reps: h.reps, weight: null }] });
          }
        }
        const elapsedMin = sessionStartedAt
          ? Math.max(1, Math.round((Date.now() - sessionStartedAt.getTime()) / 60000))
          : null;
        await db.entities.WorkoutLog.create({
          date: format(new Date(), 'yyyy-MM-dd'),
          title: title || 'Live Workout',
          exercises: grouped,
          duration_minutes: elapsedMin,
          source: 'live_session',
        });
        savedToHistory = true;
      } catch (err) {
        console.warn('[live] save-as-workout failed:', err);
      }
    }
    if (savedToHistory) {
      toast.success(`Saved ${history.length} set${history.length === 1 ? '' : 's'} to your workout history. 💪`);
    } else if (history.length === 0) {
      toast.message('Session ended. No sets logged — nothing saved to history.', {
        description: 'Tap "Log set" between each set during your next live session.',
      });
    } else {
      toast.success('Session ended. Great workout! 💪');
    }
    onClose();
  };

  // Auto-broadcast when exercise/set/reps change
  useEffect(() => {
    if (phase !== 'live' || !sessionId) return;
    broadcast(sessionId, exercise, set, reps);
    startBroadcastLoop(sessionId, exercise, set, reps);
    return () => {
      if (broadcastTimerRef.current) clearInterval(broadcastTimerRef.current);
    };
  }, [exercise, set, reps, sessionId, phase, broadcast, startBroadcastLoop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (broadcastTimerRef.current) clearInterval(broadcastTimerRef.current);
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={phase === 'setup' ? onClose : undefined}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-t-2xl w-full max-w-md"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div className="flex items-center gap-2">
            {phase === 'live' && (
              <span className="relative flex w-2.5 h-2.5">
                <span className="absolute inline-flex w-full h-full rounded-full bg-destructive opacity-75 animate-ping" />
                <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-destructive" />
              </span>
            )}
            <p className="font-bold text-base">
              {phase === 'live' ? '🔴 Live now' : tFallback('hub.live.goLive', 'Go Live')}
            </p>
            {phase === 'live' && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="w-3 h-3" /> {viewers}
              </span>
            )}
          </div>
          {phase === 'setup' && (
            <button onClick={onClose} className="p-1 rounded-full hover:bg-secondary active:bg-secondary">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        <div className="px-4 pb-4 space-y-4">
          {/* Setup phase */}
          {phase === 'setup' && (
            <>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                  Session title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 60))}
                  placeholder="e.g. Morning Push Day 🔥"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/30 text-sm focus:outline-none focus:border-primary/50"
                />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your followers will see your workout in real-time — what exercise you're doing, what set you're on. No video, just your live progress data.
              </p>
              <button
                onClick={goLive}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-destructive text-white font-bold hover:bg-destructive active:bg-destructive transition-colors"
              >
                <Radio className="w-4 h-4" />
                Start Live Session
              </button>
            </>
          )}

          {/* Starting spinner */}
          {phase === 'starting' && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}

          {/* Live phase — exercise logger */}
          {phase === 'live' && (
            <>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                  Current exercise
                </label>
                <input
                  value={exercise}
                  onChange={(e) => setExercise(e.target.value.slice(0, 60))}
                  placeholder="e.g. Bench Press"
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-secondary/30 text-sm focus:outline-none focus:border-primary/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Set counter */}
                <div className="flex flex-col items-center gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Set</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSet(s => Math.max(1, s - 1))} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80 active:bg-secondary/80">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <span className="font-heading font-bold text-2xl w-8 text-center">{set}</span>
                    <button onClick={() => setSet(s => s + 1)} className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Reps counter */}
                <div className="flex flex-col items-center gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reps</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setReps(r => Math.max(0, r - 1))} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80 active:bg-secondary/80">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <span className="font-heading font-bold text-2xl w-8 text-center">{reps}</span>
                    <button onClick={() => setReps(r => r + 1)} className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Log-set button — commits the current (exercise, set,
                  reps) tuple to the session's history so we can save
                  the workout when the session ends. Auto-increments
                  the set counter + resets reps so the next set is
                  ready to log. Without this button there was no path
                  to persist the live workout — the reported bug. */}
              <button
                onClick={logCurrentSet}
                disabled={!exercise.trim() || !reps}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                Log set {history.length > 0 ? `· ${history.length} saved` : ''}
              </button>

              <button
                onClick={endLive}
                disabled={phase === 'ending'}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-destructive text-destructive font-bold hover:bg-destructive/10 active:bg-destructive/10 transition-colors disabled:opacity-50"
              >
                <StopCircle className="w-4 h-4" />
                End Session
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
