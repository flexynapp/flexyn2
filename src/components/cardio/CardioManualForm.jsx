import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { format, subDays } from 'date-fns';
import { toast } from '@/lib/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Save, Calculator, Heart, Zap, Waves, BookmarkPlus, RotateCcw } from 'lucide-react';
import { reportError } from '@/lib/reportError';
import { useLanguage } from '@/lib/LanguageContext';
import { cardioTypeLabel } from '@/lib/cardioTypeLabel';
import { useAuth } from '@/lib/AuthContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { toMeters, metersTo, formatPace, speedKmhFrom, paceSecPerKmFrom } from '@/lib/distanceUnit';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import * as leagues from '@/lib/data/leagues';
import * as workoutStreak from '@/lib/data/workoutStreak';
import { calculateCardioXp } from '@/lib/xpSystem';
import { estimateCalories, userWeightKg } from '@/lib/cardioCalories';
import { checkCardioSpeed, getMaxRealisticCalories, checkDailyHours } from '@/lib/cardioLimits';
import * as cardioData from '@/lib/data/cardio';
import { detectNewPRs, PR_LABELS } from '@/lib/cardioPRs';
import { useProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import { bestVO2max } from '@/lib/cardioVO2max';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import TransText from '@/components/TransText';
import { track, EVENTS } from '@/lib/analytics';

function deriveType(mode, env) {
  return `${mode}_${env}`;
}

const STROKE_OPTIONS = ['Freestyle', 'Backstroke', 'Breaststroke', 'Butterfly', 'Mixed'];

export default function CardioManualForm({
  mode,
  env,
  initial,
  onCancel,
  onSaved,
  userProfile = {},
  templateDefaults = null,
}) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const { data: todayWorkoutLogs = [] } = useQuery({
    queryKey: ['workoutLogs.today', user?.email, todayStr],
    queryFn: () => db.entities.WorkoutLog.filter(
      { user_id: user.id, date: todayStr }, '-date', 50
    ).catch(() => []),
    enabled: !!user?.email,
    staleTime: 60_000,
  });
  const { data: todayCardioLogs = [] } = useQuery({
    queryKey: ['cardioLogs.today', user?.email, todayStr],
    queryFn: () => db.entities.CardioLog.filter(
      { user_id: user.id, date: todayStr }, '-date', 50
    ).catch(() => []),
    enabled: !!user?.email,
    staleTime: 60_000,
  });
  const { distanceUnit } = useDistanceUnit();
  const queryClient = useQueryClient();

  // Derive initial values from editing log OR template defaults
  const src = initial || templateDefaults || {};

  const [date, setDate] = useState(initial?.date || format(new Date(), 'yyyy-MM-dd'));
  const [hours, setHours] = useState(src.duration_seconds != null ? Math.floor(src.duration_seconds / 3600) : '');
  const [minutes, setMinutes] = useState(src.duration_seconds != null ? Math.floor((src.duration_seconds % 3600) / 60) : '');
  const [seconds, setSeconds] = useState(src.duration_seconds != null ? src.duration_seconds % 60 : '');
  const [distance, setDistance] = useState(src.distance_meters
    ? metersTo(distanceUnit, src.distance_meters).toFixed(2) : '');
  const [incline, setIncline] = useState(src.incline_percent ?? '');
  const [elevation, setElevation] = useState(src.elevation_gain_m
    ? (distanceUnit === 'mi'
        ? (src.elevation_gain_m / 0.3048).toFixed(0)
        : src.elevation_gain_m.toFixed(0))
    : '');
  const [calories, setCalories] = useState(src.calories ?? '');
  const [notes, setNotes] = useState(src.notes || '');
  const notesGuard = useProfanityGuard(setNotes);

  // New fields
  const [avgHr, setAvgHr] = useState(src.avg_heart_rate ?? '');
  const [cadence, setCadence] = useState(src.cadence_spm ?? '');
  const [powerWatts, setPowerWatts] = useState(src.power_watts ?? '');
  const [poolLength, setPoolLength] = useState(src.pool_length_m ?? '');
  const [laps, setLaps] = useState(src.laps ?? '');
  const [strokeType, setStrokeType] = useState(src.stroke_type || '');
  const [routeName, setRouteName] = useState(src.route_name || '');
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [saving, setSaving] = useState(false);
  const [speedWarning, setSpeedWarning] = useState(null);
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(!!speedWarning);

  const isSwim = mode === 'swimming';
  const isBiking = mode === 'biking';
  const showIncline = env === 'treadmill';
  const showElevation = env === 'outside' && !isBiking && !isSwim;
  const showSwimFields = isSwim;
  const showPower = isBiking;
  const showCadence = mode === 'running' || mode === 'walking' || isSwim;
  const showRouteName = env === 'outside' || env === 'openwater';
  const elevationSuffix = distanceUnit === 'mi' ? 'ft' : 'm';

  const durationSeconds = useMemo(
    () => (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0),
    [hours, minutes, seconds]
  );

  // For swimming: auto-compute distance from laps × pool length
  const swimDistMeters = useMemo(() => {
    if (!isSwim) return 0;
    const pLen = Number(poolLength);
    const lapCount = Number(laps);
    return pLen > 0 && lapCount > 0 ? pLen * lapCount : 0;
  }, [isSwim, poolLength, laps]);

  const distanceMeters = useMemo(() => {
    const manual = toMeters(distanceUnit, Number(distance) || 0);
    if (isSwim && manual === 0 && swimDistMeters > 0) return swimDistMeters;
    return manual;
  }, [distance, distanceUnit, isSwim, swimDistMeters]);

  const paceSecPerKm = useMemo(
    () => paceSecPerKmFrom(distanceMeters, durationSeconds),
    [distanceMeters, durationSeconds]
  );
  const speedKmh = useMemo(
    () => speedKmhFrom(distanceMeters, durationSeconds),
    [distanceMeters, durationSeconds]
  );

  const canSave = useMemo(() => {
    if (durationSeconds <= 0) return false;
    const type = deriveType(mode, env);
    if (type === 'walking_treadmill') {
      if (distanceMeters <= 0 && !(Number(calories) > 0)) return false;
    } else {
      if (distanceMeters <= 0) return false;
    }
    const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    if (date < sevenDaysAgo) return false;
    return true;
  }, [durationSeconds, distanceMeters, calories, date, mode, env]);

  const handleEstimate = () => {
    const est = estimateCalories({
      type: deriveType(mode, env),
      durationSeconds,
      distanceMeters,
      inclinePercent: Number(incline) || 0,
      weightKg: userWeightKg(user),
    });
    setCalories(est);
  };

  // Auto-fill swim distance from laps × pool length
  const handleSwimDistAutoFill = useCallback(() => {
    if (swimDistMeters > 0) {
      setDistance(metersTo(distanceUnit, swimDistMeters).toFixed(2));
    }
  }, [swimDistMeters, distanceUnit]);

  const handleSaveAsTemplate = async () => {
    if (!routeName && !notes) {
      toast.info(tFallback("cardioManualForm.enterARouteName", "Enter a route name or notes to identify this template"));
      return;
    }
    const tplName = routeName ||
      `${deriveType(mode, env).replace(/_/g, ' ')} ${distance ? distance + distanceUnit : ''}`.trim();
    if (!tplName) { toast.info(tFallback('cardioManualForm.templateNeedsName', 'Give the template a name via Route/Label field')); return; }
    setSavingTemplate(true);
    try {
      await supabase.from('cardio_templates').insert({
        created_by: user.email,
        name: tplName,
        type: deriveType(mode, env),
        distance_meters: distanceMeters || null,
        duration_seconds: durationSeconds || null,
        incline_percent: env === 'treadmill' ? (Number(incline) || null) : null,
        avg_heart_rate: Number(avgHr) || null,
        cadence_spm: Number(cadence) || null,
        power_watts: Number(powerWatts) || null,
        pool_length_m: Number(poolLength) || null,
        laps: Number(laps) || null,
        stroke_type: strokeType || null,
        notes: notes || null,
      });
      queryClient.invalidateQueries({ queryKey: ['cardioTemplates', user?.email] });
      toast.success(`Template "${tplName}" saved`);
    } catch (err) {
      reportError(err, { feature: 'cardio.template.save' });
      toast.error(tFallback("cardioManualForm.failedToSaveTemplate", "Failed to save template"));
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSave = async () => {
    if (hasAnyProfanity(notes)) {
      toast.error(tFallback('common.profanity.notes', 'Please remove inappropriate language from notes before saving.'));
      return;
    }
    setSaving(true);
    try {
      const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
      if (date < sevenDaysAgo) {
        toast.error(t('cardio.error.dateInPast'));
        setSaving(false);
        return;
      }
      const maxDate = new Date(Date.now() + 14 * 60 * 60 * 1000);
      const ceilingYmd = maxDate.toISOString().slice(0, 10);
      if (date > ceilingYmd) {
        toast.error(tFallback('cardio.error.dateInFuture', "Cardio can't be dated in the future."));
        setSaving(false);
        return;
      }

      if (date === todayStr) {
        const otherCardioLogs = initial?.id
          ? todayCardioLogs.filter(l => l.id !== initial.id)
          : todayCardioLogs;
        const hoursCheck = checkDailyHours(
          todayWorkoutLogs, otherCardioLogs,
          0,
          Number(durationSeconds) || 0,
        );
        if (hoursCheck.implausible) {
          toast.error(
            `That would put you over the daily ${hoursCheck.reason.replace('_', ' ')} cap ` +
            `(${hoursCheck.hours}h / ${hoursCheck.maxHours}h limit). Take a rest day.`
          );
          setSaving(false);
          return;
        }
      }

      const cardioType = deriveType(mode, env);
      const speedCheck = checkCardioSpeed(cardioType, distanceMeters, durationSeconds);
      if (speedCheck.implausible) {
        setSpeedWarning(speedCheck);
        setSaving(false);
        return;
      }

      const maxCal = getMaxRealisticCalories(durationSeconds, userProfile);
      if (Number(calories) > maxCal) {
        toast.error(
          `That calorie count (${Math.round(Number(calories))} cal) seems too high for a ${
            Math.round(durationSeconds / 60)
          }-minute session. Maximum realistic is ${maxCal} cal.`
        );
        setSaving(false);
        return;
      }

      const cappedDuration = Math.min(durationSeconds, 12 * 3600);
      const cappedDistance = Math.min(distanceMeters, 160934);
      // A BLANK calories field used to store a hard 0 via `Number('') || 0`.
      // That is not an absence, it is a claim that the session burned
      // nothing — and no consumer can tell the two apart.
      // `generate_weekly_review_for` sums this column into the week's
      // cardio kcal, so a blank field understated the review by the whole
      // session. Two of five production rows carry that zero, both of them
      // manual entries with real distance and duration behind them.
      //
      // This form was the only entry path with the problem: both live
      // trackers already call estimateCalories and store the result
      // without asking. Here the same estimator sat behind an optional
      // "Estimate" button, so the fix is to run it when the user left the
      // field alone rather than inventing a new number. A TYPED 0 is still
      // honoured as a typed 0 — only an untouched field estimates.
      const caloriesEntered = String(calories).trim() !== '';
      const effectiveCalories = caloriesEntered
        ? Number(calories) || 0
        : estimateCalories({
            type: cardioType,
            durationSeconds: cappedDuration,
            distanceMeters: cappedDistance,
            inclinePercent: Number(incline) || 0,
            weightKg: userWeightKg(user),
          });
      const cappedCalories = Math.min(effectiveCalories, getMaxRealisticCalories(cappedDuration, userProfile));

      // Compute VO2max estimate
      const restHr = userProfile.resting_heart_rate || null;
      const age = userProfile.age || null;
      const vo2 = bestVO2max({
        mode,
        distanceMeters: cappedDistance,
        durationSeconds: cappedDuration,
        avgHr: Number(avgHr) || null,
        restHr,
        age,
      });

      const payload = {
        date,
        type: cardioType,
        mode: 'manual',
        duration_seconds: cappedDuration,
        distance_meters: cappedDistance,
        pace_seconds_per_km: paceSecPerKmFrom(cappedDistance, cappedDuration),
        avg_speed_kmh: speedKmhFrom(cappedDistance, cappedDuration),
        calories: cappedCalories,
        incline_percent: env === 'treadmill' ? (Number(incline) || 0) : null,
        elevation_gain_m: (() => {
          // Defensive parse — non-numeric paste produced NaN that got
          // saved verbatim and broke downstream pace/elevation displays.
          if (!(showElevation && elevation)) return null;
          const n = Number(elevation);
          if (!Number.isFinite(n)) return null;
          return distanceUnit === 'mi' ? n * 0.3048 : n;
        })(),
        notes: notes || null,
        gps_track: null,
        // New fields
        avg_heart_rate: Number(avgHr) || null,
        cadence_spm: Number(cadence) || null,
        power_watts: Number(powerWatts) || null,
        pool_length_m: Number(poolLength) || null,
        laps: Number(laps) || null,
        stroke_type: strokeType || null,
        route_name: routeName || null,
        vo2max_estimate: vo2,
      };

      let prCount = 0;
      if (initial?.id) {
        await db.entities.CardioLog.update(initial.id, payload);
      } else {
        const createdLog = await db.entities.CardioLog.create(payload);
        track(EVENTS.CARDIO_LOGGED, { mode: 'manual' });
        if (Number(payload.distance_meters) > 0) {
          try {
            const { error: rpcErr } = await supabase.rpc('increment_user_distance', {
              p_delta: Number(payload.distance_meters),
            });
            if (rpcErr) {
              // RMW fallback only when the RPC is confirmed-missing
              // (pre-023 host — those also predate the 142/173 trigger,
              // so the direct write is still allowed there). Mig 173
              // rejects direct total_distance_meters writes with 42501,
              // and falling back on transient errors re-introduced the
              // lost-update race anyway (audit A-12 reasoning).
              if (rpcErr.code === '42883' || rpcErr.code === '42P01') {
                const me = await db.auth.me();
                const prev = Number(me?.total_distance_meters) || 0;
                await db.auth.updateMe({ total_distance_meters: prev + Number(payload.distance_meters) });
              } else {
                console.warn('[Cardio] increment_user_distance failed:', rpcErr);
              }
            }
          } catch (err) { console.warn('[Cardio] distance accumulate failed:', err); }
        }
        db.functions.invoke('updateUserXpAndAchievements', {
          xp_gained: 0,
          action_type: 'cardio_completed',
          action_data: {
            duration_seconds: payload.duration_seconds,
            distance_meters: payload.distance_meters,
            calories: payload.calories,
          },
        }).catch(err => reportError(err, {
          feature: 'cardio.achievements-invoke',
          level: 'warning',
          userEmail: user?.email,
        }));
        const prior = await cardioData.listForPRs(user.id);
        const priorOnly = prior.filter(l => l.id !== createdLog.id);
        const prs = detectNewPRs(createdLog, priorOnly);
        prCount = prs.length;
        for (const pr of prs) {
          const label = PR_LABELS[pr.distance];
          toast.success(t('cardio.pr.title', { label }), { duration: 6000 });
          try { navigator.vibrate?.([100, 60, 100]); } catch {}
        }
      }

      queryClient.invalidateQueries({ queryKey: ['cardioLogs', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      toast.success(t('cardio.saved'));

      // One batched call — recordActions reads the day's quests once and
      // fans out, where three recordAction calls read them three times.
      // Zero/absent amounts are dropped inside, so no filtering here.
      const durSec = Number(payload.duration_seconds) || 0;
      quests.recordActions(user, [
        { type: ACTION_TYPES.CARDIO_COMPLETED, amount: 1 },
        { type: ACTION_TYPES.CARDIO_SECONDS,   amount: durSec },
        { type: ACTION_TYPES.PR_ACHIEVED,      amount: prCount },
      ])
        .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(err => reportError(err, { feature: 'cardio.quest-progress', level: 'warning', userEmail: user?.email }));

      // Bump active Solo Challenge claims (migration 171). Cardio
      // minutes go to the cardio_minutes-kind challenge; we also
      // count this as a session for the "Train N days" challenge.
      // Fire-and-forget — non-blocking.
      (async () => {
        try {
          const { recordWorkoutProgress } = await import('@/lib/data/soloChallenges');
          await recordWorkoutProgress({
            cardioMin:    Math.round(durSec / 60),
            sessionCount: 1,
            prsHit:       prCount > 0 ? prCount : 0,
          });
        } catch (e) { /* non-blocking */ }
      })();

      const cardioXp = calculateCardioXp({
        duration_seconds: payload.duration_seconds,
        distance_meters:  payload.distance_meters,
        calories:         payload.calories,
      });
      leagues.recordWeeklyXp(user, cardioXp)
        .then(() => queryClient.invalidateQueries({ queryKey: ['myLeague', user?.id] }))
        .catch(err => reportError(err, { feature: 'cardio.league-xp', level: 'warning', userEmail: user?.email, cardioXp }));
      workoutStreak.recordWorkoutDay(user)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['workoutStreakProfile', user?.id] });
          queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        })
        .catch(err => reportError(err, { feature: 'cardio.workout-streak', level: 'warning', userEmail: user?.email }));

      onSaved();
    } catch (err) {
      reportError(err, { feature: 'cardio.manual.save', level: 'warning' });
      toast.error(t('cardio.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const blockSpecialKeys = (e) => {
    if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <Card className="p-5 space-y-5">
        {/* Title */}
        <h2 className="font-heading text-xl font-bold">
          {cardioTypeLabel(deriveType(mode, env), tFallback)}
        </h2>

        {/* Date */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.date')}</label>
          <Input
            type="date"
            value={date}
            max={format(new Date(), 'yyyy-MM-dd')}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        {/* Duration */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.duration')}</label>
          <div className="flex gap-2">
            {[
              { value: hours,   set: setHours,   label: t('cardio.field.hours'),   max: 23 },
              { value: minutes, set: setMinutes, label: t('cardio.field.minutes'), max: 59 },
              { value: seconds, set: setSeconds, label: t('cardio.field.seconds'), max: 59 },
            ].map(({ value, set, label, max }) => (
              <div key={label} className="flex-1 text-center">
                <Input
                  type="number"
                  min={0}
                  max={max}
                  inputMode="numeric"
                  value={value}
                  onChange={e => set(e.target.value === '' ? '' : Math.min(max, Math.max(0, parseInt(e.target.value) || 0)))}
                  onKeyDown={blockSpecialKeys}
                  className="text-center"
                  placeholder="0"
                />
                <span className="text-xs text-muted-foreground mt-1 block">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Swim-specific: Pool Length + Laps */}
        {showSwimFields && (
          <div className="space-y-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Waves className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-blue-500">{tFallback("cardioManualForm.swimDetails", "Swim Details")}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Pool Length */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">{tFallback("cardioManualForm.poolLength", "Pool Length")}</label>
                <div className="relative">
                  <Input
                    type="number"
                    min={10}
                    max={50}
                    inputMode="numeric"
                    value={poolLength}
                    onChange={e => {
                      // Clamp to 10-50 m on input so a fat-finger
                      // value like "5000" can't multiply by laps into
                      // a 10km "swim" that pollutes pace stats.
                      // `min`/`max` on number inputs are advisory only.
                      // (Audit 16 F6.)
                      const raw = e.target.value;
                      if (raw === '') { setPoolLength(''); return; }
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      setPoolLength(String(Math.min(50, Math.max(10, n))));
                    }}
                    onKeyDown={blockSpecialKeys}
                    className="pe-8"
                    placeholder="25"
                  />
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">m</span>
                </div>
              </div>
              {/* Laps */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">{tFallback("cardio.detail.laps", "Laps")}</label>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={laps}
                  onChange={e => setLaps(e.target.value)}
                  onKeyDown={blockSpecialKeys}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Stroke Type */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">{tFallback("cardio.detail.stroke", "Stroke")}</label>
              <div className="flex flex-wrap gap-2">
                {STROKE_OPTIONS.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStrokeType(strokeType === s ? '' : s)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      strokeType === s
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'border-border text-muted-foreground hover:border-blue-400'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto-fill distance from laps */}
            {swimDistMeters > 0 && (
              <button
                type="button"
                onClick={handleSwimDistAutoFill}
                className="flex items-center gap-2 text-xs text-blue-500 hover:text-blue-400 active:text-blue-400"
              >
                <RotateCcw className="w-3 h-3" />
                Fill distance from laps ({metersTo(distanceUnit, swimDistMeters).toFixed(2)} {distanceUnit})
              </button>
            )}
          </div>
        )}

        {/* Distance */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.distance')}</label>
          <div className="relative">
            <Input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              value={distance}
              onChange={e => setDistance(e.target.value)}
              onKeyDown={blockSpecialKeys}
              className="pe-12"
              placeholder={isSwim && swimDistMeters > 0
                ? metersTo(distanceUnit, swimDistMeters).toFixed(2)
                : '0.00'}
            />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
              {distanceUnit}
            </span>
          </div>
        </div>

        {/* Incline (treadmill only) */}
        {showIncline && (
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.incline')}</label>
            <div className="relative">
              <Input
                type="number"
                step="0.5"
                min={0}
                max={15}
                inputMode="decimal"
                value={incline}
                onChange={e => setIncline(e.target.value)}
                onKeyDown={blockSpecialKeys}
                className="pe-8"
                placeholder="0"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </div>
        )}

        {/* Elevation (outside non-biking, non-swim only) */}
        {showElevation && (
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.elevation')}</label>
            <div className="relative">
              <Input
                type="number"
                step={1}
                min={0}
                inputMode="numeric"
                value={elevation}
                onChange={e => setElevation(e.target.value)}
                onKeyDown={blockSpecialKeys}
                className="pe-10"
                placeholder="0"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {elevationSuffix}
              </span>
            </div>
          </div>
        )}

        {/* Heart Rate — shown for all activity types */}
        <div>
          <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5 block">
            <Heart className="w-3.5 h-3.5 text-rose-500" />
            <TransText k="cardioManualForm.avgHeartRate" en="Avg Heart Rate {optional}"
              values={{ optional: <span className="text-xs text-muted-foreground font-normal ms-1">{tFallback("common.optionalParen", "(optional)")}</span> }} />
          </label>
          <div className="relative">
            <Input
              type="number"
              min={40}
              max={220}
              inputMode="numeric"
              value={avgHr}
              onChange={e => setAvgHr(e.target.value)}
              onKeyDown={blockSpecialKeys}
              className="pe-12"
              placeholder="—"
            />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">bpm</span>
          </div>
        </div>

        {/* Cadence — running / walking / swimming */}
        {showCadence && (
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              {isSwim ? 'Strokes / Min' : 'Cadence'}{' '}
              <span className="text-xs text-muted-foreground font-normal ms-1">(optional)</span>
            </label>
            <div className="relative">
              <Input
                type="number"
                min={10}
                max={300}
                inputMode="numeric"
                value={cadence}
                onChange={e => setCadence(e.target.value)}
                onKeyDown={blockSpecialKeys}
                className="pe-12"
                placeholder="—"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {isSwim ? 'spm' : 'spm'}
              </span>
            </div>
          </div>
        )}

        {/* Power — cycling only */}
        {showPower && (
          <div>
            <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5 block">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <TransText k="cardioManualForm.avgPower" en="Avg Power {optional}"
              values={{ optional: <span className="text-xs text-muted-foreground font-normal ms-1">{tFallback("common.optionalParen", "(optional)")}</span> }} />
            </label>
            <div className="relative">
              <Input
                type="number"
                min={0}
                max={2000}
                inputMode="numeric"
                value={powerWatts}
                onChange={e => setPowerWatts(e.target.value)}
                onKeyDown={blockSpecialKeys}
                className="pe-10"
                placeholder="—"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">W</span>
            </div>
          </div>
        )}

        {/* Route / Label — outside and open water */}
        {showRouteName && (
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Route / Label <span className="text-xs text-muted-foreground font-normal ms-1">(optional)</span>
            </label>
            <Input
              type="text"
              value={routeName}
              onChange={e => setRouteName(e.target.value)}
              placeholder={tFallback('cardioManualForm.routePlaceholder', 'e.g. Morning Loop, Park Run…')}
              maxLength={80}
            />
          </div>
        )}

        {/* Calories */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.calories')}</label>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={calories}
                  onChange={e => setCalories(e.target.value)}
                  onKeyDown={blockSpecialKeys}
                  className="pe-14"
                  placeholder="0"
                />
                <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">cal</span>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleEstimate} className="shrink-0">
              <Calculator className="w-3.5 h-3.5 me-1" /> {t('cardio.field.estimate')}
            </Button>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('cardio.field.notes')}</label>
          <Textarea
            value={notes}
            onChange={e => notesGuard.handleChange(e.target.value)}
            placeholder={t('cardio.field.notesPlaceholder')}
            className="h-20"
          />
        </div>

        {/* Computed pace / speed */}
        {durationSeconds > 0 && distanceMeters > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t('cardio.field.avgPace')}: {formatPace(paceSecPerKm, distanceUnit)}</span>
            <span>
              {t('cardio.field.avgSpeed')}: {(distanceUnit === 'mi' ? speedKmh / 1.609344 : speedKmh).toFixed(1)}{' '}
              {distanceUnit === 'mi' ? 'mph' : 'km/h'}
            </span>
          </div>
        )}

        {/* Save */}
        <motion.div whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.01 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
          <Button
            className="w-full h-12 font-heading font-bold text-base"
            onClick={handleSave}
            disabled={!canSave || saving}
          >
            <Save className="w-5 h-5 me-2" />
            {saving ? t('cardio.saving') : t('cardio.save')}
          </Button>
        </motion.div>

        {/* Save as Template */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={handleSaveAsTemplate}
          disabled={savingTemplate || durationSeconds <= 0}
        >
          <BookmarkPlus className="w-3.5 h-3.5 me-1.5" />
          {savingTemplate ? 'Saving…' : 'Save as Template'}
        </Button>
      </Card>

      {speedWarning && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" onClick={() => setSpeedWarning(null)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center z-10">
            <div className="text-4xl mb-3">⚡</div>
            <h2 className="font-heading font-bold text-xl mb-2">{tFallback("cardioManualForm.thatSpeedIsnTRealistic", "That speed isn't realistic")}</h2>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              <TransText
                k="cardioManualForm.speedTooHigh"
                en="Your entry works out to {speed}, which exceeds the realistic maximum for this activity type ({max} km/h). Please check your distance and time."
                values={{
                  speed: <strong>{speedWarning.speedKmh} km/h</strong>,
                  max: speedWarning.maxKmh,
                }}
              />
            </p>
            <button
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold"
              onClick={() => setSpeedWarning(null)}
            >
              {tFallback("workout.goBackAndFix", "Go back and fix")}
            </button>
          </div>
        </div>
      )}
      <ProfanityWarningDialog open={notesGuard.open} onContinue={notesGuard.onContinue} />
    </motion.div>
  );
}
