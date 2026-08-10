// src/components/journal/MoodChip.jsx
//
// The day's mood as a 44pt chip, shared by the My Journal day screen and
// the dashboard journal widget so there is ONE control and one scale.
// A second scale would be a second answer to the same question.

import React, { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { MOOD_EMOJIS, MOOD_LABELS } from '@/lib/data/moodLogs';

// mood_score has been on journal_entries since migration 165 and shown
// nowhere on this screen — written by a tap on the dashboard's MoodLogCard
// and read by nothing here. It sits on the day now, dashed when unset.
//
// Tapping expands the SAME five steps MoodLogCard uses; a second scale would
// be a second answer to the same question.
export default function MoodChip({ score, editable, busy, onPick, tFallback }) {
  const [open, setOpen] = useState(false);
  const emoji = score ? MOOD_EMOJIS[score - 1] : null;

  if (open && editable) {
    return (
      <div className="flex items-center gap-1" data-no-swipe>
        {MOOD_EMOJIS.map((e, i) => (
          <button
            key={e}
            onClick={() => { setOpen(false); onPick(i + 1); }}
            aria-label={tFallback(`mood.label.${i + 1}`, MOOD_LABELS[i])}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-lg transition-colors ${
              score === i + 1 ? 'bg-secondary' : 'hover:bg-secondary active:bg-secondary'
            }`}
          >
            {e}
          </button>
        ))}
      </div>
    );
  }

  const label = score
    ? `${tFallback('journal.feltLabel', 'You felt')} ${tFallback(`mood.label.${score}`, MOOD_LABELS[score - 1])}`
    : tFallback('journal.setMood', 'Log a mood');

  return (
    <button
      onClick={() => editable && setOpen(true)}
      disabled={!editable && !score}
      aria-label={label}
      title={label}
      data-no-swipe
      className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-xl transition-colors ${
        emoji ? 'bg-secondary' : 'border border-dashed border-border text-muted-foreground'
      } ${editable ? 'active:opacity-70' : ''}`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (emoji || <Plus className="w-4 h-4" />)}
    </button>
  );
}
