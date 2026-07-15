import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { filterAfterReset } from '@/lib/accountReset';
import { useLanguage } from '@/lib/LanguageContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { isAppAdmin } from '@/lib/adminRoles';
import { setLayoutDefault } from '@/lib/data/layoutDefaults';
import { format, parseISO, subDays } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { triggerHaptic } from '@/lib/haptic';
import { playSound, SOUND } from '@/lib/playSound';
import { Play, Save, Plus, Dumbbell, Trash2, Target, Pause, AlertTriangle, Activity, ArrowRight, History, Camera, Sparkles, Globe, Swords, Zap, Trophy, Link2, Calculator, CalendarDays, ChevronDown, LayoutGrid, Shield } from 'lucide-react';
import PlateCalculatorModal from '@/components/workout/PlateCalculatorModal';
import { useMultiProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import CardioSection from '@/components/cardio/CardioSection';
import WorkoutShareCard from '@/components/workout/WorkoutShareCard';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import WorkoutSavedList from '@/components/workout/WorkoutSavedList';
import { Skeleton } from '@/components/ui/skeleton';
import ExerciseLogger, { isBodyweightExercise } from '@/components/workout/ExerciseLogger';
import LiveVolumePill from '@/components/workout/LiveVolumePill';
import { buildPRIndex } from '@/lib/data/personalRecords';
import { recordWorkoutExercises } from '@/lib/recentExerciseUsage';
import ExerciseAutocomplete, { EXERCISE_LIBRARY } from '@/components/regimens/ExerciseAutocomplete';
import GroupBlock from '@/components/workout/GroupBlock';
import WorkoutElapsedChip from '@/components/workout/WorkoutElapsedChip';
import InjuryBanner from '@/components/workout/InjuryBanner';
import ComebackScreen from '@/components/workout/ComebackScreen';
import { useComebackProtocol } from '@/hooks/useComebackProtocol';
import { listActiveInjuries } from '@/lib/data/injuries';
import { getActiveDuel } from '@/lib/data/duels';
import { getMyCrews } from '@/lib/data/crews';
import { getActiveWarForCrew, contributeWarXp } from '@/lib/data/crewWars';
import { getMyActiveClaim, listActiveBounties } from '@/lib/data/bounties';
import NemesisCard from '@/components/nemesis/NemesisCard';
import { getMyProgress as getGauntletProgress, checkGauntletProgress } from '@/lib/data/gauntlet';
import GauntletStatsModal from '@/components/gauntlet/GauntletStatsModal';
import { reportError } from '@/lib/reportError';
import { errorToast } from '@/lib/errorToast';
import { fireFirstWorkoutCelebration } from '@/lib/firstWorkoutCelebration';
import { firePRCelebration, OPEN_PR_SHARE_EVENT } from '@/lib/prCelebration';
import { detectPRsInWorkout } from '@/lib/data/personalRecords';
import { detectDeloadOpportunity } from '@/lib/deloadDetector';
import { enqueueReveal } from '@/lib/rewardQueue';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import * as capsules from '@/lib/data/capsules';
import * as activity from '@/lib/data/activity';
import GoalsAlmostComplete from '@/components/goals/GoalsAlmostComplete';
import RegimensSection from '@/components/workout/RegimensSection';
import RegimenStorePage from '@/components/regimens/RegimenStorePage';
import StarterPlanHeroCard from '@/components/workout/StarterPlanHeroCard';
import RoutineTodayCard from '@/components/routines/RoutineTodayCard';
import MyRoutineSheet from '@/components/routines/MyRoutineSheet';
import FirstWorkoutTutorial, { hasSeenFirstWorkoutTutorial } from '@/components/workout/FirstWorkoutTutorial';
import PageHeader from '@/components/PageHeader';
import { useWorkoutSessions, pauseWorkoutSync } from '@/hooks/useWorkoutSessions';
import { calculateWorkoutXp } from '@/lib/xpSystem';
import { hasCheckedInToday, GYM_CHECKIN_XP_MULTIPLIER } from '@/lib/data/gymCheckins';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import * as leagues from '@/lib/data/leagues';
import * as workoutStreak from '@/lib/data/workoutStreak';
import * as notifications from '@/lib/data/notifications';
import { speakWorkoutComplete } from '@/lib/audioCues';
import { getMaxRealisticWeight, getMaxRealisticReps, getMaxRealisticDuration, shouldKeepSet, looksLikeBodyweight } from '@/lib/realisticLimits';
import { detectImplausibleWorkout, getMaxSetsPerExercise, getMuscleGroupCap } from '@/lib/workoutFatigue';
import { totalVolume as computeTotalVolume } from '@/lib/workoutVolume';
import { seedSetsForExercise } from '@/lib/seedRegimenSets';

// Lazy-loaded modals — all consolidated AFTER imports so Vite's bundle
// init doesn't hit a TDZ when consts sit between import statements
// (the bug that crashed /hub twice in this session). FormCoachModal
// in particular pulls vendor-pose / vendor-tfjs through its
// detectorPrewarm chain; static import would defeat tree-shaking.
const FormCoachModal       = lazy(() => import('@/components/formcoach/FormCoachModal'));
const WorkoutGeneratorModal = lazy(() => import('@/components/workout/WorkoutGeneratorModal'));
const EditWorkoutModal     = lazy(() => import('@/components/workout/EditWorkoutModal'));
const ProgressPhotoCapture = lazy(() => import('@/components/progress/ProgressPhotoCapture'));
const InjuryForm           = lazy(() => import('@/components/workout/InjuryForm'));
const PRShareCard          = lazy(() => import('@/components/workout/PRShareCard'));
const GoalsModal           = lazy(() => import('@/components/goals/GoalsModal'));

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

// Classify an exercise's muscle groups for the save-time set filter so a
// 0-weight set isn't silently discarded. (Audit task 4.)
//   - bodyweight: name matches a calisthenics pattern (push-up, plank,
//     dip, pull-up, …) → reps-only sets are legit work.
//   - cardio: a Cardio group → duration/0-weight sets are legit.
function exerciseGroups(ex) {
  return ex?.muscle_groups?.length
    ? ex.muscle_groups
    : (ex?.muscle_group ? [ex.muscle_group] : []);
}
function exerciseIsCardio(ex) {
  return exerciseGroups(ex).some(
    (g) => typeof g === 'string' && g.toLowerCase() === 'cardio'
  );
}
function exerciseIsBodyweight(ex) {
  const name = ex?.name || ex?.displayName || '';
  return isBodyweightExercise(name) || looksLikeBodyweight(name);
}

// Whitelist-spread per-set metadata the lifter tagged (warmup, failed,
// RPE, RIR, feel emoji/note) through the normalize maps on save. The
// maps used to reduce each set to {weight,reps}, silently dropping all
// of it — same data-loss concern already fixed for repeat-from-log and
// the edit modal. (Audit task 6.)
function pickSetMeta(s) {
  const out = {};
  if (s.is_warmup  !== undefined) out.is_warmup  = s.is_warmup;
  if (s.is_failed  !== undefined) out.is_failed  = s.is_failed;
  if (s.rpe        !== undefined) out.rpe        = s.rpe;
  if (s.rir        !== undefined) out.rir        = s.rir;
  if (s.feel_emoji !== undefined) out.feel_emoji = s.feel_emoji;
  if (s.feel_note  !== undefined) out.feel_note  = s.feel_note;
  return out;
}

/**
 * Reorder.Item wrapper that uses an EXPLICIT drag handle instead of
 * letting the whole item catch pointer events. The default Reorder.Item
 * grabs any vertical drag on the card — meaning users scrolling the
 * page through an exercise card accidentally started reordering, and
 * the workouts would shuffle when they were trying to scroll. (See
 * screenshot feedback "you can't really scroll through the page up
 * or down because it starts like moving the workouts.")
 *
 * Now the drag handle is the small grip pill at the top-center of each
 * card. Touching anywhere else just scrolls / interacts with the
 * normal logger UI.
 */
function ReorderItemWithHandle({ value, children, className }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={value}
      className={className}
      whileDrag={{ scale: 1.02, boxShadow: '0 10px 25px rgba(0,0,0,0.25)' }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      dragListener={false}
      dragControls={controls}
    >
      <div
        onPointerDown={(e) => controls.start(e)}
        className="absolute top-1 start-1/2 -translate-x-1/2 z-10 w-10 h-5 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none"
        aria-label="Drag to reorder"
        role="button"
      >
        <span className="w-8 h-1 rounded-full bg-muted-foreground/30 hover:bg-muted-foreground/60 transition-colors" />
      </div>
      {children}
    </Reorder.Item>
  );
}


export default function Workout() {
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  // Auth / routing destructured EARLY — multiple useEffects below depend
  // on `user` in their deps arrays. A const referenced in a useEffect
  // deps array is evaluated synchronously at hook-call time, so it must
  // be declared BEFORE that hook line — TDZ otherwise (see CLAUDE.md
  // "TDZ trap" section). The other heavier hooks (useWorkoutSessions,
  // useQueryClient) stay below.
  const { user } = useAuth();
  const location = useLocation();
  const navigate  = useNavigate();
  const [started, setStarted] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  // First-workout tutorial visibility. Defaults true so a brand-new
  // session shows the tutorial; the effect below flips it to false
  // once user.id is known AND the per-user localStorage flag confirms
  // they've already seen it. The tutorial component writes the flag
  // itself on dismiss / unmount, so we just have to honor it on
  // subsequent mounts.
  const [showFirstTutorial, setShowFirstTutorial] = useState(true);
  // Workout start time (ISO). Set when a session starts, persisted in
  // the paused-workout localStorage so resuming after a refresh keeps
  // the timer continuous. Drives the live MM:SS clock in the header
  // AND the auto-filled duration field on save.
  const [startedAt, setStartedAt] = useState(null);

  // Live-activity presence (migration 088). When the user starts a
  // workout, mark them active for 90 min so followers see a green dot
  // in the Hub list and (eventually) a "X is working out right now"
  // badge on the feed. The TTL caps the damage if clearActive ever
  // fails to land — we don't want users stuck as "active" indefinitely.
  useEffect(() => {
    if (user?.id && hasSeenFirstWorkoutTutorial(user.id)) {
      setShowFirstTutorial(false);
    }
  }, [user?.id]);

  // Starter-plan hero dismissal. Removing the card from the Workout page
  // doesn't delete the regimen — it stays available under Regimens. The
  // choice is remembered per-user so it doesn't reappear next session.
  const [starterDismissed, setStarterDismissed] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    try { setStarterDismissed(!!localStorage.getItem(`flexyn.starterPlanDismissed.${user.id}`)); } catch { /* ignore */ }
  }, [user?.id]);
  const dismissStarterPlan = () => {
    setStarterDismissed(true);
    try { localStorage.setItem(`flexyn.starterPlanDismissed.${user?.id || 'anon'}`, '1'); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (started) {
      activity.markActive(90);
    }
    // We intentionally do NOT call clearActive() in the cleanup here —
    // resetWorkout already handles the explicit clear, and a cleanup
    // would also fire on every dependency change which would prematurely
    // clear the flag mid-session. The TTL is the safety net for the
    // edge case where the tab closes without saving.
  }, [started]);

  // PR share-card listener. firePRCelebration's toast includes a
  // "Share" action that dispatches OPEN_PR_SHARE_EVENT on the window.
  // We pop the lazy-loaded PRShareCard dialog in response. The event
  // detail carries { pr, unit } so the dialog renders the right card.
  const [prShare, setPrShare] = useState(null);
  useEffect(() => {
    const onOpen = (e) => setPrShare(e.detail || null);
    window.addEventListener(OPEN_PR_SHARE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PR_SHARE_EVENT, onOpen);
  }, []);
  const [selectedRegimen, setSelectedRegimen] = useState(null);
  const [exercises, setExercises] = useState([]);
  // Date defaults to today. Can be rolled back to yesterday for late-night sessions
  // that cross midnight (Rolling Day toggle).
  const todayStr    = format(new Date(), 'yyyy-MM-dd');
  const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const [date, setDate] = useState(todayStr);
  // Show the rolling-day banner from midnight until 5 AM.
  const isLateNight = new Date().getHours() < 5;
  const [rollingDay, setRollingDay] = useState(false);
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [newExName, setNewExName] = useState('');
  const [newExCanonical, setNewExCanonical] = useState('');
  const [newExMuscles, setNewExMuscles] = useState([]);
  const [editingLog, setEditingLog] = useState(null);
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);
  const [regimensOpen, setRegimensOpen] = useState(false);
  const [routineSheetOpen, setRoutineSheetOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [cardioOpen, setCardioOpen] = useState(false);
  const [formCoachOpen, setFormCoachOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [shareCardWorkout, setShareCardWorkout] = useState(null);
  const [savedWorkoutsOpen, setSavedWorkoutsOpen] = useState(false);
  const [activeInfo, setActiveInfo] = useState(null); // which card's ⓘ tooltip is open
  const [todayExpanded, setTodayExpanded] = useState(false); // Today chip → expands RoutineTodayCard
  const CARD_ORDER_DEFAULT = ['generate','explore','duels','bounties','regimens','saved','cardio','goals','nemesis','gauntlet','formcoach','crew'];
  const [cardOrder, setCardOrder] = useState(() => {
    try {
      const s = localStorage.getItem('wkt-card-order');
      if (s) {
        const p = JSON.parse(s);
        if (CARD_ORDER_DEFAULT.every(c => p.includes(c)) && p.length === CARD_ORDER_DEFAULT.length) return p;
      }
    } catch {}
    return [...CARD_ORDER_DEFAULT];
  });
  const [gridEditing, setGridEditing] = useState(false);
  const [dragSrcIdx, setDragSrcIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const HERO_COUNT = 3;
  const [[heroSlide, heroDir], setHeroState] = useState([0, 0]);
  const paginateHero = (dir) => setHeroState(([cur]) => [((cur + dir) % HERO_COUNT + HERO_COUNT) % HERO_COUNT, dir]);
  const heroDragging = useRef(false);
  const [cheatWarningData, setCheatWarningData] = useState(null);
  const [gauntletStatsModal, setGauntletStatsModal] = useState(null);
  const [implausibleWarning, setImplausibleWarning] = useState(null);
  const [missingDataWarning, setMissingDataWarning] = useState(null);
  const [cardioPageTitle, setCardioPageTitle] = useState(null);
  const [injuryFormOpen, setInjuryFormOpen] = useState(false);
  const [plateCalcOpen, setPlateCalcOpen] = useState(false);
  // Discard-confirmation gate for the "Cancel" button — destroying an
  // in-flight workout is irreversible, so we route it through a Radix
  // AlertDialog instead of firing resetWorkout() on the first tap.
  // (Audit task 2.)
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const guard = useMultiProfanityGuard();
  const { sessions, resumeWorkout, removeSession } = useWorkoutSessions(user?.id);
  const queryClient = useQueryClient();
  // user / location / navigate are already destructured at the top of
  // the component so the early useEffect deps arrays don't TDZ.

  // One-shot: when a session starts and no startedAt is set yet
  // (i.e. this is a NEW session, not a resume), stamp the current
  // time so the elapsed-timer can run from this moment. A resume
  // path sets startedAt explicitly from the paused snapshot.
  useEffect(() => {
    if (started && !startedAt) {
      setStartedAt(new Date().toISOString());
    }
    if (!started && startedAt) {
      // Workout reset / saved — clear the start so a fresh session
      // doesn't inherit the old timer value.
      setStartedAt(null);
    }
  }, [started, startedAt]);

  // Track user.id alongside the workout state so the unmount-time
  // pauseWorkoutSync call can pass the correct userId — paused workouts
  // are now per-user (see useWorkoutSessions.js header). Without this,
  // an unmount that happens between sign-in transitions would write to
  // the 'anon' bucket or the wrong user's namespace.
  const workoutStateRef = useRef({});
  workoutStateRef.current = { started, activeSessionId, selectedRegimen, exercises, date, duration, notes, startedAt, userId: user?.id };
  // Ref-based synchronous in-flight guard for saveWorkout. The
  // existing `saveMutation.isPending` check at line 1181 catches the
  // common case but the comment there acknowledges a race: when the
  // user taps "Save anyway" inside the missing-data warning dialog,
  // two rapid taps can enter saveWorkout() twice BEFORE React's
  // pending-state propagates, producing two WorkoutLog rows + two XP
  // grants. The ref flips synchronously on first call.
  const saveInFlightRef = useRef(false);

  // Single source of truth for writing the active session draft to
  // localStorage. Reads from workoutStateRef (kept current every render)
  // so it works from unmount cleanup, debounced ticks, AND raw DOM event
  // listeners that fire outside React's render cycle. Writes into the
  // SAME `paused_workouts.<userId>` shape useWorkoutSessions reads on
  // mount, so the Dashboard resume banner + the in-page resume path both
  // pick the draft up after a refresh / PWA kill / crash. (Audit task 1.)
  const persistActiveSession = useRef(() => {});
  persistActiveSession.current = () => {
    const { started, activeSessionId, selectedRegimen, exercises, date, duration, notes, startedAt, userId } = workoutStateRef.current;
    if (!started || !activeSessionId) return;
    pauseWorkoutSync(userId, {
      id: activeSessionId,
      selectedRegimen,
      exercises,
      date,
      duration,
      notes,
      startedAt,
      // Timestamp powers the "Resume Chest Day · 14 min ago" banner
      // on the Dashboard. Without it the banner can't show relative
      // age and can't auto-evict stale (>24h) drafts.
      pausedAt: new Date().toISOString(),
    });
  };

  // Unmount flush — covers bottom-nav tab switches and the back-arrow
  // pause path (both navigate away → component unmounts).
  useEffect(() => {
    return () => { persistActiveSession.current(); };
  }, []);

  // Continuous debounced persistence (~1s) of the active session. Before
  // this, the ONLY write was the unmount cleanup above — a hard refresh,
  // PWA kill, or crash mid-session lost everything (no unmount fires).
  // Now every edit to exercises/notes/duration/etc. schedules a write,
  // so a recovery draft is always at most ~1s stale. (Audit task 1.)
  useEffect(() => {
    if (!started || !activeSessionId) return undefined;
    const id = setTimeout(() => { persistActiveSession.current(); }, 1000);
    return () => clearTimeout(id);
  }, [started, activeSessionId, selectedRegimen, exercises, date, duration, notes, startedAt]);

  // Immediate flush on the events that fire when the tab/app is about to
  // be discarded WITHOUT a React unmount: 'pagehide' (bfcache / PWA
  // background / tab close) and visibilitychange→hidden (app switch on
  // mobile, where pagehide is unreliable). These are the windows where
  // the debounce timer would never get to fire. (Audit task 1.)
  useEffect(() => {
    const flush = () => { persistActiveSession.current(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Resume hook: when navigated here with `resumeSessionId` in router
  // state (from the Dashboard ResumeWorkoutBanner), hydrate the matching
  // paused session and drop the user straight into the active workout
  // view with all logged sets intact. Runs once on mount.
  useEffect(() => {
    const resumeId = location.state?.resumeSessionId;
    const repeatLog = location.state?.repeatFromLog;
    const startRoutine = location.state?.startRoutineExercises;
    if (!resumeId && !repeatLog && !startRoutine) return;

    // Resume-paused-session branch. Use the hook's resumeWorkout()
    // helper instead of re-reading localStorage directly. The legacy
    // un-namespaced 'paused_workouts' key was migrated to
    // 'paused_workouts.<userId>' in useWorkoutSessions, so a direct
    // read of the old key now misses every paused session.
    if (resumeId) {
      try {
        const session = resumeWorkout(resumeId);
        if (!session) return;
        setActiveSessionId(session.id);
        if (session.selectedRegimen) setSelectedRegimen(session.selectedRegimen);
        if (Array.isArray(session.exercises)) setExercises(session.exercises);
        // Only honor the resumed date if it's still TODAY's local
        // calendar day. Otherwise (e.g. paused at 11pm, resumed next
        // morning) we'd silently save the workout under yesterday's
        // date — wrong streak credit, wrong league bucket. Default to
        // today (the existing `setDate` default) instead. Wave 54
        // (Workout audit) caught this.
        if (session.date) {
          const todayStr = (() => {
            const d = new Date();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${dd}`;
          })();
          if (session.date === todayStr) setDate(session.date);
        }
        // Duration was historically string-typed (from a text Input) but
        // mixed code paths sometimes serialize it as a number. Accept
        // either and coerce to string for the state (which the Input
        // displays). Without this the typeof==='number' branch never
        // fired and the user's manually-entered duration was silently
        // lost on resume. Wave 54 (Workout audit) caught this.
        if (session.duration != null && session.duration !== '') {
          setDuration(String(session.duration));
        }
        if (typeof session.notes === 'string') setNotes(session.notes);
        // Resume the elapsed-time counter from the saved start. Without
        // this the clock would reset to 0 on reload mid-session, which
        // would lie about how long the workout has been running.
        if (typeof session.startedAt === 'string') setStartedAt(session.startedAt);
        setStarted(true);
        navigate(location.pathname, { replace: true, state: null });
      } catch { /* corrupted localStorage — ignore */ }
      return;
    }

    // Start-from-routine branch (Dashboard calendar / deep-link). Pre-loads
    // today's planned lifts with blank sets. Runs in the effect (before the
    // getLastSetsForExercise helper is defined) so we blank the sets here.
    if (Array.isArray(startRoutine)) {
      const mapped = startRoutine.map(ex => ({
        name:          ex.name,
        muscle_group:  Array.isArray(ex.muscles) ? (ex.muscles[0] || '') : '',
        muscle_groups: Array.isArray(ex.muscles) ? [...ex.muscles] : [],
        sets: [{ weight: null, reps: null }, { weight: null, reps: null }, { weight: null, reps: null }],
      }));
      setActiveSessionId(`routine-${Date.now()}`);
      if (location.state?.routineDayLabel) setSelectedRegimen({ name: location.state.routineDayLabel });
      setExercises(mapped);
      setStarted(true);
      navigate(location.pathname, { replace: true, state: null });
      return;
    }

    // Repeat-from-past-log branch. Clones the exercise list from the
    // referenced log but BLANKS the weight + reps on each set so the
    // user is entering fresh numbers, not editing yesterday's
    // numbers in place. We treat the past log as a TEMPLATE, not a
    // copy — keeping the weight/reps would invite accidentally
    // saving the old workout twice.
    if (repeatLog) {
      if (Array.isArray(repeatLog.exercises)) {
        const clonedExercises = repeatLog.exercises.map(ex => ({
          name:           ex.name,
          displayName:    ex.displayName || ex.name,
          muscle_group:   ex.muscle_group  || '',
          muscle_groups:  Array.isArray(ex.muscle_groups) ? [...ex.muscle_groups] : [],
          sets: (Array.isArray(ex.sets) && ex.sets.length > 0 ? ex.sets : [{}])
            .map(() => ({ weight: null, reps: null })),
        }));
        setExercises(clonedExercises);
        setStarted(true);
        // Notes carry forward as a hint of what they were trying to do.
        if (typeof repeatLog.notes === 'string') setNotes(repeatLog.notes);
      }
      // ALWAYS clear the state — even when repeatLog.exercises was
      // malformed and we couldn't seed the workout. Previously the
      // clear lived inside the Array.isArray branch, so a corrupt log
      // left the state in place forever and a single back-nav re-fired
      // this effect with the same broken payload.
      navigate(location.pathname, { replace: true, state: null });
    }
    // Dep on location.state (not []) so the effect re-fires when the
    // user is ALREADY on /workout and the saved-workouts modal calls
    // navigate('/workout', { state: { repeatFromLog } }). Previously the
    // mount-only effect made the "Repeat" button a silent dead button —
    // the URL changed but no session ever started. (Audit 09 #C-2.)
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // InjuryBanner fetches its own data internally — this query is unused.
  useQuery({
    queryKey: ['activeInjuries', user?.id],
    queryFn: listActiveInjuries,
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const regimens = useMemo(() => filterAfterReset(rawRegimens, userProfile), [rawRegimens, userProfile]);
  const logs = useMemo(() => filterAfterReset(rawLogs, userProfile), [rawLogs, userProfile]);
  // Build PR index ONCE per logs change so set-row PR comparison
  // is O(1) per render. Powers the PR proximity bar + the in-set
  // trophy stamp visible during the workout.
  const prIndex = useMemo(() => buildPRIndex(logs), [logs]);
  const goals = useMemo(() => filterAfterReset(rawGoals, userProfile), [rawGoals, userProfile]);
  const cardioLogs = useMemo(() => filterAfterReset(rawCardioLogs, userProfile), [rawCardioLogs, userProfile]);

  const { data: activeDuel } = useQuery({
    queryKey:  ['activeDuel', user?.id],
    queryFn:   getActiveDuel,
    enabled:   !!user?.id,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: activeBountyClaim } = useQuery({
    queryKey:  ['myActiveBountyClaim'],
    queryFn:   getMyActiveClaim,
    enabled:   !!user?.id,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: activeBounties = [] } = useQuery({
    queryKey:  ['activeBounties'],
    queryFn:   listActiveBounties,
    enabled:   !!user?.id,
    staleTime: 5 * 60_000,
  });

  const { data: gauntletProgress } = useQuery({
    queryKey:  ['gauntlet-progress'],
    queryFn:   getGauntletProgress,
    enabled:   !!user?.id,
    staleTime: 60_000,
  });

  // Comeback protocol — triggers when the user hasn't worked out in 7+ days
  const comebackProtocol = useComebackProtocol({
    workoutLogs: logs,
    hasActiveSession: sessions.length > 0,
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      // Anti-cheat: never accept future-dated workouts. Users could otherwise
      // front-load tomorrow's session today to game streaks or weekly leagues.
      //
      // The check uses the FURTHEST-EAST date (UTC + 14h) as the ceiling
      // so we don't block legitimate logging from Kiribati or other UTC+14
      // timezones at the same instant the server's UTC date is one day
      // behind. Previously the check was local-format, which let users in
      // UTC+14 timezones save workouts dated 1 day ahead of UTC.
      try {
        if (data?.date) {
          const maxDate = new Date(Date.now() + 14 * 60 * 60 * 1000);
          const ceilingYmd = maxDate.toISOString().slice(0, 10);
          if (data.date > ceilingYmd) {
            throw new Error('Workouts cannot be dated in the future.');
          }
        }
      } catch (e) {
        if (e.message === 'Workouts cannot be dated in the future.') throw e;
        // Date parsing failed — fall through (existing behavior)
      }

      // Empty-set filter — drop sets where neither weight nor reps carries
      // any real value. The missing-data dialog warns the user but allows
      // "Save anyway"; without this filter, those empty sets persisted and
      // counted toward set-count gates (Gauntlet 1, achievements) while
      // contributing 0 XP. A "meaningful" set must have reps > 0 (real
      // work) AND either weight > 0, OR be bodyweight/calisthenics, OR be
      // a cardio-style group. The bodyweight branch is critical — without
      // it pull-ups / push-ups / dips / planks logged with reps and 0
      // weight were ERASED and a calisthenics workout saved as
      // exercises:[] behind a success toast. Their XP (0.5/rep, see
      // xpSystem.js) now actually runs because the sets survive. (Audit
      // task 4.)
      data = {
        ...data,
        exercises: (data.exercises || []).map((ex) => {
          const ctx = { isBodyweight: exerciseIsBodyweight(ex), isCardio: exerciseIsCardio(ex) };
          const cleanedSets = (ex.sets || []).filter((s) => shouldKeepSet(s, ctx));
          return { ...ex, sets: cleanedSets };
        // After filtering, drop exercises that lost all their sets — they
        // were noise that the missing-data dialog already flagged.
        }).filter((ex) => (ex.sets?.length || 0) > 0),
      };

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
      // Audit C-2 — duplicate detection. The db.js shim returns
      // __duplicate=true when a prior attempt with the same
      // idempotency key already landed. Skip ALL credits in that case
      // so XP/volume/streak/leagues aren't double-counted on a retry.
      const isDuplicateSave = workoutLog?.__duplicate === true;
      let xpGained = isDuplicateSave ? 0 : calculateWorkoutXp(data);
      // Gym check-in 1.2x XP multiplier — sessions logged on a day the user
      // checked into a gym via the signage QR earn boosted XP. Best-effort:
      // the multiplier is a bonus, never a blocker, so a failed lookup just
      // skips it without affecting the save.
      let checkInBonus = false;
      if (xpGained > 0) {
        try {
          if (await hasCheckedInToday()) {
            xpGained = Math.round(xpGained * GYM_CHECKIN_XP_MULTIPLIER);
            checkInBonus = true;
          }
        } catch { /* skip the bonus on lookup failure */ }
      }
      const sessionVolume = isDuplicateSave ? 0 : calculateTotalVolume(data.exercises);

      if (!isDuplicateSave) {
        // Always fire XP + achievement check — even if XP is 0 (e.g.
        // bodyweight-only or capped workout) so that achievement unlocks
        // are never skipped. Wrapped in try-catch so a server-side
        // failure never kills the mutation or prevents the success
        // toast / workout reset from running.
        try {
          await db.functions.invoke('updateUserXpAndAchievements', {
            xp_gained: xpGained,
            action_type: 'workout_completed',
            action_data: { totalVolume: sessionVolume, workout_date: data.date }
          });
        } catch (xpErr) {
          reportError(xpErr, { feature: 'workout.xp-update', level: 'warning', userEmail: user?.email, xpGained, workoutDate: data.date });
        }

        // Bump progress on any active Solo Challenge claims the user
        // holds. Fire-and-forget — the workout save is the source of
        // truth, this is purely additive. The server caps progress at
        // each challenge's target so a retry can't double-count.
        // (See migration 171 + soloChallenges.js.)
        try {
          const { recordWorkoutProgress } = await import('@/lib/data/soloChallenges');
          await recordWorkoutProgress({
            volumeLbs:    sessionVolume,
            sessionCount: 1,
            cardioMin:    0,        // workout flow — cardio counted separately
            prsHit:       0,        // PR detection runs server-side via achievements
          });
        } catch (soloErr) {
          // Non-blocking — challenges just don't get bumped for this save.
          reportError(soloErr, { feature: 'workout.solo-challenge-bump', level: 'warning' });
        }

        // Complete any active Bounty claim this workout satisfies.
        // checkAndCompleteBounty compares the log's volume/lift against the
        // claim's target and, if met, calls the server-validated (claimant-
        // checked, idempotent) complete_bounty_claim RPC. bounties.js documents
        // this as "call after every workout save" — it was defined but never
        // wired, so claimed bounties could never be credited. Fire-and-forget.
        try {
          const { checkAndCompleteBounty } = await import('@/lib/data/bounties');
          await checkAndCompleteBounty({ exercises: data.exercises, id: workoutLog?.id });
        } catch (bountyErr) {
          reportError(bountyErr, { feature: 'workout.bounty-check', level: 'warning' });
        }
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
        let volumeCredited = false;
        try {
          const { error: rpcErr } = await supabase.rpc('increment_user_volume', {
            p_delta: sessionVolume,
          });
          if (rpcErr) {
            // Only fall back to read-modify-write when the RPC is
            // confirmed-missing (function not found / table not found
            // on pre-migration hosts). Falling back on ANY error — as
            // we used to — re-introduces the lost-update race that
            // mig 023's atomic UPDATE was designed to eliminate
            // (audit A-12). Transient network/auth failures now
            // surface as warnings instead of silently losing volume.
            const isMissing = rpcErr.code === '42883' || rpcErr.code === '42P01';
            reportError(rpcErr, { feature: 'workout.volume-rpc', level: 'warning', userEmail: user?.email, sessionVolume, isMissing });
            if (isMissing) {
              const me = await db.auth.me();
              const prev = Number(me?.total_volume_lbs) || 0;
              await db.auth.updateMe({ total_volume_lbs: prev + sessionVolume });
              volumeCredited = true;
            }
          } else {
            volumeCredited = true;
          }
        } catch (volErr) {
          reportError(volErr, { feature: 'workout.volume-accumulate', level: 'warning', userEmail: user?.email, sessionVolume });
        }
        // Audit D-4 — mark the row credited so the Dashboard's
        // reconcile pass doesn't re-credit. If the network died
        // between INSERT and this mark, volume_credited_at stays
        // NULL and reconcile_my_workout_volume() will fix it up
        // on next mount.
        if (volumeCredited && workoutLog?.id) {
          try {
            await supabase.rpc('mark_workout_volume_credited', { p_workout_log_id: workoutLog.id });
          } catch (markErr) {
            reportError(markErr, { feature: 'workout.mark-credited', level: 'warning', userEmail: user?.email });
          }
        }
      }

      // Return the CLAMPED data alongside the workoutLog so onSuccess can
      // show the correct XP / volume numbers in the success toast.
      // Previously onSuccess re-called calculateWorkoutXp on the original
      // unclamped data, which could overstate the XP by up to ~30% when
      // sets had been trimmed by the per-group cap.
      return { workoutLog, clampedData: data, xpGained, sessionVolume, isDuplicate: isDuplicateSave, checkInBonus };
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
      // Clear the in-flight guard so the user can retry. Without this
      // a save failure would leave the synchronous ref stuck true and
      // every subsequent saveWorkout() would silently bail.
      saveInFlightRef.current = false;
      // Roll back the optimistic insert AND tell the user something went
      // wrong — previously this swallowed the failure and the row just
      // disappeared with no toast, which is the worst possible UX.
      queryClient.setQueryData(['workoutLogs', user?.email], ctx.previous);
      reportError(err, { feature: 'workout.save', userEmail: user?.email });
      const code = err?.code || err?.status;
      // RLS / permission denied surfaces a clearer hint than a generic message.
      if (code === '42501' || /policy|permission/i.test(err?.message || '')) {
        errorToast({
          title: 'Could not save',
          description: 'Permission denied. Try signing in again.',
        });
      } else if (/network|fetch|failed to fetch/i.test(err?.message || '')) {
        errorToast({
          title: 'Could not save',
          description: 'Check your connection and try again.',
          retry: () => saveMutation.mutate(_data),
        });
      } else {
        errorToast({
          title: 'Could not save workout',
          description: err?.message || 'Try again.',
          retry: () => saveMutation.mutate(_data),
        });
      }
    },
    onSuccess: (result, _origData, ctx) => {
      // Clear in-flight guard on success too. (Wave 45.)
      saveInFlightRef.current = false;
      // Audit C-2 — duplicate-save short-circuit. A retry of a save
      // that already landed should NOT re-fire streak/league/quests/
      // crew wars/celebrations. We surface a quiet confirm toast and
      // reset the editor so the user knows the prior save is intact.
      if (result?.isDuplicate) {
        toast.success(tFallback('workout.alreadySaved', 'Workout already saved.'));
        if (activeSessionId) removeSession(activeSessionId);
        resetWorkout();
        queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] });
        return;
      }
      // Read clamped data + xpGained from the mutation result, NOT recompute
      // from the original payload. Recomputing on the original input ignored
      // the per-group cap clamping inside mutationFn and could overstate the
      // XP by ~30% on workouts that had sets trimmed.
      const clampedData = result?.clampedData || _origData;
      const xpGained = result?.xpGained ?? calculateWorkoutXp(clampedData);
      const checkInBonus = !!result?.checkInBonus;
      // Record exercise usage for autocomplete-ranking. Recently-
      // used exercises rise to the top of the autocomplete next
      // time the user starts a workout. Fire-and-forget — local.
      recordWorkoutExercises(user?.email, clampedData?.exercises);
      if (activeSessionId) removeSession(activeSessionId);
      // Snapshot the workout for the share card *before* resetting state.
      // Capturing here means the share card preview is built from exactly
      // what was saved (including the date and the user's actual data).
      setShareCardWorkout({ ...clampedData, date: clampedData.date || format(new Date(), 'yyyy-MM-dd') });
      resetWorkout();

      // First-workout milestone — detected via the snapshot onMutate
      // already captures into ctx.previous. Zero previous logs means
      // this save is the user's first-ever workout, which deserves a
      // distinct celebration rather than the regular saved toast.
      // Filter out optimistic placeholders so the cached optimistic
      // row from a prior attempt doesn't suppress the celebration.
      const realPrev = (ctx?.previous ?? []).filter(
        (row) => !(typeof row?.id === 'string' && row.id.startsWith('__optimistic__'))
      );
      const isFirstWorkout = realPrev.length === 0;
      // Sound effect — no-op unless the user has explicitly enabled
      // sounds in Settings. The celebration helper handles its own
      // haptic; the sound is layered for users who want both.
      playSound(SOUND.workoutSaved);
      if (isFirstWorkout) {
        // Enqueue through rewardQueue (B6) so the first-workout
        // celebration can't collide with the day-1 capsule grant
        // notification fired by LevelUpManager below — they get
        // serialized with ~700ms spacing instead of stacking.
        enqueueReveal(() => fireFirstWorkoutCelebration({ xpGained, userEmail: user?.email }));
        // Day-1 loot drop — reinforces the loot economy that the
        // day-0 welcome capsule introduced. Premium tier signals a
        // step up from the welcome standard so the reward FEELS
        // like progress, not a repeat. Fire-and-forget; the toast
        // is dispatched by LevelUpManager via the global event.
        // Idempotent — only grants once per user thanks to the
        // first_workout_capsule_granted profile flag.
        if (user?.id && user?.email) {
          capsules
            .grantForFirstWorkout(user.id, user.email)
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ['userCapsules', user.email] });
              queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
              queryClient.invalidateQueries({ queryKey: ['userProfile', user.email] });
            })
            .catch((err) => {
              // Before: silent + Sentry. The user celebrated their
              // first-workout capsule but never received it, then later
              // wondered why their Bag was empty. Now surface it so they
              // know to retry — the capsule is idempotent so a retry
              // is safe.
              toast.error(
                tFallback('workout.firstCapsuleFailed', "Your first-workout capsule didn't grant — log another workout to retry.")
              );
              reportError(err, { feature: 'workout.first-workout-capsule', userEmail: user?.email });
            });
        }
      } else {
        // "Save as template" action — pre-fills WorkoutTemplates with
        // this session so the user can repeat it later. We snapshot
        // clampedData up front because resetWorkout() clears the
        // editor state on the next tick.
        const sessionSnapshot = clampedData;
        toast.success(t('workout.saved'), {
          description: checkInBonus
            ? `${t('workout.savedXp').replace('{xp}', xpGained)} · ⚡ ${GYM_CHECKIN_XP_MULTIPLIER}x gym check-in`
            : t('workout.savedXp').replace('{xp}', xpGained),
          duration: 6000,
          action: {
            label: tFallback('workout.saveTemplate', 'Save as template'),
            onClick: async () => {
              const { saveTemplate } = await import('@/lib/data/workoutTemplates');
              const name = (sessionSnapshot?.regimen_name || '').trim()
                || tFallback('workout.templateDefaultName', 'My workout');
              const res = await saveTemplate({
                name: name.slice(0, 80),
                exercises: sessionSnapshot?.exercises || [],
              });
              if (res?.ok) {
                toast.success(tFallback('workout.templateSaved', 'Template saved — find it in the regimen list.'));
              } else if (res?.reason === 'no_exercises') {
                toast.error(tFallback('workout.templateNeedExercises', 'Session has no exercises to save.'));
              } else {
                toast.error(tFallback('workout.templateFailed', 'Could not save template — try again.'));
              }
            },
          },
        });
      }

      // PR detection — fires the 6th-family 🏋️ celebration when this
      // workout beat the user's historical best 1RM on any exercise.
      // Runs ONLY on non-first workouts; the first ever workout already
      // has its own louder celebration and "first attempt" of an
      // exercise can't be a "PR" by definition.
      //
      // realPrev is the workout-logs cache state BEFORE this save —
      // exactly the comparison window we want for "is this a PR?".
      // Filter out optimistic placeholders so a duplicate optimistic
      // entry from a retry doesn't inflate the historical PR index.
      if (!isFirstWorkout) {
        try {
          const prsLbs = detectPRsInWorkout(clampedData, realPrev);
          if (prsLbs.length > 0) {
            // Convert lb-stored values to the user's preferred unit so
            // the toast reads in their own currency (a kg user shouldn't
            // see "100 lb" in the celebration). fromLbs is a no-op when
            // weightUnit === 'lbs'.
            const unitLabel = weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lb';
            const prs = prsLbs.map(p => ({
              ...p,
              oldPR: fromLbs(p.oldPR, weightUnit),
              newPR: fromLbs(p.newPR, weightUnit),
              delta: fromLbs(p.delta, weightUnit),
            }));
            // Route through rewardQueue (B6). A workout that hits a
            // PR + crosses a streak milestone + completes a daily
            // quest would otherwise fire three overlapping toasts
            // and three colliding confetti bursts. With the queue,
            // each gets ~700ms to land before the next fires.
            enqueueReveal(() => firePRCelebration({
              prs,
              unit: unitLabel,
              userEmail: user?.email,
            }));
          }

          // Deload signal — soft suggestion when 3 consecutive weeks
          // of working volume are >2Ïƒ above the user's prior 4-week
          // baseline. Includes this just-saved workout's volume. The
          // toast is informational, not blocking; we never auto-deload.
          try {
            const deload = detectDeloadOpportunity([clampedData, ...realPrev]);
            if (deload?.suggest) {
              toast(
                tFallback(
                  'deload.suggest',
                  '3 weeks of high volume in a row. Consider a deload next week.'
                ),
                {
                  description: tFallback(
                    'deload.suggestDesc',
                    'Cut working sets ~40% to bank the gains.'
                  ),
                  duration: 7000,
                }
              );
            }
          } catch { /* non-critical */ }
        } catch (err) {
          // Non-critical — workout save already succeeded. Log to
          // Sentry but don't surface to the user.
          reportError(err, {
            feature: 'workout.pr-detection',
            level: 'warning',
            userEmail: user?.email,
          });
        }
      }

      // Voice cue (no-op if user has voice cues disabled)
      try { speakWorkoutComplete(); } catch {}

      // Comeback session bonus — +200 XP if any exercise has the comeback flag
      if ((clampedData?.exercises || []).some(ex => ex.comeback)) {
        db.functions.invoke('updateUserXpAndAchievements', {
          xp_gained: 200,
          action_type: 'comeback_bonus',
          action_data: {},
        })
          .then(() => {
            toast.success('Comeback bonus earned. Good to have you back.', { description: '+200 XP' });
            queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
          })
          .catch(() => {});
      }
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

      // Crew War contribution — fire-and-forget for each crew the user is in.
      // Shows a toast for the first active war found so the user knows their
      // workout counted toward the battle.
      if (user?.id && xpGained > 0) {
        getMyCrews(user.id)
          .then(async (myCrews) => {
            for (const crew of (myCrews || [])) {
              const war = await getActiveWarForCrew(crew.id).catch(() => null);
              if (!war || war.status !== 'active') continue;
              await contributeWarXp(war.id, crew.id, xpGained).catch(() => {});
              toast.success(`⚔️ +${xpGained} XP → ${crew.name}'s war score!`, {
                description: 'Your workout contributed to the Crew War.',
                duration: 4000,
              });
              // Only notify for the first active war to avoid toast spam
              break;
            }
          })
          .catch(() => {});
      }

      // Workout streak — milestone days celebrate with toast + confetti + invalidate profile
      workoutStreak.recordWorkoutDay(user)
        .then((res) => {
          if (res?.isNewDay && res.coinsAwarded > 0) {
            toast.success(t('dashboard.workoutStreakMilestone') === 'dashboard.workoutStreakMilestone'
              ? `🔥 ${res.streak}-day workout streak! +${res.coinsAwarded} coins`
              : t('dashboard.workoutStreakMilestone').replace('{day}', res.streak).replace('{coins}', res.coinsAwarded));
            // Confetti burst for every workout streak milestone (3, 5, 7, 14, 21, 30…)
            import('canvas-confetti').then(({ default: confetti }) => {
              const fire = (opts) => confetti({
                particleCount: 100,
                spread: 75,
                gravity: 0.85,
                colors: ['#f97316', '#fbbf24', '#ef4444', '#22c55e', '#a855f7'],
                ...opts,
              });
              fire({ origin: { x: 0.3, y: 0.5 } });
              setTimeout(() => fire({ origin: { x: 0.7, y: 0.5 } }), 200);
              setTimeout(() => fire({ origin: { x: 0.5, y: 0.35 }, particleCount: 60, spread: 50 }), 380);
            }).catch(() => {});
            // In-app notification on milestone
            notifications.notifyStreakMilestone({
              user,
              kind: 'workout',
              day: res.streak,
              coinsAwarded: res.coinsAwarded,
              eliteCapsuleAwarded: res.eliteCapsuleAwarded,
              t,
            })
              .then(() => queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] }))
              .catch(() => {});
          }
          queryClient.invalidateQueries({ queryKey: ['workoutStreakProfile', user?.id] });
          queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        })
        .catch(() => {});

      // Gauntlet path check — advances whichever challenge the user is on
      // (First Blood → The Final Gauntlet), using the just-saved workout +
      // history (realPrev is the pre-save cache = the right comparison
      // window for streak/weekly/PR metrics). Non-blocking, never throws.
      // Pass the saved log's id so the RPC can VERIFY the per-session
      // metrics server-side (mig 201) — the client evaluation is now just a
      // pre-check, not the source of truth.
      checkGauntletProgress({ workoutLog: clampedData, workoutLogId: result?.workoutLog?.id ?? null, historicalLogs: realPrev })
        .then((award) => {
          if (!award) return;
          queryClient.invalidateQueries({ queryKey: ['gauntlet-progress'] });
          queryClient.invalidateQueries({ queryKey: ['gauntlet-completions'] });
          queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
          // Show completion stats modal for the challenge that was cleared.
          import('@/lib/data/gauntlet').then(({ getGauntletStats }) =>
            getGauntletStats(award.sequence_number)
          ).then((stats) => {
            setGauntletStatsModal({
              type: 'path',
              challengeTitle: award.challenge_title ?? 'Challenge complete',
              xpAwarded: award.xp_awarded ?? 150,
              coinsAwarded: award.coins_awarded ?? 50,
              stats,
              pathCompleted: award.path_completed ?? false,
            });
          }).catch(() => {});
        })
        .catch(() => {});
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] }),
  });

  // Centralized in src/lib/workoutVolume.js so the live pill, save
  // mutation, and downstream displays all share the same formula
  // (and honor the user's include_bar_in_volume preference — audit
  // C-3).
  const calculateTotalVolume = (exList) =>
    computeTotalVolume(exList, { includeBarWeight: !!userProfile?.include_bar_in_volume });

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
      // Seed the set rows for this exercise. seedSetsForExercise honors an
      // explicit sets[] array (built-in programs / cloned templates) so
      // programs don't collapse to 3 blank sets, and falls back to the
      // scalar target_sets/target_reps shape for hand-built regimens.
      // History (getLastSetsForExercise) seeds weight where prescribed
      // weight is absent so progressive-overload tracking continues.
      // (Audit task 8 — extracted to src/lib/seedRegimenSets.js + tested.)
      const hasSetsArray = Array.isArray(ex.sets) && ex.sets.length > 0;
      const targetSets = hasSetsArray ? ex.sets.length : (ex.target_sets || 3);
      const seeded = getLastSetsForExercise(ex.name, targetSets);
      const sets = seedSetsForExercise(ex, seeded || []);

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

  // Start today's routine day — pre-load the lifts the user picked, seeded
  // from history where we have it (progressive-overload tracking continues).
  const startFromExerciseList = (exList, label) => {
    setActiveSessionId(`routine-${Date.now()}`);
    setSelectedRegimen(label ? { name: label } : null);
    const mapped = (exList || []).map(ex => {
      const seeded = getLastSetsForExercise(ex.name, 3);
      const sets = seeded
        ? seeded.map(s => ({ weight: s.weight ?? null, reps: s.reps ?? null }))
        : Array.from({ length: 3 }, () => ({ weight: null, reps: null }));
      return {
        name: ex.name,
        muscle_group: Array.isArray(ex.muscles) ? (ex.muscles[0] || '') : '',
        muscle_groups: Array.isArray(ex.muscles) ? [...ex.muscles] : [],
        sets,
      };
    });
    setExercises(mapped);
    setStarted(true);
  };

  // "Up for a challenge" — append ~2 bonus lifts matching today's focus.
  // No direct coin/XP grant (that would be farmable); the extra volume earns
  // its reward through the normal save flow. Pure cherry-on-top.
  const handleRoutineChallenge = (focus, dayExercises, label) => {
    const FOCUS_MUSCLES = {
      push:  ['Chest', 'Shoulders', 'Triceps'],
      pull:  ['Back', 'Biceps'],
      legs:  ['Legs', 'Glutes'],
      upper: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'],
      lower: ['Legs', 'Glutes', 'Core'],
      core:  ['Core'],
    };
    const targets = FOCUS_MUSCLES[focus] || [];
    const owned = new Set((dayExercises || []).map(e => e.name));
    const pool = EXERCISE_LIBRARY.filter(ex =>
      !owned.has(ex.name) &&
      (targets.length === 0 || (ex.muscles || []).some(m => targets.includes(m))),
    );
    const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, 2);
    if (picks.length === 0) { toast.message('Your plan already covers it — no bonus to add.'); return; }
    const toSession = (ex, setCount) => {
      const seeded = getLastSetsForExercise(ex.name, setCount);
      const sets = seeded
        ? seeded.map(s => ({ weight: s.weight ?? null, reps: s.reps ?? null }))
        : Array.from({ length: setCount }, () => ({ weight: null, reps: null }));
      return {
        name: ex.name,
        muscle_group: (ex.muscles || [])[0] || '',
        muscle_groups: ex.muscles || [],
        sets,
      };
    };
    const base = (dayExercises || []).map(ex => toSession(ex, 3));
    const bonus = picks.map(ex => toSession(ex, 2));
    setActiveSessionId(`challenge-${Date.now()}`);
    setSelectedRegimen(label ? { name: label } : null);
    setExercises([...base, ...bonus]);
    setStarted(true);
    toast.success(`🔥 Bonus added: ${picks.map(e => e.name).join(' + ')} — finish it for extra XP + coins!`);
  };

  const startFreestyle = () => {
    const id = `freestyle-${Date.now()}`;
    setActiveSessionId(id);
    setSelectedRegimen(null);
    setExercises([]);
    setStarted(true);
  };

  // Repeat-last-workout: the single biggest friction-reducer for daily users.
  // Pre-fills the same exercises with last session's weights and reps as
  // suggestions — if the user hits the same numbers they can save with one
  // tap; if they bumped up, they edit one cell. Same shape transform as
  // startFreestyle so the active-workout view doesn't notice it.
  const startFromLastWorkout = () => {
    const last = logs[0];
    if (!last) return;
    const id = `repeat-${last.id}-${Date.now()}`;
    setActiveSessionId(id);
    setSelectedRegimen(null);
    setExercises((last.exercises || []).map(ex => ({
      name: ex.name,
      muscle_group: ex.muscle_group || '',
      muscle_groups: ex.muscle_groups || (ex.muscle_group ? [ex.muscle_group] : []),
      // Preserve the tagged-set metadata from the prior session
      // (warmup, failed, RPE, RIR, feel_emoji, feel_note) rather than
      // flattening to weight+reps only. The user spent effort tagging
      // these in the original session — losing them silently makes
      // "Repeat last workout" feel like data loss. (Audit 09 #H-8.)
      sets: (ex.sets || []).map(s => ({
        weight:     s.weight ?? null,
        reps:       s.reps   ?? null,
        is_warmup:  s.is_warmup  || false,
        is_failed:  s.is_failed  || false,
        rpe:        s.rpe        ?? null,
        rir:        s.rir        ?? null,
        feel_emoji: s.feel_emoji ?? null,
        feel_note:  s.feel_note  ?? null,
      })),
    })));
    setNotes('');
    setStarted(true);
  };

  const handleComebackStart = (comebackExercises, title) => {
    comebackProtocol.dismiss();
    const id = `comeback-${Date.now()}`;
    setActiveSessionId(id);
    setSelectedRegimen(null);
    setExercises((comebackExercises || []).map(ex => ({
      ...ex,
      sets: (ex.sets || []).map(s => ({ weight: s.weight ?? null, reps: s.reps ?? null })),
    })));
    setNotes(title || '');
    setStarted(true);
  };

  const handleComebackSkip = () => {
    comebackProtocol.dismiss();
  };

  // Start an active workout pre-filled from the AI generator. SHARED between
  // both modal mount points (idle-view and active-view) so we never have to
  // worry about one path drifting from the other. Mirrors startFromRegimen /
  // startFreestyle so the form behaves identically regardless of entry point.
  const startFromGeneratedWorkout = (workout) => {
    const id = `generated-${Date.now()}`;
    setActiveSessionId(id);
    setSelectedRegimen(null);
    // Apply realistic-limit clamps at LOAD time so the user never sees
    // a prescription that the save layer will silently trim. Previously
    // the generator could suggest 200-rep sets that the saveMutation
    // clamping (per-muscle-group + per-exercise caps) would chop down
    // without telling the user, leaving them confused about XP.
    let clampedSomething = false;
    const clampedExercises = (workout?.exercises || []).map((ex) => {
      const maxWeight = getMaxRealisticWeight(ex.name, userProfile);
      return {
        name: ex.name,
        muscle_group: ex.group || '',
        muscle_groups: ex.group ? [ex.group] : [],
        sets: (ex.sets || []).map((s) => {
          let weight = s.weight != null ? Number(s.weight) : null;
          if (Number.isFinite(weight) && weight > maxWeight) {
            weight = maxWeight;
            clampedSomething = true;
          }
          const maxReps = getMaxRealisticReps(ex.name, weight, userProfile);
          let reps = s.reps != null ? Number(s.reps) : null;
          if (Number.isFinite(reps) && reps > maxReps) {
            reps = maxReps;
            clampedSomething = true;
          }
          return { weight, reps };
        }),
      };
    });
    setExercises(clampedExercises);
    setDuration(String(workout?.duration_minutes || ''));
    setNotes(workout?.title || '');
    setStarted(true);
    setGeneratorOpen(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    if (clampedSomething) {
      toast.success('Workout loaded — some sets were trimmed to realistic limits.');
    } else {
      toast.success('Workout loaded — log your sets!');
    }
  };

  // SHARED save-as-regimen handler for the AI generator modal — used at
  // both mount points so they can't drift.
  const saveGeneratedAsRegimen = async (workout) => {
    try {
      // Description previously had a mojibake "·" (UTF-8 byte-pair
      // displayed as two chars) in place of the intended middle-dot ·.
      // Cleaned up to a plain ASCII " — ". Also fall back the focus
      // label so an undefined `workout.focus` doesn't read as
      // "AI undefined session". (Screenshot feedback.)
      const focusLabel = workout?.focus ? `${workout.focus} ` : '';
      const mins = workout?.duration_minutes;
      const description = `AI ${focusLabel}session${mins ? ` — ${mins} min` : ''}`.trim();
      await regimens.create({
        name: workout.title || 'AI-Generated Workout',
        description,
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
      reportError(err, { feature: 'workout.save-regimen', userEmail: user?.email });
      // Surface the underlying error so beta testers can report something
      // specific. Profanity-filter rejection is the most common false
      // positive (AI titles occasionally trip the username profanity check
      // even on benign words), so flag that case explicitly.
      const reason = err?.code === 'PROFANITY'
        ? 'The AI-generated title was rejected by our filter — try regenerating for a different name.'
        : err?.message
          ? `Could not save regimen: ${err.message}`
          : 'Could not save regimen. Try again.';
      toast.error(reason);
    }
  };

  const handleResumeSession = (sessionId) => {
    const session = resumeWorkout(sessionId);
    if (!session) return;
    // Do NOT removeSession here. The draft must survive a refresh that
    // happens AFTER resume but before save — the save path (onSuccess /
    // resetWorkout) already calls removeSession(activeSessionId) once the
    // workout is actually persisted. Removing it on resume meant a
    // reload mid-resumed-session lost the draft entirely. (Audit task 3.)
    setActiveSessionId(session.id);
    setSelectedRegimen(session.selectedRegimen || null);
    setExercises(session.exercises || []);
    setDuration(session.duration != null ? String(session.duration) : '');
    setNotes(session.notes || '');
    // Restore the original start time so the elapsed-time clock stays
    // continuous instead of resetting to 0 on resume. (Audit task 3.)
    if (typeof session.startedAt === 'string') setStartedAt(session.startedAt);
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
    // two XP grants. Both the state-based and the synchronous ref-based
    // checks run — the ref is the actual safety net for within-tick races.
    if (saveInFlightRef.current || saveMutation.isPending) return;
    // NOTE: don't set saveInFlightRef.current = true here — saveWorkout
    // has many validation early-returns that don't call .mutate(), and
    // setting the ref here would strand it on the failing path. We
    // flip the ref right BEFORE the actual mutate() call below so
    // only successful entries through validation lock further taps.
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
        // Bodyweight/calisthenics + cardio exercises legitimately carry
        // 0 weight, so a reps-only set on them is NOT "missing data" and
        // must not be flagged as discardable. (Audit task 4.)
        const zeroWeightOk = exerciseIsCardio(ex) || exerciseIsBodyweight(ex);
        sets.forEach((s, i) => {
          const isBlank = (v) => v === null || v === undefined || v === '';
          const wMissing = isBlank(s.weight) || (!zeroWeightOk && Number(s.weight) === 0);
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
        ...pickSetMeta(s),
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
        ...pickSetMeta(s),
      })),
      duration_minutes: ex.duration_minutes != null
        ? Math.min(ex.duration_minutes, getMaxRealisticDuration())
        : null,
    }));

    // Auto-fill duration from the live elapsed timer when the user
    // didn't supply a manual value. Strong / Hevy / Jefit all default
    // to "real session time" — counting yourself is awful UX.
    const elapsedMin = startedAt
      ? Math.max(1, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000))
      : null;
    const effectiveDuration = duration
      ? Math.min(parseInt(duration) || 0, 360)
      : (elapsedMin ? Math.min(elapsedMin, 360) : null);

    // Audit C-2 — idempotency key for double-tap / network-retry
    // protection. crypto.randomUUID is widely supported; the fallback
    // is fine for pre-2021 browsers. The key is stable per
    // saveWorkout INVOCATION (not per mutationFn call) so the
    // errorToast retry button hands the same key back to the server.
    const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

    const pendingPayload = {
      regimen_id: selectedRegimen?.id || '',
      regimen_name: selectedRegimen?.name || t('workout.freestyle'),
      date,
      duration_minutes: effectiveDuration,
      exercises: pendingExercises,
      notes,
      idempotency_key: idempotencyKey,
    };

    if (flaggedSets.length > 0) {
      setCheatWarningData({ pendingPayload, flaggedSets });
      return;
    }

    // Primary-action haptic — saving a workout is THE highest-intent
    // moment in the app. Fires once at the tap; the celebration helpers
    // fire their own distinct patterns afterward if a PR or first-
    // workout milestone lands.
    triggerHaptic('primary');

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
      cardioLogs,
      language,
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

    // Flip the synchronous in-flight guard right before firing the
    // mutation so a double-tap can't enter again until onSuccess /
    // onError clears it.
    saveInFlightRef.current = true;
    saveMutation.mutate(pendingPayload);
  };

  const resetWorkout = (clearSessionId = null) => {
    if (clearSessionId) removeSession(clearSessionId);
    // Clear the live-activity presence flag (migration 088). Fire-and-
    // forget — a failed clear isn't catastrophic; the TTL on
    // active_until (set by markActive at workout start) caps the
    // damage to 90 minutes even if this clear never lands.
    activity.clearActive();
    setStarted(false);
    setActiveSessionId(null);
    setSelectedRegimen(null);
    setExercises([]);
    setDuration('');
    setNotes('');
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  // Returns JSX for one grid row by ID. Defined here (inside component) so it
  // captures all state/handlers without prop-drilling. Used by both the static
  // Position-based colour palette (top=red, bottom=yellow) so colours
  // stay gradient-consistent regardless of which card occupies a slot.
  const getCardPalette = (idx) => {
    const P = [
      { bg:'rgba(220,38,38,0.32) 0%,rgba(244,63,94,0.22) 100%',  cls:'border-rose-500/55 hover:border-rose-500/75 hover:shadow-[0_0_18px_rgba(239,68,68,0.32)]' },
      { bg:'rgba(220,38,38,0.30) 0%,rgba(244,63,94,0.22) 100%',  cls:'border-rose-500/52 hover:border-rose-500/72 hover:shadow-[0_0_16px_rgba(239,68,68,0.30)]' },
      { bg:'rgba(220,38,38,0.28) 0%,rgba(249,115,22,0.22) 100%', cls:'border-primary/52  hover:border-primary/72  hover:shadow-[0_0_16px_rgba(244,63,94,0.28)]'  },
      { bg:'rgba(249,115,22,0.28) 0%,rgba(245,158,11,0.22) 100%',cls:'border-primary/50  hover:border-primary/70  hover:shadow-[0_0_16px_rgba(249,115,22,0.26)]' },
      { bg:'rgba(249,115,22,0.28) 0%,rgba(251,146,60,0.20) 100%',cls:'border-primary/48  hover:border-primary/68  hover:shadow-[0_0_14px_rgba(249,115,22,0.24)]' },
      { bg:'rgba(249,115,22,0.26) 0%,rgba(251,146,60,0.18) 100%',cls:'border-primary/45  hover:border-primary/65  hover:shadow-[0_0_14px_rgba(251,146,60,0.24)]' },
      { bg:'rgba(234,179,8,0.28) 0%,rgba(251,191,36,0.18) 100%', cls:'border-yellow-500/50 hover:border-yellow-500/70 hover:shadow-[0_0_14px_rgba(234,179,8,0.26)]' },
      { bg:'rgba(234,179,8,0.26) 0%,rgba(250,204,21,0.18) 100%', cls:'border-yellow-400/48 hover:border-yellow-400/68 hover:shadow-[0_0_14px_rgba(250,204,21,0.24)]' },
      { bg:'rgba(234,179,8,0.28) 0%,rgba(251,191,36,0.18) 100%', cls:'border-yellow-500/48 hover:border-yellow-500/68 hover:shadow-[0_0_14px_rgba(234,179,8,0.26)]' },
      { bg:'rgba(234,179,8,0.26) 0%,rgba(251,191,36,0.18) 100%', cls:'border-yellow-400/45 hover:border-yellow-400/65 hover:shadow-[0_0_14px_rgba(250,204,21,0.24)]' },
      { bg:'rgba(234,179,8,0.30) 0%,rgba(251,191,36,0.20) 100%', cls:'border-yellow-500/55 hover:border-yellow-500/75 hover:shadow-[0_0_14px_rgba(234,179,8,0.26)]' },
      { bg:'rgba(234,179,8,0.28) 0%,rgba(251,191,36,0.18) 100%', cls:'border-yellow-400/50 hover:border-yellow-400/70 hover:shadow-[0_0_14px_rgba(234,179,8,0.26)]' },
    ];
    const e = P[Math.min(Math.max(idx,0), P.length-1)];
    return { background:`linear-gradient(135deg,${e.bg})`, borderClass: e.cls };
  };

  // Renders a single grid card by ID. idx = position among non-nemesis cards
  // (drives colour palette so red stays at top, yellow at bottom).
  const renderCard = (id, idx) => {
    const InfoBtn = ({ bid }) => (
      <button type="button"
        onClick={(e) => { e.stopPropagation(); setActiveInfo(activeInfo === bid ? null : bid); }}
        className="absolute top-2 end-2 w-4 h-4 rounded-full border border-border/60 bg-background/80 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:border-border transition-colors z-10">
        <span className="text-[8px] font-bold leading-none italic">i</span>
      </button>
    );
    const InfoText = ({ bid, text }) => activeInfo === bid
      ? <p className="text-[11px] text-foreground/70 mt-1 leading-tight">{text}</p>
      : null;

    const pal = getCardPalette(idx);
    const cardBase = `group relative cursor-pointer h-full transition-colors p-3 ${pal.borderClass}`;

    if (id === 'generate') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card role="button" tabIndex={0} aria-label="Generate Workout"
          className={cardBase} style={{ background: pal.background }}
          onClick={() => setGeneratorOpen(true)}
          onKeyDown={(e) => { if (e.key==='Enter'||e.key===' '){e.preventDefault();setGeneratorOpen(true);} }}>
          <InfoBtn bid="generate" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 via-primary to-amber-400 flex items-center justify-center shrink-0 shadow-[0_2px_8px_rgba(239,68,68,0.3)]">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-heading font-bold text-sm leading-tight">{tFallback('generator.title','Generate Workout')}</p>
              <InfoText bid="generate" text="AI builds a personalised session from your history and goals." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    if (id === 'explore') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card role="button" tabIndex={0} aria-label="Explore Regimens"
          className={`${cardBase} overflow-hidden`} style={{ background: pal.background }}
          onClick={() => setStoreOpen(true)}
          onKeyDown={(e) => { if (e.key==='Enter'||e.key===' '){e.preventDefault();setStoreOpen(true);} }}>
          <InfoBtn bid="explore" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-rose-500/18 border border-rose-500/28 flex items-center justify-center shrink-0">
              <Globe className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <p className="font-heading font-bold text-sm leading-tight">Explore Regimens</p>
              <InfoText bid="explore" text="Browse top-rated community training programs and adopt one." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    if (id === 'duels') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card role="button" tabIndex={0} aria-label="Duels"
          className={cardBase} style={{ background: pal.background }}
          onClick={() => navigate('/duels')}
          onKeyDown={(e) => { if (e.key==='Enter'||e.key===' '){e.preventDefault();navigate('/duels');} }}>
          <InfoBtn bid="duels" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-rose-500/18 border border-rose-500/28 flex items-center justify-center shrink-0">
              <Swords className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                <p className="font-heading font-bold text-sm leading-tight">Duels</p>
                {activeDuel && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500">Active</span>}
              </div>
              <InfoText bid="duels" text="Challenge someone to a head-to-head workout battle." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    if (id === 'bounties') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card role="button" tabIndex={0} aria-label="Bounties"
          className={cardBase} style={{ background: pal.background }}
          onClick={() => navigate('/bounties')}
          onKeyDown={(e) => { if (e.key==='Enter'||e.key===' '){e.preventDefault();navigate('/bounties');} }}>
          <InfoBtn bid="bounties" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/18 border border-amber-500/28 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                <p className="font-heading font-bold text-sm leading-tight">Bounties</p>
                {activeBountyClaim && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600">Active</span>}
                {!activeBountyClaim && activeBounties.length>0 && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600">{activeBounties.length} open</span>}
              </div>
              <InfoText bid="bounties" text="Daily fitness challenges — complete them to earn Flex Coins." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    if (id === 'regimens') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card className={cardBase} style={{ background: pal.background }} onClick={() => setRegimensOpen(true)}>
          <InfoBtn bid="regimens" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-orange-500/18 border border-orange-500/28 flex items-center justify-center shrink-0">
              <Dumbbell className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="font-heading font-bold text-sm leading-tight">{t('workout.regimens')}</p>
              <InfoText bid="regimens" text="View and manage your saved training programs." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    if (id === 'saved') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card className={cardBase} style={{ background: pal.background }} onClick={() => setSavedWorkoutsOpen(true)}>
          <InfoBtn bid="saved" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-orange-400/18 border border-orange-400/28 flex items-center justify-center shrink-0">
              <History className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="font-heading font-bold text-sm leading-tight">{tFallback('workout.savedWorkouts','Saved Workouts')}</p>
              <InfoText bid="saved" text="Replay past workouts with your previous weights pre-filled." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    if (id === 'cardio') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card className={cardBase} style={{ background: pal.background }} onClick={() => setCardioOpen(true)}>
          <InfoBtn bid="cardio" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-yellow-500/18 border border-yellow-500/28 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <p className="font-heading font-bold text-sm leading-tight">{t('cardio.title')}</p>
              <InfoText bid="cardio" text="Log runs, rides, and cardio sessions separately from your lifting." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    if (id === 'goals') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card className={cardBase} style={{ background: pal.background }} onClick={() => setGoalsModalOpen(true)}>
          <InfoBtn bid="goals" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-yellow-400/18 border border-yellow-400/28 flex items-center justify-center shrink-0">
              <Target className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <p className="font-heading font-bold text-sm leading-tight">{t('workout.goals')}</p>
              <InfoText bid="goals" text="Set and track your fitness targets — strength, weight, endurance." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    if (id === 'nemesis') return (
      <div className="rounded-xl border-2 border-rose-500/60 bg-card overflow-hidden shadow-[0_0_18px_rgba(239,68,68,0.14)]">
        <div className="relative">
          <button type="button"
            onClick={(ev) => { ev.stopPropagation(); setActiveInfo(activeInfo==='nemesis'?null:'nemesis'); }}
            className="absolute top-2 end-2 w-4 h-4 rounded-full border border-border/60 bg-background/80 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:border-border transition-colors z-20">
            <span className="text-[8px] font-bold leading-none italic">i</span>
          </button>
          {activeInfo==='nemesis' && (
            <p className="absolute top-7 end-2 z-20 text-[11px] text-muted-foreground bg-background/95 border border-border/60 rounded-lg px-2 py-1.5 max-w-[180px] leading-tight shadow-sm">
              Your auto-assigned rival — beat their stats to dethrone them.
            </p>
          )}
          <ErrorBoundary label="NemesisCard">
            <NemesisCard currentUserId={user?.id} />
          </ErrorBoundary>
        </div>
      </div>
    );

    if (id === 'gauntlet') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card role="button" tabIndex={0} aria-label="Gauntlet"
          className={cardBase} style={{ background: pal.background }}
          onClick={() => navigate('/gauntlet')}
          onKeyDown={(e) => { if (e.key==='Enter'||e.key===' '){e.preventDefault();navigate('/gauntlet');} }}>
          <InfoBtn bid="gauntlet" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-yellow-500/18 border border-amber-500/28 flex items-center justify-center shrink-0">
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                <p className="font-heading font-bold text-sm leading-tight">Gauntlet</p>
                {gauntletProgress?.path_completed && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">Done</span>}
                {!gauntletProgress?.path_completed && gauntletProgress && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-500">#{gauntletProgress.current_challenge_sequence}</span>}
              </div>
              <InfoText bid="gauntlet" text="Complete 10 epic challenges to earn prizes and climb the leaderboard." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    if (id === 'formcoach') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card role="button" tabIndex={0} aria-label="Form Coach"
          className={`${cardBase} border-yellow-400/55 hover:border-yellow-400/75 hover:shadow-[0_0_14px_rgba(234,179,8,0.30)]`}
          style={{ background:'linear-gradient(135deg,rgba(234,179,8,0.32) 0%,rgba(251,191,36,0.22) 100%)' }}
          onClick={() => setFormCoachOpen(true)}
          onKeyDown={(e) => { if (e.key==='Enter'||e.key===' '){e.preventDefault();setFormCoachOpen(true);} }}>
          <InfoBtn bid="formcoach" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-yellow-400/22 border border-yellow-400/35 flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5">
                <p className="font-heading font-bold text-sm leading-tight">{tFallback('formcoach.title','Form Coach')}</p>
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 rounded bg-yellow-400/20 text-yellow-600">{tFallback('formcoach.beta','Beta')}</span>
              </div>
              <InfoText bid="formcoach" text="AI form feedback on your lifts — record a set and get instant coaching." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    if (id === 'crew') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card role="button" tabIndex={0} aria-label="Crew Wars"
          className={cardBase} style={{ background: pal.background }}
          onClick={() => navigate('/hub', { state:{ openCrewWars:true } })}
          onKeyDown={(e) => { if (e.key==='Enter'||e.key===' '){e.preventDefault();navigate('/hub',{state:{openCrewWars:true}});} }}>
          <InfoBtn bid="crew" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-yellow-500/22 border border-yellow-500/35 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <p className="font-heading font-bold text-sm leading-tight">Crew Wars</p>
              <InfoText bid="crew" text="Battle rival crews — contribute XP and fight for crew supremacy." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    return null;
  };


  useEffect(() => {
    const state = location?.state;
    let consumed = false;
    if (state?.openRegimens && !regimensOpen) {
      setRegimensOpen(true);
      consumed = true;
    }
    // Deep-link intent from DiscoveryCards "Try Form Coach" CTA.
    // Opens the FormCoachModal automatically so the user lands directly
    // on the feature instead of having to find the card on the idle
    // screen themselves.
    if (state?.openFormCoach) {
      setFormCoachOpen(true);
      consumed = true;
    }
    if (consumed) {
      window.history.replaceState({}, document.title);
    }
  }, []);

  // Listen for the global "open form coach" event so any caller — not
  // just a router state hand-off — can request the modal. Mirrors the
  // existing flexyn-title / flexyn:open-crew custom-event pattern so
  // we don't proliferate new orchestration shapes.
  useEffect(() => {
    const handler = () => setFormCoachOpen(true);
    window.addEventListener('flexyn:open-formcoach', handler);
    return () => window.removeEventListener('flexyn:open-formcoach', handler);
  }, []);

  useEffect(() => {
    const handler = (e) => setCardioPageTitle(e.detail?.title || null);
    window.addEventListener('flexyn-title', handler);
    return () => window.removeEventListener('flexyn-title', handler);
  }, []);

  useEffect(() => {
    if (!cardioOpen) setCardioPageTitle(null);
  }, [cardioOpen]);

  // Deep-link entry points used by daily-quest CTAs:
  //   /workout?openCardio=1   — CARDIO_COMPLETED / CARDIO_SECONDS quests
  //   /workout?openGoals=1    — GOAL_COMPLETED quest
  // The route map lives in src/lib/questCatalog.js. Without this handler
  // a user tapping a cardio/goals quest from Dashboard or StatsHub
  // would land on /workout but the corresponding panel wouldn't open
  // — silent breakage. We strip the param after consuming it so a
  // page reload doesn't re-fire and so the URL stays clean.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    let consumed = false;
    if (params.get('openCardio') === '1') {
      setCardioOpen(true);
      params.delete('openCardio');
      consumed = true;
    }
    if (params.get('openGoals') === '1') {
      setGoalsModalOpen(true);
      params.delete('openGoals');
      consumed = true;
    }
    if (consumed) {
      // Route through react-router's navigate so its internal
      // location state stays in sync. Direct
      // window.history.replaceState bypasses the router and left
      // location.search holding a stale value until the next
      // navigation, which could re-trigger the same panel-open on a
      // route change that re-reads location.search.
      const search = params.toString();
      navigate({ pathname: '/workout', search: search ? `?${search}` : '' }, { replace: true });
      // Land at the TOP of the opened view. React-router keeps the prior
      // scroll position across the route change, so a quest deep-link
      // (e.g. the cardio quest) otherwise dropped the user into the
      // middle of the newly-opened panel. Scroll after the panel renders.
      setTimeout(() => { try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch { /* noop */ } }, 0);
    }
  }, [location.search, navigate]);

  useEffect(() => {
    if (!started) return undefined;
    const handler = () => {
      // Back-arrow should PAUSE the session and navigate away — the same
      // behavior as switching bottom-nav tabs — NOT destroy the workout.
      // We do NOT preventDefault: letting the Header's default fire
      // navigates to /dashboard, which unmounts this page and triggers
      // the unmount-flush above, persisting the draft. Previously this
      // called resetWorkout() and silently nuked the in-flight session
      // with no confirmation. (Audit task 2.)
      persistActiveSession.current();
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
        className="px-4 pt-4 md:px-6 md:pt-6 lg:pb-6 max-w-5xl mx-auto"
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

        {/* Rolling Day Banner — visible midnight to 5 AM */}
        {isLateNight && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between gap-3 px-4 py-3 mb-4 rounded-xl border"
            style={{ background: 'hsl(var(--primary) / 0.08)', borderColor: 'hsl(var(--primary) / 0.25)' }}
          >
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight" style={{ color: 'hsl(var(--primary))' }}>
                {'🌙'} Late-night session
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                Log as <span className="font-semibold">{rollingDay ? `yesterday (${yesterdayStr})` : `today (${todayStr})`}</span> — toggle to roll back
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">{rollingDay ? 'Yesterday' : 'Today'}</span>
              <button
                type="button"
                onClick={() => {
                  const next = !rollingDay;
                  setRollingDay(next);
                  setDate(next ? yesterdayStr : todayStr);
                }}
                className="relative w-10 h-5 rounded-full transition-colors shrink-0"
                style={{ background: rollingDay ? 'hsl(var(--primary))' : 'hsl(var(--muted))' }}
                aria-label="Toggle rolling day"
              >
                <span
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ left: rollingDay ? '1.25rem' : '0.125rem', transform: 'none' }}
                />
              </button>
            </div>
          </motion.div>
        )}

        {/* Injury banner — always visible in idle state */}
        <InjuryBanner onOpenForm={() => setInjuryFormOpen(true)} />

        {/* Today chip (left) + active duel/bounty pills + customize button (right) — uniform all breakpoints */}
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setTodayExpanded(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-colors ${
              todayExpanded
                ? 'bg-orange-500/15 border-orange-500/50 text-orange-500'
                : 'bg-orange-500/8 border-orange-400/35 text-orange-400 hover:bg-orange-500/14 hover:border-orange-400/55'
            }`}
          >
            <CalendarDays className="w-3 h-3" />
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase">Today</span>
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${todayExpanded ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex items-center gap-1.5">
            {activeDuel && (
              <button type="button" onClick={() => navigate('/duels')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/25 text-rose-400 text-[10px] font-semibold hover:bg-rose-500/18 transition-colors">
                <Swords className="w-3 h-3" />
                <span>Duel</span>
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse ms-0.5" />
              </button>
            )}
            {activeBountyClaim && (
              <button type="button" onClick={() => navigate('/bounties')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[10px] font-semibold hover:bg-amber-500/18 transition-colors">
                <Zap className="w-3 h-3" />
                <span>Bounty</span>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse ms-0.5" />
              </button>
            )}
            {/* Subtle grid-customize button — active state when editing */}
            <button
              type="button"
              onClick={() => setGridEditing(v => !v)}
              title="Customize card order"
              className={`flex items-center justify-center w-6 h-6 rounded-full border transition-colors ${
                gridEditing
                  ? 'bg-primary/15 border-primary/35 text-primary'
                  : 'bg-muted/35 border-border/35 text-muted-foreground/35 hover:text-muted-foreground hover:bg-muted/60 hover:border-border/60'
              }`}
            >
              <LayoutGrid className="w-3 h-3" />
            </button>
          </div>
        </div>

        {cardioOpen ? (
          <div className="mb-8">
            <CardioSection onBack={() => setCardioOpen(false)} />
          </div>
        ) : storeOpen ? (
          <RegimenStorePage
            onBack={() => setStoreOpen(false)}
            onPublish={() => { setStoreOpen(false); setRegimensOpen(true); }}
          />
        ) : !regimensOpen ? (
          <>
            {/* First-visit AI Coach starter-plan hero card. Renders when:
                  • zero workout logs (truly first session), AND
                  • a regimen with the canonical starter name exists.
                Goes above the freestyle CTA so the personalized plan is
                the first thing the user sees, but freestyle stays
                available right below for users who want to wing it. */}
            {logs.length === 0 && !starterDismissed && (() => {
              const starter = regimens.find(r =>
                typeof r?.name === 'string' &&
                r.name.startsWith('Your Starter Plan'),
              );
              if (!starter) return null;
              return (
                <StarterPlanHeroCard
                  regimen={starter}
                  userProfile={userProfile}
                  onStart={startFromRegimen}
                  onCustomize={() => setRegimensOpen(true)}
                  onDismiss={dismissStarterPlan}
                />
              );
            })()}

            {/* My Routine — hidden until Today chip tapped (uniform on all breakpoints) */}
            <div className={todayExpanded ? 'block' : 'hidden'}>
              <RoutineTodayCard
                onStart={(ex, label) => { startFromExerciseList(ex, label); setTodayExpanded(false); }}
                onOpenRoutines={() => { setRoutineSheetOpen(true); setTodayExpanded(false); }}
                onChallenge={handleRoutineChallenge}
              />
            </div>
            <MyRoutineSheet open={routineSheetOpen} onClose={() => setRoutineSheetOpen(false)} />

            {/* Primary action — Freestyle */}
            {/* Primary action — Freestyle */}
            {/* ── Hero carousel: Freestyle | Gauntlet | Crew Wars ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="mb-4"
            >
              <div className="relative overflow-hidden rounded-3xl" style={{ touchAction: 'pan-y' }}>
                <AnimatePresence initial={false} custom={heroDir} mode="sync">
                  <motion.div
                    key={heroSlide}
                    custom={heroDir}
                    variants={{
                      enter: (dir) => ({ x: dir >= 0 ? '100%' : '-100%', opacity: 0 }),
                      center: { x: 0, opacity: 1 },
                      exit: (dir) => ({ x: dir >= 0 ? '-100%' : '100%', opacity: 0 }),
                    }}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.15}
                    onDragStart={() => { heroDragging.current = true; }}
                    onDragEnd={(_, { offset, velocity }) => {
                      const swipe = Math.abs(offset.x) * Math.abs(velocity.x);
                      if (offset.x < -60 || swipe > 8000) paginateHero(1);
                      else if (offset.x > 60 || swipe < -8000) paginateHero(-1);
                      setTimeout(() => { heroDragging.current = false; }, 80);
                    }}
                    className="absolute inset-0 w-full cursor-grab active:cursor-grabbing"
                    style={{ zIndex: 1 }}
                  >
                    {heroSlide === 0 && (
                      <button type="button" onClick={() => { if (!heroDragging.current) startFreestyle(); }}
                        className="group w-full h-full relative overflow-hidden rounded-3xl text-white text-start"
                        style={{ background: 'linear-gradient(135deg, #0d0d14 0%, #111827 40%, #0a0f1e 100%)', boxShadow: '0 20px 60px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset' }}>
                        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                          <div className="absolute -top-[40%] -right-[15%] w-[70%] h-[200%] rounded-full blur-[80px] opacity-60"
                            style={{ background: 'radial-gradient(ellipse, hsl(var(--primary) / 0.55) 0%, transparent 65%)' }} />
                          <div className="absolute top-[20%] -left-[10%] w-[50%] h-[120%] rounded-full blur-[60px] opacity-30"
                            style={{ background: 'radial-gradient(ellipse, hsl(265 80% 65% / 0.5) 0%, transparent 65%)' }} />
                          <motion.div className="absolute inset-y-0 w-[40%] skew-x-[-20deg]"
                            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)' }}
                            animate={{ x: ['-60%', '220%'] }} transition={{ duration: 3.5, repeat: Infinity, repeatDelay: 2.5, ease: 'easeInOut' }} />
                        </div>
                        <div className="absolute top-0 start-8 end-8 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                        <div className="relative flex items-center justify-between gap-4 p-6 md:p-8">
                          <div className="min-w-0">
                            <span className="block text-[10px] font-bold tracking-[0.25em] uppercase text-primary/80 mb-2">{t('workout.startKicker')}</span>
                            <span className="font-heading font-black text-3xl md:text-4xl leading-none block tracking-tight">{t('workout.freestyle')}</span>
                            <span className="text-[13px] text-white/50 mt-2.5 block max-w-[36ch] leading-relaxed">{t('workout.freestyleDesc')}</span>
                            <span className="inline-flex items-center gap-1 mt-3 px-2.5 py-1 rounded-full bg-white/8 border border-white/10 text-[10px] font-semibold text-white/60 tracking-wide uppercase">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Ready to go
                            </span>
                          </div>
                          <div className="shrink-0">
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center relative overflow-hidden"
                              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.75) 100%)', boxShadow: '0 8px 32px -4px hsl(var(--primary) / 0.6), 0 0 0 1px hsl(var(--primary) / 0.3) inset' }}>
                              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                              <Play className="w-7 h-7 fill-current relative z-10" />
                            </div>
                          </div>
                        </div>
                      </button>
                    )}
                    {heroSlide === 1 && (
                      <button type="button" onClick={() => { if (!heroDragging.current) navigate('/gauntlet'); }}
                        className="group w-full h-full relative overflow-hidden rounded-3xl text-white text-start"
                        style={{ background: 'linear-gradient(135deg, #1e0a3c 0%, #2d1257 40%, #1a0a2e 100%)', boxShadow: '0 20px 60px -12px rgba(88,28,135,0.5), 0 0 0 1px rgba(167,139,250,0.1) inset' }}>
                        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                          <div className="absolute -top-[40%] -right-[15%] w-[70%] h-[200%] rounded-full blur-[80px] opacity-60"
                            style={{ background: 'radial-gradient(ellipse, rgba(139,92,246,0.65) 0%, transparent 65%)' }} />
                          <div className="absolute top-[20%] -left-[10%] w-[50%] h-[120%] rounded-full blur-[60px] opacity-40"
                            style={{ background: 'radial-gradient(ellipse, rgba(192,132,252,0.55) 0%, transparent 65%)' }} />
                          <motion.div className="absolute inset-y-0 w-[40%] skew-x-[-20deg]"
                            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(167,139,250,0.08) 50%, transparent 100%)' }}
                            animate={{ x: ['-60%', '220%'] }} transition={{ duration: 3.5, repeat: Infinity, repeatDelay: 2.5, ease: 'easeInOut', delay: 1.2 }} />
                        </div>
                        <div className="absolute top-0 start-8 end-8 h-px bg-gradient-to-r from-transparent via-violet-300/30 to-transparent pointer-events-none" />
                        <div className="relative flex items-center justify-between gap-4 p-6 md:p-8">
                          <div className="min-w-0">
                            <span className="block text-[10px] font-bold tracking-[0.25em] uppercase text-violet-400/80 mb-2">CHALLENGE YOURSELF</span>
                            <span className="font-heading font-black text-3xl md:text-4xl leading-none block tracking-tight">The Gauntlet</span>
                            <span className="text-[13px] text-white/50 mt-2.5 block max-w-[36ch] leading-relaxed">10 challenges. One path. Prove what you are made of.</span>
                            <span className="inline-flex items-center gap-1 mt-3 px-2.5 py-1 rounded-full bg-violet-500/15 border border-violet-400/20 text-[10px] font-semibold text-violet-300/80 tracking-wide uppercase">
                              {gauntletProgress?.path_completed ? 'Completed' : gauntletProgress ? `Challenge #${gauntletProgress.current_challenge_sequence}` : 'Start now'}
                            </span>
                          </div>
                          <div className="shrink-0">
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center relative overflow-hidden"
                              style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.9) 0%, rgba(109,40,217,0.75) 100%)', boxShadow: '0 8px 32px -4px rgba(139,92,246,0.55), 0 0 0 1px rgba(167,139,250,0.3) inset' }}>
                              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                              <Trophy className="w-7 h-7 relative z-10 text-white" />
                            </div>
                          </div>
                        </div>
                      </button>
                    )}
                    {heroSlide === 2 && (
                      <button type="button" onClick={() => { if (!heroDragging.current) navigate('/hub', { state: { openCrewWars: true } }); }}
                        className="group w-full h-full relative overflow-hidden rounded-3xl text-white text-start"
                        style={{ background: 'linear-gradient(135deg, #0c1a10 0%, #14281c 40%, #091510 100%)', boxShadow: '0 20px 60px -12px rgba(16,185,129,0.3), 0 0 0 1px rgba(52,211,153,0.08) inset' }}>
                        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                          <div className="absolute -top-[40%] -right-[15%] w-[70%] h-[200%] rounded-full blur-[80px] opacity-55"
                            style={{ background: 'radial-gradient(ellipse, rgba(16,185,129,0.55) 0%, transparent 65%)' }} />
                          <div className="absolute top-[20%] -left-[10%] w-[50%] h-[120%] rounded-full blur-[60px] opacity-35"
                            style={{ background: 'radial-gradient(ellipse, rgba(52,211,153,0.45) 0%, transparent 65%)' }} />
                          <motion.div className="absolute inset-y-0 w-[40%] skew-x-[-20deg]"
                            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(52,211,153,0.07) 50%, transparent 100%)' }}
                            animate={{ x: ['-60%', '220%'] }} transition={{ duration: 3.5, repeat: Infinity, repeatDelay: 2.5, ease: 'easeInOut', delay: 0.6 }} />
                        </div>
                        <div className="absolute top-0 start-8 end-8 h-px bg-gradient-to-r from-transparent via-emerald-300/25 to-transparent pointer-events-none" />
                        <div className="relative flex items-center justify-between gap-4 p-6 md:p-8">
                          <div className="min-w-0">
                            <span className="block text-[10px] font-bold tracking-[0.25em] uppercase text-emerald-400/80 mb-2">CREW BATTLES</span>
                            <span className="font-heading font-black text-3xl md:text-4xl leading-none block tracking-tight">Crew Wars</span>
                            <span className="text-[13px] text-white/50 mt-2.5 block max-w-[36ch] leading-relaxed">Rally your crew. Crush rivals. Dominate the leaderboard.</span>
                            <span className="inline-flex items-center gap-1 mt-3 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/20 text-[10px] font-semibold text-emerald-300/80 tracking-wide uppercase">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Join the fight
                            </span>
                          </div>
                          <div className="shrink-0">
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center relative overflow-hidden"
                              style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.85) 0%, rgba(5,150,105,0.70) 100%)', boxShadow: '0 8px 32px -4px rgba(16,185,129,0.5), 0 0 0 1px rgba(52,211,153,0.3) inset' }}>
                              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                              <Shield className="w-7 h-7 relative z-10 text-white" />
                            </div>
                          </div>
                        </div>
                      </button>
                    )}
                  </motion.div>
                </AnimatePresence>
                {/* Height placeholder so container does not collapse */}
                <div className="invisible pointer-events-none" aria-hidden="true">
                  <div className="flex items-center justify-between gap-4 p-6 md:p-8 pb-9 md:pb-10">
                    <div><span className="block text-[10px] mb-2">x</span><span className="font-heading font-black text-3xl block leading-none">x</span><span className="text-[13px] mt-2.5 block">placeholder line</span><span className="inline-flex mt-3 px-2.5 py-1 text-[10px]">badge placeholder</span></div>
                    <div className="w-16 h-16 rounded-2xl shrink-0" />
                  </div>
                </div>
              </div>
              {/* Dots */}
              <div className="flex justify-center gap-2 mt-2.5">
                {[0, 1, 2].map(i => (
                  <button key={i} type="button"
                    onClick={() => setHeroState([i, i > heroSlide ? 1 : -1])}
                    className={`transition-all duration-300 rounded-full ${heroSlide === i ? 'w-5 h-1.5 bg-primary' : 'w-1.5 h-1.5 bg-muted-foreground/25 hover:bg-muted-foreground/50'}`}
                    aria-label={`Slide ${i + 1}`} />
                ))}
              </div>
            </motion.div>

            {/* Repeat last workout — fastest path to logging for returning
                users. Pre-fills the most recent session's exercises with the
                same weights/reps as suggestions; identical numbers → one-tap
                save, harder numbers → bump one cell. Hidden when there's no
                history (new users get the freestyle CTA only). */}
            {logs.length > 0 && (() => {
              const last = logs[0];
              const exCount = (last.exercises || []).length;
              if (!exCount) return null;
              const setCount = (last.exercises || [])
                .reduce((sum, ex) => sum + (ex.sets?.length || 0), 0);
              const title = last.regimen_name || tFallback('workout.lastWorkout', 'Last workout');
              // Today-highlight signal — when the most recent workout
              // happened on the user's local calendar day, the card
              // gets a thicker left border + "TODAY" pill so the eye
              // immediately recognizes recent activity. Calendar-day
              // (not 24h) so workouts logged early morning still feel
              // like today if it's still today.
              const lastDateStr = last.date ? String(last.date).slice(0, 10) : null;
              // Local calendar day — last.date is stored as a local
              // 'yyyy-MM-dd', so comparing against a UTC day misfired the
              // "Today" label near midnight in non-UTC zones.
              const todayStr = format(new Date(), 'yyyy-MM-dd');
              const isToday = lastDateStr === todayStr;
              const subtitleParts = [
                last.date ? (isToday ? tFallback('common.today', 'Today') : format(parseISO(last.date), 'MMM d')) : null,
                exCount === 1
                  ? `1 ${tFallback('workout.exerciseSingular', 'exercise')}`
                  : `${exCount} ${(tFallback('workout.exercises', 'exercises')).toLowerCase()}`,
                setCount > 0
                  ? (setCount === 1
                      ? `1 ${tFallback('workout.setSingular', 'set')}`
                      : `${setCount} ${(tFallback('common.sets', 'sets')).toLowerCase()}`)
                  : null,
              ].filter(Boolean);
              return (
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={startFromLastWorkout}
                  className={`group relative w-full mb-4 rounded-2xl border bg-gradient-to-r p-4 md:p-5 text-start transition-colors ${
                    isToday
                      ? 'border-s-4 border-primary border-primary/40 from-primary/12 via-primary/6 to-transparent hover:border-primary/60'
                      : 'border-primary/25 from-primary/8 via-primary/5 to-transparent hover:border-primary/45'
                  }`}
                  aria-label={tFallback('workout.repeatLast', 'Repeat last workout')}
                >
                  {/* TODAY pill — Apple/Strava-style anchor for the eye
                      when scanning a session list, even on a card with
                      just one item. */}
                  {isToday && (
                    <span className="absolute top-2 end-2 text-[9px] font-bold uppercase tracking-[0.18em] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                      {tFallback('common.today', 'Today')}
                    </span>
                  )}
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 md:w-11 md:h-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 group-hover:bg-primary/25 transition-colors">
                      <History className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-primary">
                          {tFallback('workout.repeatLast', 'Repeat last workout')}
                        </span>
                      </div>
                      <p className="font-heading font-bold text-base md:text-lg leading-tight truncate mt-0.5">
                        {title}
                      </p>
                      {subtitleParts.length > 0 && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {subtitleParts.join(' • ')}
                        </p>
                      )}
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/60 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                </motion.button>
              );
            })()}

            {/* Secondary actions grid — drag-and-drop in the same 2-col layout */}
            <div className="mb-2">
              {gridEditing && (
                <div className="flex items-center justify-between mb-3 px-1">
                  <p className="text-[10px] text-muted-foreground/60 font-medium">Drag cards to reorder</p>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => { localStorage.setItem('wkt-card-order', JSON.stringify(cardOrder)); setGridEditing(false); toast.success('Layout saved.'); setDragSrcIdx(null); setDragOverIdx(null); }}
                      className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[10px] font-bold hover:bg-primary/90 transition-colors">Save</button>
                    {isAppAdmin(user) && (
                      <button
                        onClick={async () => {
                          const res = await setLayoutDefault('workout', cardOrder, null);
                          if (res.ok) toast.success('Saved — new users will see this card layout.');
                          else if (res.error === 'rpc_missing') toast.error('Apply migration 166.');
                          else if (res.error === 'admin_only')  toast.error('Admins only.');
                          else toast.error('Could not save default layout.');
                        }}
                        title="Save this layout as default for all new users"
                        className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400 text-[10px] font-bold hover:bg-amber-500/25 transition-colors"
                      >
                        Set default
                      </button>
                    )}
                    <button onClick={() => { setCardOrder([...CARD_ORDER_DEFAULT]); localStorage.removeItem('wkt-card-order'); setGridEditing(false); setDragSrcIdx(null); setDragOverIdx(null); }}
                      className="px-2.5 py-1 rounded-lg bg-secondary text-muted-foreground text-[10px] font-semibold hover:bg-secondary/80 transition-colors">Reset</button>
                  </div>
                </div>
              )}
              {/* Always 2-col grid — HTML5 drag handles in edit mode */}
              <div className="grid grid-cols-2 gap-3">
                {cardOrder.map((id, posIdx) => {
                  const nonNemesis = cardOrder.filter(x => x !== 'nemesis');
                  const colorIdx = nonNemesis.indexOf(id);
                  const isDragging = gridEditing && dragSrcIdx === posIdx;
                  const isOver    = gridEditing && dragOverIdx === posIdx && dragSrcIdx !== posIdx;
                  return (
                    <div
                      key={id}
                      className={id === 'nemesis' ? 'col-span-2' : ''}
                      draggable={gridEditing}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragSrcIdx(posIdx); }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverIdx !== posIdx) setDragOverIdx(posIdx); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragSrcIdx === null || dragSrcIdx === posIdx) return;
                        const next = [...cardOrder];
                        const [moved] = next.splice(dragSrcIdx, 1);
                        next.splice(posIdx, 0, moved);
                        setCardOrder(next);
                        setDragSrcIdx(null); setDragOverIdx(null);
                      }}
                      onDragEnd={() => { setDragSrcIdx(null); setDragOverIdx(null); }}
                      style={{
                        opacity:   isDragging ? 0.45 : 1,
                        outline:   isOver ? '2px solid hsl(var(--primary))' : 'none',
                        outlineOffset: '2px',
                        borderRadius: 12,
                        cursor:    gridEditing ? 'grab' : 'default',
                        transition: 'opacity 0.15s, outline 0.1s',
                      }}
                    >
                      {renderCard(id, colorIdx)}
                    </div>
                  );
                })}
              </div>
            </div>
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

        <Suspense fallback={null}>
          <GoalsModal open={goalsModalOpen} onClose={() => setGoalsModalOpen(false)} goals={goals} logs={logs} userProfile={userProfile} />
        </Suspense>

        <Dialog open={savedWorkoutsOpen} onOpenChange={setSavedWorkoutsOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2">
                <History className="w-5 h-5 text-accent" />
                {tFallback('workout.savedWorkouts', 'Saved Workouts')}
              </DialogTitle>
            </DialogHeader>
            <div className="mt-2">
              <WorkoutSavedList onSelectLog={(log) => { setSavedWorkoutsOpen(false); setEditingLog(log); }} />
            </div>
          </DialogContent>
        </Dialog>

        {editingLog && (
          <Suspense fallback={null}>
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
                } catch (err) { reportError(err, { feature: 'workout.edit-volume-delta', level: 'warning', userEmail: user?.email, delta }); }
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
                } catch (err) { reportError(err, { feature: 'workout.delete-volume-delta', level: 'warning', userEmail: user?.email, deletedVolume }); }
              }
              queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] });
              queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
              setEditingLog(null);
            }}
          />
          </Suspense>
        )}

        {/* AI modals — MUST be mounted in the idle view because that's where
            their trigger cards live (Generate Workout, Form Coach). Without
            this, clicking the cards updates state but no modal exists in
            the tree to react to the change. Each is wrapped in its own
            ErrorBoundary so a TF.js load failure or generator crash doesn't
            take down the whole Workout page. */}
        <ErrorBoundary label="FormCoach">
          <Suspense fallback={null}>
            <FormCoachModal open={formCoachOpen} onClose={() => setFormCoachOpen(false)} />
          </Suspense>
        </ErrorBoundary>

        <ErrorBoundary label="WorkoutGenerator">
          <Suspense fallback={null}>
            <WorkoutGeneratorModal
              open={generatorOpen}
              onClose={() => setGeneratorOpen(false)}
              userProfile={userProfile}
              onUseWorkout={startFromGeneratedWorkout}
              onSaveAsRegimen={saveGeneratedAsRegimen}
            />
          </Suspense>
        </ErrorBoundary>

        {/* Injury Form overlay */}
        <AnimatePresence>
          {injuryFormOpen && (
            <Suspense fallback={null}>
              <InjuryForm onClose={() => setInjuryFormOpen(false)} userProfile={userProfile} />
            </Suspense>
          )}
        </AnimatePresence>

        {/* Comeback Screen overlay — shown when user returns after 7+ days */}
        <AnimatePresence>
          {comebackProtocol.triggered && (
            <ComebackScreen
              daysSince={comebackProtocol.daysSince}
              workoutLogs={logs}
              userProfile={userProfile}
              onStartSession={handleComebackStart}
              onSkip={handleComebackSkip}
            />
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 28 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="px-4 pt-4 md:px-8 md:pt-8 lg:pb-8 max-w-3xl mx-auto"
    >
      {/* First-workout coach-mark tutorial — only mounts when the user
          has never logged a workout AND hasn't dismissed before. The
          banner is fixed-positioned (lives in a portal-equivalent
          stacking context) so it floats above the page chrome without
          shifting layout. */}
      {showFirstTutorial && logs.length === 0 && (
        <FirstWorkoutTutorial
          userId={user?.id}
          onClose={() => setShowFirstTutorial(false)}
        />
      )}

      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-heading text-2xl md:text-3xl font-bold tracking-tight">
              {selectedRegimen?.name || t('workout.freestyle')}
            </h1>
            {/* Live elapsed timer — counts up from session start. The
                chip clears on workout reset / save (startedAt nulls). */}
            <WorkoutElapsedChip startedAt={startedAt} />
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">{t('workout.logSetsReps')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setConfirmDiscard(true)}>{t('common.cancel')}</Button>
      </div>

      {/* Discard-workout confirmation. Cancel destroys the active session
          (no resume draft), so gate it behind an explicit confirm.
          (Audit task 2.) */}
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tFallback('workout.discardConfirm', 'Discard workout?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tFallback('workout.discardWarn', 'Your logged sets will be lost. This can’t be undone.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tFallback('workout.keepGoing', 'Keep going')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmDiscard(false); resetWorkout(activeSessionId); }}
              className="bg-destructive hover:bg-destructive/90"
            >
              {tFallback('workout.discard', 'Discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Live volume pill — ticks up as the user types each set.
          Cheap dopamine — every great fitness app has a live number
          somewhere the user watches. */}
      <div className="mb-6">
        <LiveVolumePill exercises={exercises} includeBarWeight={!!userProfile?.include_bar_in_volume} />
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
              userEmail={user?.email}
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
        {/* Plate calculator — type any weight, see what to load per side. */}
        <button
          type="button"
          onClick={() => setPlateCalcOpen(true)}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <Calculator className="w-4 h-4" />
          {tFallback('workout.plateCalc', 'Plate calculator')}
        </button>
      </Card>

      {(() => {
        // Build top-level items + a stable key per item. Keys are used
        // both as React keys AND as Reorder.Item values so framer-motion
        // can track drag identity across reorders.
        const items = [];
        const seenGroups = new Set();
        exercises.forEach((ex, globalIdx) => {
          if (ex.group_id) {
            if (!seenGroups.has(ex.group_id)) {
              seenGroups.add(ex.group_id);
              const groupItems = exercises
                .map((e, ii) => ({ exercise: e, globalIdx: ii }))
                .filter(({ exercise }) => exercise.group_id === ex.group_id);
              items.push({ type: 'group', key: `group:${ex.group_id}`, groupId: ex.group_id, groupMeta: ex.group_meta || {}, items: groupItems });
            }
          } else {
            // Use the exercise's stable id when available, else the
            // global index. Since freeform exercises don't carry ids,
            // a synthetic key per name+position is good enough — we
            // re-key on every render anyway.
            items.push({ type: 'single', key: `ex:${ex.id || `${ex.name}-${globalIdx}`}`, exercise: ex, globalIdx });
          }
        });
        const orderKeys = items.map(it => it.key);

        // Rebuild the exercises array from a new top-level key order.
        // Preserves intra-group order (the exercises inside a superset
        // don't get re-shuffled — only the group as a whole moves).
        const reorderTopLevel = (nextKeys) => {
          const itemsByKey = Object.fromEntries(items.map(it => [it.key, it]));
          const nextExercises = [];
          for (const k of nextKeys) {
            const it = itemsByKey[k];
            if (!it) continue;
            if (it.type === 'group') {
              for (const g of it.items) nextExercises.push(g.exercise);
            } else {
              nextExercises.push(it.exercise);
            }
          }
          setExercises(nextExercises);
        };

        return (
          <ErrorBoundary label="ActiveSession.ExerciseList">
          <Reorder.Group
            axis="y"
            values={orderKeys}
            onReorder={reorderTopLevel}
            className="space-y-4 mb-6 list-none p-0"
          >
            {items.map((item) => {
              if (item.type === 'group') {
                return (
                  <ReorderItemWithHandle
                    key={item.key}
                    value={item.key}
                    className="relative"
                  >
                    <GroupBlock
                      groupId={item.groupId}
                      groupMeta={item.groupMeta}
                      exercises={item.items.map(gi => gi.exercise)}
                      onChange={(gIdx, updated) => {
                        if (item.items[gIdx]) updateExercise(item.items[gIdx].globalIdx, updated);
                      }}
                      userProfile={userProfile}
                    />
                  </ReorderItemWithHandle>
                );
              }
              const { exercise: ex, globalIdx: i } = item;
              return (
                <ReorderItemWithHandle
                  key={item.key}
                  value={item.key}
                  className="relative"
                >
                  <ExerciseLogger
                    exercise={ex}
                    onChange={(updated) => updateExercise(i, updated)}
                    userProfile={userProfile}
                    prIndex={prIndex}
                    workoutLogs={rawLogs}
                  />
                <div className="absolute top-3 end-3 flex items-center gap-1">
                  {/* Group with previous as a superset — one-tap pairing
                      that fills in group_id on both exercises so the
                      GroupBlock renderer picks them up on next render.
                      Only meaningful when the previous exercise exists
                      AND neither is already in a group. */}
                  {i > 0 && !ex.group_id && !exercises[i - 1]?.group_id && (
                    <button
                      type="button"
                      onClick={() => {
                        const gid = `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                        const next = exercises.map((e, idx) => {
                          if (idx === i || idx === i - 1) {
                            return { ...e, group_id: gid, group_meta: { type: 'superset' } };
                          }
                          return e;
                        });
                        setExercises(next);
                        toast.success('Paired as superset with the previous exercise.');
                      }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      aria-label="Pair with previous exercise as superset"
                      title="Pair as superset"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {/* Skip / remove. Always visible during an active
                      session — if a machine is taken, the user shouldn't
                      have to dig through a menu to move on. */}
                  <button
                    type="button"
                    onClick={() => {
                      const removed = exercises[i];
                      // Use a stable identity (group_id || name + reference)
                      // captured at click time, then find the *current* index
                      // when Undo fires. Otherwise removing two exercises in
                      // sequence and tapping Undo on the later toast inserts
                      // at the stale captured index, which lands mid-superset
                      // and can break group integrity. (Audit 09 #M-3 / #L-11.)
                      const undoMarker = { name: removed?.name, group_id: removed?.group_id, ref: removed };
                      setExercises(exercises.filter((_, idx) => idx !== i));
                      toast.success(`Skipped ${removed?.displayName || removed?.name || 'exercise'}.`, {
                        action: {
                          label: 'Undo',
                          onClick: () => setExercises(prev => {
                            // Best-effort reinsert near the original neighbor.
                            // Append to end as a safe default — the user can
                            // always reorder. Better to be at the bottom than
                            // wedged between unrelated supersetted rows.
                            if (prev.some(ex => ex === undoMarker.ref)) return prev;
                            return [...prev, undoMarker.ref];
                          }),
                        },
                      });
                    }}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label="Skip this exercise"
                    title="Skip exercise"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                </ReorderItemWithHandle>
              );
            })}
          </Reorder.Group>
          </ErrorBoundary>
        );
      })()}

      <div className="mb-4">
        <label htmlFor="workout-notes" className="text-xs font-medium text-muted-foreground mb-1 block">{t('workout.notes')}</label>
        <Textarea id="workout-notes" value={notes} onChange={e => guard.handleChange(e.target.value, setNotes)} placeholder={t('workout.notesPlaceholder')} className="h-20" maxLength={1000} />
      </div>

      <Suspense fallback={null}>
        <ProgressPhotoCapture workoutName={selectedRegimen?.name || t('workout.freestyle')} />
      </Suspense>

      <motion.div whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.01 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }} className="mt-6">
        <Button
          className="w-full h-12 font-heading font-bold text-base mb-8"
          onClick={() => saveWorkout()}
          disabled={exercises.length === 0 || saveMutation.isPending}
        >
          <Save className="w-5 h-5 me-2" />
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
                <ul className="list-disc ps-5 text-sm space-y-0.5 max-h-40 overflow-y-auto">
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
        <Suspense fallback={null}>
          <FormCoachModal open={formCoachOpen} onClose={() => setFormCoachOpen(false)} />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary label="WorkoutShareCard">
        <WorkoutShareCard
          open={!!shareCardWorkout}
          onClose={() => setShareCardWorkout(null)}
          workout={shareCardWorkout}
          username={user?.username ? `@${user.username}` : 'Athlete'}
          includeBarWeight={!!userProfile?.include_bar_in_volume}
        />
      </ErrorBoundary>

      {/* PR share card — opened from the firePRCelebration toast's
          "Share" action via the OPEN_PR_SHARE_EVENT window event.
          Lazy-loaded since most workout saves don't hit a PR. */}
      {prShare && (
        <ErrorBoundary label="PRShareCard">
          <Suspense fallback={null}>
            <PRShareCard
              open={!!prShare}
              onClose={() => setPrShare(null)}
              pr={prShare.pr}
              unit={prShare.unit}
              username={user?.username ? `@${user.username}` : 'Athlete'}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {gauntletStatsModal && (
        <GauntletStatsModal
          open={!!gauntletStatsModal}
          onClose={() => setGauntletStatsModal(null)}
          type={gauntletStatsModal.type}
          challengeTitle={gauntletStatsModal.challengeTitle}
          xpAwarded={gauntletStatsModal.xpAwarded}
          coinsAwarded={gauntletStatsModal.coinsAwarded}
          stats={gauntletStatsModal.stats}
          pathCompleted={gauntletStatsModal.pathCompleted}
        />
      )}

      <ErrorBoundary label="WorkoutGenerator">
        <Suspense fallback={null}>
          <WorkoutGeneratorModal
            open={generatorOpen}
            onClose={() => setGeneratorOpen(false)}
            userProfile={userProfile}
            onUseWorkout={startFromGeneratedWorkout}
            onSaveAsRegimen={saveGeneratedAsRegimen}
          />
        </Suspense>
      </ErrorBoundary>

      {editingLog && (
        <Suspense fallback={null}>
        <EditWorkoutModal
          log={editingLog}
          userProfile={userProfile}
          logs={logs}
          cardioLogs={cardioLogs}
          open={!!editingLog}
          onClose={() => setEditingLog(null)}
          // Mirror the idle-view handlers EXACTLY so editing a workout
          // from inside an active session applies the same volume
          // delta math to total_volume_lbs / leaderboards. Previously
          // this active-session copy of the modal skipped the delta,
          // so the same edit produced different leaderboard outcomes
          // depending on which view was open when the user tapped Edit.
          // (Audit 09 #C-1, H-7.)
          onSave={async (id, data) => {
            const oldVolume = calculateTotalVolume(editingLog?.exercises || []);
            const newVolume = calculateTotalVolume(data?.exercises || []);
            const delta = newVolume - oldVolume;
            await db.entities.WorkoutLog.update(id, data);
            if (delta !== 0) {
              try {
                await supabase.rpc('increment_user_volume', { p_delta: delta });
              } catch (err) { reportError(err, { feature: 'workout.edit-volume-delta-active', level: 'warning', userEmail: user?.email, delta }); }
            }
            queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] });
            queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
            setEditingLog(null);
          }}
          onDelete={async (id) => {
            const deletedVolume = calculateTotalVolume(editingLog?.exercises || []);
            await db.entities.WorkoutLog.delete(id);
            if (deletedVolume > 0) {
              try {
                await supabase.rpc('increment_user_volume', { p_delta: -deletedVolume });
              } catch (err) { reportError(err, { feature: 'workout.delete-volume-delta-active', level: 'warning', userEmail: user?.email, deletedVolume }); }
            }
            queryClient.invalidateQueries({ queryKey: ['workoutLogs', user?.email] });
            queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
            setEditingLog(null);
          }}
        />
        </Suspense>
      )}

      {/* Injury Form — accessible during active session too */}
      <AnimatePresence>
        {injuryFormOpen && (
          <InjuryForm onClose={() => setInjuryFormOpen(false)} userProfile={userProfile} />
        )}
      </AnimatePresence>

      {/* Plate calculator — on-demand "what to load per side" sheet */}
      <PlateCalculatorModal open={plateCalcOpen} onClose={() => setPlateCalcOpen(false)} />
    </motion.div>
  );
}
