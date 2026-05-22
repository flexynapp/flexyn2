// src/lib/voiceInput.js
//
// Web Speech API wrapper for dictating workout sets. Users tap a mic
// icon, say "100 by 5" or "100 pounds 5 reps", and the parsed values
// fill into the weight + reps fields. Optimized for gym-glove-friendly
// UX where tapping tiny number inputs is friction.
//
// SUPPORT
// ───────
//   • Chrome / Edge (desktop + Android) — Web Speech API native
//   • Safari iOS 14.5+ — supported with manual permission grant
//   • Firefox — no built-in SpeechRecognition; isSupported = false
//
// The hook gracefully reports isSupported = false on missing browsers,
// so the mic icon hides rather than presenting a broken button.

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function isVoiceInputSupported() {
  return !!SR;
}

/**
 * Parses a spoken phrase into { weight, reps }.
 *
 * Accepts (case-insensitive, locale-friendly):
 *   "100 by 5"            → { weight: 100, reps: 5 }
 *   "100 pounds 5 reps"   → { weight: 100, reps: 5 }
 *   "one hundred by five" → { weight: 100, reps: 5 }
 *   "225 for 8"           → { weight: 225, reps: 8 }
 *   "five reps"           → { weight: null, reps: 5 }
 *   "weight 100"          → { weight: 100, reps: null }
 *
 * Returns nulls for any field we couldn't parse, so the caller can
 * decide whether to fill, prompt for the missing field, or ignore.
 */
export function parseVoiceSet(transcript) {
  if (typeof transcript !== 'string') return { weight: null, reps: null };
  const text = transcript.toLowerCase().trim();
  if (!text) return { weight: null, reps: null };

  // Normalize spoken numbers to digits. We only cover 0-999 since lifts
  // outside that range are exotic; users typing them is acceptable.
  const WORDS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  };
  let normalized = text;
  for (const [w, n] of Object.entries(WORDS)) {
    normalized = normalized.replace(new RegExp(`\\b${w}\\b`, 'g'), String(n));
  }

  // Collapse "100 100" patterns like "one hundred" → "100" then "100".
  // Handle "X hundred" + optional "and N" patterns: "two hundred and twenty five"
  // becomes "2 100 and 20 5". We collapse triplets/pairs back to a single number.
  normalized = normalized.replace(/(\d+)\s+100(?:\s+and)?\s+(\d+)(?:\s+(\d+))?/g, (m, h, t, u) => {
    const hundred = Number(h) * 100;
    const tens = Number(t);
    const units = u ? Number(u) : 0;
    return String(hundred + tens + units);
  });
  normalized = normalized.replace(/(\d+)\s+100/g, (m, h) => String(Number(h) * 100));
  normalized = normalized.replace(/100\s+and\s+(\d+)/g, (m, n) => String(100 + Number(n)));

  // Extract numbers + their context.
  // We look for "(weight value) (separator) (reps value)" patterns.
  // Separators we accept: "by", "for", "x", "times", "and", "rep(s)" (after
  // a number), "pound(s)" / "kg" (after a number — denotes weight).
  let weight = null;
  let reps = null;

  // First pass: "N by M" / "N for M" / "N x M" / "N times M"
  const sepMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:by|for|x|times|@)\s*(\d+)/);
  if (sepMatch) {
    weight = parseFloat(sepMatch[1]);
    reps = parseInt(sepMatch[2], 10);
  }

  // Second pass: keyword-tagged values. Overrides the first-pass result
  // when explicit keywords are present.
  const repsMatch = normalized.match(/(\d+)\s*rep/);
  if (repsMatch) reps = parseInt(repsMatch[1], 10);

  const weightMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:pound|lb|kg|kilo|kilogram)/);
  if (weightMatch) weight = parseFloat(weightMatch[1]);

  // "weight 100" / "100 pounds" alone (no reps)
  const weightAloneMatch = normalized.match(/(?:weight\s+)?(\d+(?:\.\d+)?)$/);
  if (sepMatch == null && weight == null && weightAloneMatch) {
    weight = parseFloat(weightAloneMatch[1]);
  }

  // Sanity caps so a misheard "300 by 100" doesn't fill 100 reps.
  if (reps != null && (reps < 1 || reps > 50)) reps = null;
  if (weight != null && (weight < 0 || weight > 2000)) weight = null;

  return { weight, reps };
}

/**
 * Start a one-shot voice listening session. Returns an object with a
 * `stop()` method so the caller can cancel mid-listen. Callbacks:
 *   onResult({ transcript, weight, reps })  — fired when recognition completes
 *   onError(reason: string)                 — 'permission' | 'unsupported' | 'aborted' | 'other'
 *
 * Designed for a single shot per tap — not continuous dictation. The
 * user taps mic, speaks once, recognition ends. They can tap again to
 * record a new set.
 */
export function startVoiceCapture({ lang = 'en-US', onResult, onError } = {}) {
  if (!SR) {
    onError?.('unsupported');
    return { stop: () => {} };
  }

  const rec = new SR();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    try {
      const transcript = e.results?.[0]?.[0]?.transcript || '';
      const parsed = parseVoiceSet(transcript);
      onResult?.({ transcript, ...parsed });
    } catch (err) {
      onError?.('other');
    }
  };

  rec.onerror = (e) => {
    if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
      onError?.('permission');
    } else if (e?.error === 'aborted') {
      onError?.('aborted');
    } else {
      onError?.('other');
    }
  };

  // No-op onend handler — the result/error fires first.
  rec.onend = () => {};

  try {
    rec.start();
  } catch {
    // Some browsers throw if start() is called while another instance
    // is mid-listen. Treat as a clean cancel.
    onError?.('aborted');
  }

  return { stop: () => { try { rec.stop(); } catch { /* ignore */ } } };
}
