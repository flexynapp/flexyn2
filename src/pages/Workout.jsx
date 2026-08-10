import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { filterAfterReset } from '@/lib/accountReset';
import { readPendingWorkout, clearPendingWorkout } from '@/lib/pendingWorkout';
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
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { triggerHaptic } from '@/lib/haptic';
import { playSound, SOUND } from '@/lib/playSound';
import { Play, Save, Plus, Dumbbell, Trash2, Target, Pause, AlertTriangle, Activity, ArrowRight, History, Camera, Sparkles, Globe, Swords, Zap, Trophy, Link2, Calculator, CalendarDays, ChevronDown, LayoutGrid, Shield, Search } from 'lucide-react';
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
import CardioLogger, { CARDIO_ACTIVITIES, activityEmoji } from '@/components/workout/CardioLogger';
import { TagSelector } from '@/components/workout/WorkoutTags';
import LiveVolumePill from '@/components/workout/LiveVolumePill';
import { buildPRIndex } from '@/lib/data/personalRecords';
import { recordWorkoutExercises } from '@/lib/recentExerciseUsage';
import ExerciseAutocomplete, { EXERCISE_LIBRARY } from '@/components/regimens/ExerciseAutocomplete';
import GroupBlock from '@/components/workout/GroupBlock';
import WorkoutElapsedChip from '@/components/workout/WorkoutElapsedChip';
import InjuryBanner from '@/components/workout/InjuryBanner';
import ComebackScreen from '@/components/workout/ComebackScreen';
import { useComebackProtocol } from '@/hooks/useComebackProtocol';
import { getActiveDuel } from '@/lib/data/duels';
import { syncMyCrewWarProgress } from '@/lib/data/crewWars';
import { syncMyCrewChallengeProgress } from '@/lib/data/crewChallenges';
import { getMyActiveClaim, listActiveBounties } from '@/lib/data/bounties';
import GymRivalCard from '@/components/gymRival/GymRivalCard';
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
import { DURATION_COLUMN } from '@/lib/workoutDuration';
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
const EditWorkoutModal     = lazy(() => import('@/components/workout/EditWorkoutModal'));
const CardioSavedList      = lazy(() => import('@/components/cardio/CardioSavedList'));
const CardioDetailModal    = lazy(() => import('@/components/cardio/CardioDetailModal'));
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
        <span className="w-8 h-1 rounded-full bg-muted-foreground/30 hover:bg-muted-foreground/60 active:bg-muted-foreground/60 transition-colors" />
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
  const [workoutName, setWorkoutName] = useState('');
  const [workoutTags, setWorkoutTags] = useState([]);
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
  const [shareCardWorkout, setShareCardWorkout] = useState(null);
  const [savedWorkoutsOpen, setSavedWorkoutsOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState('gym'); // 'gym' | 'cardio'
  const [historySearch, setHistorySearch] = useState('');
  const [cardioDetailLog, setCardioDetailLog] = useState(null);
  const [activeInfo, setActiveInfo] = useState(null); // which card's ⓘ tooltip is open
  const [todayExpanded, setTodayExpanded] = useState(false); // Today chip → expands RoutineTodayCard
  // Gauntlet + Crew Wars: reachable from the hero slideshow.
  // Form Coach: now a button inside the active workout (Freestyle/Regimen).
  // None need a grid tile. Order per user request; the full-width Rival
  // card ('nemesis') stays last.
  const CARD_ORDER_DEFAULT = ['generate','explore','cardio','regimens','duels','bounties','goals','saved','nemesis'];
  // Per-user, per CLAUDE.md's `flexyn.<feature>.<userId>` convention. The
  // old key was a bare `wkt-card-order` — unnamespaced and shared, so a
  // second account on the same phone inherited the first one's card
  // layout. `user` is declared at the top of the component, well above
  // this useState initializer, so reading it here is not a TDZ hazard.
  const cardOrderKey = `flexyn.wktCardOrder.${user?.id || 'anon'}`;
  const [cardOrder, setCardOrder] = useState(() => {
    try {
      const s = localStorage.getItem(cardOrderKey);
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
  const [incompleteWarnOpen, setIncompleteWarnOpen] = useState(false);
  const [cardioPageTitle, setCardioPageTitle] = useState(null);
  const [injuryFormOpen, setInjuryFormOpen] = useState(false);
  const [plateCalcOpen, setPlateCalcOpen] = useState(false);
  const [cardioMenuOpen, setCardioMenuOpen] = useState(false);
  // Discard-confirmation gate for the "Cancel" button — destroying an
  // in-flight workout is irreversible, so we route it through a Radix
  // AlertDialog instead of firing resetWorkout() on the first tap.
  // (Audit task 2.)
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const guard = useMultiProfanityGuard();
  const { sessions, resumeWorkout, removeSession } = useWorkoutSessions(user?.id);

  // Declared HERE, immediately after removeSession, rather than ~860 lines
  // further down where it used to live. Every binding it touches is above
  // this line, and its callers (the save mutation's onSuccess, the discard
  // dialog) are below — so nothing reads it before initialization.
  //
  // The old position produced two no-use-before-define warnings, which is
  // the same rule that caught the 2026-05-23 production Hub crash. These two
  // were latent rather than live, because both call sites are async mutation
  // callbacks that run long after render — but "latent TDZ in the app's
  // hottest file" is not a state to leave a 3,700-line component in, and
  // this file is where the pattern gets copied from.
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
    setWorkoutName('');
    setWorkoutTags([]);
  };

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
          // Weight/reps are deliberately blanked above, but the machine
          // is not: repeating a workout means going back to the same
          // gym and the same equipment. This map rebuilds the exercise
          // key-by-key, so anything not listed here is silently dropped.
          ...(ex.equipment ? { equipment: ex.equipment } : {}),
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

  // ── The STORED volume is raw. Do not re-add the preference here. ──
  //
  // Formula lives in src/lib/workoutVolume.js so the live pill and the
  // save mutation can't drift apart (audit C-3). What differs is the
  // OPTION: this helper deliberately passes includeBarWeight: false.
  //
  // include_bar_in_volume adds 45 lb per rep on every barbell set. That
  // is a fine thing for a person to want to SEE — the live pill honours
  // it at line ~2997, and the share card and saved list re-derive it
  // from the exercises array. It is not a fine thing to STORE, because
  // every value this helper produces is either compared across users or
  // spent:
  //
  //   • workout_logs.total_volume  → get_gym_leaderboard ranks members
  //     against each other on it, and get_gym_community_progress sums it
  //     into the gym's "lbs moved"
  //   • user_profiles.total_volume_lbs → gym rival, profile stats
  //   • the WORKOUT_VOLUME reward action → XP
  //   • solo-challenge progress → challenge targets
  //
  // Preference-aware storage would mean a display toggle in Settings
  // climbs your gym's volume leaderboard past someone who lifted the
  // same weight, and earns more XP for it. Nobody would be cheating; the
  // number would just stop meaning one thing. Raw here, preference at
  // display time. (Kegan's call, 2026-08-09 — flagged by the Weekly
  // Reviews session, which found the column had never been written at
  // all. Latent when decided: 0 of 43 profiles had the flag on.)
  //
  // This also keeps the column equal to migration 329's backfill by
  // construction rather than by luck.
  const calculateTotalVolume = (exList) =>
    computeTotalVolume(exList, { includeBarWeight: false });

  // (An unused ['activeInjuries', uid] query used to sit here. Its own comment
  // said InjuryBanner fetches its own data — so this was a second network
  // request on every Workout load whose result nothing read, under a key
  // nothing invalidated. It did not even warm the banner's cache: the banner
  // keys on ['injuries','active',uid].)

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

      // Persist the session's volume ONTO THE LOG ROW. It was computed a few
      // lines below as `sessionVolume`, spent crediting the profile's
      // total_volume_lbs, and then dropped — so `workout_logs.total_volume`
      // had never been written by anything, on any row, ever. Every reader of
      // that column was therefore reading a hard zero: the weekly review said
      // "0 lbs" beside a real session (verified in production — one log
      // derives to 4,995 lbs and stores 0), My Journal's day chips suppressed
      // volume entirely, and the gym floor under-reported. The review now
      // derives volume from the sets so it no longer depends on this, but the
      // other readers still do, and a denormalised column that nothing writes
      // is worse than no column at all.
      //
      // Computed AFTER the set filtering and the per-group clamp above, so
      // the stored number matches the sets that actually persist.
      data = { ...data, total_volume: calculateTotalVolume(data.exercises) };

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
              const { saveTemplate } = await import('@/lib/data/templates');
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

      // Quest progress — non-blocking, fire-and-forget.
      //
      // One recordActions call, not four recordAction calls: each of those
      // was a full read of the day's quest rows before it could update
      // anything, so a save that emits four actions cost four round-trips to
      // do one thing. recordActions reads once and fans out the updates.
      //
      // Volume is the CLAMPED session volume — the same figure credited to
      // the profile above — so a quest and the stat it mirrors can never
      // disagree about what the session was worth.
      const durationMin = Number(clampedData.duration_minutes) || 0;
      const setCount = (clampedData?.exercises || []).reduce(
        // Only sets with reps on them. An exercise carries empty set rows
        // for anything the user laid out and didn't do, and counting those
        // would complete a 20-set quest off a plan rather than a session.
        (n, ex) => n + (ex?.sets || []).filter(s => (Number(s?.reps) || 0) > 0).length,
        0,
      );
      quests.recordActions(user, [
        { type: ACTION_TYPES.WORKOUT_COMPLETED, amount: 1 },
        { type: ACTION_TYPES.WORKOUT_MINUTES,   amount: durationMin },
        { type: ACTION_TYPES.SETS_COMPLETED,    amount: setCount },
        { type: ACTION_TYPES.WORKOUT_VOLUME,    amount: Math.round(result?.sessionVolume || 0) },
      ])
        .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(() => {});

      // League weekly XP — non-blocking
      leagues.recordWeeklyXp(user, xpGained)
        .then(() => queryClient.invalidateQueries({ queryKey: ['myLeague', user?.id] }))
        .catch(() => {});

      // Crew War contribution — one call, no arguments, no client numbers.
      //
      // Migration 249 recomputes the caller's contribution to every active
      // war from the workout_logs rows that were just written, blending
      // volume, sessions and days trained rather than counting XP. That
      // replaced a three-round-trip dance (getMyCrews, then a war lookup
      // per crew, then a contribute call carrying the browser's own XP
      // figure) sitting inside the workout-save path.
      //
      // The toast no longer quotes a number, because the client no longer
      // computes one — and an approximate figure that disagrees with the
      // scoreboard a second later is worse than no figure at all.
      if (user?.id) {
        syncMyCrewWarProgress()
          .then((res) => {
            if (!res?.ok || !res.wars) return;
            queryClient.invalidateQueries({ queryKey: ['activeWar'] });
            queryClient.invalidateQueries({ queryKey: ['warBreakdown'] });
            toast.success('Your session counted toward the Crew War', {
              description: 'Volume, sessions and days trained all score.',
              duration: 4000,
            });
          })
          .catch(() => {});
      }

      // Crew challenge progress — one call covers every crew and every
      // live challenge the user is part of. Takes no arguments: the
      // server recomputes this user's contribution from the workout_logs
      // rows that were just written, then rewrites the crew aggregate.
      // Nothing about the amount is client-supplied, so it's safe to
      // fire-and-forget. Completions fan out their own push server-side.
      syncMyCrewChallengeProgress()
        .then((res) => {
          if (!res?.ok) return;
          queryClient.invalidateQueries({ queryKey: ['crewChallenges'] });
          queryClient.invalidateQueries({ queryKey: ['crewChallengeContrib'] });
        })
        .catch(() => {});

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
      // Same reasoning as the tagged-set metadata below: repeating a
      // workout means the same gym and the same machine, so the
      // equipment choice carries forward too.
      ...(ex.equipment ? { equipment: ex.equipment } : {}),
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
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    if (clampedSomething) {
      toast.success('Workout loaded — some sets were trimmed to realistic limits.');
    } else {
      toast.success('Workout loaded — log your sets!');
    }
  };

  // "Start workout" from the AI Coach / Quick generator hands a session off via
  // sessionStorage (the two routes are separate chunks). Consume it once on
  // mount and load it into the live workout form.
  useEffect(() => {
    const pending = readPendingWorkout();
    if (!pending) return;
    startFromGeneratedWorkout(pending);
    // Clear AFTER the mount sticks. Under StrictMode the first mount's cleanup
    // cancels this timer, so only the surviving mount clears the cache — and
    // the cache (not sessionStorage) is what the surviving mount reads.
    const t = setTimeout(clearPendingWorkout, 0);
    return () => clearTimeout(t);
  }, []);

  // A scheduled-workout reminder deep-links here as /workout?scheduled=<id>.
  // The session was stored whole when it was scheduled, so this loads exactly
  // what the user committed to rather than regenerating something similar —
  // and a reminder that dropped you on an empty Workout page to go find the
  // thing yourself would be most of a reminder that didn't work.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('scheduled');
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const { getScheduledWorkout } = await import('@/lib/data/scheduledWorkouts');
        const row = await getScheduledWorkout(id);
        if (cancelled || !row?.workout?.exercises?.length) return;
        startFromGeneratedWorkout(row.workout);
        // Strip the param so a refresh doesn't reload the session over
        // whatever the user has since logged into the form.
        window.history.replaceState({}, '', '/workout');
      } catch { /* a missing or foreign row just leaves the page as-is */ }
    })();
    return () => { cancelled = true; };
  }, []);

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

  // Add a cardio entry (walk / run / bike) to the active workout. Stored as a
  // kind:'cardio' "exercise" so it rides along in the workout's JSONB on save.
  const addCardio = (activityId = 'running') => {
    const a = CARDIO_ACTIVITIES.find(x => x.id === activityId) || CARDIO_ACTIVITIES[1];
    setExercises([...exercises, {
      kind: 'cardio',
      activity: a.id,
      name: a.name,
      displayName: a.name,
      segments: [{ duration_s: null, distance_m: null }],
      sets: [],
    }]);
    setCardioMenuOpen(false);
  };

  // True if a cardio entry has any duration/distance logged (across splits).
  const cardioHasData = (ex) => {
    const segs = Array.isArray(ex.segments) ? ex.segments : [{ duration_s: ex.duration_s, distance_m: ex.distance_m }];
    return segs.some(s => Number(s.duration_s) > 0 || Number(s.distance_m) > 0);
  };

  // Count logged-but-unchecked items for the finish nudge. Returns 0 when the
  // lifter hasn't used ✓ Done at all, so people who don't use it never get nagged.
  const uncheckedOnFinish = () => {
    const engaged = exercises.some(ex => ex.completed || (ex.sets || []).some(s => s.completed));
    if (!engaged) return 0;
    let n = 0;
    for (const ex of exercises) {
      if (ex.completed) continue;
      if (ex.kind === 'cardio') {
        if (cardioHasData(ex)) n += 1;
      } else {
        n += (ex.sets || []).filter(s => (s.weight != null || s.reps != null) && !s.completed).length;
      }
    }
    return n;
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
        // Cardio entries have no sets — validity is distance/duration, so flag
        // only when BOTH are empty (never as "no sets").
        if (ex.kind === 'cardio') {
          if (!cardioHasData(ex)) {
            missing.push({ exName: ex.displayName || ex.name || 'Cardio', reason: 'no distance or duration' });
          }
          return;
        }
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
      // User-given name wins; else the regimen name; else Freestyle.
      regimen_name: workoutName.trim() || selectedRegimen?.name || t('workout.freestyle'),
      date,
      // `duration_min` is the real column. This said `duration_minutes` —
      // a column workout_logs does not have — so db.js's strip-and-retry
      // dropped it on every save and the duration was never stored. See
      // src/lib/workoutDuration.js for the full account.
      [DURATION_COLUMN]: effectiveDuration,
      exercises: pendingExercises,
      notes,
      tags: workoutTags,
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
      { date, exercises: pendingPayload.exercises, [DURATION_COLUMN]: pendingPayload[DURATION_COLUMN] },
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

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  // Returns JSX for one grid row by ID. Defined here (inside component) so it
  // captures all state/handlers without prop-drilling. Used by both the static
  // Every tile in this grid gets the SAME surface.
  //
  // This used to be a 12-entry position-based gradient ramp — "top=red,
  // bottom=yellow" — so each tile carried its own hue and a matching
  // coloured glow. Two problems. It's the "every block gets its own
  // colour" pattern that reads as generated, and because the ramp was
  // keyed on POSITION rather than on the card, the colour encoded
  // nothing at all: reordering the grid (which this page lets you do)
  // repainted every tile. A user could not learn "Duels is the red one",
  // because Duels was only red while it sat in slot two.
  //
  // The tiles are navigation. They separate by their icon and label; the
  // brand accent lives on the icon, and the surface is the same card
  // surface as the rest of the app. `idx` is kept in the signature so
  // the call-sites don't change and so a future intentional per-card
  // treatment has somewhere to go.
  const getCardPalette = (/* idx */) => ({
    background: 'hsl(var(--card))',
    borderClass: 'border-border/60 hover:border-primary/40',
  });

  // Renders a single grid card by ID. idx = position among non-nemesis cards
  // (drives colour palette so red stays at top, yellow at bottom).
  const renderCard = (id, idx) => {
    const InfoBtn = ({ bid }) => (
      <button type="button"
        onClick={(e) => { e.stopPropagation(); setActiveInfo(activeInfo === bid ? null : bid); }}
        aria-label="What is this card?"
        aria-expanded={activeInfo === bid}
        // The badge keeps its rendered size; `before:` grows the TAP box to
        // ~44px. Four of these render in a single viewport and every one was
        // a 16px target sitting 8px from the card's own click handler, so a
        // miss didn't just fail — it navigated somewhere instead.
        // active:text-foreground is the app-wide press state; the glyph is
        // text-micro per the 11px type floor.
        className="absolute top-2 end-2 w-4 h-4 rounded-full border border-border/60 bg-background/80 flex items-center justify-center text-muted-foreground/60 hover:text-foreground active:text-foreground hover:border-border transition-colors z-10 before:absolute before:content-[''] before:-inset-3.5">
        <span className="text-micro font-bold leading-none italic">i</span>
      </button>
    );
    const InfoText = ({ bid, text }) => activeInfo === bid
      ? <p className="text-micro text-foreground/70 mt-1 leading-tight">{text}</p>
      : null;

    const pal = getCardPalette(idx);
    const cardBase = `group relative cursor-pointer h-full transition-colors p-3 ${pal.borderClass}`;

    if (id === 'generate') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card role="button" tabIndex={0} aria-label="Generate Workout"
          className={cardBase} style={{ background: pal.background }}
          onClick={() => navigate('/coach?generate=1')}
          onKeyDown={(e) => { if (e.key==='Enter'||e.key===' '){e.preventDefault();navigate('/coach?generate=1');} }}>
          <InfoBtn bid="generate" />
          <div className="flex flex-col items-center text-center gap-1.5">
            {/* Matches the other nine cards. This was the lone solid
                bg-primary tile in the grid, which read as a priority the
                layout never explained — its neighbour "Explore Regimens" is
                a peer, not a lesser option. If the Coach deserves top
                billing, that is a navigation decision, not a tile colour. */}
            <div className="w-10 h-10 rounded-xl bg-primary/18 border border-primary/28 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-heading font-bold text-sm leading-tight">{tFallback('generator.title','Generate Workout')}</p>
              <InfoText bid="generate" text="Tell the AI Coach your goal — or tap Quick pick — and it builds a session or plan." />
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
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <Globe className="w-5 h-5 text-primary" />
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
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <Swords className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                <p className="font-heading font-bold text-sm leading-tight">Duels</p>
                {activeDuel && <span className="text-micro font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/15 text-success">Active</span>}
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
            <div className="w-10 h-10 rounded-xl bg-primary/18 border border-primary/28 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                <p className="font-heading font-bold text-sm leading-tight">Bounties</p>
                {activeBountyClaim && <span className="text-micro font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">Active</span>}
                {!activeBountyClaim && activeBounties.length>0 && <span className="text-micro font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">{activeBounties.length} open</span>}
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
            <div className="w-10 h-10 rounded-xl bg-primary/18 border border-primary/28 flex items-center justify-center shrink-0">
              <Dumbbell className="w-5 h-5 text-primary" />
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
            <div className="w-10 h-10 rounded-xl bg-primary/18 border border-primary/28 flex items-center justify-center shrink-0">
              <History className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-heading font-bold text-sm leading-tight">{tFallback('workout.allWorkouts','All Workouts')}</p>
              <InfoText bid="saved" text="Browse, search, and replay every workout — gym and cardio." />
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
            <div className="w-10 h-10 rounded-xl bg-primary/18 border border-primary/28 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-primary" />
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
            <div className="w-10 h-10 rounded-xl bg-primary/18 border border-primary/28 flex items-center justify-center shrink-0">
              <Target className="w-5 h-5 text-primary" />
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
      // GymRivalCard renders its own bordered card per state, so this
      // wrapper is just a positioning context for the info button — no
      // border/bg of its own (that produced a double rose outline).
      // data-gym-rival is the scroll target for the ?rival=1 deep link —
      // the card itself is a switch branch, so the wrapper is what a
      // querySelector can reach.
      <div className="relative" data-gym-rival>
        <button type="button"
          onClick={(ev) => { ev.stopPropagation(); setActiveInfo(activeInfo==='nemesis'?null:'nemesis'); }}
          className="absolute top-3 end-3 w-4 h-4 rounded-full border border-border/60 bg-background/80 flex items-center justify-center text-muted-foreground/60 hover:text-foreground active:text-foreground hover:border-border transition-colors z-20">
          <span className="text-micro font-bold leading-none italic">i</span>
        </button>
        {activeInfo==='nemesis' && (
          <p className="absolute top-9 end-3 z-20 text-micro text-muted-foreground bg-background/95 border border-border/60 rounded-lg px-2 py-1.5 max-w-[190px] leading-tight shadow-sm">
            Weekly Rivals — you're matched with someone at your level. Out-train them to win rewards.
          </p>
        )}
        <ErrorBoundary label="GymRivalCard">
          <GymRivalCard currentUserId={user?.id} />
        </ErrorBoundary>
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
            <div className="w-10 h-10 rounded-xl bg-primary/18 border border-primary/28 flex items-center justify-center shrink-0">
              <Trophy className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                <p className="font-heading font-bold text-sm leading-tight">Gauntlet</p>
                {gauntletProgress?.path_completed && <span className="text-micro font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">Done</span>}
                {!gauntletProgress?.path_completed && gauntletProgress && <span className="text-micro font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">#{gauntletProgress.current_challenge_sequence}</span>}
              </div>
              <InfoText bid="gauntlet" text="Complete 10 epic challenges to earn prizes and climb the leaderboard." />
            </div>
          </div>
        </Card>
      </motion.div>
    );

    // Form Coach moved out of the grid — it's now a button inside the
    // active workout view (next to the plate calculator).


    if (id === 'crew') return (
      <motion.div whileHover={{ y:-2 }} whileTap={{ scale:0.98 }} transition={{ type:'spring', stiffness:380, damping:22 }}>
        <Card role="button" tabIndex={0} aria-label="Crew Wars"
          className={cardBase} style={{ background: pal.background }}
          onClick={() => navigate('/hub', { state:{ openCrewWars:true } })}
          onKeyDown={(e) => { if (e.key==='Enter'||e.key===' '){e.preventDefault();navigate('/hub',{state:{openCrewWars:true}});} }}>
          <InfoBtn bid="crew" />
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="w-10 h-10 rounded-xl bg-primary/22 border border-primary/35 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-primary" />
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
  //   /workout?freestyle=1    — every "Start a workout" CTA in the app
  //                             (Dashboard hero + its slideshow, the
  //                             Workout tab's Quick log long-press)
  //   /workout?rival=1        — "Open rival" on the Hub profile's contest
  //                             rail; scrolls to the card and opens it
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
    // A "Start" button that lands you on a page with another Start button
    // on it is a step the user already took. This opens the session for
    // them — but NOT over a live one: startFreestyle() blanks the exercise
    // list, so firing it on someone mid-workout would delete the sets
    // they've logged. Already started is already where the CTA was going.
    if (params.get('freestyle') === '1') {
      if (!started) startFreestyle();
      params.delete('freestyle');
      consumed = true;
    }
    // The Gym Rival card lives partway down this page, so the Hub's "Open
    // rival" used to hand the user a page and leave them to find it.
    let rivalRequested = false;
    if (params.get('rival') === '1') {
      rivalRequested = true;
      params.delete('rival');
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
      // ?rival=1 is the exception — it has its own target further down the
      // page, and scrolling to the top would undo it.
      setTimeout(() => {
        try {
          if (rivalRequested) {
            document.querySelector('[data-gym-rival]')
              ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            // Opens the rival's detail menu — the thing the Hub CTA named.
            // A no-op when the card isn't on screen (mid-session, or the
            // tile hidden in the user's layout), which is the right
            // failure: they still land on the page they asked for.
            window.dispatchEvent(new CustomEvent('flexyn:open-rival'));
          } else {
            window.scrollTo({ top: 0, behavior: 'auto' });
          }
        } catch { /* noop */ }
      }, 0);
    }
    // `started` and `startFreestyle` are deliberately not deps. The param
    // is the trigger; re-running this because a session opened (or because
    // startFreestyle was re-created on a render) would only re-read a
    // search string this pass already stripped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                ? 'bg-primary/15 border-primary/50 text-primary'
                : 'bg-primary/8 border-primary/35 text-primary hover:bg-primary/14 active:bg-primary/14 hover:border-primary/55'
            }`}
          >
            <CalendarDays className="w-3 h-3" />
            <span className="text-micro font-semibold tracking-[0.12em] uppercase">Today</span>
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${todayExpanded ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex items-center gap-1.5">
            {activeDuel && (
              <button type="button" onClick={() => navigate('/duels')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-destructive/10 border border-destructive/25 text-destructive text-micro font-semibold hover:bg-destructive/18 active:bg-destructive/18 transition-colors">
                <Swords className="w-3 h-3" />
                <span>Duel</span>
                <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse ms-0.5" />
              </button>
            )}
            {activeBountyClaim && (
              <button type="button" onClick={() => navigate('/bounties')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-primary/10 border border-primary/25 text-primary text-micro font-semibold hover:bg-primary/18 active:bg-primary/18 transition-colors">
                <Zap className="w-3 h-3" />
                <span>Bounty</span>
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse ms-0.5" />
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
                  : 'bg-muted/35 border-border/35 text-muted-foreground/35 hover:text-muted-foreground active:text-muted-foreground hover:bg-muted/60 active:bg-muted/60 hover:border-border/60'
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
                            <span className="block text-micro font-bold tracking-[0.25em] uppercase text-primary/80 mb-2">{t('workout.startKicker')}</span>
                            <span className="font-heading font-black text-3xl md:text-4xl leading-none block tracking-tight min-h-[2em]">{t('workout.freestyle')}</span>
                            <span className="text-label text-white/50 mt-2.5 block max-w-[36ch] leading-relaxed min-h-[3.25em]">{t('workout.freestyleDesc')}</span>
                            <span className="inline-flex items-center gap-1 mt-3 px-2.5 py-1 rounded-full bg-white/8 border border-white/10 text-micro font-semibold text-white/60 tracking-wide uppercase">
                              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />Ready to go
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
                        <div className="absolute top-0 start-8 end-8 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none" />
                        <div className="relative flex items-center justify-between gap-4 p-6 md:p-8">
                          <div className="min-w-0">
                            <span className="block text-micro font-bold tracking-[0.25em] uppercase text-primary/80 mb-2">CHALLENGE YOURSELF</span>
                            <span className="font-heading font-black text-3xl md:text-4xl leading-none block tracking-tight min-h-[2em]">The Gauntlet</span>
                            <span className="text-label text-white/50 mt-2.5 block max-w-[36ch] leading-relaxed min-h-[3.25em]">10 challenges. One path. Prove what you are made of.</span>
                            <span className="inline-flex items-center gap-1 mt-3 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/20 text-micro font-semibold text-primary/80 tracking-wide uppercase">
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
                        <div className="absolute top-0 start-8 end-8 h-px bg-gradient-to-r from-transparent via-success/25 to-transparent pointer-events-none" />
                        <div className="relative flex items-center justify-between gap-4 p-6 md:p-8">
                          <div className="min-w-0">
                            <span className="block text-micro font-bold tracking-[0.25em] uppercase text-success/80 mb-2">CREW BATTLES</span>
                            <span className="font-heading font-black text-3xl md:text-4xl leading-none block tracking-tight min-h-[2em]">Crew Wars</span>
                            <span className="text-label text-white/50 mt-2.5 block max-w-[36ch] leading-relaxed min-h-[3.25em]">Rally your crew. Crush rivals. Dominate the leaderboard.</span>
                            <span className="inline-flex items-center gap-1 mt-3 px-2.5 py-1 rounded-full bg-success/15 border border-success/20 text-micro font-semibold text-success/80 tracking-wide uppercase">
                              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />Join the fight
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
                    <div><span className="block text-micro mb-2">x</span><span className="font-heading font-black text-3xl block leading-none min-h-[2em]">x</span><span className="text-label mt-2.5 block min-h-[3.25em]">placeholder line</span><span className="inline-flex mt-3 px-2.5 py-1 text-micro">badge placeholder</span></div>
                    <div className="w-16 h-16 rounded-2xl shrink-0" />
                  </div>
                </div>
              </div>
              {/* Dots */}
              <div className="flex justify-center gap-2 mt-2.5">
                {[0, 1, 2].map(i => (
                  <button key={i} type="button"
                    onClick={() => setHeroState([i, i > heroSlide ? 1 : -1])}
                    className={`transition-all duration-300 rounded-full ${heroSlide === i ? 'w-5 h-1.5 bg-primary' : 'w-1.5 h-1.5 bg-muted-foreground/25 hover:bg-muted-foreground/50 active:bg-muted-foreground/50'}`}
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
                    <span className="absolute top-2 end-2 text-micro font-bold uppercase tracking-[0.18em] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                      {tFallback('common.today', 'Today')}
                    </span>
                  )}
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 md:w-11 md:h-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 group-hover:bg-primary/25 transition-colors">
                      <History className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-micro font-semibold tracking-[0.18em] uppercase text-primary">
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
                  <p className="text-micro text-muted-foreground/60 font-medium">Drag cards to reorder</p>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => { localStorage.setItem(cardOrderKey, JSON.stringify(cardOrder)); setGridEditing(false); toast.success('Layout saved.'); setDragSrcIdx(null); setDragOverIdx(null); }}
                      className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-micro font-bold hover:bg-primary/90 active:bg-primary/90 transition-colors">Save</button>
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
                        className="px-2.5 py-1 rounded-lg bg-primary/15 border border-primary/40 text-primary dark:text-primary text-micro font-bold hover:bg-primary/25 active:bg-primary/25 transition-colors"
                      >
                        Set default
                      </button>
                    )}
                    <button onClick={() => { setCardOrder([...CARD_ORDER_DEFAULT]); localStorage.removeItem(cardOrderKey); setGridEditing(false); setDragSrcIdx(null); setDragOverIdx(null); }}
                      className="px-2.5 py-1 rounded-lg bg-secondary text-muted-foreground text-micro font-semibold hover:bg-secondary/80 active:bg-secondary/80 transition-colors">Reset</button>
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
                      className="p-4 border-primary/40 bg-primary/5 cursor-pointer hover:bg-primary/10 active:bg-primary/10 transition-colors"
                      onClick={() => handleResumeSession(session.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                            <Pause className="w-4 h-4 text-primary" />
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
                            className="text-xs text-muted-foreground hover:text-destructive active:text-destructive"
                            onClick={(e) => { e.stopPropagation(); removeSession(session.id); }}
                          >
                            {t('workout.discard')}
                          </Button>
                          <Button size="sm" className="bg-primary hover:bg-primary active:bg-primary text-white text-xs">
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
                {tFallback('workout.allWorkouts', 'All Workouts')}
              </DialogTitle>
            </DialogHeader>

            {/* Gym / Cardio tabs — tap or swipe the panel below. */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/50 p-1 mt-1">
              {[
                { id: 'gym', label: tFallback('workout.tab.gym', 'Gym'), emoji: '🏋️' },
                { id: 'cardio', label: tFallback('workout.tab.cardio', 'Cardio'), emoji: '🏃' },
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setHistoryTab(tab.id)}
                  aria-pressed={historyTab === tab.id}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${
                    historyTab === tab.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground active:text-foreground'
                  }`}
                >
                  <span>{tab.emoji}</span> {tab.label}
                </button>
              ))}
            </div>

            {/* Search by name or date */}
            <div className="relative mt-3">
              <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder={tFallback('workout.searchWorkouts', 'Search by name or date…')}
                className="w-full h-10 ps-9 pe-3 rounded-xl bg-secondary/40 border border-border text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div className="relative overflow-hidden mt-3">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={historyTab}
                  initial={{ opacity: 0, x: historyTab === 'gym' ? -24 : 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: historyTab === 'gym' ? 24 : -24 }}
                  // 0.1 because mode="wait" pays it twice — see Coach.jsx.
                  transition={{ duration: 0.1, ease: 'easeOut' }}
                  drag="x"
                  dragDirectionLock
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.18}
                  onDragEnd={(_e, info) => {
                    if (info.offset.x < -60 && historyTab === 'gym') setHistoryTab('cardio');
                    else if (info.offset.x > 60 && historyTab === 'cardio') setHistoryTab('gym');
                  }}
                >
                  {historyTab === 'gym' ? (
                    <WorkoutSavedList search={historySearch} onSelectLog={(log) => { setSavedWorkoutsOpen(false); setEditingLog(log); }} />
                  ) : (
                    <Suspense fallback={<div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>}>
                      <CardioSavedList search={historySearch} onSelectLog={(log) => setCardioDetailLog(log)} />
                    </Suspense>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </DialogContent>
        </Dialog>

        {/* Cardio detail (from the Cardio history tab) */}
        {cardioDetailLog && (
          <Suspense fallback={null}>
            <CardioDetailModal
              log={cardioDetailLog}
              open={!!cardioDetailLog}
              onOpenChange={(o) => { if (!o) setCardioDetailLog(null); }}
              onEdit={() => setCardioDetailLog(null)}
            />
          </Suspense>
        )}

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
              // total_volume rides along with the exercises that produced it.
              // EditWorkoutModal's payload carries only the fields it edits,
              // so an edit used to rewrite `exercises` and leave the
              // denormalised column at its pre-edit value — and that column
              // is what get_gym_leaderboard ranks members on and what
              // get_gym_community_progress sums into the gym's "lbs moved".
              // Same number as the delta above, so the row and the profile
              // can't disagree about the same edit.
              await db.entities.WorkoutLog.update(id, { ...data, total_volume: newVolume });
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

      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl md:text-3xl font-bold tracking-tight truncate">
            {selectedRegimen?.name || t('workout.freestyle')}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t('workout.logSetsReps')}</p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => setConfirmDiscard(true)}>{t('common.cancel')}</Button>
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/90"
            >
              {tFallback('workout.discard', 'Discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Live session stats — elapsed timer + volume, grouped so the two
          watch-me numbers sit together cleanly (the timer used to crowd the
          title next to Cancel). */}
      <div className="flex items-center gap-2 mb-6">
        <WorkoutElapsedChip startedAt={startedAt} />
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
        {/* + Cardio — log a walk / run / bike inside the workout. Tapping opens
            a tiny activity picker; choosing one drops a cardio card into the
            list. */}
        <div className="relative mt-2">
          <button
            type="button"
            onClick={() => setCardioMenuOpen(o => !o)}
            aria-expanded={cardioMenuOpen}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-info/40 text-sm font-semibold text-info dark:text-info hover:bg-info/10 active:bg-info/10 transition-colors"
          >
            <Plus className="w-4 h-4" /> {tFallback('workout.addCardio', 'Cardio')}
            <span className="text-base leading-none">
              {activityEmoji('walking', userProfile?.gender)} {activityEmoji('running', userProfile?.gender)} {activityEmoji('cycling', userProfile?.gender)}
            </span>
          </button>
          <AnimatePresence>
            {cardioMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.14 }}
                className="absolute z-20 top-full mt-1.5 inset-x-0 grid grid-cols-3 gap-1.5 p-1.5 rounded-xl border border-border bg-card shadow-lg"
              >
                {CARDIO_ACTIVITIES.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => addCardio(a.id)}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-lg hover:bg-secondary active:bg-secondary transition-colors"
                  >
                    <span className="text-2xl leading-none">{activityEmoji(a.id, userProfile?.gender)}</span>
                    <span className="text-xs font-semibold">{a.label}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {/* In-workout utilities: plate calculator + AI Form Coach. */}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setPlateCalcOpen(true)}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground transition-colors"
          >
            <Calculator className="w-4 h-4" />
            {tFallback('workout.plateCalc', 'Plate calculator')}
          </button>
          <button
            type="button"
            onClick={() => setFormCoachOpen(true)}
            aria-label={tFallback('formcoach.title', 'Form Coach')}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-primary/40 text-sm font-semibold text-primary dark:text-primary hover:bg-primary/10 active:bg-primary/10 transition-colors"
          >
            <Camera className="w-4 h-4" />
            {tFallback('formcoach.title', 'Form Coach')}
          </button>
        </div>
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
                  {ex.kind === 'cardio' ? (
                    <CardioLogger
                      exercise={ex}
                      onChange={(updated) => updateExercise(i, updated)}
                      gender={userProfile?.gender}
                    />
                  ) : (
                    <ExerciseLogger
                      exercise={ex}
                      onChange={(updated) => updateExercise(i, updated)}
                      userProfile={userProfile}
                      prIndex={prIndex}
                      workoutLogs={rawLogs}
                    />
                  )}
                <div className="absolute top-3 end-3 flex items-center gap-1">
                  {/* Group with previous as a superset — one-tap pairing
                      that fills in group_id on both exercises so the
                      GroupBlock renderer picks them up on next render.
                      Only meaningful when the previous exercise exists
                      AND neither is already in a group. Cardio entries
                      can't superset. */}
                  {ex.kind !== 'cardio' && i > 0 && !ex.group_id && !exercises[i - 1]?.group_id && (
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
                      className="p-1.5 rounded-md text-muted-foreground hover:text-primary active:text-primary hover:bg-primary/10 active:bg-primary/10 transition-colors"
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
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive active:text-destructive hover:bg-destructive/10 active:bg-destructive/10 transition-colors"
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

      {/* Name this workout */}
      <div className="mb-4">
        <label htmlFor="workout-name" className="text-xs font-medium text-muted-foreground mb-1 block">
          {tFallback('workout.nameLabel', 'Workout name')}
        </label>
        <Input
          id="workout-name"
          value={workoutName}
          onChange={(e) => setWorkoutName(e.target.value.slice(0, 60))}
          placeholder={selectedRegimen?.name || tFallback('workout.namePlaceholder', 'e.g. Push Day A')}
          maxLength={60}
        />
      </div>

      {/* Tags — colored pills for muscle groups / session type */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          {tFallback('workout.tagsLabel', 'Tags')}
        </label>
        <TagSelector value={workoutTags} onChange={setWorkoutTags} />
      </div>

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
          onClick={() => { if (uncheckedOnFinish() > 0) setIncompleteWarnOpen(true); else saveWorkout(); }}
          disabled={exercises.length === 0 || saveMutation.isPending}
        >
          <Save className="w-5 h-5 me-2" />
          {saveMutation.isPending ? t('workout.saving') : t('workout.saveWorkout')}
        </Button>
      </motion.div>

      {/* Finish-workout completeness nudge — only fires once the lifter has
          started checking sets off (so people who don't use ✓ Done never get
          nagged), and counts logged-but-unchecked sets + incomplete cardio. */}
      <AlertDialog open={incompleteWarnOpen} onOpenChange={setIncompleteWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finish your workout?</AlertDialogTitle>
            <AlertDialogDescription>
              You still have {uncheckedOnFinish()} item{uncheckedOnFinish() === 1 ? '' : 's'} that {uncheckedOnFinish() === 1 ? "isn't" : "aren't"} checked off.
              You can finish now — they just won't be marked done.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setIncompleteWarnOpen(false); saveWorkout(); }}>
              Finish anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



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
                      <span className="block text-micro">Weight exceeds {f.maxWeight} lbs max for your profile</span>
                    )}
                    {f.repsFlagged && f.maxReps != null && (
                      <span className="block text-micro">Reps exceed {f.maxReps} reps max at that weight</span>
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
            // Writes total_volume for the same reason the idle-view copy does.
            await db.entities.WorkoutLog.update(id, { ...data, total_volume: newVolume });
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
