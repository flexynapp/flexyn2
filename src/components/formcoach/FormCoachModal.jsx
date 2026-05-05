// src/components/formcoach/FormCoachModal.jsx
//
// Wires the four orphaned formcoach components (CameraView, ExercisePicker,
// DemoSection, FeedbackPanel) into a usable Beta flow. Until an AI analysis
// backend is connected, analyzeForm returns mock feedback so the UI is fully
// navigable and demoable.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, X } from 'lucide-react';
import CameraView from './CameraView';
import ExercisePicker from './ExercisePicker';
import DemoSection from './DemoSection';
import FeedbackPanel from './FeedbackPanel';
import { useLanguage } from '@/lib/LanguageContext';

/**
 * MOCK form analyzer. Replace with a real call to the AI vision endpoint.
 *
 * Returns:
 *   {
 *     score: 0-10,
 *     scoreLabel: 'excellent' | 'good' | 'needswork' | 'poor',
 *     positives: string[],
 *     warnings: string[],
 *     tips: string[],
 *   }
 */
async function mockAnalyzeForm(_imageDataUrl, exerciseName) {
  // Simulate latency
  await new Promise((r) => setTimeout(r, 1500));
  return {
    score: 7,
    scoreLabel: 'good',
    exercise: exerciseName,
    positives: [
      'Good bar path — staying close to your body',
      'Solid setup position',
    ],
    warnings: [
      'Slight forward lean at the bottom — engage your core more',
    ],
    tips: [
      'Try filming from the side for the clearest feedback',
      'Lower lighting is making depth detection harder — try a brighter spot',
    ],
    isBeta: true,
  };
}

export default function FormCoachModal({ open, onClose }) {
  const { t } = useLanguage();
  const [exercise, setExercise] = useState('');
  const [exerciseDisplay, setExerciseDisplay] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleCapture = async (imageDataUrl) => {
    if (!exercise) return;
    setAnalyzing(true);
    setFeedback(null);
    try {
      const result = await mockAnalyzeForm(imageDataUrl, exerciseDisplay || exercise);
      setFeedback(result);
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setFeedback(null);
    setAnalyzing(false);
  };

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
              <p className="font-heading font-semibold">Analyzing your form…</p>
              <p className="text-xs text-muted-foreground mt-1">This usually takes a few seconds.</p>
            </div>
          )}

          <AnimatePresence>
            {feedback && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {feedback.isBeta && (
                  <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs">
                    <span className="font-bold text-yellow-700 dark:text-yellow-400">Beta:</span>{' '}
                    AI form analysis is in early testing. Feedback shown is a sample — real
                    coaching coming soon.
                  </div>
                )}
                <FeedbackPanel feedback={feedback} />
                <button
                  onClick={reset}
                  className="mt-4 w-full py-2 rounded-md bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                >
                  Try another rep
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
