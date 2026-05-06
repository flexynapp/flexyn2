import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useSettings } from '@/lib/SettingsContext';
import {
  speakRestStart,
  speakRestComplete,
  speakCountdown,
  isVoiceCuesEnabled,
  setVoiceCuesEnabled as persistVoiceCuesEnabled,
  preloadVoices,
} from '@/lib/audioCues';

/**
 * RestTimerContext — global rest timer for active workouts.
 *
 * - Auto-starts when a set is added (called from ExerciseLogger.addSet).
 * - Shows a floating pill at the bottom of the viewport.
 * - Beeps + vibrates on completion.
 * - User can skip, add 15s, or change the default duration.
 * - Default duration persists in localStorage.
 *
 * The timer uses a single setInterval that ticks against an absolute target
 * timestamp, so backgrounded tabs don't drift.
 */

const DEFAULT_DURATION_KEY = 'fn-rest-timer-default';
const SOUND_ENABLED_KEY = 'fn-rest-timer-sound';
const FALLBACK_DURATION = 90; // seconds

const RestTimerContext = createContext(null);

export function RestTimerProvider({ children }) {
  const { restTimerEnabled } = useSettings() || { restTimerEnabled: true };
  const [defaultDuration, setDefaultDurationState] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(DEFAULT_DURATION_KEY) || '');
      return Number.isFinite(v) && v > 0 && v <= 600 ? v : FALLBACK_DURATION;
    } catch {
      return FALLBACK_DURATION;
    }
  });

  const [soundEnabled, setSoundEnabledState] = useState(() => {
    try {
      const saved = localStorage.getItem(SOUND_ENABLED_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  // Voice cues — separate from sound (chimes). Lets users keep the chime
  // but disable the spoken coach (or vice versa). Persisted via audioCues.js.
  const [voiceCuesEnabled, setVoiceCuesEnabledState] = useState(() => isVoiceCuesEnabled());

  // Eagerly load voices on first mount so the first cue doesn't lag
  useEffect(() => { preloadVoices(); }, []);

  // Active timer state
  const [active, setActive] = useState(false);
  const [endsAt, setEndsAt] = useState(null);          // ms epoch when timer ends
  const [totalSeconds, setTotalSeconds] = useState(0); // initial duration (for progress %)
  const [secondsLeft, setSecondsLeft] = useState(0);
  const tickRef = useRef(null);
  const completedFiredRef = useRef(false);

  // Persist preferences
  useEffect(() => {
    try { localStorage.setItem(DEFAULT_DURATION_KEY, String(defaultDuration)); } catch {}
  }, [defaultDuration]);

  useEffect(() => {
    try { localStorage.setItem(SOUND_ENABLED_KEY, String(soundEnabled)); } catch {}
  }, [soundEnabled]);

  // Tick loop
  // We track the last "spoken second" so countdown cues fire exactly once per
  // second boundary, not on every 250ms tick.
  const lastSpokenSecRef = useRef(null);
  useEffect(() => {
    if (!active || endsAt == null) {
      lastSpokenSecRef.current = null;
      return;
    }

    const tick = () => {
      const remainingMs = endsAt - Date.now();
      const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
      setSecondsLeft(remaining);

      // Voice countdown for the last 3 seconds (fires once per second boundary)
      if (voiceCuesEnabled && remaining > 0 && remaining <= 3 && remaining !== lastSpokenSecRef.current) {
        lastSpokenSecRef.current = remaining;
        speakCountdown(remaining);
      }

      if (remaining <= 0 && !completedFiredRef.current) {
        completedFiredRef.current = true;
        fireCompletionFeedback(soundEnabled);
        if (voiceCuesEnabled) speakRestComplete();
        // Auto-dismiss after 2 seconds at zero
        setTimeout(() => {
          setActive(false);
          setEndsAt(null);
          completedFiredRef.current = false;
        }, 2000);
      }
    };

    tick(); // initial sync
    tickRef.current = setInterval(tick, 250);
    return () => clearInterval(tickRef.current);
  }, [active, endsAt, soundEnabled, voiceCuesEnabled]);

  const start = useCallback((seconds) => {
    if (!restTimerEnabled) return;
    const dur = Number.isFinite(seconds) && seconds > 0 ? seconds : defaultDuration;
    completedFiredRef.current = false;
    lastSpokenSecRef.current = null;
    setTotalSeconds(dur);
    setSecondsLeft(dur);
    setEndsAt(Date.now() + dur * 1000);
    setActive(true);
    if (voiceCuesEnabled) speakRestStart(dur);
  }, [defaultDuration, restTimerEnabled, voiceCuesEnabled]);

  const stop = useCallback(() => {
    setActive(false);
    setEndsAt(null);
    setSecondsLeft(0);
    completedFiredRef.current = false;
  }, []);

  const addTime = useCallback((deltaSeconds) => {
    if (!active || endsAt == null) return;
    const newEnd = Math.max(Date.now() + 1000, endsAt + deltaSeconds * 1000);
    setEndsAt(newEnd);
    setTotalSeconds(prev => Math.max(prev, Math.ceil((newEnd - Date.now()) / 1000)));
  }, [active, endsAt]);

  const setDefaultDuration = useCallback((seconds) => {
    const v = Math.max(15, Math.min(600, Math.round(seconds)));
    setDefaultDurationState(v);
  }, []);

  const setSoundEnabled = useCallback((on) => setSoundEnabledState(!!on), []);
  const setVoiceCuesEnabled = useCallback((on) => {
    const next = !!on;
    setVoiceCuesEnabledState(next);
    persistVoiceCuesEnabled(next);
  }, []);

  return (
    <RestTimerContext.Provider value={{
      active, secondsLeft, totalSeconds,
      defaultDuration, setDefaultDuration,
      soundEnabled, setSoundEnabled,
      voiceCuesEnabled, setVoiceCuesEnabled,
      start, stop, addTime,
    }}>
      {children}
    </RestTimerContext.Provider>
  );
}

export function useRestTimer() {
  const ctx = useContext(RestTimerContext);
  if (!ctx) {
    // Graceful fallback when used outside the provider — returns no-ops so
    // ExerciseLogger and other consumers don't crash if the provider is
    // accidentally omitted.
    return {
      active: false, secondsLeft: 0, totalSeconds: 0,
      defaultDuration: FALLBACK_DURATION,
      setDefaultDuration: () => {},
      soundEnabled: false,
      setSoundEnabled: () => {},
      voiceCuesEnabled: false,
      setVoiceCuesEnabled: () => {},
      start: () => {}, stop: () => {}, addTime: () => {},
    };
  }
  return ctx;
}

/* ── Audio + haptic feedback ─────────────────────────────────────────── */

function fireCompletionFeedback(soundEnabled) {
  if (soundEnabled) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        // Three short rising beeps
        const tones = [880, 1108, 1318];
        const startTime = ctx.currentTime;
        tones.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          osc.connect(gain);
          gain.connect(ctx.destination);
          const t0 = startTime + i * 0.18;
          gain.gain.setValueAtTime(0, t0);
          gain.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
          osc.start(t0);
          osc.stop(t0 + 0.18);
        });
        // Auto-close context after the last beep
        setTimeout(() => { try { ctx.close(); } catch {} }, 1000);
      }
    } catch {}
  }
  // Haptic feedback — short triple pulse on capable devices
  try {
    if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 60]);
  } catch {}
}