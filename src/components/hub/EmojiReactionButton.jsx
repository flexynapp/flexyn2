// src/components/hub/EmojiReactionButton.jsx
//
// Compact emoji-reaction control next to the like/dislike buttons.
// Mirrors the Strava-kudos pattern but uses emoji. Two interactions:
//   • Tap          → toggle the default 🔥 reaction (set if none,
//                    clear if already 🔥, swap if a different emoji)
//   • Long-press   → open a small popover with the 6 quick emojis
//
// State is optimistic — the displayed emoji + count flip immediately,
// then we reconcile with the server. On RPC failure we revert.

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { setEmojiReaction } from '@/lib/data/hubReactions';
import { useLongPress } from '@/hooks/useLongPress';
import { triggerHaptic } from '@/lib/haptic';

const QUICK_EMOJIS = ['🔥', '💪', '👏', '🚀', '🎯', '🙌'];
const DEFAULT_EMOJI = '🔥';

export default function EmojiReactionButton({
  postId,
  initialEmoji = null,
  initialCount = 0,
  onCountChange,
}) {
  const [myEmoji, setMyEmoji] = useState(initialEmoji);
  const [count, setCount] = useState(initialCount);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inFlightRef = useRef(false);
  const rootRef = useRef(null);

  // Close the picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [pickerOpen]);

  const applyReaction = async (nextEmoji) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const prevEmoji = myEmoji;
    const prevCount = count;
    // Optimistic update: count goes up only when transitioning from
    // "no emoji" → "emoji", down when "emoji" → "no emoji". Swapping
    // between two emojis doesn't change the count.
    const delta = (prevEmoji ? 0 : 1) - (nextEmoji ? 0 : 1);
    setMyEmoji(nextEmoji);
    setCount(c => Math.max(0, c + delta));
    onCountChange?.(Math.max(0, prevCount + delta));
    triggerHaptic?.('light');
    try {
      const serverCount = await setEmojiReaction(postId, nextEmoji);
      if (serverCount != null) {
        setCount(serverCount);
        onCountChange?.(serverCount);
      } else {
        // Pre-126 host (RPC missing) — revert silently. UI still
        // showed the optimistic state briefly; flipping it back is
        // the least-jarring failure mode.
        setMyEmoji(prevEmoji);
        setCount(prevCount);
        onCountChange?.(prevCount);
      }
    } catch {
      setMyEmoji(prevEmoji);
      setCount(prevCount);
      onCountChange?.(prevCount);
    } finally {
      inFlightRef.current = false;
    }
  };

  const handleTap = () => {
    if (pickerOpen) { setPickerOpen(false); return; }
    // Cycle: none → 🔥, 🔥 → none, other → 🔥
    const next = myEmoji === DEFAULT_EMOJI ? null : DEFAULT_EMOJI;
    applyReaction(next);
  };

  const longPress = useLongPress(() => setPickerOpen(true), { ms: 350 });

  const handlePick = (emoji) => {
    setPickerOpen(false);
    const next = myEmoji === emoji ? null : emoji;
    applyReaction(next);
  };

  const isActive = !!myEmoji;
  const displayEmoji = myEmoji || DEFAULT_EMOJI;

  return (
    <div ref={rootRef} className="relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        {...longPress.bind}
        onClick={(e) => { if (longPress.consumeClick(e)) handleTap(); }}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
          isActive
            ? 'text-orange-500 bg-orange-500/10'
            : 'text-muted-foreground hover:bg-secondary'
        }`}
        aria-label={isActive ? 'Remove reaction' : 'React'}
      >
        <span
          className={`text-base leading-none ${isActive ? '' : 'opacity-70 grayscale'}`}
          aria-hidden="true"
        >
          {displayEmoji}
        </span>
        {count > 0 && <span>{count}</span>}
      </motion.button>

      <AnimatePresence>
        {pickerOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-0 mb-2 z-30 flex items-center gap-1 px-2 py-1.5 rounded-full bg-card border border-border shadow-xl"
          >
            {QUICK_EMOJIS.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => handlePick(e)}
                className={`w-8 h-8 flex items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-secondary/60 ${
                  myEmoji === e ? 'bg-secondary' : ''
                }`}
                aria-label={`React with ${e}`}
              >
                {e}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
