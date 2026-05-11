import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/api/db';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Exercises that require multiple images to depict the full movement
const MOVEMENT_EXERCISES = new Set([
  'clean', 'snatch', 'jerk', 'clean and jerk', 'power clean', 'power snatch',
  'hang clean', 'hang snatch', 'hang power clean', 'hang power snatch',
  'block clean', 'block snatch', 'squat jerk', 'split jerk', 'power jerk',
  'turkish get-up', 'kettlebell turkish get-up', 'devils press',
  'thruster', 'kettlebell thrusters', 'ground to overhead',
  'muscle-up (bar)', 'muscle-up (rings)', 'banded muscle-up', 'jumping muscle-up',
  'deadlift', 'romanian deadlift', 'dumbbell romanian deadlift', 'single leg romanian deadlift',
  'squat', 'front squat', 'back squat', 'goblet squat', 'bulgarian split squat',
  'barbell hack squat', 'zercher squat', 'safety bar squat', 'box squat',
  'lunge', 'barbell lunge', 'dumbbell lunge', 'reverse barbell lunge', 'walking lunge',
  'barbell walking lunge', 'dumbbell walking lunge', 'jumping lunge', 'curtsy lunge',
  'hip thrust', 'glute bridge', 'one-legged hip thrust', 'one-legged glute bridge',
  'pull-up', 'chin-up', 'assisted pull-up', 'assisted chin-up', 'ring pull-up',
  'push-up', 'decline push-up', 'incline push-up', 'clap push-up', 'plank to push-up',
  'dip', 'bar dip', 'ring dip', 'bench dip',
  'bench press', 'incline bench press', 'decline bench press', 'dumbbell chest press',
  'overhead press', 'arnold press', 'push press',
  'barbell row', 'dumbbell row', 'cable close grip seated row', 'pendlay row',
  'kettlebell swing', 'one-handed kettlebell swing',
  'box jump', 'depth jump', 'jump squat', 'lateral bound',
  'farmers walk', 'renegade row',
  'bicycle crunch', 'mountain climbers', 'dead bug', 'hanging leg raise',
  'dragon flag', 'ab wheel roll-out', 'kneeling ab wheel roll-out',
  'good morning', 'stiff-legged deadlift', 'sumo deadlift', 'deficit deadlift',
  'pistol squat', 'nordic hamstring eccentric', 'glute ham raise',
]);

function isMovement(exerciseName) {
  return MOVEMENT_EXERCISES.has(exerciseName.toLowerCase());
}

function getImageCount(exerciseName) {
  const name = exerciseName.toLowerCase();
  if (['turkish get-up', 'clean and jerk', 'snatch', 'clean'].some(m => name.includes(m))) return 4;
  if (isMovement(exerciseName)) return 2;
  return 1;
}

function buildPrompts(exerciseName) {
  const count = getImageCount(exerciseName);
  if (count === 1) {
    return [
      `A clear, professional fitness illustration showing proper form for "${exerciseName}". Show a person in the correct position with perfect posture and alignment. Clean white background, anatomically accurate, instructional diagram style with key body alignment cues visible. Bold outlines, clear muscle engagement indicators.`
    ];
  }
  if (count === 2) {
    return [
      `Phase 1 of 2 — Starting position for "${exerciseName}" exercise. Show a person in the starting/setup position with correct form. White background, professional fitness illustration, bold instructional diagram style, anatomically accurate. Label it "Phase 1: Start".`,
      `Phase 2 of 2 — Finishing position for "${exerciseName}" exercise. Show a person at the top/end position with correct form. White background, professional fitness illustration, bold instructional diagram style, anatomically accurate. Label it "Phase 2: Finish".`
    ];
  }
  // 4 phases
  return [
    `Phase 1 of 4 — Setup for "${exerciseName}". Show the starting position with correct form. White background, professional fitness illustration, bold instructional diagram style. Label it "Phase 1: Setup".`,
    `Phase 2 of 4 — Initiation for "${exerciseName}". Show the first movement phase. White background, professional fitness illustration, bold instructional diagram style. Label it "Phase 2: Initiation".`,
    `Phase 3 of 4 — Power phase for "${exerciseName}". Show the explosive/power portion. White background, professional fitness illustration, bold instructional diagram style. Label it "Phase 3: Power".`,
    `Phase 4 of 4 — Catch/finish for "${exerciseName}". Show the final catch or lockout position. White background, professional fitness illustration, bold instructional diagram style. Label it "Phase 4: Finish".`,
  ];
}

