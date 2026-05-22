// src/components/workout/VoiceInputButton.jsx
//
// Mic-icon button that captures a single voice command and parses it
// into { weight, reps }. Designed for the workout set entry surface
// so users with sweaty / gloved hands don't have to peck at tiny
// number inputs.
//
// USAGE
// ─────
//   <VoiceInputButton
//     onParsed={({ weight, reps, transcript }) => {
//       // weight and/or reps may be null if unparseable
//       setSet({ weight: weight ?? currentWeight, reps: reps ?? currentReps });
//     }}
//   />
//
// Self-hides when Web Speech API isn't available (Firefox, some
// embedded browsers). Otherwise renders a Mic icon that animates
// while listening and toasts the parse result.

import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/lib/LanguageContext';
import { isVoiceInputSupported, startVoiceCapture } from '@/lib/voiceInput';

export default function VoiceInputButton({ onParsed, lang = 'en-US', className = '' }) {
  const { tFallback } = useLanguage();
  const [listening, setListening] = useState(false);
  const sessionRef = useRef(null);

  // Cancel any in-flight session on unmount — leaving an SR running
  // would block the next tap and confuse users.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        try { sessionRef.current.stop(); } catch { /* ignore */ }
        sessionRef.current = null;
      }
    };
  }, []);

  if (!isVoiceInputSupported()) return null;

  const startListening = () => {
    if (listening) {
      // Tap-while-listening = cancel.
      sessionRef.current?.stop();
      setListening(false);
      return;
    }
    setListening(true);
    sessionRef.current = startVoiceCapture({
      lang,
      onResult: ({ transcript, weight, reps }) => {
        setListening(false);
        sessionRef.current = null;
        if (weight == null && reps == null) {
          toast.error(
            tFallback('voice.noParse', "Couldn't parse — try \"100 by 5\".", { transcript })
          );
          return;
        }
        onParsed?.({ weight, reps, transcript });
        // Quick confirmation so the user knows the values landed.
        const parts = [];
        if (weight != null) parts.push(`${weight}`);
        if (reps != null) parts.push(`× ${reps}`);
        toast.success(
          tFallback('voice.parsed', 'Heard: {summary}', { summary: parts.join(' ') })
        );
      },
      onError: (reason) => {
        setListening(false);
        sessionRef.current = null;
        if (reason === 'permission') {
          toast.error(
            tFallback('voice.permission', 'Mic permission denied — enable it in your browser settings.')
          );
        } else if (reason === 'aborted') {
          // User cancelled; no toast.
        } else if (reason === 'unsupported') {
          toast.error(
            tFallback('voice.unsupported', "Voice input isn't supported on this device.")
          );
        } else {
          toast.error(
            tFallback('voice.failed', "Couldn't hear that — try again.")
          );
        }
      },
    });
  };

  return (
    <button
      type="button"
      onClick={startListening}
      className={[
        'shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors',
        listening
          ? 'bg-rose-500/15 text-rose-500'
          : 'bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground',
        className,
      ].join(' ')}
      aria-label={listening
        ? tFallback('voice.cancel', 'Stop listening')
        : tFallback('voice.dictate', 'Dictate a set ("100 by 5")')
      }
      aria-pressed={listening}
    >
      {listening ? (
        <motion.span
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        >
          <MicOff className="w-4 h-4" aria-hidden="true" />
        </motion.span>
      ) : (
        <Mic className="w-4 h-4" aria-hidden="true" />
      )}
    </button>
  );
}
