// src/components/formcoach/FormCoachModal.jsx
//
// Real Form Coach. Wires the four formcoach sub-components into a usable
// flow backed by TensorFlow.js MoveNet pose detection. The analyzer lives
// at src/lib/formCoach/analyzeForm.js — see that file for how the rule-based
// per-exercise checks work.

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import CameraView from './CameraView';
import ExercisePicker from './ExercisePicker';
import DemoSection from './DemoSection';
import FeedbackPanel from './FeedbackPanel';
import { useLanguage } from '@/lib/LanguageContext';
import { analyzeForm, prewarmDetector } from '@/lib/formCoach/analyzeForm';

export default function FormCoachModal({ open, onClose }) {
  const { t } = useLanguage();
  const [exercise, setExercise] = useState('');
  const [exerciseDisplay, setExerciseDisplay] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState('Analyzing your form…');

  // Pre-warm the model in the background as soon as the modal opens, so the
  // user's first capture isn't blocked on the 3 MB model download.
  useEffect(() => {
    if (open) prewarmDetector();
  }, [open]);

  const handleCapture = async (imageDataUrl) => {
    if (!exercise) return;
    setAnalyzing(true);
    setFeedback(null);
    setLoadingMessage('Analyzing your form…');

    // After 2.5s, switch the loading message — first-call model load can take
    // 3-6s on slow devices, and silence makes it feel broken.
    const slowMessageTimer = setTimeout(() => {
      setLoadingMessage('Loading the AI model (one-time, ~3 MB)…');
    }, 2500);

    try {
      const result = await analyzeForm(imageDataUrl, exerciseDisplay || exercise);
      setFeedback(result);
    } catch (err) {
      console.error('[FormCoach] analysis failed:', err);
      setFeedback({
        overall_score: 0,
        form_rating: 'Analysis failed',
        good_points: [],
        corrections: ['Something went wrong analyzing the frame. Try capturing again.'],
        injury_risks: [],
        tip: 'If this keeps happening, refresh the page to reset the AI model.',
      });
    } finally {
      clearTimeout(slowMessageTimer);
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setFeedback(null);
    setAnalyzing(false);
  };

  // Reset state when the modal closes so the next open is a clean slate
  useEffect(() => {
    if (!open) {
      setFeedback(null);
      setAnalyzing(false);
      // Keep the exercise selection — most users want to analyze the same lift
    }
  }, [open]);

  const isPartial = feedback?._poseQuality === 'partial';
  const noBody    = feedback?._poseQuality === 'no_body';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        <div className="p-5 sm:p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2">
              {t('formcoach.title') !== 'formcoach.title' ? t('formcoach.title') : 'Form Coach'}
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-primary/15 text-primary">
                Beta
              </span>
            </DialogTitle>
          </DialogHeader>

          {!feedback && !analyzing && (
            <>
              <DemoSection />
              <ExercisePicker
                value={exercise}
                onChange={setExercise}
                onDisplayChange={setExerciseDisplay}
              />
              <CameraView
                onCapture={handleCapture}
                isAnalyzing={analyzing}
                exerciseSelected={!!exercise}
              />
            </>
          )}

          {analyzing && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
              <p className="font-heading font-semibold">{loadingMessage}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Detecting body posture and joint angles.
              </p>
            </div>
          )}

          <AnimatePresence>
            {feedback && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {/* Beta disclosure — the analysis is real but rule-based on a single frame */}
                <div className="mb-4 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs">
                  <p className="text-foreground/80 leading-relaxed">
                    <span className="font-bold text-primary">How this works:</span>{' '}
                    Your photo is analyzed locally on this device using AI pose detection
                    (MoveNet). No images are sent to any server. Feedback is based on joint
                    angles and posture from a single frame — for the most accurate read,
                    capture mid-rep at the bottom (or top, for pull-ups).
                  </p>
                </div>

                {/* Pose quality warning */}
                {isPartial && (
                  <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs">
                    <p className="font-bold text-yellow-700 dark:text-yellow-400 mb-1">
                      Partial detection
                    </p>
                    <p className="text-yellow-700/80 dark:text-yellow-400/80">
                      Some joints weren't fully visible. Results below are best-effort —
                      try better lighting or a clearer angle for a more confident read.
                    </p>
                  </div>
                )}

                {!noBody && (
                  <FeedbackPanel feedback={feedback} exercise={exerciseDisplay || exercise} />
                )}

                {noBody && (
                  <div className="rounded-xl bg-muted p-5">
                    <p className="font-heading font-bold mb-2">{feedback.form_rating}</p>
                    <ul className="text-sm text-muted-foreground space-y-1.5">
                      {feedback.corrections.map((c, i) => (
                        <li key={i} className="flex gap-2">
                          <span>→</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                    {feedback.tip && (
                      <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                        <span className="font-semibold">Tip:</span> {feedback.tip}
                      </p>
                    )}
                  </div>
                )}

                <button
                  onClick={reset}
                  className="mt-4 w-full py-2 rounded-md bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity"
                >
                  Analyze another rep
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
