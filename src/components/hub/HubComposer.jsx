// src/components/hub/HubComposer.jsx
//
// The Hub composer supports two post kinds:
//   1. Status — free-text only, no images, profanity-filtered.
//   2. Activity-tied — picks from real workouts/cardio/meals/goals/etc.
//      Optional caption (also profanity-filtered).
//
// There is no file picker for posting content — progress photos are the only
// image source, and they're chosen from the user's saved progress photos.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Send, Globe2, Lock,
  Dumbbell, Activity, Apple, Target, Trophy, ListChecks, Image as ImageIcon, BarChart3,
  ArrowLeft, Loader2, MessageSquare, ChevronDown, Camera, XCircle, Film, Users, AtSign, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { cardioTypeLabel } from '@/lib/cardioTypeLabel';
import { displayName, handle } from '@/lib/userDisplay';
import { reportError } from '@/lib/reportError';
import { triggerHaptic } from '@/lib/haptic';
import { useFormDraft } from '@/hooks/useFormDraft';
import { useProfanityGuard } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import { containsProfanity } from '@/lib/profanityFilter';
import * as hubPosts from '@/lib/data/hubPosts';
import * as hubFollows from '@/lib/data/hubFollows';
import * as quests from '@/lib/data/quests';
import * as notifications from '@/lib/data/notifications';
import { useNumberFormatter } from '@/lib/intl';
import * as users from '@/lib/data/users';
import { supabase } from '@/api/supabaseClient';
import { ACTION_TYPES } from '@/lib/questCatalog';
import * as workouts from '@/lib/data/workouts';
import * as cardio from '@/lib/data/cardio';
import * as nutrition from '@/lib/data/nutrition';
import * as goals from '@/lib/data/goals';
import { listEarnedForShare } from '@/lib/data/trophies';
import * as regimens from '@/lib/data/regimens';
import { loadProgressPhotos } from '@/components/progress/ProgressPhotoCapture';
import { db } from '@/api/db';
import { toast } from '@/lib/toast';
import { NoWorkoutsIllustration } from '@/components/emptyStateIllustrations';
import CharCountIndicator from '@/components/ui/CharCountIndicator';
import { compressImage } from '@/lib/imageCompress';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { workoutDurationMin } from '@/lib/workoutDuration';

// Trim a GPS track down to ~250 points so the map render stays fast
// and the post payload stays under reasonable size limits. Preserves
// start, end, and evenly-distributed intermediate points.
function decimateGpsTrack(track, target = 250) {
  if (!Array.isArray(track) || track.length <= target) return track || [];
  const step = track.length / target;
  const out = [];
  for (let i = 0; i < target - 1; i++) {
    const idx = Math.floor(i * step);
    const p = track[idx];
    out.push({ lat: p.lat, lng: p.lng, timestamp_ms: p.timestamp_ms });
  }
  // Always include the final point so the route ends correctly
  const last = track[track.length - 1];
  out.push({ lat: last.lat, lng: last.lng, timestamp_ms: last.timestamp_ms });
  return out;
}

// Build a display-safe snapshot of the activity for embedding in a post.
// Only include fields needed to render the post card — never include
// internal IDs, owner emails, or any field not directly shown to viewers.
function buildSnapshot(kind, item) {
  if (!item) return null;
  switch (kind) {
    case 'workout':
      return {
        regimen_name: item.regimen_name || null,
        date: item.date || null,
        duration_minutes: workoutDurationMin(item) || null,
        exercises: (item.exercises || []).map(e => ({
          exercise_name: e.exercise_name || e.name || null,
          sets: (e.sets || []).map(s => ({
            weight: s.weight || 0,
            reps: s.reps || 0,
          })),
        })),
      };
    case 'cardio':
      return {
        type: item.type || 'cardio',
        mode: item.mode || 'manual',
        date: item.date || null,
        duration_seconds: item.duration_seconds || null,
        distance_meters: item.distance_meters || null,
        pace_seconds_per_km: item.pace_seconds_per_km || null,
        avg_speed_kmh: item.avg_speed_kmh || null,
        calories: item.calories || null,
        elevation_gain_m: item.elevation_gain_m || null,
        incline_percent: item.incline_percent ?? null,
        gps_track: decimateGpsTrack(item.gps_track),
      };
    case 'meal':
      return {
        food_name: item.food_name || null,
        meal_type: item.meal_type || null,
        calories: item.calories || null,
        protein_g: item.protein_g || null,
        carbs_g: item.carbs_g || null,
        fat_g: item.fat_g || null,
        servings: item.servings || null,
      };
    case 'goal':
      return {
        exercise_name: item.exercise_name || null,
        target_weight: item.target_weight || null,
        target_reps: item.target_reps || null,
        achieved_weight: item.achieved_weight || null,
        achieved_reps: item.achieved_reps || null,
        completed_date: item.completed_date || item.updated_date || null,
      };
    case 'achievement':
      return {
        achievement_id: item.achievement_id || null,
        name: item.name || null,
        description: item.description || null,
        icon: item.icon || null,
        unlocked_date: item.unlocked_date || null,
        xp_reward: item.xp_reward || null,
      };
    case 'regimen':
      return {
        name: item.name || null,
        description: item.description || null,
        exercises: (item.exercises || []).map(e => ({
          exercise_name: e.exercise_name || e.name || null,
          target_sets: e.target_sets || null,
          target_reps: e.target_reps || null,
        })),
      };
    case 'stats':
      return {
        level: item.level || null,
        total_xp: item.total_xp || null,
        total_volume_lbs: item.total_volume_lbs || null,
        total_distance_meters: item.total_distance_meters || null,
        achievements_unlocked_count: item.achievements_unlocked_count || null,
      };
    case 'progressPhoto':
      // The image_url field on the post already carries the photo;
      // we only need the caption metadata in the snapshot.
      return {
        workout_name: item.workoutName || null,
        taken_at: item.takenAt || null,
      };
    default:
      return null;
  }
}

const summarize = {
  workout: (w) => {
    const exCount = (w.exercises || []).length;
    const setCount = (w.exercises || []).reduce((s, e) => s + (e.sets?.length || 0), 0);
    const date = w.date ? format(parseISO(w.date), 'MMM d') : '';
    return `${w.regimen_name || 'Freestyle'} · ${exCount} exercise${exCount === 1 ? '' : 's'} · ${setCount} set${setCount === 1 ? '' : 's'}${date ? ' · ' + date : ''}`;
  },
  cardio: (c, typeLabel) => {
    const km = c.distance_meters ? (c.distance_meters / 1000).toFixed(2) : null;
    const mins = c.duration_seconds ? Math.round(c.duration_seconds / 60) : null;
    const parts = [typeLabel || (c.type || 'cardio')];
    if (km) parts.push(`${km} km`);
    if (mins) parts.push(`${mins} min`);
    return parts.join(' · ');
  },
  meal: (m) => {
    const cal = m.calories != null ? `${Math.round(m.calories)} cal` : '';
    return [m.food_name, cal].filter(Boolean).join(' · ');
  },
  goal: (g) => g.exercise_name || g.goal_type || 'Goal',
  achievement: (a) => a.name || a.achievement_id || 'Achievement',
  regimen: (r) => `${r.name} · ${(r.exercises || []).length} exercise${(r.exercises || []).length === 1 ? '' : 's'}`,
  progressPhoto: (p) => {
    const date = p.takenAt ? format(parseISO(p.takenAt), 'MMM d') : '';
    return [p.workoutName, date].filter(Boolean).join(' · ') || 'Progress photo';
  },
  stats: (s, fmt) => {
    // fmt is an optional locale-aware number formatter from useNumberFormatter().
    // When the caller passes it the lift volume renders in the user's locale
    // (Arabic-Indic digits for ar, French thin-spaces, etc.); without it we
    // fall back to a plain toLocaleString() so this helper still works in
    // hook-less contexts (tests, error boundaries, future callers).
    const parts = [];
    const formatVol = fmt
      ? (n) => fmt(Math.round(n))
      : (n) => Math.round(n).toLocaleString();
    if (s.level) parts.push(`Level ${s.level}`);
    if (s.total_volume_lbs) parts.push(`${formatVol(s.total_volume_lbs)} lbs lifted`);
    if (s.total_distance_meters) parts.push(`${(s.total_distance_meters / 1000).toFixed(1)} km logged`);
    return parts.join(' · ') || 'Stats snapshot';
  },
};

