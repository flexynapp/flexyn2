import React, { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { toast } from '@/lib/toast';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel
} from '@/components/ui/alert-dialog';
import { Play, Pause, Square, Save, X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { cardioTypeLabel } from '@/lib/cardioTypeLabel';
import { useAuth } from '@/lib/AuthContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import {
  formatDistance, formatPace, toMeters,
  speedKmhFrom, paceSecPerKmFrom,
} from '@/lib/distanceUnit';
import { estimateCalories, userWeightKg } from '@/lib/cardioCalories';
import { getMaxRealisticCalories } from '@/lib/cardioLimits';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { snapshot, readSnapshot, clearSnapshot } from '@/lib/cardioSession';
import * as cardioData from '@/lib/data/cardio';
import { bestVO2max } from '@/lib/cardioVO2max';
import { detectNewPRs, PR_LABELS } from '@/lib/cardioPRs';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import * as leagues from '@/lib/data/leagues';
import * as workoutStreak from '@/lib/data/workoutStreak';
import { calculateCardioXp } from '@/lib/xpSystem';
import { reportError } from '@/lib/reportError';
import { track, EVENTS } from '@/lib/analytics';

export default function CardioLiveTrackerIndoor({ mode, env, onCancel, onSaved, userProfile = {} }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('idle');
  const [, forceTick] = useState(0);
  const [distanceInputUnits, setDistanceInputUnits] = useState('');
  const [incline, setIncline] = useState(env === 'treadmill' ? 0 : null);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const startedAtRef = useRef(null);
  const pauseStartedAtRef = useRef(null);
  const pausedTotalMsRef = useRef(0);
  const tickIdRef = useRef(null);
  const wakeLockRef = useRef(null);
  const hiddenAtRef = useRef(null);
  const frozenElapsedMsRef = useRef(null); // set by finish() — never recalculates after stop

  // ── Restore snapshot on mount ──
  useEffect(() => {
    const snap = readSnapshot(user?.id);
    if (!snap || snap.kind !== 'indoor' || snap.mode !== mode || snap.env !== env) return;
    startedAtRef.current = snap.startedAt;
    pausedTotalMsRef.current = snap.pausedTotalMs || 0;
    if (snap.pauseStartedAt) pauseStartedAtRef.current = snap.pauseStartedAt;
    if (snap.distanceInputUnits != null) setDistanceInputUnits(snap.distanceInputUnits);
    if (snap.incline != null) setIncline(snap.incline);
    setStatus('paused');
    toast.success(t('cardio.recover.recovered'));
    forceTick(n => n + 1);
   
  }, []);

  // ── Exclude background time from elapsed ──
  useEffect(() => {
    const handleVisibility = () => {
      if (!startedAtRef.current || !tickIdRef.current) return;
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
      } else if (hiddenAtRef.current !== null) {
        pausedTotalMsRef.current += Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        forceTick(n => n + 1);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // ── Auto-snapshot every 10s while active ──
  useEffect(() => {
    if (status !== 'tracking' && status !== 'paused') return;
    const id = setInterval(() => {
      snapshot(user?.id, {
        kind: 'indoor',
        mode,
        env,
        startedAt: startedAtRef.current,
        pausedTotalMs: pausedTotalMsRef.current,
        pauseStartedAt: status === 'paused' ? pauseStartedAtRef.current : null,
        distanceInputUnits,
        incline,
        status,
        savedAt: Date.now(),
      });
    }, 10000);
    return () => clearInterval(id);
  }, [status, mode, env, distanceInputUnits, incline]);

  // ── Derived ──
  const distanceMeters = distanceInputUnits
    ? toMeters(distanceUnit, Number(distanceInputUnits) || 0)
    : 0;

  const elapsedMs = frozenElapsedMsRef.current !== null
    ? frozenElapsedMsRef.current
    : (startedAtRef.current
        ? (status === 'paused'
            ? (pauseStartedAtRef.current - startedAtRef.current - pausedTotalMsRef.current)
            : (Date.now() - startedAtRef.current - pausedTotalMsRef.current))
        : 0);
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const pace = paceSecPerKmFrom(distanceMeters, elapsedSeconds);
  const speedKmh = speedKmhFrom(distanceMeters, elapsedSeconds);
  const calories = estimateCalories({
    type: `${mode}_${env}`,
    durationSeconds: elapsedSeconds,
    distanceMeters,
    inclinePercent: incline ?? 0,
    weightKg: userWeightKg(user),
  });

  // ── Start ──
  const start = () => {
    frozenElapsedMsRef.current = null;
    setStatus('tracking');
    startedAtRef.current = Date.now();
    pausedTotalMsRef.current = 0;
    tickIdRef.current = setInterval(() => forceTick(n => n + 1), 500);
  };

  // ── Pause ──
  const pause = () => {
    if (status !== 'tracking') return;
    pauseStartedAtRef.current = Date.now();
    setStatus('paused');
    if (tickIdRef.current) { clearInterval(tickIdRef.current); tickIdRef.current = null; }
  };

  // ── Resume ──
  const resume = () => {
    if (status !== 'paused') return;
    pausedTotalMsRef.current += Date.now() - pauseStartedAtRef.current;
    pauseStartedAtRef.current = null;
    setStatus('tracking');
    tickIdRef.current = setInterval(() => forceTick(n => n + 1), 500);
  };

  // ── Finish ──
  const finish = () => {
    if (tickIdRef.current) { clearInterval(tickIdRef.current); tickIdRef.current = null; }
    // Freeze elapsed at this exact instant — any future render uses this value,
    // never Date.now(), so coming back from background can't add ghost time.
    frozenElapsedMsRef.current = startedAtRef.current
      ? Math.max(0, Date.now() - startedAtRef.current - pausedTotalMsRef.current)
      : 0;
    setStatus('finished');
  };

  // ── Discard ──
  const discardAndClose = () => {
    if (tickIdRef.current) clearInterval(tickIdRef.current);
    clearSnapshot(user?.id);
    onCancel();
  };

  // Ref-based guard against double-tap on Save. See CardioOutside for the
  // full rationale — same race condition applies here.
  const savingGuardRef = useRef(false);

  // ── Save ──
  const save = async () => {
    if (savingGuardRef.current) return;
    savingGuardRef.current = true;

    // Block 0-distance / sub-30s saves. Indoor sessions with no movement
    // are not a thing — refusing here prevents accidental empty-credit saves.
    if (elapsedSeconds < 30) {
      savingGuardRef.current = false;
      toast.error(tFallback('cardioIndoor.tooShort', 'Session too short to save (under 30 seconds).'));
      return;
    }
    // Refuse 0-distance saves so a user who forgets to enter the
    // treadmill distance doesn't accidentally credit XP / streak /
    // quest progress for a stationary session. The outside save
    // already enforces this — bringing indoor in line. (Audit 16 F5.)
    if (!distanceMeters || distanceMeters <= 0) {
      savingGuardRef.current = false;
      toast.error(tFallback('cardioIndoor.needDistance', 'Enter the distance from your treadmill display before saving.'));
      return;
    }

    setSaving(true);
    try {
      const finalCalories = estimateCalories({
        type: `${mode}_${env}`,
        durationSeconds: elapsedSeconds,
        distanceMeters,
        inclinePercent: incline ?? 0,
        weightKg: userWeightKg(user),
      });
      const cappedCalories = Math.min(
        finalCalories,
        getMaxRealisticCalories(elapsedSeconds, userProfile)
      );
      // VO2max, on the LIVE path too. Only the manual form computed this,
      // so the flagship GPS session — the one with the most trustworthy
      // distance and duration in the app — stored nothing, while a
      // hand-typed entry got a figure. Verified against production: the one
      // live-tracked row had vo2max_estimate NULL and both populated values
      // came from manual entries.
      //
      // No avgHr is passed: the live trackers do not read heart rate, so
      // this resolves to the speed-based ACSM estimate for a run and null
      // for anything else — which is the honest answer rather than a
      // profile constant dressed up as a session measurement.
      const vo2 = bestVO2max({
        mode,
        distanceMeters,
        durationSeconds: elapsedSeconds,
        avgHr: null,
        restHr: userProfile?.resting_heart_rate || null,
        age: userProfile?.age || null,
      });
      const payload = {
        date: format(new Date(startedAtRef.current), 'yyyy-MM-dd'),
        type: `${mode}_${env}`,
        vo2max_estimate: vo2,
        mode: 'live',
        duration_seconds: elapsedSeconds,
        distance_meters: distanceMeters,
        pace_seconds_per_km: paceSecPerKmFrom(distanceMeters, elapsedSeconds),
        avg_speed_kmh: speedKmhFrom(distanceMeters, elapsedSeconds),
        calories: cappedCalories,
        incline_percent: env === 'treadmill' ? (incline ?? 0) : null,
        elevation_gain_m: null,
        notes: null,
        gps_track: [],
      };
      const createdLog = await cardioData.create(payload);
      track(EVENTS.CARDIO_LOGGED, { mode: 'indoor' });
      clearSnapshot(user?.id);
      // Atomic accumulation via increment_user_distance RPC (migration 023).
      // See CardioManualForm for context on the race this fixes.
      if (Number(payload.distance_meters) > 0) {
        try {
          const { error: rpcErr } = await supabase.rpc('increment_user_distance', {
            p_delta: Number(payload.distance_meters),
          });
          if (rpcErr) {
            // RMW fallback only when the RPC is confirmed-missing
            // (pre-023 host — those also predate the 142/173 trigger, so
            // the direct write is still allowed there). Mig 173 rejects
            // direct total_distance_meters writes with 42501 (audit A-12
            // reasoning: transient-error fallback re-opened the race).
            if (rpcErr.code === '42883' || rpcErr.code === '42P01') {
              const me = await db.auth.me();
              const prev = Number(me?.total_distance_meters) || 0;
              await db.auth.updateMe({ total_distance_meters: prev + Number(payload.distance_meters) });
            } else {
              console.warn('[CardioIndoor] increment_user_distance failed:', rpcErr);
            }
          }
        } catch (err) { console.warn('[CardioIndoor] distance accumulate failed:', err); }
      }
      // Fire achievement check (non-blocking). Report on failure so
      // a broken cardio→achievements pipeline doesn't rot silently.
      db.functions.invoke('updateUserXpAndAchievements', {
        xp_gained: 0,
        action_type: 'cardio_completed',
        action_data: {
          duration_seconds: payload.duration_seconds,
          distance_meters: payload.distance_meters,
          calories: payload.calories,
        },
      }).catch(err => reportError(err, {
        feature: 'cardio.live-indoor.achievements-invoke',
        level: 'warning',
        userEmail: user?.email,
      }));
      // Check for PRs
      const prior = await cardioData.listForPRs(user.id);
      const priorOnly = prior.filter(l => l.id !== createdLog.id);
      const prs = detectNewPRs(createdLog, priorOnly);
      for (const pr of prs) {
        const label = PR_LABELS[pr.distance];
        toast.success(t('cardio.pr.title', { label }), {
          duration: 6000,
        });
        try { navigator.vibrate?.([100, 60, 100]); } catch {}
      }
      queryClient.invalidateQueries({ queryKey: ['cardioLogs', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      toast.success(t('cardio.saved'));

      // Quest progress — non-blocking. Failures used to silently
      // .catch(() => {}); now reportError so quest breakage is visible.
      const durSec = Number(payload.duration_seconds) || 0;
      const _user = user;
      // One batched call — recordActions reads the day's quests once and
      // fans out, where three recordAction calls read them three times.
      quests.recordActions(_user, [
        { type: ACTION_TYPES.CARDIO_COMPLETED, amount: 1 },
        { type: ACTION_TYPES.CARDIO_SECONDS,   amount: durSec },
        { type: ACTION_TYPES.PR_ACHIEVED,      amount: prs.length },
      ])
        .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(err => reportError(err, {
          feature: 'cardio.live-indoor.quest-progress',
          level: 'warning',
          userEmail: _user?.email,
        }));

      // League weekly XP + workout streak — non-blocking
      const cardioXp = calculateCardioXp({
        duration_seconds: payload.duration_seconds,
        distance_meters:  payload.distance_meters,
        calories:         payload.calories,
      });
      leagues.recordWeeklyXp(_user, cardioXp)
        .then(() => queryClient.invalidateQueries({ queryKey: ['myLeague', _user?.id] }))
        .catch(err => reportError(err, {
          feature: 'cardio.live-indoor.league-xp',
          level: 'warning',
          userEmail: _user?.email,
          cardioXp,
        }));
      workoutStreak.recordWorkoutDay(_user)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['workoutStreakProfile', _user?.id] });
          queryClient.invalidateQueries({ queryKey: ['userProfile', _user?.email] });
        })
        .catch(err => reportError(err, {
          feature: 'cardio.live-indoor.workout-streak',
          level: 'warning',
          userEmail: _user?.email,
        }));

      onSaved();
    } catch (err) {
      console.error('[CardioIndoor] save failed:', err);
      toast.error(t('cardio.saveFailed'));
    } finally {
      setSaving(false);
      savingGuardRef.current = false;
    }
  };

  // ── Wake lock ──
  useEffect(() => {
    if (status !== 'tracking') return;
    let lock = null;
    (async () => {
      try {
        if ('wakeLock' in navigator) {
          lock = await navigator.wakeLock.request('screen');
          wakeLockRef.current = lock;
        }
      } catch {}
    })();
    return () => {
      try { lock?.release(); } catch {}
      wakeLockRef.current = null;
    };
  }, [status]);

  // ── Cleanup on unmount ──
  // Belt-and-braces wake-lock release (the status-dependent effect above
  // only releases on status change, not on bare unmount) plus tick cleanup.
  useEffect(() => () => {
    try { wakeLockRef.current?.release?.(); } catch {}
    wakeLockRef.current = null;
    if (tickIdRef.current) clearInterval(tickIdRef.current);
  }, []);

  // ── Timer string ──
  const hh = Math.floor(elapsedSeconds / 3600);
  const mm = Math.floor((elapsedSeconds % 3600) / 60);
  const ss = elapsedSeconds % 60;
  const timerStr = hh > 0
    ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  const speedDisplay = distanceUnit === 'mi'
    ? `${(speedKmh / 1.609344).toFixed(1)} mph`
    : `${speedKmh.toFixed(1)} km/h`;

  const activityLabel = cardioTypeLabel(`${mode}_${env}`, tFallback);

  // ════════════════ RENDER ════════════════

  // IDLE
  if (status === 'idle') {
    return (
      <Card className="p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <Play className="w-10 h-10 text-primary ms-1" />
        </div>
        <h2 className="font-heading text-2xl font-bold mb-2">{activityLabel}</h2>
        <p className="text-sm text-muted-foreground mb-8">
          {env === 'treadmill' ? t('cardio.env.treadmill') : t('cardio.env.stationary')}
        </p>
        <Button className="w-full h-14 font-heading font-bold text-base" onClick={start}>
          <Play className="w-5 h-5 me-2" />
          {t('cardio.live.start')}
        </Button>
      </Card>
    );
  }

  // FINISHED
  if (status === 'finished') {
    return (
      <Card className="p-6">
        <h2 className="font-heading text-2xl font-bold text-center mb-6">{t('cardio.live.summaryTitle')}</h2>
        <div className="text-center mb-6">
          <p className="font-heading text-5xl font-bold tracking-tight">{timerStr}</p>
          <p className="font-heading text-3xl font-semibold mt-2 text-primary">
            {formatDistance(distanceMeters, distanceUnit, 2)}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-8">
          <StatCard label={t('cardio.field.avgPace')} value={formatPace(pace, distanceUnit)} />
          <StatCard label={t('cardio.field.avgSpeed')} value={speedDisplay} />
          <StatCard label={t('cardio.field.calories')} value={`${Math.round(calories)} cal`} />
        </div>
        {env === 'treadmill' && incline != null && (
          <p className="text-center text-sm text-muted-foreground mb-6">
            {t('cardio.field.incline')}: {incline}%
          </p>
        )}
        <div className="flex gap-3">
          <Button className="flex-1 h-12 font-heading font-bold" onClick={save} disabled={saving}>
            <Save className="w-5 h-5 me-2" />
            {saving ? t('cardio.saving') : t('cardio.save')}
          </Button>
          <Button variant="outline" className="flex-1 h-12" onClick={onCancel} disabled={saving}>
            <X className="w-4 h-4 me-2" />
            {t('cardio.live.discard')}
          </Button>
        </div>
      </Card>
    );
  }

  // TRACKING / PAUSED
  return (
    <>
      <Card className="p-5 relative">
        {/* Discard button */}
        <button
          className="absolute top-3 end-3 p-1.5 rounded-md text-muted-foreground hover:text-destructive active:text-destructive hover:bg-destructive/10 active:bg-destructive/10 transition-colors"
          onClick={() => setConfirmDiscardOpen(true)}
        >
          <X className="w-4 h-4" />
        </button>

        {/* Timer */}
        <div className="text-center mb-4 pt-2">
          <p className="font-heading text-5xl font-bold tracking-tight">{timerStr}</p>
        </div>

        {/* Distance input */}
        <div className="mb-4">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {t('cardio.live.tapDistance')}
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={distanceInputUnits}
              onChange={e => setDistanceInputUnits(e.target.value)}
              placeholder="0.00"
              className="text-lg font-heading font-semibold text-center"
            />
            <span className="text-sm font-medium text-muted-foreground w-8 shrink-0">{distanceUnit}</span>
          </div>
        </div>

        {/* Incline slider — treadmill only */}
        {env === 'treadmill' && (
          <div className="mb-4">
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
              <span>{t('cardio.field.incline')}</span>
              <span className="font-bold text-foreground">{incline}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="15"
              step="0.5"
              value={incline ?? 0}
              onChange={e => setIncline(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          <StatCard label={t('cardio.field.avgPace')} value={formatPace(pace, distanceUnit)} />
          <StatCard label={t('cardio.field.avgSpeed')} value={speedDisplay} />
          <StatCard label={t('cardio.field.calories')} value={`${Math.round(calories)}`} small />
        </div>

        {/* Controls */}
        <div className="flex gap-3">
          {status === 'tracking' ? (
            <Button variant="outline" className="flex-1 h-12 font-heading font-bold" onClick={pause}>
              <Pause className="w-5 h-5 me-2" />
              {t('cardio.live.pause')}
            </Button>
          ) : (
            <Button className="flex-1 h-12 font-heading font-bold" onClick={resume}>
              <Play className="w-5 h-5 me-2" />
              {t('cardio.live.resume')}
            </Button>
          )}
          <Button variant="destructive" className="flex-1 h-12 font-heading font-bold" onClick={finish}>
            <Square className="w-5 h-5 me-2" />
            {t('cardio.live.finish')}
          </Button>
        </div>
      </Card>

      {/* Discard confirm */}
      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cardio.live.confirmDiscard')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cardio.live.confirmDiscardDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/90"
              onClick={discardAndClose}
            >
              {t('cardio.live.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StatCard({ label, value, small }) {
  return (
    <div className="bg-muted rounded-lg p-3 text-center">
      <p className={`font-heading font-bold ${small ? 'text-lg' : 'text-xl'} leading-tight`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{label}</p>
    </div>
  );
}