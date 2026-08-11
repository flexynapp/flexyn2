// src/components/hub/PostActivityBlock.jsx
//
// Renders the structured activity data attached to a Hub post.
//
// Primary data source: post.linked_entity_snapshot — a JSON snapshot
// written by HubComposer at post-creation time. This is the canonical
// path because it works for ALL viewers regardless of base44 RLS on
// the source entity.
//
// Fallback path: if the post has linked_entity_id but no snapshot
// (either because it predates the snapshot feature, or because the
// snapshot field was missing from the schema at write time), we
// attempt a render-time fetch of the source entity. This will succeed
// when the viewer is the author (RLS allows them to read their own
// activity), and silently fail otherwise — in which case we render a
// minimal type pill so the post still has visual context.

import { useState, lazy, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dumbbell, Activity, Apple, Target, Trophy, ListChecks,
  BarChart3, Clock, Flame, Footprints, TrendingUp, Zap,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { cardioTypeLabel } from '@/lib/cardioTypeLabel';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatDistance, formatDuration, formatPace } from '@/lib/distanceUnit';
import { fromLbs } from '@/lib/weightUnit';
import { useNumberFormatter, useDateFormatter } from '@/lib/intl';
import { db } from '@/api/db';
import ErrorBoundary from '@/components/ErrorBoundary';
import { workoutDurationMin } from '@/lib/workoutDuration';
// Lazy-load — maplibre-gl is ~200 KB gzipped and most hub posts
// don't render a map. Shared chunk with CardioDetailModal.
const RouteMap = lazy(() => import('@/components/cardio/RouteMap'));

const TYPE_META = {
  workout:        { Icon: Dumbbell,   labelKey: 'hub.share.workout',     entity: 'Workout',      accent: 'border-primary/60 bg-primary/5',   iconBg: 'bg-primary/15',   iconColor: 'text-primary' },
  cardio:         { Icon: Activity,   labelKey: 'hub.share.cardio',      entity: 'CardioLog',    accent: 'border-success/60 bg-success/5',     iconBg: 'bg-success/15',    iconColor: 'text-success' },
  meal:           { Icon: Apple,      labelKey: 'hub.share.meal',        entity: 'NutritionLog', accent: 'border-primary/60 bg-primary/5',   iconBg: 'bg-primary/15',   iconColor: 'text-primary' },
  goal_completed: { Icon: Target,     labelKey: 'hub.share.goal',        entity: 'Goal',         accent: 'border-primary/60 bg-primary/5',         iconBg: 'bg-primary/15',      iconColor: 'text-primary' },
  achievement:    { Icon: Trophy,     labelKey: 'hub.share.achievement', entity: 'Achievement',  accent: 'border-primary/60 bg-primary/5',     iconBg: 'bg-primary/15',    iconColor: 'text-primary' },
  regimen:        { Icon: ListChecks, labelKey: 'hub.share.regimen',     entity: 'Regimen',      accent: 'border-info/60 bg-info/5',   iconBg: 'bg-info/15',   iconColor: 'text-info' },
  stats:          { Icon: BarChart3,  labelKey: 'hub.share.stats',       entity: null,           accent: 'border-info/60 bg-info/5',       iconBg: 'bg-info/15',     iconColor: 'text-info' },
};

// Same decimation logic as the composer — used when we have to build a
// snapshot from a fallback fetch. Keeps the map fast.
function decimateGpsTrack(track, target = 250) {
  if (!Array.isArray(track) || track.length <= target) return track || [];
  const step = track.length / target;
  const out = [];
  for (let i = 0; i < target - 1; i++) {
    const idx = Math.floor(i * step);
    const p = track[idx];
    out.push({ lat: p.lat, lng: p.lng, timestamp_ms: p.timestamp_ms });
  }
  const last = track[track.length - 1];
  out.push({ lat: last.lat, lng: last.lng, timestamp_ms: last.timestamp_ms });
  return out;
}