const ICONS = {
  status: MessageSquare,
  workout: Dumbbell, cardio: Activity, meal: Apple,
  goal: Target, achievement: Trophy, regimen: ListChecks,
  progressPhoto: ImageIcon, stats: BarChart3,
  poll: BarChart3, video: Film,
};

export default function HubComposer({ onClose }) {
  const { t, tFallback, language } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fmt = useNumberFormatter();

  // Lock body scroll when composer is open. The composer only exists while
  // it's open, so the lock runs for the component's whole lifetime.
  useBodyScrollLock();

  const [step, setStep] = useState('pick');
  const [selected, setSelected] = useState(null);

  // Body field — used for both status posts (as the post body itself)
  // and activity-tied posts (as an optional caption). Profanity-guarded.
  const [body, setBody] = useState('');
  const bodyGuard = useProfanityGuard(setBody);

  // Auto-save draft of the body text + which kind of post the user
  // chose. Restores on remount with a "Draft restored · Discard" toast.
  // Storing kind so a user who picked "status" or "poll" lands back in
  // the same step on return; we only persist the lightweight selection
  // (NOT linked workouts/meals etc) because those snapshots can go stale.
  const draftValue = { body, kind: selected?.kind ?? null };
  const draft = useFormDraft({
    key: user?.email ? `flexyn.draft.hubComposer.${user.email}` : null,
    value: draftValue,
    enabled: !!user?.email,
    onRestore: (saved) => {
      if (!saved) return;
      if (typeof saved.body === 'string' && saved.body.length > 0) {
        setBody(saved.body);
      }
      // Only auto-resume a step we can hydrate without external data
      // (status posts are pure text; meal/workout posts need a fresh
      // server snapshot, so we don't restore those step picks).
      if (saved.kind === 'status') {
        setSelected({ kind: 'status', item: null, summary: null });
        setStep('status_compose');
      } else if (saved.kind === 'poll') {
        setSelected({ kind: 'poll', item: null, summary: null });
        setStep('poll_compose');
      }
    },
  });

  // Peek at the stored draft without consuming it, so the header can offer it
  // as something to go back to. useFormDraft owns the write side; this only
  // reads the same key, and applying it reuses the identical hydration rules
  // (status and poll only — meal/workout picks need a fresh server snapshot).
  const draftStorageKey = user?.email ? `flexyn.draft.hubComposer.${user.email}` : null;
  const [savedDraft, setSavedDraft] = useState(null);
  useEffect(() => {
    if (!draftStorageKey) { setSavedDraft(null); return; }
    try {
      const raw = localStorage.getItem(draftStorageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      const value = parsed && typeof parsed === 'object' ? parsed.value : null;
      setSavedDraft(value && typeof value.body === 'string' && value.body.trim() ? value : null);
    } catch { setSavedDraft(null); }
  }, [draftStorageKey, step]);

  const restoreSavedDraft = () => {
    const saved = savedDraft;
    if (!saved) return;
    if (typeof saved.body === 'string') setBody(saved.body);
    if (saved.kind === 'poll') {
      setSelected({ kind: 'poll', item: null, summary: null });
      setStep('poll_compose');
    } else {
      setSelected({ kind: 'status', item: null, summary: null });
      setStep('status_compose');
    }
  };

  const [privacy, setPrivacy] = useState('public');
  const [selectedCrewId, setSelectedCrewId] = useState(null);
  const [posting, setPosting] = useState(false);
  // Ref-based in-flight guard. The `disabled={posting}` gate on the
  // Post button is asynchronous — a rapid double-tap could fire
  // handlePost twice before `setPosting(true)` lands in state, racing
  // two creates of the same post (and two image uploads). The ref
  // flips synchronously inside handlePost. Same pattern as
  // DailyQuestsCard / LogMealForm / MoodLogCard.
  const postingRef = useRef(false);

  // Content warning state. NULL by default — most posts don't need one.
  // `cwType` is one of the catalog keys; `cwLabel` is freeform text
  // shown when cwType is 'other'.
  const [cwType, setCwType] = useState(null);
  const [cwLabel, setCwLabel] = useState('');
  const [cwPickerOpen, setCwPickerOpen] = useState(false);

  // ── Post scheduling ──────────────────────────────────────────────────────────
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(''); // ISO datetime-local string

  // Crew list for crew-private posts
  const { data: myCrews = [] } = useQuery({
    queryKey: ['myCrews', user?.id],
    queryFn:  () => import('@/lib/data/crews').then(m => m.getMyCrews(user.id)),
    enabled:  !!user?.id,
    staleTime: 60_000,
  });

  // Custom meal form (for meal posts without a prior log)
  const [customMeal, setCustomMeal] = useState({ food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' });

  // Optional image attachment for meal posts
  const [mealImageFile, setMealImageFile] = useState(null);
  const [mealImagePreview, setMealImagePreview] = useState(null);
  const mealImageInputRef = useRef(null);

  const handleMealImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMealImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setMealImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const clearMealImage = () => {
    setMealImageFile(null);
    setMealImagePreview(null);
    if (mealImageInputRef.current) mealImageInputRef.current.value = '';
  };

  // Feature 25: Optional image attachment for status posts
  const [statusImageFile, setStatusImageFile] = useState(null);
  const [statusImagePreview, setStatusImagePreview] = useState(null);
  const statusImageInputRef = useRef(null);

  const handleStatusImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setStatusImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const clearStatusImage = () => {
    setStatusImageFile(null);
    setStatusImagePreview(null);
    if (statusImageInputRef.current) statusImageInputRef.current.value = '';
  };

  // Feature 24: Poll compose state
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);

  // Video post state
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const videoInputRef = useRef(null);

  const handleVideoPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error('Video must be under 50 MB.');
      return;
    }
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
  };

  const clearVideo = () => {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(null);
    setVideoPreview(null);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  // Collaborator tagging state (id-keyed — co-authors are stored on the
  // post as collaborator_ids; mig 219 keeps collaborator_emails in sync)
  const [collaboratorInput, setCollaboratorInput] = useState('');
  const [collaboratorIds, setCollaboratorIds] = useState([]);

  // Look up users for collaborator @mention suggestions
  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => users.list(),
    staleTime: 60_000,
  });

  const collaboratorSuggestions = useMemo(() => {
    if (!collaboratorInput.trim()) return [];
    const q = collaboratorInput.toLowerCase().replace(/^@/, '');
    return allUsers
      .filter(u =>
        u.id !== user?.id &&
        !collaboratorIds.includes(u.id) &&
        (u.username || '').toLowerCase().includes(q)
      )
      .slice(0, 5);
  }, [collaboratorInput, allUsers, collaboratorIds, user?.id]);

  // ── Load shareable activities ──
  const { data: recentWorkouts = [] } = useQuery({
    queryKey: ['composer.workouts', user?.email],
    queryFn: () => workouts.list(user.email, 10),
    enabled: !!user?.email,
  });
  const { data: recentCardio = [] } = useQuery({
    queryKey: ['composer.cardio', user?.email],
    queryFn: () => cardio.list(user.email, 10),
    enabled: !!user?.email,
  });
  // Hydration shares the meal table: a glass of water is a `nutrition_logs`
  // row with meal_type NULL and food_name 'Water' (8 oz) or 'Water|N' (N oz).
  // 118 of the 126 rows in production are water, so anything listing "meals"
  // has to exclude them or it lists almost nothing else.
  //
  // This filter used to read `!(m.food_name === 'Water' && m.water_oz > 0)`
  // and excluded NOTHING. `water_oz` is a column migration 006 declares and
  // has never created, so `m.water_oz` is undefined, `undefined > 0` is
  // false, and the whole negated conjunction is therefore always true.
  // Measured against production: 8 of the 10 rows this handed the composer
  // were water, so "attach a recent meal" offered Water, Water, Water|32…
  // ahead of the two real meals. It also only matched the bare 'Water',
  // never the 'Water|N' form that carries a custom bottle size.
  //
  // The predicate below is the one used at Nutrition.jsx:72,
  // HydrationRing.jsx:41, MealHistoryModal.jsx:178 and LogMealForm.jsx:128.
  // Those four are correct; this was the fifth consumer and the only one
  // that got it wrong. Keep them in sync — see the audit doc for why a
  // shared helper is the better end state.
  const { data: recentMeals = [] } = useQuery({
    queryKey: ['composer.meals', user?.email],
    queryFn: () => nutrition.list(user.email, 20).then(meals =>
      meals
        .filter(m => !(m.food_name === 'Water' || m.food_name?.startsWith?.('Water|')))
        .slice(0, 10)
    ),
    enabled: !!user?.email,
  });
  const { data: completedGoals = [] } = useQuery({
    queryKey: ['composer.goals', user?.email],
    queryFn: async () => {
      const all = await goals.list(user.email);
      return all.filter(g => g.status === 'completed').slice(0, 10);
    },
    enabled: !!user?.email,
  });
  const { data: unlockedAchievements = [] } = useQuery({
    // Keyed on user.id, not email: user_trophies is keyed by uid and the
    // old email key would have gone on serving the retired table's
    // cached empty array.
    // Language is part of the key: the rows carry translated names and
    // descriptions, so a cached list from before a language switch would
    // render the share picker in the old one.
    queryKey: ['composer.achievements', user?.id, language],
    queryFn: async () => (await listEarnedForShare(user.id, tFallback)).slice(0, 10),
    enabled: !!user?.id,
  });
  const { data: myRegimens = [] } = useQuery({
    queryKey: ['composer.regimens', user?.email],
    queryFn: () => regimens.list(user.email),
    enabled: !!user?.email,
  });

  const [progressPhotos, setProgressPhotos] = useState([]);
  useEffect(() => {
    if (step === 'pick') {
      // Pass user.id so the per-user namespaced read picks up the
      // current user's photos (post-Wave-57 ProgressPhotoCapture fix).
      try { setProgressPhotos(loadProgressPhotos(user?.id).slice(0, 12)); } catch {}
    }
  }, [step, user?.id]);

  const statsSnapshot = {
    level: user?.level,
    total_volume_lbs: user?.total_volume_lbs,
    total_distance_meters: user?.total_distance_meters,
    achievements_unlocked_count: user?.achievements_unlocked_count,
  };

  const handlePick = (kind, item = null) => {
    // null item for meal = open custom meal form
    if (kind === 'meal' && !item) {
      setSelected({ kind: 'meal', item: null, summary: null });
      setCustomMeal({ food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' });
      setBody('');
      clearMealImage();
      setStep('meal_compose');
      return;
    }
    // Feature 24: Poll compose
    if (kind === 'poll') {
      setSelected({ kind: 'poll', item: null, summary: null });
      setPollQuestion('');
      setPollOptions(['', '']);
      setBody('');
      setStep('poll_compose');
      return;
    }
    // Video post
    if (kind === 'video') {
      setSelected({ kind: 'video', item: null, summary: null });
      clearVideo();
      setBody('');
      setStep('video_compose');
      return;
    }
    setSelected({
      kind,
      item,
      summary: kind === 'status' ? null
             : kind === 'cardio' ? summarize.cardio(item, cardioTypeLabel(item?.type, tFallback))
             : summarize[kind](item),
    });
    setBody('');
    clearMealImage();
    clearStatusImage();
    setStep(kind === 'status' ? 'status_compose' : 'compose');
  };

  // Shared by the dedicated video step and by a Status that has a clip
  // attached. Extracted rather than duplicated so both paths get the same
  // error mapping for UNSUPPORTED_FILE_TYPE / FILE_TOO_LARGE.
  const submitVideoPost = async () => {
      if (!videoFile) { toast.error('Please pick a video to share.'); return; }
      if (body && containsProfanity(body)) {
        toast.error(t('hub.composer.profanityError'));
        return;
      }
      setPosting(true);
      try {
        const result = await db.integrations.Core.UploadFile({ file: videoFile });
        const videoUrl = result?.file_url || null;
        await hubPosts.create({
          author_email:       user.email,
          author_name:        handle(user),
          author_avatar_url:  user.avatar_url || null,
          post_type:          'video',
          body:               body.trim() || 'Shared a video',
          video_url:          videoUrl,
          privacy,
          like_count:   0,
          dislike_count: 0,
          comment_count: 0,
          collaborator_ids: collaboratorIds.length > 0 ? collaboratorIds : [],
          ...(privacy === 'crew' && selectedCrewId ? { crew_id: selectedCrewId } : {}),
          ...(scheduleEnabled && scheduledAt ? { publish_at: new Date(scheduledAt).toISOString() } : {}),
        });
        queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
        toast.success(tFallback("hubComposer.videoPosted", "Video posted!"));
        draft.clear();
        clearVideo();
        onClose();
      } catch (err) {
        reportError(err, { feature: 'hub.composer.video', level: 'warning' });
        // _uploadFile throws distinct codes for bad input so we can give the
        // user an actionable reason instead of a generic "couldn't post".
        if (err?.code === 'UNSUPPORTED_FILE_TYPE') {
          toast.error(tFallback(
            'hub.composer.videoTypeError',
            'That file type isn’t supported. Use an MP4, MOV, WebM, or M4V video.'
          ));
        } else if (err?.code === 'FILE_TOO_LARGE') {
          toast.error(tFallback(
            'hub.composer.videoTooLarge',
            'That video is too large. The limit is 50 MB.'
          ));
        } else {
          toast.error(t('hub.composer.postError'));
        }
      } finally {
        setPosting(false);
      }
  };

  // ── Posting ──
  // Defensive submit-time profanity check — even if onChange interception
  // was bypassed (paste, autofill, programmatic injection), this catches it.
  const _handlePostInner = async () => {
    if (!selected) return;
    // Primary-action haptic — posting to Hub is one of the highest-
    // intent moments in the social surface. The centralized util
    // honors haptics-off + reduced-motion + rate-limit.
    triggerHaptic('primary');

    // Custom meal post: food_name is required.
    // The previous implementation did `selected.item = {...}` — directly
    // mutating the React state object. That worked the first time but on
    // a post-failure retry the now-non-null selected.item caused this
    // validation branch to be skipped, bypassing food_name + profanity
    // checks. We now build the finalized item locally and ALSO update
    // React state so subsequent retries see the correct state.
    let effectiveSelected = selected;
    if (selected.kind === 'meal' && !selected.item) {
      if (!customMeal.food_name.trim()) {
        toast.error('Please enter a meal name.');
        return;
      }
      if (containsProfanity(customMeal.food_name)) {
        toast.error(t('hub.composer.profanityError'));
        return;
      }
      const item = {
        food_name: customMeal.food_name.trim(),
        calories: parseFloat(customMeal.calories) || null,
        protein_g: parseFloat(customMeal.protein_g) || null,
        carbs_g: parseFloat(customMeal.carbs_g) || null,
        fat_g: parseFloat(customMeal.fat_g) || null,
      };
      const summary = summarize.meal(item);
      effectiveSelected = { ...selected, item, summary };
      setSelected((prev) => prev ? { ...prev, item, summary } : prev);
    }

    // Feature 24: Poll posts
    if (selected.kind === 'poll') {
      const q = pollQuestion.trim();
      const opts = pollOptions.map(o => o.trim()).filter(Boolean);
      if (!q) { toast.error('Please enter a poll question.'); return; }
      if (opts.length < 2) { toast.error('Please add at least 2 options.'); return; }
      if (containsProfanity(q) || opts.some(o => containsProfanity(o))) {
        toast.error(t('hub.composer.profanityError'));
        return;
      }
      setPosting(true);
      try {
        const pollBody = '[POLL_V1]' + JSON.stringify({ question: q, options: opts });
        await hubPosts.create({
          author_email: user.email,
          author_name: handle(user),
          author_avatar_url: user.avatar_url || null,
          post_type: 'poll',
          body: pollBody,
          privacy,
          like_count: 0,
          dislike_count: 0,
          comment_count: 0,
          ...(privacy === 'crew' && selectedCrewId ? { crew_id: selectedCrewId } : {}),
          ...(scheduleEnabled && scheduledAt ? { publish_at: new Date(scheduledAt).toISOString() } : {}),
        });
        queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
        toast.success("Poll's live.");
        draft.clear();
        onClose();
      } catch {
        toast.error(t('hub.composer.postError'));
      } finally {
        setPosting(false);
      }
      return;
    }

    if (selected.kind === 'video') {
      await submitVideoPost();
      return;
    }

    // Status posts: body is mandatory and is the entire post.
    // A status carrying a video IS a video post — same row shape, same
    // post_type, so the feed renders the player it already knows how to
    // render. Routing it here rather than duplicating the create() call keeps
    // one upload path with the orphan-cleanup the video branch never had.
    if (selected.kind === 'status' && videoFile) {
      if (body && containsProfanity(body)) {
        toast.error(t('hub.composer.profanityError'));
        return;
      }
      await submitVideoPost();
      return;
    }

    if (selected.kind === 'status') {
      if (!body.trim()) {
        toast.error(t('hub.composer.statusEmpty'));
        return;
      }
      if (containsProfanity(body)) {
        toast.error(t('hub.composer.profanityError'));
        return;
      }
    } else {
      // Activity-tied posts: caption is optional but still filtered.
      if (body && containsProfanity(body)) {
        toast.error(t('hub.composer.profanityError'));
        return;
      }
    }

    setPosting(true);
    // Track storage path of any uploaded image so we can clean up the
    // orphan blob if the post insert fails downstream. The previous
    // flow uploaded the file, then called hubPosts.create — if create
    // threw, the image stayed in Supabase Storage with no DB reference,
    // leaking on every retry. Same orphan pattern stories.js already
    // handles correctly; now HubComposer matches.
    let uploadedPath = null;
    let uploadedBucket = null;
    try {
      let imageUrl = null;

      if (effectiveSelected.kind === 'progressPhoto' && effectiveSelected.item?.dataUrl) {
        try {
          const blob = await (await fetch(effectiveSelected.item.dataUrl)).blob();
          const file = new File([blob], `progress-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
          const result = await db.integrations.Core.UploadFile({ file });
          imageUrl = result?.file_url || null;
          uploadedPath = result?.path || null;
          uploadedBucket = result?.bucket || 'uploads';
        } catch (e) {
          reportError(e, { feature: 'hub.composer.photo-upload', level: 'warning' });
          toast.error(t('hub.composer.postError'));
          setPosting(false);
          return;
        }
      }

      if (effectiveSelected.kind === 'meal' && mealImageFile) {
        try {
          const compressed = await compressImage(mealImageFile);
          const result = await db.integrations.Core.UploadFile({ file: compressed });
          imageUrl = result?.file_url || null;
          uploadedPath = result?.path || null;
          uploadedBucket = result?.bucket || 'uploads';
        } catch (e) {
          reportError(e, { feature: 'hub.composer.meal-upload', level: 'warning' });
          toast.error(t('hub.composer.postError'));
          setPosting(false);
          return;
        }
      }

      // Feature 25: status post image upload
      if (effectiveSelected.kind === 'status' && statusImageFile) {
        try {
          const compressed = await compressImage(statusImageFile);
          const result = await db.integrations.Core.UploadFile({ file: compressed });
          imageUrl = result?.file_url || null;
          uploadedPath = result?.path || null;
          uploadedBucket = result?.bucket || 'uploads';
        } catch (e) {
          reportError(e, { feature: 'hub.composer.status-upload', level: 'warning' });
          // Non-fatal: continue posting without the image
        }
      }

      const postTypeMap = {
        status: 'status',
        workout: 'workout',
        cardio: 'cardio',
        meal: 'meal',
        goal: 'goal_completed',
        achievement: 'achievement',
        regimen: 'regimen',
        progressPhoto: 'progress_photo',
        stats: 'stats',
      };

      // Body construction:
      //   Status:        body field = whole post content
      //   Activity-tied: body field = caption (if any) OR auto-generated summary
      let finalBody;
      if (effectiveSelected.kind === 'status') {
        finalBody = body.trim();
      } else {
        const translationKey = `hub.share.body.${effectiveSelected.kind}`;
        const translated = t(translationKey);
        // Detect missing translation: i18n returns the raw key on miss.
        const isTranslationMissing = translated === translationKey;
        const summary = effectiveSelected.summary || '';
        const autoBody = isTranslationMissing || !summary
          ? '' // Don't post the literal key string or "Just shared my undefined"
          : translated.replace('{summary}', summary);
        finalBody = body.trim() || autoBody;
        // Guard: never post an activity-tied post with empty body. Fall back to
        // a minimal language-agnostic label if everything above failed.
        if (!finalBody) {
          finalBody = `Shared ${effectiveSelected.kind}`;
        }
      }

      // Build snapshot for activity-linked posts
      const snapshot = effectiveSelected.kind === 'status'
        ? null
        : buildSnapshot(effectiveSelected.kind, effectiveSelected.item);

      // Keep the created row — notify_friend_post_for now takes the post id
      // and derives the preview from the stored body, so the notification
      // text can't be caller-supplied (mig 288).
      const createdPost = await hubPosts.create({
        author_email:           user.email,
        author_name:            handle(user),
        author_avatar_url:      user.avatar_url || null,
        post_type:              postTypeMap[effectiveSelected.kind] || 'status',
        body:                   finalBody,
        image_url:              imageUrl,
        privacy,
        like_count:             0,
        dislike_count:          0,
        comment_count:          0,
        linked_entity_type:     effectiveSelected.kind === 'status' ? null : effectiveSelected.kind,
        linked_entity_id:       effectiveSelected.kind === 'status' ? null : (effectiveSelected.item?.id || null),
        linked_entity_snapshot: snapshot,
        collaborator_ids:       collaboratorIds.length > 0 ? collaboratorIds : [],
        ...(privacy === 'crew' && selectedCrewId ? { crew_id: selectedCrewId } : {}),
        ...(cwType ? { content_warning: cwType, content_warning_label: cwType === 'other' ? (cwLabel.trim() || null) : null } : {}),
        ...(scheduleEnabled && scheduledAt ? { publish_at: new Date(scheduledAt).toISOString() } : {}),
      });

      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      toast.success(t('hub.composer.posted'));

      // Quest progress — non-blocking
      quests.recordAction(user, ACTION_TYPES.HUB_POST, 1)
        .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(() => {});

      // Notify followers — non-blocking, capped at 100 followers per post to
      // avoid hammering the DB on viral posts. Look up each follower's user_id
      // for the recipient_id field on the notification row.
      (async () => {
        try {
          const followerEmails = await hubFollows.listFollowers(user.email);
          if (!followerEmails || followerEmails.length === 0) return;
          const allUsers = await users.list().catch(() => []);
          const lcMap = new Map(allUsers.map(u => [u.email?.toLowerCase(), u]));
          const posterName = user.username ? `@${user.username}` : 'A friend';
          const preview = (finalBody || '').slice(0, 100);
          const capped = followerEmails.slice(0, 100);
          // No post id means nothing to attribute the notification to —
          // skip rather than fall back to sending caller-supplied text.
          if (!createdPost?.id) return;
          // Per-recipient i18n via notify_friend_post_for (migration 041).
          // The RPC reads each recipient's preferred_language server-side
          // so the title renders in their language, not the poster's.
          // Falls back to the legacy client-rendered notifyFriendPost
          // helper if the RPC is unavailable (pre-migration hosts).
          await Promise.all(capped.map(async (email) => {
            const recipient = lcMap.get(email?.toLowerCase());
            if (!recipient?.id) return null;
            const { error } = await supabase.rpc('notify_friend_post_for', {
              p_user_id: recipient.id,
              p_post_id: createdPost.id,
            });
            // PGRST202 = PostgREST can't find a function with these argument
            // names, i.e. a host still on the pre-288 three-text-param
            // signature. Frontend deploys before the SQL is pasted, so this
            // window is expected — take the legacy path rather than dropping
            // the notification.
            if (error && (error.code === '42883' || error.code === '42P01' || error.code === 'PGRST202')) {
              return notifications.notifyFriendPost({
                recipient: { id: recipient.id, email: recipient.email },
                posterName,
                postPreview: preview,
                t,
              });
            }
            if (error) console.warn('[HubComposer] notify_friend_post_for failed:', error);
            return null;
          }));
        } catch (err) {
          console.warn('[HubComposer] follower notify failed:', err);
        }
      })();

      draft.clear();
      onClose();
    } catch (err) {
      reportError(err, { feature: 'hub.composer.post', level: 'warning' });
      toast.error(t('hub.composer.postError'));
      // Orphan cleanup: if we uploaded an image but the post insert
      // (or any subsequent step in this try block) threw, the blob is
      // now in Storage with no DB row referencing it. Best-effort
      // remove; failures here are non-fatal and shouldn't mask the
      // original post error.
      if (uploadedPath) {
        supabase.storage.from(uploadedBucket).remove([uploadedPath])
          .catch(cleanupErr => console.warn('[HubComposer] orphan-upload cleanup failed:', cleanupErr));
      }
    } finally {
      setPosting(false);
    }
  };

  // Public entry point — synchronous ref guard against double-tap on
  // the Post button. The disabled-on-`posting` gate alone races a
  // fast double-tap because the state setter is asynchronous, so the
  // second tap could enter _handlePostInner and create a duplicate
  // post (with two image uploads).
  const handlePost = async () => {
    if (postingRef.current) return;
    postingRef.current = true;
    try {
      await _handlePostInner();
    } finally {
      postingRef.current = false;
    }
  };

  // ── Rendering: pick step ──
  const totalActivity =
    recentWorkouts.length + recentCardio.length + recentMeals.length +
    completedGoals.length + unlockedAchievements.length + myRegimens.length +
    progressPhotos.length;

  const renderPicker = () => (
    <div className="flex-1 overflow-y-auto px-4 pb-4">
      <div className="space-y-3">
        {/* Status — always open, pinned at top */}
        <Section title={t('hub.share.section.status')} alwaysOpen>
          <PickCard
            kind="status"
            onClick={() => handlePick('status')}
            title={t('hub.share.status')}
            subtitle={t('hub.share.statusDesc')}
            highlight
          />
          {/* Feature 24: Poll */}
          <PickCard
            kind="poll"
            onClick={() => handlePick('poll')}
            title={tFallback("hubComposer.createAPoll", "Create a Poll")}
            subtitle="Ask your followers to vote on something"
          />
          {/* "Share a Video" used to be a third card here. It is now an
              attachment inside Status, because posting a clip with a caption
              IS a status — splitting them made the user choose a post TYPE
              before they knew what they wanted to say, and left two nearly
              identical compose screens to maintain. */}
        </Section>

        {totalActivity === 0 && (
          <EmptyState
            title={t('hub.composer.noActivity')}
            desc={t('hub.composer.noActivityDesc')}
          />
        )}

        {/* Everything below is a post ABOUT something you logged, as opposed
            to something you're writing now. Without this line the picker was
            one flat run of sections and the two kinds of posting read as the
            same list. */}
        {totalActivity > 0 && (
          <p className="pt-2 text-micro font-semibold uppercase tracking-widest text-muted-foreground">
            {tFallback('hub.share.section.activity', 'Share your activity')}
          </p>
        )}

        {recentWorkouts.length > 0 && (
          <Section title={t('hub.share.workout')} count={recentWorkouts.length}>
            {recentWorkouts.map(w => (
              <PickCard key={w.id} kind="workout" onClick={() => handlePick('workout', w)}
                title={w.regimen_name || 'Freestyle workout'}
                subtitle={summarize.workout(w)} />
            ))}
          </Section>
        )}

        {recentCardio.length > 0 && (
          <Section title={t('hub.share.cardio')} count={recentCardio.length}>
            {recentCardio.map(c => (
              <PickCard
                key={c.id}
                kind="cardio"
                onClick={() => handlePick('cardio', c)}
                title={cardioTypeLabel(c.type, tFallback)}
                subtitle={summarize.cardio(c, cardioTypeLabel(c.type, tFallback))}
              />
            ))}
          </Section>
        )}

        <Section title={t('hub.share.meal')} count={recentMeals.length || undefined}>
          <PickCard kind="meal" onClick={() => handlePick('meal', null)}
            title={tFallback("hubComposer.shareAMeal", "Share a meal")}
            subtitle="Enter macros + optional photo"
            highlight />
          {recentMeals.map(m => (
            <PickCard key={m.id} kind="meal" onClick={() => handlePick('meal', m)}
              title={m.food_name}
              subtitle={summarize.meal(m)} />
          ))}
        </Section>

        {completedGoals.length > 0 && (
          <Section title={t('hub.share.goal')} count={completedGoals.length}>
            {completedGoals.map(g => (
              <PickCard key={g.id} kind="goal" onClick={() => handlePick('goal', g)}
                title={g.exercise_name || 'Goal'}
                subtitle={summarize.goal(g)} />
            ))}
          </Section>
        )}

        {unlockedAchievements.length > 0 && (
          <Section title={t('hub.share.achievement')} count={unlockedAchievements.length}>
            {unlockedAchievements.map(a => (
              <PickCard key={a.id} kind="achievement" onClick={() => handlePick('achievement', a)}
                title={a.name || a.achievement_id || 'Achievement'}
                subtitle={a.unlocked_date ? format(parseISO(a.unlocked_date), 'MMM d, yyyy') : ''} />
            ))}
          </Section>
        )}

        {myRegimens.length > 0 && (
          <Section title={t('hub.share.regimen')} count={myRegimens.length}>
            {myRegimens.map(r => (
              <PickCard key={r.id} kind="regimen" onClick={() => handlePick('regimen', r)}
                title={r.name}
                subtitle={summarize.regimen(r)} />
            ))}
          </Section>
        )}

        {progressPhotos.length > 0 && (
          <Section title={t('hub.share.section.progressPhotos')} count={progressPhotos.length}>
            <div className="grid grid-cols-3 gap-2">
              {progressPhotos.map(p => (
                <button key={p.id}
                  onClick={() => handlePick('progressPhoto', p)}
                  className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-colors">
                  <img loading="lazy" src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title={t('hub.share.section.stats')}>
          <PickCard kind="stats" onClick={() => handlePick('stats', statsSnapshot)}
            title={t('hub.share.stats')}
            subtitle={summarize.stats(statsSnapshot, fmt)} />
        </Section>
      </div>
    </div>
  );

  // ── Rendering: custom meal compose step ──
  const renderMealCompose = () => (
    <div className="flex-1 flex flex-col px-4 pt-4 pb-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Apple className="w-3.5 h-3.5 text-success" />
        {tFallback("hubComposer.shareAMeal2", "Share a meal with your community")}
      </div>

      {/* Meal name */}
      <label className="text-xs font-semibold text-muted-foreground mb-1 block">Meal name *</label>
      <input
        value={customMeal.food_name}
        onChange={e => setCustomMeal(p => ({ ...p, food_name: e.target.value }))}
        placeholder="e.g. Grilled Chicken & Rice Bowl"
        maxLength={80}
        className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/40 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary/40"
      />

      {/* Macros row */}
      <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Macros (optional)</label>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { key: 'calories',  label: 'Calories', unit: 'cal', color: 'text-primary' },
          { key: 'protein_g', label: 'Protein',  unit: 'g',    color: 'text-destructive' },
          { key: 'carbs_g',   label: 'Carbs',    unit: 'g',    color: 'text-info' },
          { key: 'fat_g',     label: 'Fat',      unit: 'g',    color: 'text-primary' },
        ].map(f => (
          <div key={f.key} className="flex flex-col">
            <span className={`text-micro font-medium mb-1 ${f.color}`}>{tFallback(`nutrient.${f.key.replace(/_(g|mg)$/, '')}`, f.label)}</span>
            <input
              type="number" inputMode="decimal"
              min="0"
              placeholder="0"
              value={customMeal[f.key]}
              onChange={e => setCustomMeal(p => ({ ...p, [f.key]: e.target.value }))}
              className="w-full px-2 py-1.5 rounded-lg border border-border bg-secondary/40 text-sm text-center font-heading font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <span className="text-micro text-muted-foreground text-center mt-0.5">{f.unit}</span>
          </div>
        ))}
      </div>

      {/* Photo */}
      {mealImagePreview ? (
        <div className="relative rounded-xl overflow-hidden border border-border mb-3">
          <img loading="lazy" src={mealImagePreview} alt={tFallback("hub.share.meal", "Meal")} className="w-full max-h-48 object-cover" />
          <button onClick={clearMealImage} className="absolute top-2 end-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 active:bg-black/80">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => mealImageInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-border text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground active:text-foreground transition-colors mb-3">
          <Camera className="w-4 h-4" /> Add a photo of your meal (optional)
        </button>
      )}
      <input ref={mealImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleMealImagePick} />

      {/* Caption */}
      <textarea
        value={body}
        onChange={e => bodyGuard.handleChange(e.target.value)}
        placeholder={tFallback("hubComposer.addACaptionOptional", "Add a caption… (optional)")}
        maxLength={500}
        rows={2}
        className="w-full p-3 bg-secondary/40 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 mb-3"
      />
      {renderPrivacyButtons()}
    </div>
  );

  // ── Rendering: status compose step ──
  const renderStatusCompose = () => (
    <div className="flex-1 flex flex-col px-4 pt-4 pb-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <MessageSquare className="w-3.5 h-3.5" />
        {t('hub.share.statusDesc')}
      </div>
      <textarea
        value={body}
        onChange={(e) => bodyGuard.handleChange(e.target.value)}
        placeholder={t('hub.composer.statusPlaceholder')}
        maxLength={500}
        rows={6}
        autoFocus
        className="w-full p-3 bg-secondary/40 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="text-end mt-1 mb-3">
        <CharCountIndicator value={body} max={500} />
      </div>

      {/* Feature 25: image attachment for status posts */}
      <div className="mb-3">
        {statusImagePreview ? (
          <div className="relative rounded-xl overflow-hidden border border-border">
            <img loading="lazy" src={statusImagePreview} alt="" className="w-full max-h-48 object-cover" />
            <button
              onClick={clearStatusImage}
              className="absolute top-2 end-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 active:bg-black/80 transition-colors"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        ) : videoPreview ? (
          <div className="relative rounded-xl overflow-hidden border border-border">
            <video src={videoPreview} className="w-full max-h-48 object-cover" muted playsInline controls />
            <button
              onClick={clearVideo}
              className="absolute top-2 end-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 active:bg-black/80 transition-colors"
              aria-label={tFallback('hub.composer.removeVideo', 'Remove video')}
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        ) : (
          // Photo OR video, one at a time — a post carries one or the other,
          // so offering both as a single choice avoids a state where the user
          // has attached two things and has to be told only one will be used.
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => statusImageInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-border text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground active:text-foreground transition-colors"
            >
              <ImageIcon className="w-4 h-4" /> {tFallback('hub.composer.addPhoto', 'Add a photo')}
            </button>
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-border text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground active:text-foreground transition-colors"
            >
              <Film className="w-4 h-4" /> {tFallback('hub.composer.addVideo', 'Add a video')}
            </button>
          </div>
        )}
        <input
          ref={statusImageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleStatusImagePick}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleVideoPick}
        />
      </div>

      {renderPrivacyButtons()}
    </div>
  );

  // ── Rendering: poll compose step (Feature 24) ──
  const renderPollCompose = () => (
    <div className="flex-1 flex flex-col px-4 pt-4 pb-4 gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <BarChart3 className="w-3.5 h-3.5" />
        <span>Create a poll — your followers can vote</span>
      </div>
      <input
        value={pollQuestion}
        onChange={(e) => setPollQuestion(e.target.value)}
        placeholder="Ask a question…"
        maxLength={200}
        autoFocus
        className="w-full p-3 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="space-y-2">
        {pollOptions.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={opt}
              onChange={(e) => {
                const next = [...pollOptions];
                next[i] = e.target.value;
                setPollOptions(next);
              }}
              placeholder={`Option ${i + 1}`}
              maxLength={100}
              className="flex-1 p-2.5 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {pollOptions.length > 2 && (
              <button
                onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive active:text-destructive hover:bg-destructive/10 active:bg-destructive/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        {pollOptions.length < 4 && (
          <button
            onClick={() => setPollOptions([...pollOptions, ''])}
            className="w-full py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground active:text-foreground transition-colors"
          >
            + Add option
          </button>
        )}
      </div>
      {renderPrivacyButtons()}
    </div>
  );

  // ── Rendering: activity-tied compose step ──
  const renderCompose = () => (
    <div className="flex-1 flex flex-col px-4 pt-4 pb-4">
      <div className="mb-3 p-3 rounded-xl bg-secondary/50 border border-border">
        <div className="flex items-start gap-3">
          {selected.kind === 'progressPhoto' && selected.item?.dataUrl ? (
            <img loading="lazy" src={selected.item.dataUrl} alt=""
              className="w-12 h-12 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              {(() => {
                const Icon = ICONS[selected.kind] || BarChart3;
                return <Icon className="w-5 h-5 text-primary" />;
              })()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-micro uppercase tracking-wider text-muted-foreground font-bold">
              {t(`hub.share.${selected.kind}`)}
            </p>
            <p className="text-sm font-medium leading-tight mt-0.5 line-clamp-2">
              {selected.summary}
            </p>
          </div>
        </div>
      </div>
      <textarea
        value={body}
        onChange={(e) => bodyGuard.handleChange(e.target.value)}
        placeholder={t('hub.composer.captionPlaceholder')}
        maxLength={500}
        rows={3}
        className="w-full p-3 bg-secondary/40 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="text-end mt-1 mb-3">
        <CharCountIndicator value={body} max={500} />
      </div>

      {/* Optional photo for meal posts */}
      {selected.kind === 'meal' && (
        <div className="mb-3">
          {mealImagePreview ? (
            <div className="relative rounded-xl overflow-hidden border border-border">
              <img loading="lazy" src={mealImagePreview} alt={tFallback("hub.share.meal", "Meal")} className="w-full max-h-48 object-cover" />
              <button
                onClick={clearMealImage}
                className="absolute top-2 end-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 active:bg-black/80 transition-colors"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => mealImageInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-border text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground active:text-foreground transition-colors"
            >
              <Camera className="w-4 h-4" /> Add a photo of your meal (optional)
            </button>
          )}
          <input
            ref={mealImageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleMealImagePick}
          />
        </div>
      )}

      {renderPrivacyButtons()}
    </div>
  );

  // ── Rendering: collaborator tagging UI (shared by video + activity compose) ──
  const renderCollaboratorInput = () => (
    <div className="mb-3">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
        Co-authors (optional)
      </label>
      {/* Chips of added collaborators */}
      {collaboratorIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {collaboratorIds.map(id => {
            const u = allUsers.find(u => u.id === id);
            const label = handle(u);
            return (
              <span key={id} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                <Users className="w-3 h-3" />
                {label}
                <button
                  type="button"
                  onClick={() => setCollaboratorIds(prev => prev.filter(x => x !== id))}
                  className="ms-0.5 hover:text-destructive active:text-destructive"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-secondary/40">
          <AtSign className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            value={collaboratorInput}
            onChange={e => setCollaboratorInput(e.target.value)}
            placeholder={tFallback("hubComposer.tagACoAuthorBy", "Tag a co-author by username…")}
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
        </div>
        {collaboratorSuggestions.length > 0 && (
          <div className="absolute top-full start-0 end-0 z-20 mt-1 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
            {collaboratorSuggestions.map(u => (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setCollaboratorIds(prev => [...prev, u.id]);
                  setCollaboratorInput('');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-start hover:bg-secondary active:bg-secondary transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary">
                  {displayName(u)[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{handle(u)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ── Rendering: video compose step ──
  const renderVideoCompose = () => (
    <div className="flex-1 flex flex-col px-4 pt-4 pb-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Film className="w-3.5 h-3.5 text-destructive" />
        {tFallback("hubComposer.shareAShortWorkoutClip", "Share a short workout clip")}
      </div>

      {/* Video picker / preview */}
      {videoPreview ? (
        <div className="relative rounded-xl overflow-hidden border border-border mb-3 bg-black">
          <video
            src={videoPreview}
            controls
            muted
            playsInline
            className="w-full max-h-56 object-contain"
          />
          <button onClick={clearVideo} className="absolute top-2 end-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 active:bg-black/80">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-border text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground active:text-foreground transition-colors mb-3"
        >
          <Film className="w-8 h-8 opacity-40" />
          <span>{tFallback("hubComposer.tapToSelectAVideo", "Tap to select a video")}</span>
          <span className="text-micro opacity-60">MP4 / MOV · max 50 MB</span>
        </button>
      )}
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleVideoPick}
      />

      {/* Caption */}
      <textarea
        value={body}
        onChange={e => bodyGuard.handleChange(e.target.value)}
        placeholder={tFallback("hubComposer.addACaptionOptional", "Add a caption… (optional)")}
        maxLength={500}
        rows={2}
        className="w-full p-3 bg-secondary/40 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 mb-3"
      />

      {renderCollaboratorInput()}
      {renderPrivacyButtons()}
    </div>
  );

  const renderPrivacyButtons = () => (
    <>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
        {t('hub.composer.privacyLabel')}
      </label>
      <div className="flex gap-2 mb-1">
        <button onClick={() => { setPrivacy('public'); setSelectedCrewId(null); }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
            privacy === 'public'
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-border text-muted-foreground hover:bg-secondary active:bg-secondary'
          }`}>
          <Globe2 className="w-4 h-4" /> {t('hub.privacy.public')}
        </button>
        <button onClick={() => { setPrivacy('followers'); setSelectedCrewId(null); }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
            privacy === 'followers'
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-border text-muted-foreground hover:bg-secondary active:bg-secondary'
          }`}>
          <Lock className="w-4 h-4" /> {t('hub.privacy.followers')}
        </button>
        {myCrews.length > 0 && (
          <button onClick={() => { setPrivacy('crew'); setSelectedCrewId(myCrews[0]?.id); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
              privacy === 'crew'
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border text-muted-foreground hover:bg-secondary active:bg-secondary'
            }`}>
            🛡️ Crew
          </button>
        )}
      </div>
      {privacy === 'crew' && myCrews.length > 0 && (
        <div className="mt-1">
          <select
            value={selectedCrewId || ''}
            onChange={e => setSelectedCrewId(e.target.value)}
            className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
          >
            {myCrews.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="text-micro text-muted-foreground mt-1">Only crew members will see this post.</p>
        </div>
      )}

      {/* Content warning picker. Optional — hidden by default behind
          a single small button. Users who need it find it; users who
          don't aren't distracted by a third row of pills. */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setCwPickerOpen(o => !o)}
          className={`text-micro font-semibold uppercase tracking-wide flex items-center gap-1.5 py-1 transition-colors ${
            cwType ? 'text-primary' : 'text-muted-foreground hover:text-foreground active:text-foreground'
          }`}
        >
          {cwType ? '⚠️' : '＋'} {cwType
            ? `Content warning: ${cwType === 'other' ? (cwLabel || 'Custom') : cwType.replace('_', ' ')}`
            : 'Add content warning'}
        </button>
        {cwPickerOpen && (
          <div className="mt-2 p-3 rounded-lg border border-border bg-secondary/40 space-y-2">
            {[
              { id: 'graphic_injury', label: 'Graphic injury' },
              { id: 'sensitive',      label: 'Sensitive content' },
              { id: 'spoiler',        label: 'Spoiler' },
              { id: 'other',          label: 'Other (specify)' },
              { id: null,             label: 'No warning' },
            ].map(opt => (
              <label key={opt.id ?? 'none'} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="cw"
                  checked={cwType === opt.id}
                  onChange={() => setCwType(opt.id)}
                  className="accent-primary"
                />
                {opt.label}
              </label>
            ))}
            {cwType === 'other' && (
              <input
                type="text"
                value={cwLabel}
                onChange={e => setCwLabel(e.target.value.slice(0, 60))}
                placeholder={tFallback("hubComposer.briefDescriptionMax60Chars", "Brief description (max 60 chars)")}
                className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary/50"
                maxLength={60}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Post scheduling ── */}
      <div className="mt-3 border-t border-border/40 pt-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <span>🕐</span> {tFallback("hubComposer.schedulePost", "Schedule post")}
          </label>
          <button
            type="button"
            onClick={() => setScheduleEnabled(v => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors ${scheduleEnabled ? 'bg-primary' : 'bg-muted'}`}
          >
            <span className={`absolute top-0.5 start-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${scheduleEnabled ? 'translate-x-4' : ''}`} />
          </button>
        </div>
        {scheduleEnabled && (
          <div className="mt-2">
            <input
              type="datetime-local"
              value={scheduledAt}
              min={new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16)}
              onChange={e => setScheduledAt(e.target.value)}
              className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
            />
            {scheduledAt && (
              <p className="text-micro text-primary mt-1">
                Will publish: {new Date(scheduledAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );

  const onPickStep = step === 'pick';
  const isStatusStep = step === 'status_compose';
  const isMealComposeStep = step === 'meal_compose';
  const isPollStep = step === 'poll_compose';
  const isVideoStep = step === 'video_compose';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col bg-card border border-border max-h-[90vh] px-6"
        >
          <div className="flex items-center gap-2 px-4 pt-4 pb-3 shrink-0 border-b border-border">
            {!onPickStep && (
              <button
                onClick={() => {
                  setStep('pick');
                  setSelected(null);
                  setBody('');
                  setCustomMeal({ food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' });
                  clearMealImage();
                  clearStatusImage();
                  clearVideo();
                  setCollaboratorInput('');
                  setCollaboratorIds([]);
                }}
                className="p-1.5 rounded-md hover:bg-secondary active:bg-secondary"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="flex-1">
              <h2 className="font-heading font-bold text-lg leading-tight">
                {onPickStep
                  ? t('hub.composer.pickActivity')
                  : isStatusStep
                  ? t('hub.composer.statusTitle')
                  : isMealComposeStep
                  ? 'Share a Meal'
                  : isVideoStep
                  ? 'Share a Video'
                  : isPollStep
                  ? 'Create a Poll'
                  : t('hub.composer.title')}
              </h2>
              {onPickStep && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('hub.composer.pickActivityDesc')}
                </p>
              )}
            </div>
            {/* Drafts. Auto-save already worked and already kept only the
                most recent draft — but it restored SILENTLY on mount, so the
                only evidence it existed was a toast you may have missed, and
                once you started something else the saved text was
                unreachable. This makes it a thing you can go and get. */}
            {savedDraft && (
              <button
                type="button"
                onClick={restoreSavedDraft}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-border text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground active:bg-secondary transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                {tFallback('hub.composer.drafts', 'Drafts')}
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-secondary active:bg-secondary shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          {onPickStep
            ? renderPicker()
            : isStatusStep
            ? renderStatusCompose()
            : isMealComposeStep
            ? renderMealCompose()
            : isPollStep
            ? renderPollCompose()
            : isVideoStep
            ? renderVideoCompose()
            : renderCompose()}

          {!onPickStep && (
            <div className="border-t border-border px-4 py-3 flex items-center justify-end gap-2 shrink-0">
              <Button onClick={handlePost} disabled={posting} className="gap-2">
                {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {posting ? t('hub.composer.posting') : t('hub.composer.post')}
              </Button>
            </div>
          )}

          <ProfanityWarningDialog open={bodyGuard.open} onContinue={bodyGuard.onContinue} />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Section({ title, count, defaultOpen = false, alwaysOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen || alwaysOpen);

  // alwaysOpen sections are non-interactive — render flat with no toggle.
  if (alwaysOpen) {
    return (
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-4 mb-2 px-2">
          {title}
        </h3>
        <div className="space-y-1.5">{children}</div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/40 active:bg-secondary/40 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
          {typeof count === 'number' && count > 0 && (
            <span className="text-micro font-bold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18 }}
          className="text-muted-foreground shrink-0"
        >
          <ChevronDown className="w-4 h-4" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 pt-2 pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PickCard({ kind, title, subtitle, onClick, highlight = false }) {
  const Icon = ICONS[kind] || BarChart3;
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-start ${
        highlight
          ? 'bg-primary/5 border-primary/30 hover:bg-primary/10 active:bg-primary/10 hover:border-primary'
          : 'bg-card border-border hover:bg-secondary/40 active:bg-secondary/40 hover:border-primary/40'
      }`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
        highlight ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
      }`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight truncate">{title}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground leading-tight mt-0.5 truncate">
            {subtitle}
          </p>
        )}
      </div>
    </motion.button>
  );
}

function EmptyState({ title, desc }) {
  return (
    <div className="text-center py-8 px-2">
      <div className="text-primary/70 inline-flex mb-2">
        <NoWorkoutsIllustration />
      </div>
      <p className="font-heading font-bold text-base">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}