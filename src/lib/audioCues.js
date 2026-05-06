// src/lib/audioCues.js
//
// Hands-free voice coaching during workouts. Uses the Web Speech API
// (window.speechSynthesis) which is built into every modern browser — no
// API key, no external service, instant playback.
//
// Why this matters: real users have headphones in during a workout. They
// don't want to look at the phone for "rest 30 seconds left". A voice cue
// lets them keep their eyes on form / next set / their training partner.
//
// User pref: persists in localStorage at fn-voice-cues. Default: off (until
// the user opts in via the rest timer settings panel).

const PREF_KEY = 'fn-voice-cues';

let _voiceCache = null; // selected voice, lazy-loaded on first speak

/** Read the user's voice-cue pref. */
export function isVoiceCuesEnabled() {
  try {
    return localStorage.getItem(PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Set the user's voice-cue pref. */
export function setVoiceCuesEnabled(on) {
  try {
    localStorage.setItem(PREF_KEY, String(!!on));
  } catch {
    /* localStorage may be disabled */
  }
}

/** Whether the current browser supports speech synthesis at all. */
export function isSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Pick the best English voice available. Browsers ship with multiple voices
 * — we prefer "natural"/"premium" voices when present, otherwise the system
 * default. Voices load asynchronously on first request.
 */
function pickVoice() {
  if (!isSpeechSupported()) return null;
  if (_voiceCache) return _voiceCache;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  // Match the user's language if possible
  const lang = (navigator.language || 'en-US').split('-')[0];
  const langMatches = voices.filter(v => v.lang.startsWith(lang));
  const pool = langMatches.length > 0 ? langMatches : voices;

  // Prefer premium-sounding voices
  const PREFERRED_NAMES = [
    /samantha/i, /natural/i, /premium/i, /enhanced/i,
    /google.*us/i, /microsoft.*natural/i,
  ];
  for (const re of PREFERRED_NAMES) {
    const match = pool.find(v => re.test(v.name));
    if (match) { _voiceCache = match; return match; }
  }
  _voiceCache = pool[0];
  return _voiceCache;
}

/**
 * Speak a phrase. No-ops gracefully if:
 *   - Speech API isn't supported
 *   - User has voice cues disabled
 *   - Browser is muted / interrupted
 *
 * Cancels any in-progress utterance before speaking the new one so the
 * coach feels responsive (you don't get a queue of stale "30 seconds left"
 * announcements).
 */
export function speak(text, { rate = 1.05, pitch = 1.0, volume = 1.0, force = false } = {}) {
  if (!text) return;
  if (!isSpeechSupported()) return;
  if (!force && !isVoiceCuesEnabled()) return;

  try {
    const synth = window.speechSynthesis;
    // Cancel any pending or in-progress utterances so the new one plays now
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(String(text));
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.rate = rate;
    utter.pitch = pitch;
    utter.volume = volume;
    synth.speak(utter);
  } catch (err) {
    // Some Safari versions throw when called from non-user-gesture contexts.
    // Silently fail — this is best-effort coaching, not critical UX.
  }
}

/** Cancel any in-progress speech immediately. */
export function cancelSpeech() {
  if (!isSpeechSupported()) return;
  try { window.speechSynthesis.cancel(); } catch {}
}

/**
 * Eagerly load voices so the first speak() call doesn't have to wait. Call
 * this on app boot or first user interaction.
 */
export function preloadVoices() {
  if (!isSpeechSupported()) return;
  try {
    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      pickVoice();
    } else {
      // Some browsers fire `voiceschanged` once they're ready
      window.speechSynthesis.addEventListener('voiceschanged', () => pickVoice(), { once: true });
    }
  } catch { /* ignore */ }
}

// ── Workout-specific phrasings ───────────────────────────────────────────────
// Short, action-oriented, plain English. Designed to feel like a coach, not
// a robot. We deliberately don't say "rest period of one minute and thirty
// seconds" — too verbose for an athlete mid-set.

export function speakRestStart(seconds) {
  if (seconds >= 60) {
    const min = Math.round(seconds / 60);
    speak(`Rest. ${min} minute${min === 1 ? '' : 's'}.`);
  } else {
    speak(`Rest. ${seconds} seconds.`);
  }
}

export function speakRestComplete() {
  // Two phrasings rotated to avoid feeling repetitive across a workout
  const lines = ["Time's up. Let's go.", 'Rest complete. Next set.', 'Time. Get back in.'];
  speak(lines[Math.floor(Math.random() * lines.length)]);
}

export function speakCountdown(n) {
  // Used for the last 3 seconds of rest
  speak(String(n), { rate: 1.15 });
}

export function speakSetComplete(setNum, totalSets) {
  if (totalSets > 0) {
    speak(`Set ${setNum} of ${totalSets}.`);
  } else {
    speak(`Set ${setNum} complete.`);
  }
}

export function speakWorkoutComplete() {
  speak('Workout saved. Great session.', { rate: 1.0 });
}