// Map a fetched entity back into the snapshot shape so the renderers
// below have a single uniform input.
function entityToSnapshot(kind, item) {
  if (!item) return null;
  switch (kind) {
    case 'workout':
      return {
        regimen_name: item.regimen_name || null,
        date: item.date || null,
        duration_minutes: workoutDurationMin(item) || null,
        exercises: (item.exercises || []).map(e => ({
          exercise_name: e.exercise_name || e.name || null,
          sets: (e.sets || []).map(s => ({ weight: s.weight || 0, reps: s.reps || 0 })),
        })),
      };
    case 'cardio':
      return {
        type: item.type || 'cardio',
        date: item.date || null,
        duration_seconds: item.duration_seconds || null,
        distance_meters: item.distance_meters || null,
        pace_seconds_per_km: item.pace_seconds_per_km || null,
        avg_speed_kmh: item.avg_speed_kmh || null,
        calories: item.calories || null,
        elevation_gain_m: item.elevation_gain_m || null,
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
      };
    case 'goal_completed':
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
        name: item.name || null,
        description: item.description || null,
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
    default:
      return null;
  }
}

export default function PostActivityBlock({ post }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const type = post.linked_entity_type || post.post_type;

  // Normalize type early so hooks can be called in the right order
  const normalizedType = type && type !== 'goal' ? type : (type === 'goal' ? 'goal_completed' : null);
  const meta = normalizedType ? TYPE_META[normalizedType] : null;

  // Determine if we need a fallback fetch (before any early returns, so hooks are always called)
  const needsFallback = !post.linked_entity_snapshot && !!post.linked_entity_id && !!(meta?.entity);
  const isAuthor = post.author_email === user?.email;

  const { data: fetchedSnapshot } = useQuery({
    queryKey: ['postActivityFallback', post.id, post.linked_entity_id, normalizedType],
    queryFn: async () => {
      try {
        const list = await db.entities[meta.entity]
          .filter({ id: post.linked_entity_id })
          .catch(() => []);
        const item = Array.isArray(list) ? list[0] : null;
        return entityToSnapshot(normalizedType, item);
      } catch {
        return null;
      }
    },
    enabled: Boolean(needsFallback && isAuthor),
    staleTime: 60_000,
  });

  // Status posts and progress photos have no activity block.
  if (!type || type === 'status' || type === 'progress_photo') return null;
  if (!meta) return null;

  const snap = post.linked_entity_snapshot || fetchedSnapshot;

  // Still no data — render a small type pill as a last resort so the
  // post has at least a hint of what it's about.
  if (!snap) {
    return (
      <div className={`mx-3 mb-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium text-muted-foreground ${meta.accent || 'border-border bg-secondary'}`}>
        <meta.Icon className={`w-3.5 h-3.5 ${meta.iconColor || 'text-muted-foreground'}`} />
        {t(meta.labelKey)}
      </div>
    );
  }

  return (
    <div className={`mx-3 mb-3 rounded-xl border overflow-hidden ${meta.accent || 'border-border bg-secondary/30'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-current/10 bg-black/5 dark:bg-white/5">
        <div className={`w-6 h-6 rounded-md flex items-center justify-center ${meta.iconBg || 'bg-primary/15'}`}>
          <meta.Icon className={`w-3.5 h-3.5 ${meta.iconColor || 'text-primary'}`} />
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {t(meta.labelKey)}
        </span>
      </div>

      <div className="p-3">
        {normalizedType === 'cardio'         && <CardioBlock      snap={snap} />}
        {normalizedType === 'workout'        && <WorkoutBlock     snap={snap} />}
        {normalizedType === 'meal'           && <MealBlock        snap={snap} />}
        {normalizedType === 'goal_completed' && <GoalBlock        snap={snap} />}
        {normalizedType === 'achievement'    && <AchievementBlock snap={snap} />}
        {normalizedType === 'regimen'        && <RegimenBlock     snap={snap} post={post} />}
        {normalizedType === 'stats'          && <StatsBlock       snap={snap} />}
      </div>
    </div>
  );
}

// ─── Cardio: route map + stat grid ───
function CardioBlock({ snap }) {
  const { t, tFallback } = useLanguage();
  const { distanceUnit } = useDistanceUnit();
  const hasRoute = Array.isArray(snap.gps_track) && snap.gps_track.length >= 2;

  return (
    <>
      {hasRoute && (
        <div className="mb-3 -mx-3 -mt-3">
          {/* ErrorBoundary is load-bearing — without it, any throw
              inside RouteMap (WebGL init failure, malformed track,
              maplibre internal exception, lazy-chunk fetch failure)
              would propagate up and blank out the entire post card.
              The fallback shows a neutral box at the same height so
              the post still renders the stat grid below. */}
          <ErrorBoundary
            label="RouteMap"
            fallback={
              <div
                style={{ height: 220 }}
                className="bg-secondary/30 border border-border flex items-center justify-center text-xs text-muted-foreground"
              >
                Map unavailable
              </div>
            }
          >
            <Suspense fallback={<div style={{ height: 220 }} className="bg-secondary/50 animate-pulse" />}>
              <RouteMap track={snap.gps_track} height={220} interactive={false} />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
      <h4 className="font-heading font-bold text-base mb-2">
        {cardioTypeLabel(snap.type, tFallback)}
      </h4>
      <div className="grid grid-cols-2 gap-2">
        <Stat icon={Footprints}  label={t('cardio.field.distance')}
              value={snap.distance_meters ? formatDistance(snap.distance_meters, distanceUnit, 2) : '—'} />
        <Stat icon={Clock}       label={t('cardio.field.duration')}
              value={snap.duration_seconds ? formatDuration(snap.duration_seconds) : '—'} />
        <Stat icon={TrendingUp}  label={t('cardio.field.avgPace')}
              value={snap.pace_seconds_per_km ? formatPace(snap.pace_seconds_per_km, distanceUnit) : '—'} />
        <Stat icon={Flame}       label={t('cardio.field.calories')}
              value={snap.calories ? `${snap.calories} cal` : '—'} />
      </div>
    </>
  );
}

// ─── Workout: regimen, count tiles, exercise list ───
function WorkoutBlock({ snap }) {
  const { t } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const fmt = useNumberFormatter();
  const exCount = (snap.exercises || []).length;
  const setCount = (snap.exercises || []).reduce((s, e) => s + (e.sets?.length || 0), 0);
  const volumeLbs = (snap.exercises || []).reduce((sum, e) =>
    sum + (e.sets || []).reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0), 0
  );

  return (
    <>
      <h4 className="font-heading font-bold text-base mb-2">
        {snap.regimen_name || t('hub.share.freestyle')}
      </h4>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat icon={ListChecks} label={t('hub.activity.exercises')} value={exCount} />
        <Stat icon={Zap}        label={t('hub.activity.sets')}      value={setCount} />
        <Stat icon={Dumbbell}   label={t('hub.activity.volume')}
              value={`${fmt(Math.round(fromLbs(volumeLbs, weightUnit)))} ${weightUnit}`} />
      </div>
      {exCount > 0 && (
        <ul className="space-y-1">
          {snap.exercises.slice(0, 5).map((e, i) => (
            <li key={i} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{e.exercise_name || '—'}</span>
              {e.sets?.length > 0 && <span> · {e.sets.length} sets</span>}
            </li>
          ))}
          {exCount > 5 && (
            <li className="text-xs text-muted-foreground italic">+{exCount - 5} more</li>
          )}
        </ul>
      )}
    </>
  );
}

// ─── Meal: food name + macros ───
function MealBlock({ snap }) {
  const { t } = useLanguage();
  return (
    <>
      <h4 className="font-heading font-bold text-base mb-1">{snap.food_name || '—'}</h4>
      {snap.meal_type && (
        <p className="text-xs text-muted-foreground capitalize mb-2">{snap.meal_type}</p>
      )}
      {/* LEFT OFF THE COLOUR BUDGET DELIBERATELY. These four tints are the
          app's macro vocabulary — the same orange/red/blue/yellow the
          Dashboard's MacroRingWidget uses for cal/protein/carbs/fat. A
          user reads them across both surfaces, so re-tokenising one and
          not the other would split one vocabulary in half. If the macro
          palette gets revisited it has to be done as a single pass over
          both files, which is a bigger call than a page colour cleanup. */}
      <div className="grid grid-cols-4 gap-2">
        <Stat label={t('nutrition.macros.calories')} value={snap.calories ? `${Math.round(snap.calories)}` : '—'} bgColor="bg-orange-50 dark:bg-orange-950/20" textColor="text-primary" />
        <Stat label={t('nutrition.macros.protein')}  value={snap.protein_g ? `${Math.round(snap.protein_g)}g` : '—'} bgColor="bg-red-50 dark:bg-red-950/20" textColor="text-destructive" />
        <Stat label={t('nutrition.macros.carbs')}    value={snap.carbs_g ? `${Math.round(snap.carbs_g)}g` : '—'} bgColor="bg-blue-50 dark:bg-blue-950/20" textColor="text-info" />
        <Stat label={t('nutrition.macros.fat')}      value={snap.fat_g ? `${Math.round(snap.fat_g)}g` : '—'} bgColor="bg-yellow-50 dark:bg-yellow-950/20" textColor="text-primary" />
      </div>
    </>
  );
}

// ─── Goal completion ───
function GoalBlock({ snap }) {
  const { t } = useLanguage();
  const goalDisplay = [];
  if (snap.achieved_reps != null || snap.target_reps != null) {
    const achievedReps = snap.achieved_reps ?? snap.target_reps;
    goalDisplay.push(`${achievedReps ?? '—'}/${snap.target_reps ?? '—'} reps`);
  }
  if (snap.achieved_weight != null || snap.target_weight != null) {
    const achievedWeight = snap.achieved_weight ?? snap.target_weight;
    goalDisplay.push(`${achievedWeight ?? '—'} lbs`);
  }
  
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
        <Target className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-heading font-bold text-base">
          {snap.exercise_name || t('hub.share.goal')}
        </h4>
        {goalDisplay.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {goalDisplay.join(' @ ')}
          </p>
        )}
        {snap.completed_date && (
          <p className="text-xs text-muted-foreground mt-1">
            {t('hub.activity.completed')} {format(parseISO(snap.completed_date), 'MMM d, yyyy')}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Achievement unlock ───
function AchievementBlock({ snap }) {
  const { t } = useLanguage();
  // date-fns `format()` binds no locale, so this line read "Aug 11, 2026"
  // under a fully-translated screen — the exact defect CLAUDE.md's i18n
  // section calls out. `useDateFormatter` is Intl-backed and already
  // language-bound.
  const fmtDate = useDateFormatter();
  return (
    <div className="flex items-start gap-3">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary via-primary to-destructive flex items-center justify-center shrink-0 shadow-md shadow-primary/30">
        <Trophy className="w-6 h-6 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-heading font-bold text-base">{snap.name || t('hub.share.achievement')}</h4>
        {snap.description && (
          <p className="text-sm text-muted-foreground mt-0.5">{snap.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          {snap.xp_reward != null && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary dark:text-primary">
              +{snap.xp_reward} XP
            </span>
          )}
          {snap.unlocked_date && (
            <span className="text-xs text-muted-foreground">
              {fmtDate(snap.unlocked_date, { dateStyle: 'medium' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Regimen: name + first 5 exercises ───
function RegimenBlock({ snap, post }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [copying, setCopying] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const exCount = (snap.exercises || []).length;

  // Query the user's regimens so the "Copied" state survives card unmounts.
  const { data: myRegimens = [] } = useQuery({
    queryKey: ['regimens', user?.email],
    queryFn: () => db.entities.Regimen.list(),
    enabled: !!user?.email,
    staleTime: 30_000,
  });

  const alreadyCopied = post?.id
    ? myRegimens.some(r => r.copied_from_post_id === post.id)
    : false;
  const showCopied = justCopied || alreadyCopied;

  const handleCopyRegimen = async () => {
    if (!user?.email || showCopied || copying) return;
    setCopying(true);
    try {
      // The post snapshot stores exercises with `exercise_name`, but the
      // canonical Regimen entity uses `name`. Map the fields so the list view
      // (which renders `{ex.name}`) doesn't show empty badges.
      const copiedExercises = (snap.exercises || []).map(e => ({
        name: e.exercise_name || e.name || '',
        target_sets: e.target_sets ?? null,
        target_reps: e.target_reps ?? null,
        muscle_groups: [],
        muscle_group: '',
        notes: '',
      }));

      await db.entities.Regimen.create({
        name: snap.name,
        description: snap.description || '',
        exercises: copiedExercises,
        copied_from_post_id: post?.id || null,
        original_author_username: post?.author_name || null,
        original_author_email: post?.author_email || null,
      });
      setJustCopied(true);
      queryClient.invalidateQueries({ queryKey: ['regimens', user?.email] });
      toast.success(t('hub.activity.copyRegimenSuccess').replace('{name}', snap.name || t('hub.share.regimen')));
    } catch (err) {
      toast.error(t('hub.activity.copyRegimenError'));
    } finally {
      setCopying(false);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h4 className="font-heading font-bold text-base mb-2">{snap.name || '—'}</h4>
          <p className="text-xs text-muted-foreground mb-2">
            {exCount} {exCount === 1 ? t('hub.activity.exercise') : t('hub.activity.exercises')}
          </p>
        </div>
        <button
          onClick={handleCopyRegimen}
          disabled={copying || showCopied}
          className="shrink-0 px-3 py-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 active:bg-primary/20 disabled:opacity-50 transition-colors"
        >
          {copying ? tFallback('hub.activity.savingRegimen', 'Saving…') : showCopied ? tFallback('hub.activity.savedRegimen', 'Saved') : tFallback('hub.activity.saveRegimen', 'Save')}
        </button>
      </div>
      {exCount > 0 && (
        <ul className="space-y-1">
          {snap.exercises.slice(0, 5).map((e, i) => (
            <li key={i} className="text-xs">
              <span className="font-medium">{e.exercise_name || '—'}</span>
              {(e.target_sets || e.target_reps) && (
                <span className="text-muted-foreground">
                  {' · '}{e.target_sets || '?'} × {e.target_reps || '?'}
                </span>
              )}
            </li>
          ))}
          {exCount > 5 && (
            <li className="text-xs text-muted-foreground italic">+{exCount - 5} more</li>
          )}
        </ul>
      )}
    </>
  );
}

// ─── Stats snapshot ───
function StatsBlock({ snap }) {
  const { t } = useLanguage();
  const { distanceUnit } = useDistanceUnit();
  const { weightUnit } = useWeightUnit();
  const fmt = useNumberFormatter();
  return (
    <div className="grid grid-cols-2 gap-2">
      {snap.level != null && (
        <Stat icon={Zap} label={t('leaderboards.level')} value={`Lv ${snap.level}`} />
      )}
      {snap.total_xp != null && (
        <Stat icon={TrendingUp} label="XP" value={fmt(Math.round(snap.total_xp))} />
      )}
      {snap.total_volume_lbs != null && (
        <Stat icon={Dumbbell} label={t('leaderboards.volume')}
              value={`${fmt(Math.round(fromLbs(snap.total_volume_lbs, weightUnit)))} ${weightUnit}`} />
      )}
      {snap.total_distance_meters != null && (
        <Stat icon={Footprints} label={t('leaderboards.distance')}
              value={formatDistance(snap.total_distance_meters, distanceUnit, 1)} />
      )}
    </div>
  );
}

// ─── Reusable stat tile ───
function Stat({ icon: Icon, label, value, bgColor, textColor }) {
  return (
    <div className={`${bgColor || 'bg-card'} rounded-lg p-2 border ${bgColor ? 'border-current/20' : 'border-border/50'}`}>
      <div className="flex items-center gap-1 mb-0.5">
        {Icon && <Icon className="w-3 h-3 text-muted-foreground" />}
        <span className="text-micro text-muted-foreground uppercase tracking-wider truncate">{label}</span>
      </div>
      <p className={`font-heading font-bold text-sm leading-tight ${textColor || ''}`}>{value}</p>
    </div>
  );
}