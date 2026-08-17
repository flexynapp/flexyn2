// Voice coach for live cardio tracking. Uses Web Speech API (free, offline).
// Cadence: speak a summary every milestoneMeters of accumulated distance.

const SUPPORTED_LANGS = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR',
  it: 'it-IT', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', ar: 'ar-SA',
  hi: 'hi-IN', ru: 'ru-RU', tr: 'tr-TR', pl: 'pl-PL', nl: 'nl-NL',
};

function pickVoice(langCode) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const target = SUPPORTED_LANGS[langCode] || 'en-US';
  const voices = window.speechSynthesis.getVoices() || [];
  return (
    voices.find(v => v.lang === target) ||
    voices.find(v => v.lang.startsWith(target.split('-')[0])) ||
    voices.find(v => v.default) ||
    voices[0] ||
    null
  );
}

export function speak(text, langCode) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(langCode);
    if (v) u.voice = v;
    u.lang = SUPPORTED_LANGS[langCode] || 'en-US';
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    window.speechSynthesis.cancel();   // stop any in-flight
    window.speechSynthesis.speak(u);
  } catch {}
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch {}
}

// Build the milestone announcement from the localized t() function.
// Caller passes an object with already-formatted display strings:
//   { distanceLabel: "1 mile",
//     timeLabel: "8 minutes 34 seconds",
//     paceLabel: "8:42 per mile" }
// and a t() that resolves cardio.voice.* keys.
export function buildMilestoneText(t, { distanceLabel, timeLabel, paceLabel }) {
  return t('cardio.voice.milestone', {
    distance: distanceLabel,
    time: timeLabel,
    pace: paceLabel,
  });
}

export function buildStartText(t) {
  return t('cardio.voice.workoutStarted');
}
export function buildPauseText(t) {
  return t('cardio.voice.workoutPaused');
}
export function buildResumeText(t) {
  return t('cardio.voice.workoutResumed');
}
export function buildFinishText(t, { distanceLabel, timeLabel }) {
  return t('cardio.voice.workoutFinished', {
    distance: distanceLabel,
    time: timeLabel,
  });
}

// Convert a duration in seconds to a SPOKEN form ("8 minutes 34 seconds").
// Keep numeric — SpeechSynthesis pronounces digits naturally per language.
export function spokenDuration(t, totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} ${t('cardio.voice.hours')}`);
  if (m > 0) parts.push(`${m} ${t('cardio.voice.minutes')}`);
  if (s > 0 && h === 0) parts.push(`${s} ${t('cardio.voice.seconds')}`);
  return parts.join(' ');
}