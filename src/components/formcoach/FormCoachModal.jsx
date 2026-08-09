// src/components/formcoach/FormCoachModal.jsx
//
// Real Form Coach. Wires the four formcoach sub-components into a usable
// flow backed by TensorFlow.js MoveNet pose detection. The analyzer lives
// at src/lib/formCoach/analyzeForm.js — see that file for how the rule-based
// per-exercise checks work.

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import CameraView from './CameraView';
import ExercisePicker from './ExercisePicker';
import DemoSection from './DemoSection';
import FeedbackPanel from './FeedbackPanel';
import { useLanguage } from '@/lib/LanguageContext';
import { analyzeForm, prewarmDetector } from '@/lib/formCoach/analyzeForm';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// Plain framer-motion portal (NOT Radix). Same pattern as
// ProfanityWarningDialog/WorkoutGeneratorModal — sidesteps Radix's
// portal/focus-trap issues where the click handler fires but the dialog
// content never visibly appears.
export default function FormCoachModal({ open, onClose }) {
  const { t, tFallback } = useLanguage();
  const [exercise, setExercise] = useState('');
  const [exerciseDisplay, setExerciseDisplay] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Pre-warm the model in the background as soon as the modal opens, so the
  // user's first capture isn't blocked on the 3 MB model download.
  useEffect(() => {
    if (open) prewarmDetector();
  }, [open]);

  useBodyScrollLock(open);

  // Esc-to-close
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleCapture = async (imageDataUrl) => {
    if (!exercise) return;
    setAnalyzing(true);
    setFeedback(null);
    setLoadingMessage(t('formcoach.analyzingMessage'));

    // After 2.5s, switch the loading message — first-call model load can take
    // 3-6s on slow devices, and silence makes it feel broken.
    const slowMessageTimer = setTimeout(() => {
      setLoadingMessage(t('formcoach.modelLoadingMessage'));
    }, 2500);

    try {
      const result = await analyzeForm(imageDataUrl, exerciseDisplay || exercise);
      // Localize the no-body fallback messages from analyzeForm.js
      if (result?._poseQuality === 'no_body') {
        result.form_rating  = t('formcoach.noBodyDetected');
        result.corrections  = [t('formcoach.noBodyCorrection1'), t('formcoach.noBodyCorrection2')];
        result.tip          = t('formcoach.noBodyTip');
      }
      setFeedback(result);
    } catch (err) {
      console.error('[FormCoach] analysis failed:', err);
      setFeedback({
        overall_score: 0,
        form_rating: t('formcoach.analysisFailed'),
        good_points: [],
        corrections: [t('formcoach.analysisErrorCorrection')],
        injury_risks: [],
        tip: t('formcoach.analysisErrorTip'),
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
    <AnimatePresence>
      {open && (
        <motion.div
          key="formcoach-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
          >
            <button
              onClick={onClose}
              aria-label={tFallback('common.close', 'Close')}
              className="absolute top-3 end-3 z-10 p-1.5 rounded-md hover:bg-secondary active:bg-secondary transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-5 sm:p-6">
              <div className="mb-4 pe-8">
                <h2 className="font-heading font-bold text-lg flex items-center gap-2">
                  {t('formcoach.title')}
                  <span className="px-1.5 py-0.5 rounded-md text-micro font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/25">
                    Beta
                  </span>
                </h2>
              </div>

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
                {t('formcoach.detectingBody')}
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
                {/* Disclosure — explains the analysis is local & rule-based */}
                <div className="mb-4 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs">
                  <p className="text-foreground/80 leading-relaxed">
                    <span className="font-bold text-primary">{t('formcoach.howItWorksHeader')}</span>{' '}
                    {t('formcoach.betaDisclosure')}
                  </p>
                </div>

                {isPartial && (
                  <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs">
                    <p className="font-bold text-yellow-700 dark:text-yellow-400 mb-1">
                      {t('formcoach.partialDetectionTitle')}
                    </p>
                    <p className="text-yellow-700/80 dark:text-yellow-400/80">
                      {t('formcoach.partialDetectionMessage')}
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
                        {feedback.tip}
                      </p>
                    )}
                  </div>
                )}

                <button
                  onClick={reset}
                  className="mt-4 w-full py-2 rounded-md bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity"
                >
                  {t('formcoach.analyzeAnother')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
