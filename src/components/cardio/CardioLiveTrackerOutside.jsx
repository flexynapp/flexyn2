import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel
} from '@/components/ui/alert-dialog';
import { Play, Pause, Square, AlertTriangle, Save, X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { useSettings } from '@/lib/SettingsContext';
import {
  formatDistance, formatPace,
  speedKmhFrom, paceSecPerKmFrom,
} from '@/lib/distanceUnit';
import { estimateCalories, userWeightKg } from '@/lib/cardioCalories';
import { getMaxRealisticCalories } from '@/lib/cardioLimits';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { detectNewPRs, PR_LABELS } from '@/lib/cardioPRs';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import * as leagues from '@/lib/data/leagues';
import * as workoutStreak from '@/lib/data/workoutStreak';
import { calculateCardioXp } from '@/lib/xpSystem';
import {
  speak, stopSpeaking, buildMilestoneText, buildStartText,
  buildPauseText, buildResumeText, buildFinishText, spokenDuration,
} from '@/lib/cardioVoiceCoach';
import { snapshot, readSnapshot, clearSnapshot } from '@/lib/cardioSession';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineMeters(a, b) {
  const R = 6371000;
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(Δφ / 2) ** 2
          + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const ACCURACY_THRESHOLD_M = 30;
const MIN_MOVE_METERS = 5;
const STABILIZE_MS = 5000;
const STILL_SPEED_THRESHOLD_MPS = 0.5;
const STILL_DURATION_MS = 5000;

// Per-mode maximum plausible instantaneous speed (m/s). Used to reject GPS
// outliers — urban canyon / tunnel exit / signal bounce can show as a
// teleport even when accuracy reports look fine. A 200m jump in 2s implies
// 100 m/s (~360 km/h), which is obviously bogus for running. Caps are
// world-record + safety margin, NOT typical performance, so we don't
// accidentally clip a fast sprinter.
//   running:  Bolt sprint peak 12.4 m/s → cap 15
//   walking:  fast walk 2.5 m/s → cap 5
//   cycling:  Tour-de-France descents reach ~30 m/s → cap 35
//   hiking:   trail jog max ~5 m/s → cap 8
//   default:  cycling cap (generous fallback for unknown modes)
const MAX_MODE_SPEED_MPS = {
  running: 15,
  walking: 5,
  cycling: 35,
  hiking:  8,
};

function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤';
  if (code <= 3) return '☁️';
  if (code <= 48) return '🌫';
  if (code <= 67) return '🌧';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧';
  if (code <= 86) return '🌨';
  if (code >= 95) return '⛈';
  return '🌡';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CardioLiveTrackerOutside({ mode, onCancel, onSaved, userProfile = {} }) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const { cardioVoiceCues, cardioAutoPause } = useSettings();
  const queryClient = useQueryClient();

  const voiceEnabled = cardioVoiceCues !== false;
  const autoPauseEnabled = cardioAutoPause !== false;

  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [, forceTick] = useState(0);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [weather, setWeather] = useState(null);

  const startedAtRef = useRef(null);
  const pauseStartedAtRef = useRef(null);
  const pausedTotalMsRef = useRef(0);
  const trackRef = useRef([]);
  const distanceMetersRef = useRef(0);
  const lastAcceptedRef = useRef(null);
  const watchIdRef = useRef(null);
  const tickIdRef = useRef(null);
  const wakeLockRef = useRef(null);
  const lastFixAccuracyRef = useRef(null);
  const lastMilestoneRef = useRef(0);
  const stillSinceRef = useRef(null);
  const wasAutoPausedRef = useRef(false);
  // True for 30s after a transient GPS error so we don't spam the toast on
  // every retry. See onGpsError for the soft-vs-hard error distinction.
  const transientGpsToastRef = useRef(false);

  // ── Restore snapshot on mount ──
  useEffect(() => {
    const snap = readSnapshot();
    if (!snap || snap.kind !== 'outside' || snap.mode !== mode) return;
    startedAtRef.current = snap.startedAt;
    pausedTotalMsRef.current = snap.pausedTotalMs || 0;
    // Recovery always lands in a paused state. The snapshot may or may not
    // include a pauseStartedAt value — if it doesn't (e.g. the app was
    // killed while tracking), we MUST initialize one anyway, otherwise
    // resume() does `Date.now() - null` → NaN and the timer corrupts
    // for the rest of the session. Default to savedAt-or-now so the
    // paused-time accounting only counts the gap since recovery.
    pauseStartedAtRef.current = snap.pauseStartedAt || snap.savedAt || Date.now();
    trackRef.current = snap.track || [];
    distanceMetersRef.current = snap.distanceMeters || 0;
    lastAcceptedRef.current = snap.track?.length ? snap.track[snap.track.length - 1] : null;
    setStatus('paused');
    toast.success(t('cardio.recover.recovered'));
    forceTick(n => n + 1);
   
  }, []);

  // ── Fetch weather on mount ──
  // Strategy: fire GPS and IP-based location simultaneously. GPS wins if it
  // arrives first (more accurate). IP location fires after 2s as a fallback so
  // weather is always shown even when the user hasn't granted GPS permission.
  useEffect(() => {
    const tempUnit = distanceUnit === 'mi' ? 'fahrenheit' : 'celsius';
    let priority = 0; // higher wins — GPS(2) beats IP(1)

    const applyWeather = (data, p) => {
      if (p <= priority) return; // lower-priority result arrived late, discard
      priority = p;
      if (data?.current) {
        setWeather({
          temp: Math.round(data.current.temperature_2m),
          feels: Math.round(data.current.apparent_temperature),
          code: data.current.weather_code,
          wind: Math.round(data.current.wind_speed_10m),
          uv: data.current.uv_index != null ? Math.round(data.current.uv_index) : null,
          unit: tempUnit === 'fahrenheit' ? '°F' : '°C',
          speedUnit: distanceUnit === 'mi' ? 'mph' : 'km/h',
        });
      }
    };

    const fetchWeather = async (lat, lng, p) => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast`
          + `?latitude=${lat}&longitude=${lng}`
          + `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,uv_index`
          + `&temperature_unit=${tempUnit}`
          + `&wind_speed_unit=${distanceUnit === 'mi' ? 'mph' : 'kmh'}`;
        const res = await fetch(url);
        applyWeather(await res.json(), p);
      } catch {}
    };

    const fetchWeatherByIp = async (p = 1) => {
      try {
        const res = await fetch('https://ipapi.co/json/');
        const d = await res.json();
        if (d?.latitude) await fetchWeather(d.latitude, d.longitude, p);
      } catch {}
    };

    // Kick off IP fallback after 2s — enough time for GPS to answer first
    const ipTimer = setTimeout(() => fetchWeatherByIp(1), 2000);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(ipTimer);
          fetchWeather(pos.coords.latitude, pos.coords.longitude, 2);
        },
        () => {
          clearTimeout(ipTimer);
          fetchWeatherByIp(1);
        },
        { enableHighAccuracy: false, timeout: 6000 }
      );
    } else {
      clearTimeout(ipTimer);
      fetchWeatherByIp(1);
    }

    return () => clearTimeout(ipTimer);
  }, [distanceUnit]);

  // ── Auto-snapshot every 10s while active ──
  useEffect(() => {
    if (status !== 'tracking' && status !== 'paused') return;
    const id = setInterval(() => {
      snapshot({
        kind: 'outside',
        mode,
        startedAt: startedAtRef.current,
        pausedTotalMs: pausedTotalMsRef.current,
        pauseStartedAt: status === 'paused' ? pauseStartedAtRef.current : null,
        track: trackRef.current,
        distanceMeters: distanceMetersRef.current,
        status,
        savedAt: Date.now(),
      });
    }, 10000);
    return () => clearInterval(id);
  }, [status, mode]);

  // ── Pre-load voice list (Chrome/Safari quirk) ──
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const handler = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', handler);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', handler);
  }, []);

  // ── Derived ──
  const elapsedMs = startedAtRef.current
    ? (status === 'paused'
        ? (pauseStartedAtRef.current - startedAtRef.current - pausedTotalMsRef.current)
        : (Date.now() - startedAtRef.current - pausedTotalMsRef.current))
    : 0;
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const distanceMeters = distanceMetersRef.current;
  const pace = paceSecPerKmFrom(distanceMeters, elapsedSeconds);
  const speedKmh = speedKmhFrom(distanceMeters, elapsedSeconds);
  const calories = estimateCalories({
    type: `${mode}_outside`,
    durationSeconds: elapsedSeconds,
    distanceMeters,
    weightKg: userWeightKg(user),
  });

  // ── GPS handler ──
  const onGpsFix = (pos) => {
    const fix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      timestamp_ms: pos.timestamp,
      speed_mps: pos.coords.speed ?? 0,
      accuracy_m: pos.coords.accuracy ?? 999,
    };
    lastFixAccuracyRef.current = fix.accuracy_m;
    if (Date.now() - startedAtRef.current < STABILIZE_MS) {
      lastAcceptedRef.current = fix;
      return;
    }

    // Auto-pause logic
    if (autoPauseEnabled && status === 'tracking') {
      const speed = fix.speed_mps || 0;
      if (speed < STILL_SPEED_THRESHOLD_MPS) {
        if (!stillSinceRef.current) stillSinceRef.current = Date.now();
        else if (Date.now() - stillSinceRef.current > STILL_DURATION_MS) {
          wasAutoPausedRef.current = true;
          pause();
          toast.info(t('cardio.live.autoPaused'));
          try { navigator.vibrate?.(60); } catch {}
          if (voiceEnabled) speak(buildPauseText(t), language);
          return;
        }
      } else {
        stillSinceRef.current = null;
      }
    }

    if (fix.accuracy_m > ACCURACY_THRESHOLD_M) return;
    if (lastAcceptedRef.current) {
      const d = haversineMeters(lastAcceptedRef.current, fix);
      if (d < MIN_MOVE_METERS) return;

      // GPS outlier rejection. Even with accuracy < 30m, a fix can be plain
      // wrong (urban canyon, tunnel exit, signal bounce) and report a 200m
      // jump in 2s. Reject any sample whose implied speed exceeds the mode's
      // physical maximum. We DON'T update lastAcceptedRef in this case so
      // subsequent samples are compared against the last known-good point —
      // a single jump is silently dropped without polluting downstream
      // distance accumulation.
      const dtSec = Math.max(0.001,
        (fix.timestamp_ms - (lastAcceptedRef.current.timestamp_ms || fix.timestamp_ms)) / 1000);
      const impliedSpeed = d / dtSec;
      const maxSpeed = MAX_MODE_SPEED_MPS[mode] ?? MAX_MODE_SPEED_MPS.cycling;
      if (impliedSpeed > maxSpeed) {
        // Discard the outlier — don't add distance, don't advance lastAccepted.
        return;
      }

      distanceMetersRef.current += d;
    }
    lastAcceptedRef.current = fix;
    trackRef.current.push(fix);

    // ── Voice milestone ──
    if (voiceEnabled) {
      const milestoneMeters = distanceUnit === 'km' ? 1000 : 1609.344;
      const currentMilestone = Math.floor(distanceMetersRef.current / milestoneMeters);
      if (currentMilestone > lastMilestoneRef.current && currentMilestone > 0) {
        lastMilestoneRef.current = currentMilestone;
        const elapsed = Math.floor((Date.now() - startedAtRef.current - pausedTotalMsRef.current) / 1000);
        const distLabel = distanceUnit === 'km'
          ? `${currentMilestone} ${currentMilestone === 1 ? t('cardio.voice.kilometer') : t('cardio.voice.kilometers')}`
          : `${currentMilestone} ${currentMilestone === 1 ? t('cardio.voice.mile') : t('cardio.voice.miles')}`;
        const timeLabel = spokenDuration(t, elapsed);
        const paceSecPerKm = elapsed / (distanceMetersRef.current / 1000);
        const paceSec = distanceUnit === 'km' ? paceSecPerKm : paceSecPerKm * 1.609344;
        const pm = Math.floor(paceSec / 60);
        const ps = Math.round(paceSec % 60);
        const paceLabel = `${pm} ${t('cardio.voice.minutes')} ${ps} ${t('cardio.voice.seconds')} ${
          distanceUnit === 'km' ? t('cardio.voice.perKilometer') : t('cardio.voice.perMile')
        }`;
        speak(buildMilestoneText(t, { distanceLabel: distLabel, timeLabel, paceLabel }), language);
        try { navigator.vibrate?.(80); } catch {}
      }
    }
  };

  const onGpsError = (err) => {
    // Hard error — permission denied. The user MUST grant access; transition
    // to error state, clear the watch, surface the recovery UI.
    if (err.code === err.PERMISSION_DENIED) {
      setError('denied');
      setStatus('error');
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }
    // Soft errors — POSITION_UNAVAILABLE or TIMEOUT happen routinely during
    // a long run (entering a tunnel, brief signal loss). The OS retries on
    // its own. Previously these transitioned to status='error' and CLEARED
    // THE WATCH, killing the entire session. Now they just emit a transient
    // toast on the first occurrence per pause-window and let the watch keep
    // running; distance accumulation is already paused naturally because
    // no fix is arriving.
    if (!transientGpsToastRef.current) {
      transientGpsToastRef.current = true;
      toast.message(t('cardio.live.gpsTransient') === 'cardio.live.gpsTransient'
        ? 'GPS signal weak — keep moving, it should recover.'
        : t('cardio.live.gpsTransient'));
      // Allow the toast to fire again after 30s of continued errors.
      setTimeout(() => { transientGpsToastRef.current = false; }, 30000);
    }
  };

  // ── Start ──
  const start = () => {
    if (!navigator.geolocation) {
      setError('unavailable');
      setStatus('error');
      return;
    }
    setStatus('tracking');
    startedAtRef.current = Date.now();
    pausedTotalMsRef.current = 0;
    trackRef.current = [];
    distanceMetersRef.current = 0;
    lastAcceptedRef.current = null;
    lastFixAccuracyRef.current = null;
    lastMilestoneRef.current = 0;

    if (voiceEnabled) speak(buildStartText(t), language);

    watchIdRef.current = navigator.geolocation.watchPosition(
      onGpsFix, onGpsError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    tickIdRef.current = setInterval(() => forceTick(t => t + 1), 500);
  };

  // ── Pause ──
  const pause = () => {
    if (status !== 'tracking') return;
    wasAutoPausedRef.current = false;
    stillSinceRef.current = null;
    pauseStartedAtRef.current = Date.now();
    setStatus('paused');
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (tickIdRef.current) {
      clearInterval(tickIdRef.current);
      tickIdRef.current = null;
    }
  };

  // ── Resume ──
  const resume = () => {
    if (status !== 'paused') return;
    pausedTotalMsRef.current += Date.now() - pauseStartedAtRef.current;
    pauseStartedAtRef.current = null;
    setStatus('tracking');
    watchIdRef.current = navigator.geolocation.watchPosition(
      onGpsFix, onGpsError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    tickIdRef.current = setInterval(() => forceTick(t => t + 1), 500);
  };

  // ── Finish ──
  const finish = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (tickIdRef.current) {
      clearInterval(tickIdRef.current);
      tickIdRef.current = null;
    }
    if (voiceEnabled) {
      const distLabel = distanceUnit === 'km'
        ? `${(distanceMetersRef.current / 1000).toFixed(2)} ${t('cardio.voice.kilometers')}`
        : `${(distanceMetersRef.current / 1609.344).toFixed(2)} ${t('cardio.voice.miles')}`;
      speak(buildFinishText(t, {
        distanceLabel: distLabel,
        timeLabel: spokenDuration(t, elapsedSeconds),
      }), language);
    }
    setStatus('finished');
  };

  // ── Discard ──
  const discardAndClose = () => {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    if (tickIdRef.current) clearInterval(tickIdRef.current);
    clearSnapshot();
    onCancel();
  };

  // Ref-based guard against double-tap on Save. The Save button is
  // `disabled={saving}` but `setSaving(true)` is async and React can
  // batch a rapid double-tap on mobile so two clicks fire before the
  // button re-renders disabled. The ref synchronously blocks the
  // second call.
  const savingGuardRef = useRef(false);

  // ── Save ──
  const save = async () => {
    if (savingGuardRef.current) return;
    savingGuardRef.current = true;

    // Refuse to save a 0-distance / sub-30s outdoor session — previously
    // these still went through and credited XP/league/quest/streak from
    // empty data (e.g. user opened the tracker, never moved, hit Finish).
    if (distanceMetersRef.current <= 0 || elapsedSeconds < 30) {
      savingGuardRef.current = false;
      toast.error(
        distanceMetersRef.current <= 0
          ? 'No distance tracked yet — start moving before saving.'
          : 'Session too short to save (under 30 seconds).'
      );
      return;
    }

    setSaving(true);
    try {
      const cappedCalories = Math.min(
        calories,
        getMaxRealisticCalories(elapsedSeconds, userProfile)
      );
      const payload = {
        date: format(new Date(startedAtRef.current), 'yyyy-MM-dd'),
        type: `${mode}_outside`,
        mode: 'live',
        duration_seconds: elapsedSeconds,
        distance_meters: distanceMetersRef.current,
        pace_seconds_per_km: paceSecPerKmFrom(distanceMetersRef.current, elapsedSeconds),
        avg_speed_kmh: speedKmhFrom(distanceMetersRef.current, elapsedSeconds),
        calories: cappedCalories,
        incline_percent: null,
        elevation_gain_m: null,
        notes: null,
        gps_track: trackRef.current,
      };
      const createdLog = await db.entities.CardioLog.create(payload);
      clearSnapshot();
      // Atomic accumulation via increment_user_distance RPC (migration 023).
      if (Number(payload.distance_meters) > 0) {
        try {
          const { error: rpcErr } = await supabase.rpc('increment_user_distance', {
            p_delta: Number(payload.distance_meters),
          });
          if (rpcErr) {
            console.warn('[CardioOutside] distance RPC failed, falling back:', rpcErr);
            const me = await db.auth.me();
            const prev = Number(me?.total_distance_meters) || 0;
            await db.auth.updateMe({ total_distance_meters: prev + Number(payload.distance_meters) });
          }
        } catch (err) { console.warn('[CardioOutside] distance accumulate failed:', err); }
      }
      // Fire achievement check (non-blocking)
      db.functions.invoke('updateUserXpAndAchievements', {
        xp_gained: 0,
        action_type: 'cardio_completed',
        action_data: {
          duration_seconds: payload.duration_seconds,
          distance_meters: payload.distance_meters,
          calories: payload.calories,
        },
      }).catch(() => {});
      // Check for PRs
      const prior = await db.entities.CardioLog.filter(
        { created_by: user.email }, '-date', 1000
      );
      const priorOnly = prior.filter(l => l.id !== createdLog.id);
      const prs = detectNewPRs(createdLog, priorOnly);
      for (const pr of prs) {
        const label = PR_LABELS[pr.distance];
        toast.success(t('cardio.pr.title').replace('{label}', label), {
          duration: 6000,
        });
        try { navigator.vibrate?.([100, 60, 100]); } catch {}
      }
      queryClient.invalidateQueries({ queryKey: ['cardioLogs', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      toast.success(t('cardio.saved'));

      // Quest progress — non-blocking
      const durSec = Number(payload.duration_seconds) || 0;
      const _user = user;
      Promise.all([
        quests.recordAction(_user, ACTION_TYPES.CARDIO_COMPLETED, 1),
        durSec > 0 ? quests.recordAction(_user, ACTION_TYPES.CARDIO_SECONDS, durSec) : null,
        prs.length > 0 ? quests.recordAction(_user, ACTION_TYPES.PR_ACHIEVED, prs.length) : null,
      ].filter(Boolean))
        .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(() => {});

      // League weekly XP + workout streak — non-blocking
      const cardioXp = calculateCardioXp({
        duration_seconds: payload.duration_seconds,
        distance_meters:  payload.distance_meters,
        calories:         payload.calories,
      });
      leagues.recordWeeklyXp(_user, cardioXp)
        .then(() => queryClient.invalidateQueries({ queryKey: ['myLeague', _user?.id] }))
        .catch(() => {});
      workoutStreak.recordWorkoutDay(_user)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['workoutStreakProfile', _user?.id] });
          queryClient.invalidateQueries({ queryKey: ['userProfile', _user?.email] });
        })
        .catch(() => {});

      onSaved();
    } catch (err) {
      console.error('[CardioOutside] save failed:', err);
      toast.error(t('cardio.saveFailed'));
    } finally {
      // ALWAYS release the saving state, regardless of success / failure /
      // success-path-threw. The previous code only reset on the error
      // branch, so any post-create error (PR detection throws, etc.)
      // stranded the user on the saving spinner forever.
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

  // Belt-and-braces wake-lock cleanup on unmount. The status-dependent
  // effect above releases the lock when status changes, but if the user
  // navigates away mid-tracking (route change, back button, hard close)
  // the component unmounts without status changing first — the lock
  // would otherwise remain acquired, draining battery silently.
  useEffect(() => () => {
    try { wakeLockRef.current?.release?.(); } catch {}
    wakeLockRef.current = null;
    // Also clear any leftover watch / tick — defense in depth.
    if (watchIdRef.current != null) {
      try { navigator.geolocation.clearWatch(watchIdRef.current); } catch {}
      watchIdRef.current = null;
    }
    if (tickIdRef.current) {
      try { clearInterval(tickIdRef.current); } catch {}
      tickIdRef.current = null;
    }
  }, []);

  // ── Auto-resume watch ──
  useEffect(() => {
    if (status !== 'paused' || !wasAutoPausedRef.current || !autoPauseEnabled) return;

    let detectId = null;
    if (navigator.geolocation) {
      detectId = navigator.geolocation.watchPosition(
        (pos) => {
          const sp = pos.coords.speed || 0;
          if (sp >= STILL_SPEED_THRESHOLD_MPS) {
            wasAutoPausedRef.current = false;
            stillSinceRef.current = null;
            navigator.geolocation.clearWatch(detectId);
            resume();
            toast.info(t('cardio.live.autoResumed'));
            try { navigator.vibrate?.(60); } catch {}
            if (voiceEnabled) speak(buildResumeText(t), language);
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
      );
    }
    return () => {
      if (detectId != null) navigator.geolocation.clearWatch(detectId);
    };
  }, [status, autoPauseEnabled, voiceEnabled, language, t]);

  // ── Cleanup on unmount ──
  useEffect(() => () => {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    if (tickIdRef.current) clearInterval(tickIdRef.current);
    stopSpeaking();
  }, []);

  // ── GPS indicator ──
  const accuracy = lastFixAccuracyRef.current;
  let gpsColor = 'bg-red-500';
  let gpsLabel = t('cardio.live.gpsAcquiring');
  if (accuracy != null) {
    if (accuracy < 10) { gpsColor = 'bg-green-500'; gpsLabel = t('cardio.live.gpsExcellent'); }
    else if (accuracy < 25) { gpsColor = 'bg-yellow-400'; gpsLabel = t('cardio.live.gpsGood'); }
    else { gpsColor = 'bg-red-500'; gpsLabel = t('cardio.live.gpsWeak'); }
  }

  // ── Format timer ──
  const hh = Math.floor(elapsedSeconds / 3600);
  const mm = Math.floor((elapsedSeconds % 3600) / 60);
  const ss = elapsedSeconds % 60;
  const timerStr = hh > 0
    ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  // ── Speed display ──
  const speedDisplay = distanceUnit === 'mi'
    ? `${(speedKmh / 1.609344).toFixed(1)} mph`
    : `${speedKmh.toFixed(1)} km/h`;

  // ════════════════ RENDER ════════════════

  // IDLE
  if (status === 'idle') {
    return (
      <Card className="p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <Play className="w-10 h-10 text-primary ml-1" />
        </div>
        <h2 className="font-heading text-2xl font-bold mb-2">
          {mode === 'running' ? t('cardio.modes.running') :
           mode === 'walking' ? t('cardio.modes.walking') : t('cardio.modes.biking')}
        </h2>
        <p className="text-sm text-muted-foreground mb-8">{t('cardio.env.outside')}</p>
        {weather && (
          <Card className="p-4 mb-4 border-border/60">
            <div className="flex items-start gap-3">
              <span className="text-3xl mt-0.5">{weatherEmoji(weather.code)}</span>
              <div className="flex-1 text-left space-y-1.5">
                <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5">
                  <p className="text-sm font-semibold">
                    {weather.temp}{weather.unit}
                    <span className="text-muted-foreground text-xs font-normal ml-1.5">
                      ({t('cardio.weather.feelsLike')} {weather.feels}{weather.unit})
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    💨 {weather.wind} {weather.speedUnit}
                  </p>
                </div>
                {weather.uv != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">UV Index</span>
                    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                      weather.uv <= 2  ? 'bg-green-500/15 text-green-600 dark:text-green-400' :
                      weather.uv <= 5  ? 'bg-yellow-400/20 text-yellow-600 dark:text-yellow-400' :
                      weather.uv <= 7  ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' :
                      weather.uv <= 10 ? 'bg-red-500/15 text-red-600 dark:text-red-400' :
                                         'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                    }`}>
                      ☀ {weather.uv} — {
                        weather.uv <= 2  ? 'Low' :
                        weather.uv <= 5  ? 'Moderate' :
                        weather.uv <= 7  ? 'High' :
                        weather.uv <= 10 ? 'Very High' : 'Extreme'
                      }
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
        <Button className="w-full h-14 font-heading font-bold text-base" onClick={start}>
          <Play className="w-5 h-5 mr-2" />
          {t('cardio.live.start')}
        </Button>
      </Card>
    );
  }

  // ERROR
  if (status === 'error') {
    return (
      <Card className="p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="font-heading text-xl font-bold mb-2">{t('cardio.live.gpsDenied')}</h2>
        <p className="text-sm text-muted-foreground mb-6">{t('cardio.live.gpsDeniedDesc')}</p>
        <Button variant="outline" className="w-full" onClick={onCancel}>
          {t('cardio.live.switchToManual')}
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
          <StatCard label={t('cardio.field.calories')} value={`${Math.round(calories)} kcal`} />
        </div>
        <div className="flex gap-3">
          <Button
            className="flex-1 h-12 font-heading font-bold"
            onClick={save}
            disabled={saving}
          >
            <Save className="w-5 h-5 mr-2" />
            {saving ? t('cardio.saving') : t('cardio.save')}
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-12"
            onClick={onCancel}
            disabled={saving}
          >
            <X className="w-4 h-4 mr-2" />
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
          className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          onClick={() => setConfirmDiscardOpen(true)}
        >
          <X className="w-4 h-4" />
        </button>

        {/* Timer */}
        <div className="text-center mb-2 pt-2">
          <motion.p
            className="font-heading text-5xl font-bold tracking-tight"
            key={timerStr}
          >
            {timerStr}
          </motion.p>
        </div>

        {/* Distance */}
        <p className="font-heading text-3xl font-semibold text-center text-primary mb-5">
          {formatDistance(distanceMeters, distanceUnit, 2)}
        </p>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <StatCard label={t('cardio.field.avgPace')} value={formatPace(pace, distanceUnit)} />
          <StatCard label={t('cardio.field.avgSpeed')} value={speedDisplay} />
          <StatCard label={t('cardio.field.calories')} value={`${Math.round(calories)}`} small />
        </div>

        {/* GPS indicator */}
        <div className="flex items-center justify-center gap-2 mb-5">
          <span className={`w-2.5 h-2.5 rounded-full ${gpsColor} ${status === 'tracking' ? 'animate-pulse' : ''}`} />
          <span className="text-xs text-muted-foreground">{gpsLabel}</span>
        </div>

        {/* Controls */}
        <div className="flex gap-3">
          {status === 'tracking' ? (
            <Button variant="outline" className="flex-1 h-12 font-heading font-bold" onClick={pause}>
              <Pause className="w-5 h-5 mr-2" />
              {t('cardio.live.pause')}
            </Button>
          ) : (
            <Button className="flex-1 h-12 font-heading font-bold" onClick={resume}>
              <Play className="w-5 h-5 mr-2" />
              {t('cardio.live.resume')}
            </Button>
          )}
          <Button
            variant="destructive"
            className="flex-1 h-12 font-heading font-bold"
            onClick={finish}
          >
            <Square className="w-5 h-5 mr-2" />
            {t('cardio.live.finish')}
          </Button>
        </div>
      </Card>

      {/* Discard confirm dialog */}
      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cardio.live.confirmDiscard')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cardio.live.confirmDiscardDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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