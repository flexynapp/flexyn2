// src/lib/playSound.js
//
// Centralized sound-effect player. Default OFF (most users don't want
// audio cues), opt-in via SettingsPanel. When ON, key primary actions
// play very short audio cues — workout save, PR, celebration, etc.
//
// Design constraints:
//   • Default OFF — most users want silence; opt-in via Settings
//   • Pre-bundled sounds live in /public/sounds/<id>.mp3
//   • Lazy-loaded — only fetched when the toggle is enabled the first
//     time. Don't bloat the initial bundle for the 90% who'll never
//     enable it.
//   • Respect prefers-reduced-motion as a secondary "low stim" signal
//   • Rate-limited so a stream of 5 likes doesn't fire 5 chimes
//   • Phone-on-silent → audio just doesn't play (OS handles)
//   • Autoplay errors silenced (browsers block audio without prior
//     user-gesture interaction; first sound right after enabling may
//     drop, subsequent calls work)
//
// NOTE on audio assets: this commit ships the infrastructure but NOT
// the actual .mp3 files. The `playSound` calls already in code will
// silently no-op until files exist at /public/sounds/<id>.mp3. The
// shipping question (custom chimes vs licensed library) is a content
// decision; the toggle is in Settings ready to flip the day assets land.

const LS_KEY = 'flexyn.soundsEnabled';
const SOUND_BASE = '/sounds';

const SOUND_IDS = {
  workoutSaved: 'workout-saved',
  prHit:        'pr-hit',
  messageSent:  'message-sent',
  capsuleOpen:  'capsule-open',
  goalComplete: 'goal-complete',
  click:        'click',          // generic micro-tap
};

// Cache audio elements per id so we're not creating new <Audio> on every
// call. ~50KB per file × maybe 6 sounds = 300KB cached, acceptable.
const audioCache = new Map();

let lastPlayedAt = 0;
const MIN_GAP_MS = 200;

export function getSoundsEnabled() {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}

export function setSoundsEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(LS_KEY, '1');
    else localStorage.removeItem(LS_KEY);
  } catch { /* best-effort */ }
  try { window.dispatchEvent(new CustomEvent('flexyn:sounds-toggled', { detail: { enabled: !!enabled } })); } catch { /* ignore */ }
}

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

/**
 * Play a short sound effect by id. Silently no-ops when:
 *   • Sounds are disabled (default)
 *   • Audio file is missing (404 → cached as null)
 *   • Browser blocked autoplay
 *   • Reduced-motion is active
 *   • Called within MIN_GAP_MS of the last play
 *
 * @param {keyof typeof SOUND_IDS | string} id  one of the registered ids
 *   (e.g. 'workoutSaved') or a raw filename ('custom-event').
 */
export function playSound(id) {
  if (!getSoundsEnabled()) return;
  if (prefersReducedMotion()) return;
  const now = Date.now();
  if (now - lastPlayedAt < MIN_GAP_MS) return;
  lastPlayedAt = now;

  const filename = SOUND_IDS[id] || id;

  // Cache: null sentinel means "we tried and the file isn't available"
  // — don't re-fetch on every call.
  if (audioCache.has(filename) && audioCache.get(filename) === null) return;

  try {
    let audio = audioCache.get(filename);
    if (!audio) {
      audio = new Audio(`${SOUND_BASE}/${filename}.mp3`);
      audio.preload = 'auto';
      audio.addEventListener('error', () => {
        // File missing or unsupported codec — flag negative so we
        // don't keep retrying on every call.
        audioCache.set(filename, null);
      }, { once: true });
      audioCache.set(filename, audio);
    }
    // Rewind so rapid replays don't get cut off mid-clip.
    try { audio.currentTime = 0; } catch { /* some browsers throw before metadata loaded */ }
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => { /* autoplay block / gesture requirement — silent */ });
    }
  } catch { /* anything else — silent */ }
}

export const SOUND = SOUND_IDS;