export default function ExerciseFormModal({ exerciseName, open, onClose }) {
  const [imageUrls, setImageUrls] = useState([]);
  const [tips, setTips] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cachedId, setCachedId] = useState(null);

  const loadOrGenerate = async () => {
    setLoading(true);
    setError(null);
    setImageUrls([]);
    setTips(null);
    setCurrentIndex(0);

    try {
      // Always check cache first — only use if it has valid images
      // Filter by `exercise` (canonical column) OR `exercise_name` (legacy alias added in migration 004)
      const cached = await db.entities.ExerciseForm.filter({ exercise: exerciseName });
      const validCache = cached?.find(c => c.image_urls?.length > 0);
      if (validCache) {
        setImageUrls(validCache.image_urls);
        setTips(validCache.tips || []);
        setCachedId(validCache.id);
        setLoading(false);
        return;
      }

      // Generate once and save permanently
      const prompts = buildPrompts(exerciseName);
      const [tipsRes, ...imageResults] = await Promise.all([
        db.integrations.Core.InvokeLLM({
          prompt: `Give 3 concise form tips for performing the "${exerciseName}" exercise correctly. Each tip should be one short sentence. Return as JSON.`,
          response_json_schema: {
            type: 'object',
            properties: {
              tips: { type: 'array', items: { type: 'string' } },
            },
          },
        }),
        ...prompts.map(prompt =>
          db.integrations.Core.GenerateImage({ prompt })
        ),
      ]);

      const urls = imageResults.map(r => r.url);
      const newTips = tipsRes.tips || [];

      // Update existing stale record or create new
      if (cached?.length > 0) {
        await db.entities.ExerciseForm.update(cached[0].id, {
          image_urls: urls,
          tips: newTips,
          is_movement: isMovement(exerciseName),
        });
        setCachedId(cached[0].id);
      } else {
        const created = await db.entities.ExerciseForm.create({
          exercise: exerciseName,       // canonical column
          exercise_name: exerciseName,  // alias column (migration 004)
          image_urls: urls,
          tips: newTips,
          is_movement: isMovement(exerciseName),
        });
        setCachedId(created.id);
      }
      setImageUrls(urls);
      setTips(newTips);
    } catch (err) {
      setError(err?.message || 'Failed to load form guide. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && exerciseName) {
      loadOrGenerate();
    } else if (!open) {
      // Reset state when closed so reopening the same exercise re-triggers load
      setImageUrls([]);
      setTips(null);
      setError(null);
      setLoading(true);
      setCurrentIndex(0);
    }
  }, [open, exerciseName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenChange = (isOpen) => {
    if (!isOpen) onClose();
  };

  const multiImage = imageUrls.length > 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg">{exerciseName} — Form Guide</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {loading || (!error && imageUrls.length === 0) ? (
            <div className="space-y-3">
              <Skeleton className="w-full h-64 rounded-xl" />
              <Skeleton className="w-3/4 h-4 rounded" />
              <Skeleton className="w-2/3 h-4 rounded" />
              <Skeleton className="w-4/5 h-4 rounded" />
            </div>
          ) : error ? (
            <div className="space-y-3 text-center py-6">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => loadOrGenerate()}>
                Try Again
              </Button>
            </div>
          ) : (
            <>
              {imageUrls.length > 0 && (
                <div className="relative">
                  <img
                    src={imageUrls[currentIndex]}
                    alt={`${exerciseName} form phase ${currentIndex + 1}`}
                    className="w-full rounded-xl object-cover border border-border"
                  />
                  {multiImage && (
                    <>
                      <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
                        {imageUrls.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setCurrentIndex(i)}
                            className={`w-2 h-2 rounded-full transition-colors ${i === currentIndex ? 'bg-primary' : 'bg-white/70'}`}
                          />
                        ))}
                      </div>
                      {currentIndex > 0 && (
                        <button
                          onClick={() => setCurrentIndex(idx => idx - 1)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1 transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                      )}
                      {currentIndex < imageUrls.length - 1 && (
                        <button
                          onClick={() => setCurrentIndex(idx => idx + 1)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1 transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {multiImage && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {imageUrls.map((url, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentIndex(i)}
                      className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors ${i === currentIndex ? 'border-primary' : 'border-transparent'}`}
                    >
                      <img src={url} alt={`Phase ${i + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {tips && tips.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Form Tips</p>
                  <ul className="space-y-1.5">
                    {tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}


            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}