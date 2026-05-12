import React, { useState, useEffect, useRef, useMemo } from 'react';
import { filterAfterReset } from '@/lib/accountReset';
import { useLanguage } from '@/lib/LanguageContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import MobileSelect from '@/components/MobileSelect';
import { toast } from 'sonner';
import { Play, Save, Plus, Dumbbell, Trash2, Target, Pause, AlertTriangle, Activity, ArrowRight, History, Camera, Sparkles } from 'lucide-react';
import { useMultiProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import CardioSection from '@/components/cardio/CardioSection';
import FormCoachModal from '@/components/formcoach/FormCoachModal';
import WorkoutGeneratorModal from '@/components/workout/WorkoutGeneratorModal';
import WorkoutShareCard from '@/components/workout/WorkoutShareCard';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import EditWorkoutModal from '@/components/workout/EditWorkoutModal';
import ProgressPhotoCapture from '@/components/progress/ProgressPhotoCapture';
import WorkoutSavedList from '@/components/workout/WorkoutSavedList';
import { Skeleton } from '@/components/ui/skeleton';
import ExerciseLogger from '@/components/workout/ExerciseLogger';
import ExerciseAutocomplete, { EXERCISE_LIBRARY } from '@/components/regimens/ExerciseAutocomplete';
import GoalsModal from '@/components/goals/GoalsModal';
import GoalsAlmostComplete from '@/components/goals/GoalsAlmostComplete';
import RegimensSection from '@/components/workout/RegimensSection';
import PageHeader from '@/components/PageHeader';
import { useWorkoutSessions, pauseWorkoutSync } from '@/hooks/useWorkoutSessions';
import { calculateWorkoutXp } from '@/lib/xpSystem';
import * as quests from '@/lib/data/quests';
import * as regimens from '@/lib/data/regimens';
import { ACTION_TYPES } from '@/lib/questCatalog';
import * as leagues from '@/lib/data/leagues';
import * as workoutStreak from '@/lib/data/workoutStreak';
import * as notifications from '@/lib/data/notifications';
import { speakWorkoutComplete } from '@/lib/audioCues';
import { getMaxRealisticWeight, getMaxRealisticReps, getMaxRealisticDuration } from '@/lib/realisticLimits';
import { detectImplausibleWorkout, getMaxSetsPerExercise, getMuscleGroupCap } from '@/lib/workoutFatigue';

const EXERCISE_NAMES = new Set(EXERCISE_LIBRARY.map(e => e.name.toLowerCase()));

// Returns true if the exercise name matches any library entry (exact or partial)
function isKnownExercise(name) {
  const lower = name.toLowerCase();
  if (EXERCISE_NAMES.has(lower)) return true;
  for (const n of EXERCISE_NAMES) {
    if (n.includes(lower) || lower.includes(n)) return true;
  }
  return false;
}

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Full Body', 'Cardio'];


export default function Workout() {
  const { t } = useLanguage();
  const [started, setStarted] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [selectedRegimen, setSelectedRegimen] = useState(null);
  const [exercises, setExercises] = useState([]);
  // Date is always today's local date — no editor, no resumed-session override.
  const date = format(new Date(), 'yyyy-MM-dd');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [newExName, setNewExName] = useState('');
  const [newExCanonical, setNewExCanonical] = useState('');
  const [newExMuscles, setNewExMuscles] = useState([]);
  const [editingLog, setEditingLog] = useState(null);
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);
  const [regimensOpen, setRegimensOpen] = useState(false);
  const [cardioOpen, setCardioOpen] = useState(false);
  const [formCoachOpen, setFormCoachOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [shareCardWorkout, setShareCardWorkout] = useState(null);
  const [savedWorkoutsOpen, setSavedWorkoutsOpen] = useState(false);
  const [cheatWarningData, setCheatWarningData] = useState(null);
  const [implausibleWarning, setImplausibleWarning] = useState(null);
  const [missingDataWarning, setMissingDataWarning] = useState(null);
  const [cardioPageTitle, setCardioPageTitle] = useState(null);

  const guard = useMultiProfanityGuard();
  const { sessions, pauseWorkout, resumeWorkout, removeSession } = useWorkoutSessions();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const location = useLocation();

  const workoutStateRef = React.useRef({});
  workoutStateRef.current = { started, activeSessionId, selectedRegimen, exercises, date, duration, notes };

  useEffect(() => {
    return () => {
      const { started, activeSessionId, selectedRegimen, exercises, date, duration, notes } = workoutStateRef.current;
      if (started && activeSessionId) {
        pauseWorkoutSync({
          id: activeSessionId,
          selectedRegimen,
          exercises,
          date,
          duration,
          notes,
        });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: rawRegimens = [], isLoading } = useQuery({
    queryKey: ['regimens', user?.email],
    queryFn: () => db.entities.Regimen.filter({ created_by: user.email }),
    enabled: !!user?.email,
  });

  const { data: rawLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['workoutLogs', user?.email],
    queryFn: () => db.entities.WorkoutLog.filter({ created_by: user.email }, '-date', 50),
    enabled: !!user?.email,
  });

  const { data: rawCardioLogs = [] } = useQuery({
    queryKey: ['cardioLogs', user?.email],
    queryFn: () => db.entities.CardioLog.filter({ created_by: user.email }, '-date', 100),
    enabled: !!user?.email,
  });

  const { data: rawGoals = [] } = useQuery({
    queryKey: ['goals', user?.email],
    queryFn: () => db.entities.Goal.filter({ created_by: user.email }),
    enabled: !!user?.email,
  });

  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });

  const regimens = useMemo(() => filterAfterReset(rawRegimens, userProfile), [rawRegimens, userProfile]);
  const logs = useMemo(() => filterAfterReset(rawLogs, userProfile), [rawLogs, userProfile]);
  const goals = useMemo(() => filterAfterReset(rawGoals, userProfile), [rawGoals, userProfile]);
  const cardioLogs = useMemo(() => filterAfterReset(rawCardioLogs, userProfile), [rawCardioLogs, userProfile]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      // Anti-cheat: never accept future-dated workouts. Users could otherwise
      // front-load tomorrow's session today to game streaks or weekly leagues.
      // We allow today's date in any timezone (with a small clock-drift buffer)
      // but reject anything dated >1 day ahead of the user's current local date.
      try {
        if (data?.date) {
          const today = format(new Date(), 'yyyy-MM-dd');
          if (data.date > today) {
            throw new Error('Workouts cannot be dated in the future.');
          }
        }
      } catch (e) {
        if (e.message === 'Workouts cannot be dated in the future.') throw e;
        // Date parsing failed — fall through (existing behavior)
      }

      // Per-exercise set cap (defense-in-depth, trim before XP calc)
      const perExerciseCap = getMaxSetsPerExercise(userProfile);
      data = {
        ...data,
        exercises: (data.exercises || []).map(ex => ({
          ...ex,
          sets: (ex.sets || []).slice(0, perExerciseCap),
        })),
      };

      // Per-muscle-group clamp: XP cannot reward beyond realistic per-group cap
      // even if the warning was dismissed.
      {
        const groupRunningTotals = {};
        const clampedExercises = data.exercises.map(ex => {
          const groups = ex.muscle_groups?.length
            ? ex.muscle_groups
            : (ex.muscle_group ? [ex.muscle_group] : []);
          if (groups.length === 0) return ex;
          let allowed = ex.sets?.length || 0;
          for (const g of groups) {
            const cap = getMuscleGroupCap(g, userProfile);
            const used = groupRunningTotals[g] || 0;
            const headroom = Math.max(0, cap - used);
            allowed = Math.min(allowed, headroom);
          }
          for (const g of groups) {
            groupRunningTotals[g] = (groupRunningTotals[g] || 0) + allowed;
          }
          return { ...ex, sets: (ex.sets || []).slice(0, allowed) };
        });
        data = { ...data, exercises: clampedExercises };
      }

      const workoutLog = await db.entities.WorkoutLog.create(data);
      const xpGained = calculateWorkoutXp(data);
      const sessionVolume = calculateTotalVolume(data.exercises);

      // Always fire XP + achievement check — even if XP is 0 (e.g. bodyweight-only
      // or capped workout) so that achievement unlocks are never skipped.
      // Wrapped in try-catch so a server-side failure never kills the mutation
      // or prevents the success toast / workout reset from running.
      try {
        await db.functions.invoke('updateUserXpAndAchievements', {
          xp_gained: xpGained,
          action_type: 'workout_completed',
          action_data: { totalVolume: sessionVolume, workout_date: data.date }
        });
      } catch (xpErr) {
        console.warn('XP/achievement update failed (non-blocking):', xpErr);
      }

      // Atomic volume accumulation via RPC (migration 023). The previous
      // read-modify-write pattern raced against itself when a workout and
      // cardio finished within ~200ms — both reads saw the same `prev`,
      // and the second write overwrote the first, losing one session's
      // volume from leaderboards. The increment_user_volume RPC adds the
      // delta in a single SQL statement, so concurrent calls compose
      // instead of overwriting. Falls back to read-modify-write only if
      // the RPC isn't available (pre-migration).
      if (sessionVolume > 0) {
        try {
          const { error: rpcErr } = await supabase.rpc('increment_user_volume', {
            p_delta: sessionVolume,
          });
          if (rpcErr) {
            // RPC missing or denied — fall back to non-atomic update so
            // the count at least advances on this device. Migration 023
            // adds the RPC; this fallback exists for pre-migration users.
            console.warn('[Workout] volume RPC failed, falling back:', rpcErr);
            const me = await db.auth.me();
            const prev = Number(me?.total_volume_lbs) || 0;
            await db.auth.updateMe({ total_volume_lbs: prev + sessionVolume });
          }
        } catch (volErr) { console.warn('[Workout] volume accumulate failed:', volErr); }
      }

      // Return the CLAMPED data alongside the workoutLog so onSuccess can
      // show the correct XP / volume numbers in the success toast.
      // Previously onSuccess re-called calculateWorkoutXp on the original
      // unclamped data, which could overstate the XP by up to ~30% when
      // sets had been trimmed by the per-group cap.
      return { workoutLog, clampedData: data, xpGained, sessionVolume };
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['workoutLogs', user?.email] });
      const previous = queryClient.getQueryData(['workoutLogs', user?.email]);
      // Unique optimistic id so two queued mutations don't collide. The
      // double-tap guard in saveWorkout SHOULD prevent two from queueing,
      // but if anything bypasses that (background sync, programmatic call)
      // a literal '__optimistic__' would create a React key collision.
      const optimisticId = `__optimistic__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      queryClient.setQueryData(['workoutLogs', user?.email], (old = []) => [
        { id: optimisticId, ...data },
        ...old,
      ]);
      return { previous };
    },
    onError: (err, _data, ctx) => {
      // Roll back the optimistic insert AND tell the user something went
      // wrong — previously this swallowed the failure and the row just
      // disappeared with no toast, which is the worst possible UX.
      queryClient.setQueryData(['workoutLogs', user?.email], ctx.previous);
      console.error('[Workout] save failed:', err);
      const code = err?.code || err?.status;
      // RLS / permission denied surfaces a clearer hint than a generic message.
      if (code === '42501' || /policy|permission/i.test(err?.message || '')) {
        toast.error('Could not save — permission denied. Try signing in again.');
      } else if (/network|fetch|failed to fetch/i.test(err?.message || '')) {
        toast.error('Could not save — check your connection and try again.');
      } else {
        toast.error('Could not save workout', { description: err?.message || 'Try again.' });
      }
    },
    onSuccess: (result, _origData) => {
      // Read clamped data + xpGained from the mutation result, NOT recompute
      // from the original payload. Recomputing on the original input ignored
      // the per-group cap clamping inside mutationFn and could overstate the
      // XP by ~30% on workouts that had sets trimmed.
      const clampedData = result?.clampedData || _origData;
      const xpGained = result?.xpGained ?? calculateWorkoutXp(clampedData);
      if (activeSessionId) removeSession(activeSessionId);
      // Snapshot the workout for the share card *before* resetting state.
      // Capturing here means the share card preview is built from exactly
      // what was saved (including the date and the user's actual data).
      setShareCardWorkout({ ...clampedData, date: clampedData.date || format(new Date(), 'yyyy-MM-dd') });
      resetWorkout();
      toast.success(t('workout.saved'), { description: t('workout.savedXp').replace('{xp}', xpGained) });
      // Voice cue (no-op if user has voice cues disabled)
      try { speakWorkoutComplete(); } catch {}
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['cardioLogs', user?.email] });
      // Refetch achievements so the modal reflects newly unlocked ones immediately
      queryClient.invalidateQueries({ queryKey: ['achievements', user?.email] });

      // Quest progress — non-blocking, fire-and-forget
      const durationMin = Number(clampedData.duration_minutes) || 0;
      Promise.all([
        quests.recordAction(user, ACTION_TYPES.WORKOUT_COMPLETED, 1),
        durationMin > 0 ? quests.recordAction(user, ACTION_TYPES.WORKOUT_MINUTES, durationMin) : null,
      ].filter(Boolean))
        .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(() => {});

      // League weekly XP — non-blocking
      leagues.recordWeeklyXp(user, xpGained)
        .then(() => queryClient.invalidateQueries({ queryKey: ['myLeague', user?.id] }))
        .catch(() => {});

      // Workout streak — milestone days celebrate with toast + invalidate profile
      workoutStreak.recordWorkoutDay(user)
        .then((res) => {
          if (res?.isNewDay && res.coinsAwarded > 0) {
            toast.success(t('dashboard.workoutStreakMilestone') === 'dashboard.workoutStreakMilestone'
              ? `🔥 ${res.streak}-day workout streak! +${res.coinsAwarded} coins`
              : t('dashboard.workoutStreakMilestone').replace('{day}', res.streak).replace('{coins}', res.coinsAwarded));
            // In-app notification on milestone
            notifications.notifyStreakMilestone({
              user,
              kind: 'workout',
              day: res.streak,
              coinsAwarded: res.coinsAwarded,
              eliteCapsuleAwarded: res.eliteCapsuleAwarded,
            })
              .then(() => queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] }))
              .catch(() => {});
          }
          queryClient.invalidateQueries({ queryKey: ['workoutStreakProfile', user?.id] });
          queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        })
        .catch(() => {});
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] }),
  });

  const calculateTotalVolume = (exList) => {
    let total = 0;
    exList?.forEach(ex => {
      ex.sets?.forEach(set => {
        total += (set.weight || 0) * (set.reps || 0);
      });
    });
    return total;
  };

  const getLastSetsForExercise = (exerciseName, targetSetCount) => {
    if (!logs || logs.length === 0) return null;
    for (const log of logs) {
      const match = log.exercises?.find(
        e => e.name?.toLowerCase() === exerciseName?.toLowerCase()
      );
      if (match?.sets?.length) {
        const lastSets = match.sets.map(s => ({ weight: s.weight ?? null, reps: s.reps ?? null }));
        if (lastSets.length >= targetSetCount) return lastSets.slice(0, targetSetCount);
        const filler = lastSets[lastSets.length - 1] || { weight: null, reps: null };
        return [...lastSets, ...Array.from({ length: targetSetCount - lastSets.length }, () => ({ ...filler }))];
      }
    }
    return null;
  };

  const startFromRegimen = (regimen) => {
    const id = `regimen-${regimen.id}-${Date.now()}`;
    setActiveSessionId(id);
    setSelectedRegimen(regimen);
    const exList = (regimen.exercises || []).map(ex => {
      const targetSets = ex.target_sets || 3;
      const targetReps = ex.target_reps != null && ex.target_reps !== '' ? Number(ex.target_reps) : null;
      const seeded = getLastSetsForExercise(ex.name, targetSets);

      // Build the final sets:
      //   - reps come from the regimen's target_reps when prescribed (the user
      //     explicitly set this for this regimen — it must win over history).
      //   - weight comes from history when available, so progressive-overload
      //     tracking still works without forcing re-entry every session.
      //   - if no target_reps and no history, both fields are blank.
      let sets;
      if (seeded) {
        sets = seeded.map(s => ({
          weight: s.weight ?? null,
          reps: targetReps != null ? targetReps : (s.reps ?? null),
        }));
      } else {
        sets = Array.from({ length: targetSets }, () => ({
          weight: null,
          reps: targetReps,
        }));
      }

      return {
        name: ex.name,
        muscle_group: ex.muscle_group || '',
        muscle_groups: ex.muscle_groups || (ex.muscle_group ? [ex.muscle_group] : []),
        sets,
      };
    });
    setExercises(exList);
    setStarted(true);
  };

  const startFreestyle = () => {
    const id = `freestyle-${Date.now()}`;
    setActiveSessionId(id);
    setSelectedRegimen(null);
    setExercises([]);
    setStarted(true);
  };

  // Start an active workout pre-filled from the AI generator. SHARED between
  // both modal mount points (idle-view and active-view) so we never have to
  // worry about one path drifting from the other. Mirrors startFromRegimen /
  // startFreestyle so the form behaves identically regardless of entry point.
  const startFromGeneratedWorkout = (workout) => {
    const id = `generated-${Date.now()}`;
    setActiveSessionId(id);
    setSelectedRegimen(null);
    setExercises((workout?.exercises || []).map(ex => ({
      name: ex.name,
      muscle_group: ex.group || '',
      muscle_groups: ex.group ? [ex.group] : [],
      sets: (ex.sets || []).map(s => ({
        weight: s.weight != null ? s.weight : null,
        reps:   s.reps   != null ? s.reps   : null,
      })),
    })));
    setDuration(String(workout?.duration_minutes || ''));
    setNotes(workout?.title || '');
    setStarted(true);
    setGeneratorOpen(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    toast.success('Workout loaded — log your sets!');
  };

  // SHARED save-as-regimen handler for the AI generator modal — used at
  // both mount points so they can't drift.
  const saveGeneratedAsRegimen = async (workout) => {
    try {
      await regimens.create({
        name: workout.title || 'AI-Generated Workout',
        description: `AI ${workout.focus} session · ${workout.duration_minutes} min`,
        exercises: (workout.exercises || []).map(ex => ({
          name: ex.name,
          target_sets: ex.sets?.length || 3,
          target_reps: ex.sets?.[0]?.reps ?? null,
          target_weight: ex.sets?.[0]?.weight ?? null,
          rest_seconds: ex.restSec ?? 90,
        })),
        is_public: false,
      });
      queryClient.invalidateQueries({ queryKey: ['regimens', user?.email] });
      toast.success('Saved to your Regimens!');
    } catch (err) {
      console.error('[Workout] save regimen failed:', err);
      toast.error('Could not save regimen. Try again.');
    }
  };

  const handleResumeSession = (sessionId) => {
    const session = resumeWorkout(sessionId);
    if (!session) return;
    removeSession(sessionId);
    setActiveSessionId(session.id);
    setSelectedRegimen(session.selectedRegimen || null);
    setExercises(session.exercises || []);
    setDuration(session.duration || '');
    setNotes(session.notes || '');
    setStarted(true);
  };

  const loadTemplate = (template) => {
    setSelectedRegimen(null);
    const exList = (template.exercises || []).map(ex => {
      const targetSets = ex.target_sets || 3;
      const targetReps = ex.target_reps != null && ex.target_reps !== '' ? Number(ex.target_reps) : null;
      const seeded = getLastSetsForExercise(ex.name, targetSets);

      let sets;
      if (seeded) {
        sets = seeded.map(s => ({
          weight: s.weight ?? null,
          reps: targetReps != null ? targetReps : (s.reps ?? null),
        }));
      } else {
        sets = Array.from({ length: targetSets }, () => ({
          weight: null,
          reps: targetReps,
        }));
      }

      return {
        name: ex.name,
        muscle_group: ex.muscle_group || '',
        muscle_groups: ex.muscle_groups || (ex.muscle_group ? [ex.muscle_group] : []),
        sets,
      };
    });
    setExercises(exList);
    setStarted(true);
  };

  const addExercise = () => {
    if (!newExName.trim()) return;
    const displayName = newExName.trim();
    const canonicalName = newExCanonical || displayName;
    setExercises([...exercises, {
      name: canonicalName,
      displayName,
      muscle_group: newExMuscles[0] || '',
      muscle_groups: newExMuscles,
      sets: [{ weight: null, reps: null }]
    }]);
    setNewExName('');
    setNewExCanonical('');
    setNewExMuscles([]);
  };

  const updateExercise = (index, updated) => {
    const newExercises = [...exercises];
    newExercises[index] = updated;
    setExercises(newExercises);
  };

  const saveWorkout = (forceIgnoreMissing = false) => {
    // Guard against double-tap. saveMutation.isPending isn't true during the
    // warning-dialog detour, so a fast double-tap on "Save anyway" could fire
    // .mutate() twice in the same tick, producing two WorkoutLog rows AND
    // two XP grants. This early-return is the actual safety net.
    if (saveMutation.isPending) return;
    const exerciseStrings = (exercises || []).flatMap(ex => [ex.name, ex.displayName]);
    if (hasAnyProfanity(notes, exerciseStrings)) {
      toast.error('Please remove inappropriate language before saving.');
      return;
    }
    // Detect empty / missing-data sets unless the user has confirmed.
    // A set is incomplete if EITHER weight or reps is missing — except for
    // cardio/bodyweight exercises where 0 weight is legitimate.
    if (!forceIgnoreMissing) {
      const missing = [];
      exercises.forEach((ex) => {
        const sets = ex.sets || [];
        if (sets.length === 0) {
          missing.push({ exName: ex.name || 'Unnamed exercise', reason: 'no sets' });
          return;
        }
        const groups = ex.muscle_groups || (ex.muscle_group ? [ex.muscle_group] : []);
        const isBodyweight = groups.some(g =>
          typeof g === 'string' && g.toLowerCase() === 'cardio'
        );
        sets.forEach((s, i) => {
          const isBlank = (v) => v === null || v === undefined || v === '';
          const wMissing = isBlank(s.weight) || (!isBodyweight && Number(s.weight) === 0);
          const rMissing = isBlank(s.reps) || Number(s.reps) === 0;
          if (wMissing && rMissing) {
            missing.push({ exName: ex.name || 'Unnamed exercise', setIndex: i + 1, reason: 'empty set' });
          } else if (wMissing) {
            missing.push({ exName: ex.name || 'Unnamed exercise', setIndex: i + 1, reason: 'no weight entered' });
          } else if (rMissing) {
            missing.push({ exName: ex.name || 'Unnamed exercise', setIndex: i + 1, reason: 'no reps entered' });
          }
        });
      });
      if (missing.length > 0) {
        setMissingDataWarning(missing);
        return;
      }
    }

    for (const ex of exercises) {
      for (const s of (ex.sets || [])) {
        const w = s.weight;
        if (w !== null && w !== undefined && w !== '' && isNaN(parseFloat(w))) {
          toast.error(t('workout.numbersOnly'), {
            description: t('workout.numbersOnlyDesc'),
          });
          setExercises(exercises.map(e => ({
            ...e,
            sets: (e.sets || []).map(st => ({
              ...st,
              weight: (st.weight !== null && st.weight !== undefined && st.weight !== '' && isNaN(parseFloat(st.weight))) ? null : st.weight,
            })),
          })));
          return;
        }
      }
    }

    const normalizedExercises = exercises.map(ex => ({
      ...ex,
      sets: (ex.sets || []).map(s => ({
        weight: Number(s.weight) || 0,
        reps: Number(s.reps) || 0,
      })),
      duration_minutes: ex.duration_minutes != null ? (Number(ex.duration_minutes) || null) : null,
    }));

    // ── Anti-cheat: flag weight AND rep violations visibly ───────────────────
    // Previously, reps were silently clamped. Now both are flagged so the user
    // is aware their input was outside realistic bounds and must correct it.
    const flaggedSets = [];
    normalizedExercises.forEach((ex, exIndex) => {
      const maxWeight = getMaxRealisticWeight(ex.name, userProfile);
      ex.sets.forEach((s, setIndex) => {
        const maxReps = getMaxRealisticReps(ex.name, s.weight, userProfile);
        const weightFlagged = s.weight > 0 && s.weight > maxWeight;
        const repsFlagged   = s.reps   > 0 && s.reps   > maxReps;
        if (weightFlagged || repsFlagged) {
          flaggedSets.push({
            exIndex,
            setIndex,
            exName: ex.name,
            weightFlagged,
            repsFlagged,
            maxWeight: weightFlagged ? maxWeight : null,
            maxReps:   repsFlagged   ? maxReps   : null,
          });
        }
      });
    });

    const pendingExercises = normalizedExercises.map(ex => ({
      ...ex,
      sets: ex.sets.map(s => ({
        weight: s.weight,
        reps: s.reps,
      })),
      duration_minutes: ex.duration_minutes != null
        ? Math.min(ex.duration_minutes, getMaxRealisticDuration())
        : null,
    }));

    const pendingPayload = {
      regimen_id: selectedRegimen?.id || '',
      regimen_name: selectedRegimen?.name || t('workout.freestyle'),
      date,
      duration_minutes: duration ? Math.min(parseInt(duration) || 0, 360) : null,
      exercises: pendingExercises,
      notes,
    };

    if (flaggedSets.length > 0) {
      setCheatWarningData({ pendingPayload, flaggedSets });
      return;
    }

    const maxSetsPerEx = getMaxSetsPerExercise(userProfile);
    for (const ex of pendingPayload.exercises) {
      if ((ex.sets?.length || 0) > maxSetsPerEx) {
        setImplausibleWarning(
          t('workout.warn.perExSetLimit')
            .replace('{exercise}', ex.name)
            .replace('{setCount}', ex.sets.length)
            .replace('{maxSets}', maxSetsPerEx)
        );
        return;
      }
    }

    const fatigueCheck = detectImplausibleWorkout(
      { date, exercises: pendingPayload.exercises, duration_minutes: pendingPayload.duration_minutes },
      userProfile,
      logs,
      cardioLogs
    );
    if (fatigueCheck.implausible) {
      let msg = t(fatigueCheck.i18nKey);
      if (fatigueCheck.i18nParams) {
        Object.entries(fatigueCheck.i18nParams).forEach(([key, val]) => {
          msg = msg.replace(`{${key}}`, val);
        });
      }
      setImplausibleWarning(msg);
      return;
    }

    saveMutation.mutate(pendingPayload);
  };

  const resetWorkout = (clearSessionId = null) => {
    if (clearSessionId) removeSession(clearSessionId);
    setStarted(false);
    setActiveSessionId(null);
    setSelectedRegimen(null);
    setExercises([]);
    setDuration('');
    setNotes('');
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  useEffect(() => {
    const state = location?.state;
    if (state?.openRegimens && !regimensOpen) {
      setRegimensOpen(true);
      window.history.replaceState({}, document.title);
    }
  }, []);

  useEffect(() => {
    const handler = (e) => setCardioPageTitle(e.detail?.title || null);
    window.addEventListener('flexyn-title', handler);
    return () => window.removeEventListener('flexyn-title', handler);
  }, []);

  useEffect(() => {
    if (!cardioOpen) setCardioPageTitle(null);
  }, [cardioOpen]);

  useEffect(() => {
    if (!started) return undefined;
    const handler = (e) => {
      e.preventDefault();
      resetWorkout(activeSessionId);
    };
    window.addEventListener('flexyn-back', handler);
    return () => window.removeEventListener('flexyn-back', handler);
  }, [started, activeSessionId]);

  if (!started) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="p-4 md:p-8 max-w-5xl mx-auto"
      >
        <PageHeader
          kicker={cardioPageTitle ? 'CARDIO' : t('pageHeader.kicker.workout')}
          title={cardioPageTitle || t('nav.workout')}
          hidePeriod
          subtitle={cardioPageTitle ? null : t('workout.subtitle')}
        />

        <motion.div variants={itemVariants} initial="hidden" animate="visible" transition={{ delay: 0.2 }}>
          <GoalsAlmostComplete goals={goals} logs={logs} onOpen={() => setGoalsModalOpen(true)} />
        </motion.div>

        {cardioOpen ? (
          <div className="mb-8">
            <CardioSection onBack={() => setCardioOpen(false)} />
          </div>
        ) : !regimensOpen ? (
          <>
            {/* Primary action */}
            <motion.button
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={startFreestyle}
              className="group relative w-full mb-4 overflow-hidden rounded-2xl bg-[hsl(210_18%_11%)] dark:bg-[hsl(210_22%_8%)] text-white p-6 md:p-7 text-left shadow-xl shadow-black/15 hover:shadow-2xl transition-shadow select-none-ui"
            >
              <div className="absolute inset-0 pointer-events-none">
                <div
                  className="absolute -top-1/2 -right-1/4 w-[80%] h-[180%] rounded-full blur-3xl opacity-80"
                  style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.6), transparent 65%)' }}
                />
              </div>
              <div
                className="absolute inset-0 opacity-[0.06] pointer-events-none"
                style={{
                  backgroundImage:
                    'linear-gradient(hsl(0 0% 100% / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.6) 1px, transparent 1px)',
                  backgroundSize: '28px 28px',
                }}
              />
              <div className="relative flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold tracking-[0.2em] uppercase text-primary/90 mb-1.5">
                    {t('workout.startKicker')}
                  </span>
                  <span className="font-heading font-bold text-2xl md:text-3xl leading-tight block">
                    {t('workout.freestyle')}
                  </span>
                  <span className="text-sm text-white/60 mt-1.5 block max-w-[40ch]">
                    {t('workout.freestyleDesc')}
                  </span>
                </div>
                <motion.div
                  className="shrink-0 w-14 h-14 md:w-16 md:h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/40"
                  whileHover={{ rotate: 5 }}
                  transition={{ type: 'spring', stiffness: 400 }}
                >
                  <Play className="w-6 h-6 md:w-7 md:h-7 fill-current" />
                </motion.div>
              </div>
            </motion.button>

            {/* Secondary actions */}
            <motion.div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-8"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              <motion.div variants={itemVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
                <Card
                  className="group p-4 cursor-pointer border-border/70 hover:border-accent/40 transition-colors h-full"
                  onClick={() => setGoalsModalOpen(true)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0 group-hover:bg-accent/15 transition-colors">
                      <Target className="w-5 h-5 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold text-sm leading-tight">{t('workout.goals')}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t('workout.goalsDesc')}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                </Card>
              </motion.div>

              <motion.div variants={itemVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
                <Card
                  className="group p-4 cursor-pointer border-border/70 hover:border-primary/40 transition-colors h-full"
                  onClick={() => setRegimensOpen(true)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                      <Dumbbell className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold text-sm leading-tight">{t('workout.regimens')}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t('workout.regimensDesc')}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                </Card>
              </motion.div>

              <motion.div variants={itemVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
                <Card
                  className="group p-4 cursor-pointer border-border/70 hover:border-primary/40 transition-colors h-full"
                  onClick={() => setCardioOpen(true)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                      <Activity className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold text-sm leading-tight">{t('cardio.title')}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t('cardio.subtitle')}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                </Card>
              </motion.div>

              <motion.div variants={itemVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
                <Card
                  role="button"
                  tabIndex={0}
                  aria-label={t('generator.title') === 'generator.title' ? 'Generate Workout' : t('generator.title')}
                  className="group p-4 cursor-pointer border-primary/20 bg-gradient-to-br from-primary/5 via-fuchsia-500/5 to-violet-500/5 hover:border-primary/50 transition-colors h-full"
                  onClick={() => setGeneratorOpen(true)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setGeneratorOpen(true); } }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary via-fuchsia-500 to-violet-500 flex items-center justify-center shrink-0">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold text-sm leading-tight">
                        {t('generator.title') === 'generator.title' ? 'Generate Workout' : t('generator.title')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {t('generator.cardSubtitle') === 'generator.cardSubtitle'
                          ? 'AI builds a session from your history'
                          : t('generator.cardSubtitle')}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                </Card>
              </motion.div>

              <motion.div variants={itemVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
                <Card
                  role="button"
                  tabIndex={0}
                  aria-label="Form Coach"
                  className="group p-4 cursor-pointer border-border/70 hover:border-primary/40 transition-colors h-full"
                  onClick={() => setFormCoachOpen(true)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFormCoachOpen(true); } }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                      <Camera className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-heading font-bold text-sm leading-tight">Form Coach</p>
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 rounded bg-primary/15 text-primary">Beta</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">AI form check on your lifts</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                </Card>
              </motion.div>

              <motion.div variants={itemVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
                <Card
                  className="group p-4 cursor-pointer border-border/70 hover:border-accent/40 transition-colors h-full"
                  onClick={() => setSavedWorkoutsOpen(true)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0 group-hover:bg-accent/15 transition-colors">
                      <History className="w-5 h-5 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold text-sm leading-tight">{t('workout.savedWorkouts') || 'Saved Workouts'}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t('workout.savedWorkoutsDesc') || 'View your past workouts'}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                </Card>
              </motion.div>
            </motion.div>
          </>
        ) : (
          <div className="mb-8">
            <Button variant="outline" onClick={() => setRegimensOpen(false)} className="mb-4">
              {t('workout.back')}
            </Button>
            <RegimensSection onStartRegimen={startFromRegimen} />
          </div>
        )}

        {/* Paused workouts */}
        {sessions.length > 0 && (
          <div className="space-y-2 mb-6">
            <AnimatePresence>
              {sessions.map(session => (
                <motion.div
                  key={session.id}
                  initial={{ opacity: 1, x: 0, height: 'auto' }}
                  exit={{ opacity: 0, x: '110%', height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.35, ease: 'easeInOut' }}
                  style={{ overflow: 'hidden' }}
                >
                  <motion.div
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 20 }}
                  >
                    <Card
                      className="p-4 border-orange-400/40 bg-orange-400/5 cursor-pointer hover:bg-orange-400/10 transition-colors"
                      onClick={() => handleResumeSession(session.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-orange-400/20 flex items-center justify-center shrink-0">
                            <Pause className="w-4 h-4 text-orange-400" />
                          </div>
                          <div>
                            <p className="font-heading font-bold text-sm">
                              {t('workout.resume')} {session.selectedRegimen ? session.selectedRegimen.name : t('workout.freestyle')}
                            </p>
                            <p className="text-xs text-muted-foreground">{session.exercises?.length || 0} {t('workout.exercises').toLowerCase()} · {t('workout.paused')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs text-muted-foreground hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); removeSession(session.id); }}
                          >
                            {t('workout.discard')}
                          </Button>
                          <Button size="sm" className="bg-orange-400 hover:bg-orange-500 text-white text-xs">
                            {t('workout.resumeLabel')}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {isLoading && (
          <div className="space-y-3">
            {[1,2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        )}

        <GoalsModal open={goalsModalOpen} onClose={() => setGoalsModalOpen(false)} goals={goals} logs={logs} userProfile={userProfile} />

        <Dialog open={savedWorkoutsOpen} onOpenChange={setSavedWorkoutsOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2">
                <History className="w-5 h-5 text-accent" />
                {t('workout.savedWorkouts') || 'Saved Workouts'}
              </DialogTitle>
            </DialogHeader>
            <div className="mt-2">
              <WorkoutSavedList onSelectLog={(log) => { setSavedWorkoutsOpen(false); setEditingLog(log); }} />
            </div>
          </DialogContent>
        </Dialog>

        {editingLog && (
          <EditWorkoutModal
            log={editingLog}
            userProfile={userProfile}
            logs={logs}
            cardioLogs={cardioLogs}
            open={!!editingLog}
            onClose={() => setEditingLog(null)}
            onSave={async (id, data) => {
              // Volume delta on edit. Without this, a user could log a heavy
              // session (huge total_volume_lbs accrual for XP/leaderboards),
              // then edit the same log down to 0 — keeping the volume credit
              // even though the underlying log is empty.
              const oldVolume = calculateTotalVolume(editingLog?.exercises || []);
              const newVolume = calculateTotalVolume(data?.exercises || []);
              const delta = newVolume - oldVolume;
              await db.entities.WorkoutLog.update(id, data);
              if (delta !== 0) {
                try {
                  await supabase.rpc('increment_user_volume', { p_delta: delta });
                } catch (err) { console.warn('[Workout] edit volume delta failed:', err); }
              }
              queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] });
              queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
              setEditingLog(null);
            }}
            onDelete={async (id) => {
              // Same volume accumulator concern on delete — subtract the
              // deleted log's contribution so leaderboards reflect reality.
              const deletedVolume = calculateTotalVolume(editingLog?.exercises || []);
              await db.entities.WorkoutLog.delete(id);
              if (deletedVolume > 0) {
                try {
                  await supabase.rpc('increment_user_volume', { p_delta: -deletedVolume });
                } catch (err) { console.warn('[Workout] delete volume delta failed:', err); }
              }
              queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] });
              queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
              setEditingLog(null);
            }}
          />
        )}

        {/* AI modals — MUST be mounted in the idle view because that's where
            their trigger cards live (Generate Workout, Form Coach). Without
            this, clicking the cards updates state but no modal exists in
            the tree to react to the change. Each is wrapped in its own
            ErrorBoundary so a TF.js load failure or generator crash doesn't
            take down the whole Workout page. */}
        <ErrorBoundary label="FormCoach">
          <FormCoachModal open={formCoachOpen} onClose={() => setFormCoachOpen(false)} />
        </ErrorBoundary>

        <ErrorBoundary label="WorkoutGenerator">
          <WorkoutGeneratorModal
            open={generatorOpen}
            onClose={() => setGeneratorOpen(false)}
            userProfile={userProfile}
            onUseWorkout={startFromGeneratedWorkout}
            onSaveAsRegimen={saveGeneratedAsRegimen}
          />
        </ErrorBoundary>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 28 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="p-4 md:p-8 max-w-3xl mx-auto"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold tracking-tight">
            {selectedRegimen?.name || t('workout.freestyle')}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t('workout.logSetsReps')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => resetWorkout(activeSessionId)}>{t('common.cancel')}</Button>
      </div>

      <div className="mb-6">
        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('workout.date')}</label>
        <p className="font-heading text-lg font-semibold tracking-tight">
          {format(new Date(), 'EEEE, MMMM d')}
        </p>
      </div>

      {/* Add exercise — kept above the list so users don't have to scroll
          past every added exercise to add the next one. */}
      <Card className="p-4 border-dashed mb-6">
        <p className="text-sm font-medium mb-3">{t('workout.addExercise')}</p>
        <div className="flex gap-2">
          <div className="flex-1">
            <ExerciseAutocomplete
              value={newExName}
              onChange={setNewExName}
              onSelect={(exercise) => {
                setNewExName(exercise.displayName || exercise.name);
                setNewExCanonical(exercise.name);
                setNewExMuscles(exercise.muscles || []);
              }}
              placeholder={t('workout.searchExercise')}
            />
          </div>
          <Button type="button" onClick={addExercise} disabled={!newExName.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </Card>

      <motion.div
        className="space-y-4 mb-6"
        initial="hidden"
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }}
      >
        {exercises.map((ex, i) => (
          <motion.div
            key={i}
            className="relative"
            variants={{ hidden: { opacity: 0, y: 16, scale: 0.97 }, visible: { opacity: 1, y: 0, scale: 1 } }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <ExerciseLogger
              exercise={ex}
              onChange={(updated) => updateExercise(i, updated)}
              userProfile={userProfile}
            />
            <div className="absolute top-3 right-3 flex items-center gap-1">
              {!selectedRegimen && (
                <button
                  type="button"
                  onClick={() => setExercises(exercises.filter((_, idx) => idx !== i))}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label="Remove exercise"
                  title="Remove exercise"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>

      <div className="mb-4">
        <label htmlFor="workout-notes" className="text-xs font-medium text-muted-foreground mb-1 block">{t('workout.notes')}</label>
        <Textarea id="workout-notes" value={notes} onChange={e => guard.handleChange(e.target.value, setNotes)} placeholder={t('workout.notesPlaceholder')} className="h-20" maxLength={1000} />
      </div>

      <ProgressPhotoCapture workoutName={selectedRegimen?.name || t('workout.freestyle')} />

      <motion.div whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.01 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }} className="mt-6">
        <Button
          className="w-full h-12 font-heading font-bold text-base mb-8"
          onClick={saveWorkout}
          disabled={exercises.length === 0 || saveMutation.isPending}
        >
          <Save className="w-5 h-5 mr-2" />
          {saveMutation.isPending ? t('workout.saving') : t('workout.saveWorkout')}
        </Button>
      </motion.div>



      {/* Anti-cheat warning modal */}
      <Dialog open={!!cheatWarningData} onOpenChange={(open) => { if (!open) setCheatWarningData(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              Unrealistic values detected
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            One or more sets have weights or reps outside realistic limits for your profile.
            The flagged fields have been cleared — please enter valid values before saving.
          </p>
          {cheatWarningData?.flaggedSets?.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-1 mt-1">
              {cheatWarningData.flaggedSets.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive/60 shrink-0 mt-1" />
                  <span>
                    <span className="font-medium text-foreground">{f.exName}</span>
                    {' — '}Set {f.setIndex + 1}
                    {f.weightFlagged && f.maxWeight != null && (
                      <span className="block text-[10px]">Weight exceeds {f.maxWeight} lbs max for your profile</span>
                    )}
                    {f.repsFlagged && f.maxReps != null && (
                      <span className="block text-[10px]">Reps exceed {f.maxReps} reps max at that weight</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 mt-2">
            <Button className="w-full" onClick={() => {
              const { flaggedSets } = cheatWarningData;
              // Count how many fields we're about to clear so the
              // follow-up toast can be specific. Without this, the user
              // dismisses the dialog and lands on a form with mysteriously
              // empty inputs — no breadcrumb to what changed.
              let weightsCleared = 0;
              let repsCleared = 0;
              for (const f of flaggedSets) {
                if (f.weightFlagged) weightsCleared += 1;
                if (f.repsFlagged) repsCleared += 1;
              }
              setExercises(exercises.map((ex, exIndex) => ({
                ...ex,
                sets: (ex.sets || []).map((s, setIndex) => {
                  const flag = flaggedSets.find(f => f.exIndex === exIndex && f.setIndex === setIndex);
                  if (!flag) return s;
                  return {
                    ...s,
                    weight: flag.weightFlagged ? null : s.weight,
                    reps:   flag.repsFlagged   ? null : s.reps,
                  };
                }),
              })));
              setCheatWarningData(null);
              // Single follow-up toast naming exactly what was cleared.
              const parts = [];
              if (weightsCleared) parts.push(`${weightsCleared} weight${weightsCleared === 1 ? '' : 's'}`);
              if (repsCleared) parts.push(`${repsCleared} rep ${repsCleared === 1 ? 'field' : 'fields'}`);
              const cleared = parts.join(' and ');
              if (cleared) {
                toast.message(`Cleared ${cleared}`, {
                  description: 'Re-enter realistic values and Save again.',
                  duration: 5000,
                });
              }
            }}>
              Go Back &amp; Fix
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Missing data warning */}
      <AlertDialog open={!!missingDataWarning} onOpenChange={(open) => !open && setMissingDataWarning(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Missing Data
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>This workout has empty sets or missing weights/reps:</p>
                <ul className="list-disc pl-5 text-sm space-y-0.5 max-h-40 overflow-y-auto">
                  {(missingDataWarning || []).slice(0, 8).map((m, i) => (
                    <li key={i}>
                      <span className="font-medium">{m.exName}</span>
                      {m.setIndex ? ` — set ${m.setIndex}` : ''} ({m.reason})
                    </li>
                  ))}
                  {(missingDataWarning || []).length > 8 && (
                    <li className="text-muted-foreground">…and {missingDataWarning.length - 8} more</li>
                  )}
                </ul>
                <p className="pt-2">Save the workout anyway?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMissingDataWarning(null)}>Go back and fix</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setMissingDataWarning(null); saveWorkout(true); }}>
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Implausible workout volume modal */}
      <Dialog open={!!implausibleWarning} onOpenChange={(open) => { if (!open) setImplausibleWarning(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              Workout looks unrealistic
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{implausibleWarning}</p>
          <Button className="w-full mt-2" onClick={() => setImplausibleWarning(null)}>
            Dismiss
          </Button>
        </DialogContent>
      </Dialog>

      <ProfanityWarningDialog open={guard.open} onContinue={guard.onContinue} />

      {/* Each AI modal in its own ErrorBoundary so a TF.js load failure or
          generator crash doesn't take down the whole Workout page. */}
      <ErrorBoundary label="FormCoach">
        <FormCoachModal open={formCoachOpen} onClose={() => setFormCoachOpen(false)} />
      </ErrorBoundary>

      <ErrorBoundary label="WorkoutShareCard">
        <WorkoutShareCard
          open={!!shareCardWorkout}
          onClose={() => setShareCardWorkout(null)}
          workout={shareCardWorkout}
          username={user?.username ? `@${user.username}` : (user?.email?.split('@')[0] || 'Athlete')}
        />
      </ErrorBoundary>

      <ErrorBoundary label="WorkoutGenerator">
        <WorkoutGeneratorModal
          open={generatorOpen}
          onClose={() => setGeneratorOpen(false)}
          userProfile={userProfile}
          onUseWorkout={startFromGeneratedWorkout}
          onSaveAsRegimen={saveGeneratedAsRegimen}
        />
      </ErrorBoundary>

      {editingLog && (
        <EditWorkoutModal
          log={editingLog}
          userProfile={userProfile}
          logs={logs}
          cardioLogs={cardioLogs}
          open={!!editingLog}
          onClose={() => setEditingLog(null)}
          onSave={async (id, data) => {
            await db.entities.WorkoutLog.update(id, data);
            queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] });
            setEditingLog(null);
          }}
          onDelete={async (id) => {
            await db.entities.WorkoutLog.delete(id);
            queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] });
            setEditingLog(null);
          }}
        />
      )}
    </motion.div>
  );
}