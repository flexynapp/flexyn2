// src/components/workout/GroupBlock.jsx
//
// Renders a superset or circuit block during a live session.
// All exercises in the group are shown stacked; the active one is highlighted.
// Intra-rest fires between exercises; inter-rest fires between full rounds.
//
// Props:
//   groupId        — UUID string identifying this group
//   groupMeta      — { type, intra_rest_seconds, inter_rest_seconds, round_count }
//   exercises      — array of exercise objects that belong to this group
//   onChange(i, ex)— called when exercise at index i is updated
//   userProfile    — passed through to ExerciseLogger

import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Zap, RotateCcw } from 'lucide-react';
import ExerciseLogger from './ExerciseLogger';
import { useRestTimer } from '@/lib/RestTimerContext';

const TYPE_LABEL = { superset: 'Superset', circuit: 'Circuit' };
// The left border here is STRUCTURAL, not decoration — it brackets the
// exercises that belong to one group, the way an editor gutter marks a
// block. It stays. What changed is that it used to be violet / emerald
// while TYPE_BADGE two lines down was already primary / success, so the
// stripe and the badge labelling the same group disagreed about its
// colour. (Contrast HubPostCard, where an eleven-hue border-l-4 was pure
// decoration restating what the card's own content said, and is gone.)
const TYPE_COLOR  = {
  superset: 'border-l-primary bg-primary/5',
  circuit:  'border-l-success bg-success/5',
};
const TYPE_BADGE  = {
  superset: 'text-primary bg-primary/10 border-primary/25',
  circuit:  'text-success bg-success/10 border-success/25',
};

export default function GroupBlock({ groupId, groupMeta = {}, exercises = [], onChange, userProfile = {} }) {
  const {
    type            = 'superset',
    intra_rest_seconds = 15,
    inter_rest_seconds = 90,
    round_count     = 3,
  } = groupMeta;

  const [activeIdx,    setActiveIdx]    = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [roundsDone,   setRoundsDone]   = useState(false);

  const { start: startRestTimer } = useRestTimer();

  // Called by the "Complete Set → Next" flow when the user finishes a set
  // and wants to advance to the next exercise (intra-rest fires).
  const handleAdvance = useCallback(() => {
    const isLastInGroup = activeIdx >= exercises.length - 1;

    if (!isLastInGroup) {
      // Move to next exercise after intra-rest
      startRestTimer(intra_rest_seconds);
      setActiveIdx(i => i + 1);
    } else {
      // End of this round
      if (currentRound < round_count) {
        startRestTimer(inter_rest_seconds);
        setCurrentRound(r => r + 1);
        setActiveIdx(0);
      } else {
        setRoundsDone(true);
      }
    }
  }, [activeIdx, exercises.length, currentRound, round_count, intra_rest_seconds, inter_rest_seconds, startRestTimer]);

  return (
    <div className={`rounded-xl border-s-4 border border-border overflow-hidden mb-3 ${TYPE_COLOR[type] || TYPE_COLOR.superset}`}>
      {/* Group header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className={`text-micro font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${TYPE_BADGE[type] || TYPE_BADGE.superset}`}>
            {TYPE_LABEL[type] || type}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <RotateCcw className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {roundsDone ? `${round_count}/${round_count} rounds` : `Round ${currentRound} of ${round_count}`}
          </span>
        </div>
      </div>

      {/* Rest timing info */}
      <div className="flex items-center gap-3 px-3 py-1.5 text-micro text-muted-foreground border-b border-border/40">
        <span>Intra: {intra_rest_seconds}s</span>
        <span>·</span>
        <span>Inter: {inter_rest_seconds}s</span>
      </div>

      {/* Exercises */}
      <div className="divide-y divide-border/40">
        {exercises.map((exercise, i) => {
          const isActive  = !roundsDone && i === activeIdx;
          const isPast    = roundsDone || i < activeIdx || (i === activeIdx && roundsDone);

          return (
            <motion.div
              key={`${groupId}-${i}`}
              animate={{ opacity: isActive ? 1 : 0.55 }}
              transition={{ duration: 0.2 }}
              className={`relative ${isActive ? 'bg-background/80' : 'bg-transparent'}`}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute start-0 top-0 bottom-0 w-0.5 bg-primary rounded-full" />
              )}

              <div className={isActive ? 'ps-2' : ''}>
                <ExerciseLogger
                  exercise={exercise}
                  onChange={updated => onChange(i, updated)}
                  userProfile={userProfile}
                />
              </div>

              {/* Advance button — only on active exercise, not last-of-last-round */}
              {isActive && !roundsDone && (
                <div className="px-4 pb-3">
                  <button
                    onClick={handleAdvance}
                    className="w-full text-xs font-semibold py-2 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 active:bg-primary/10 transition-colors"
                  >
                    {i < exercises.length - 1
                      ? `Rest ${intra_rest_seconds}s → ${exercises[i + 1]?.name || 'Next'}`
                      : currentRound < round_count
                        ? `Rest ${inter_rest_seconds}s → Round ${currentRound + 1}`
                        : 'Complete group'}
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {roundsDone && (
        <div className="px-3 py-2 text-xs font-semibold text-center text-success border-t border-border/40">
          Group complete ✓
        </div>
      )}
    </div>
  );
}
