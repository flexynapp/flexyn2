// src/components/stories/StoryReactionPicker.jsx
//
// Compact emoji reaction picker shown alongside the heart + reply
// row in StoryViewer. Backed by migration 097's story_reactions
// table + reactToStory wrapper. Tapping an emoji upserts the
// reaction (one per story per user — re-tapping the same emoji
// removes; tapping a different one swaps).

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ALLOWED_EMOJIS, reactToStory, getMyReactionForStory } from '@/lib/data/storyReactions';

export default function StoryReactionPicker({ storyId, onReacted }) {
  const [mine, setMine] = useState(null);
  const [busy, setBusy] = useState(null); // the emoji currently being submitted

  // Pull the current user's reaction (if any) when the story changes
  // so the picker shows their active selection highlighted.
  useEffect(() => {
    let cancelled = false;
    if (!storyId) {
      setMine(null);
      return undefined;
    }
    getMyReactionForStory(storyId).then((emoji) => {
      if (!cancelled) setMine(emoji);
    }).catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, [storyId]);

  const handleTap = async (emoji) => {
    if (!storyId || busy) return;
    setBusy(emoji);
    // Same-emoji-tap removes the reaction; different-emoji swaps.
    const next = mine === emoji ? null : emoji;
    setMine(next); // optimistic
    const res = await reactToStory(storyId, next);
    setBusy(null);
    if (!res?.ok) {
      // Revert on failure.
      setMine(mine);
    } else {
      onReacted?.(next);
    }
  };

  if (!storyId) return null;

  return (
    <div className="flex items-center gap-1 px-1" onClick={(e) => e.stopPropagation()}>
      {ALLOWED_EMOJIS.map((emoji) => {
        const isActive = mine === emoji;
        return (
          <motion.button
            key={emoji}
            type="button"
            whileTap={{ scale: 0.85 }}
            onClick={() => handleTap(emoji)}
            className={[
              'w-9 h-9 rounded-full flex items-center justify-center text-lg transition-colors',
              isActive ? 'bg-white/30 scale-110' : 'bg-black/30 hover:bg-black/40',
              busy === emoji ? 'animate-pulse' : '',
            ].join(' ')}
            aria-pressed={isActive}
            aria-label={`React with ${emoji}`}
          >
            <span aria-hidden="true">{emoji}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
