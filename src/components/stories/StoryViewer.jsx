// src/components/stories/StoryViewer.jsx
//
// Full-screen story viewer rendered via React portal so it sits above
// every other layer, including the Header's stacking context.
//
// Navigation:
//   Tap the left  ~35% → previous story (or previous person's last story)
//   Tap the right ~35% → next story (or next person's first story → close)
//   X button           → close
//
// Each story auto-advances after STORY_DURATION_MS (5 seconds).
// A thin progress bar at the top animates from 0→100% then triggers advance.
//
// Own stories show a delete button (bottom-right).

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import * as storiesData from '@/lib/data/stories';

const STORY_DURATION_MS = 5000;

export default function StoryViewer({
  open,
  groups,        // StoryGroup[] — only groups with stories (pre-filtered by caller)
  startIndex,    // which group to open first
  viewedIds,     // Set<storyId> — already-seen IDs at open time
  userId,
  onClose,
  onStoriesChange, // called after delete so the row refetches
}) {
  const [groupIdx, setGroupIdx]   = useState(0);
  const [storyIdx, setStoryIdx]   = useState(0);
  const timerRef                  = useRef(null);
  // Tick counter forces progress bar to remount (restart animation) on advance
  const [tick, setTick]           = useState(0);

  // ── sync to startIndex whenever the viewer opens ────────────────────────────
  useEffect(() => {
    if (open) {
      setGroupIdx(Math.max(0, Math.min(startIndex, groups.length - 1)));
      setStoryIdx(0);
      setTick(t => t + 1);
    }
  }, [open, startIndex]);

  const currentGroup = groups[groupIdx];
  const currentStory = currentGroup?.stories[storyIdx];

  // ── mark viewed ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !currentStory || !userId) return;
    if (!viewedIds.has(currentStory.id)) {
      storiesData.markStoryViewed(currentStory.id, userId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentStory?.id, userId]);

  // ── navigation helpers ──────────────────────────────────────────────────────
  const goNext = useCallback(() => {
    const group = groups[groupIdx];
    if (!group) return;
    if (storyIdx < group.stories.length - 1) {
      setStoryIdx(i => i + 1);
      setTick(t => t + 1);
    } else {
      // Advance to next group
      const nextGroupIdx = groups.findIndex((g, i) => i > groupIdx);
      if (nextGroupIdx >= 0) {
        setGroupIdx(nextGroupIdx);
        setStoryIdx(0);
        setTick(t => t + 1);
      } else {
        onClose();
      }
    }
  }, [groupIdx, storyIdx, groups, onClose]);

  const goBack = useCallback(() => {
    if (storyIdx > 0) {
      setStoryIdx(i => i - 1);
      setTick(t => t + 1);
      return;
    }
    // Back to previous group's last story
    let prevGroupIdx = -1;
    for (let i = groupIdx - 1; i >= 0; i--) {
      prevGroupIdx = i;
      break;
    }
    if (prevGroupIdx >= 0) {
      const prevGroup = groups[prevGroupIdx];
      setGroupIdx(prevGroupIdx);
      setStoryIdx(Math.max(0, prevGroup.stories.length - 1));
      setTick(t => t + 1);
    }
    // At the very first story — do nothing (stays at start)
  }, [groupIdx, storyIdx, groups]);

  // ── auto-advance timer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !currentStory) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(goNext, STORY_DURATION_MS);
    return () => clearTimeout(timerRef.current);
  }, [open, tick, goNext]); // `tick` resets on every navigation

  // ── delete own story ────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!currentStory) return;
    const { ok } = await storiesData.deleteStory(currentStory.id);
    if (!ok) { toast.error('Could not delete story.'); return; }
    onStoriesChange();
    // If more stories remain for this user, stay in viewer
    if (currentGroup.stories.length > 1) {
      const newIdx = storyIdx > 0 ? storyIdx - 1 : 0;
      setStoryIdx(newIdx);
      setTick(t => t + 1);
    } else {
      onClose();
    }
  };

  const timeAgo = (() => {
    try {
      return currentStory
        ? formatDistanceToNow(new Date(currentStory.created_at), { addSuffix: true })
        : '';
    } catch { return ''; }
  })();

  // ── render ──────────────────────────────────────────────────────────────────
  if (!currentGroup || !currentStory) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="story-viewer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[10000] bg-black flex flex-col select-none"
        >
          {/* ── Story image ─────────────────────────────────────────── */}
          <div className="relative flex-1 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={currentStory.id}
                src={currentStory.image_url}
                alt=""
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 w-full h-full object-cover"
                draggable={false}
              />
            </AnimatePresence>

            {/* Top gradient overlay so bars + user info are always legible */}
            <div
              className="absolute top-0 left-0 right-0 h-36 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%)' }}
            />

            {/* ── Progress bars ──────────────────────────────────────── */}
            <div
              className="absolute top-0 left-0 right-0 flex gap-1 px-3"
              style={{ paddingTop: 'max(14px, env(safe-area-inset-top))' }}
            >
              {currentGroup.stories.map((s, i) => (
                <div key={s.id} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
                  {i < storyIdx ? (
                    // Already seen within this session → full
                    <div className="h-full w-full bg-white" />
                  ) : i === storyIdx ? (
                    // Active → animate from 0 → 100%
                    <motion.div
                      key={`bar-${tick}`}
                      className="h-full bg-white origin-left"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: STORY_DURATION_MS / 1000, ease: 'linear' }}
                    />
                  ) : null /* future → stays empty/transparent */}
                </div>
              ))}
            </div>

            {/* ── User info row ──────────────────────────────────────── */}
            <div className="absolute left-0 right-0 flex items-center justify-between px-3 mt-2"
              style={{ top: 'max(30px, calc(env(safe-area-inset-top) + 16px))' }}
            >
              <div className="flex items-center gap-2">
                {/* Avatar thumbnail */}
                <div className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-white/40 shrink-0">
                  {currentGroup.avatarUrl ? (
                    <img
                      src={currentGroup.avatarUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full bg-white/20 flex items-center justify-center text-[10px] font-bold text-white">
                      {currentGroup.username.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-white font-semibold text-sm leading-tight drop-shadow-md">
                    {currentGroup.isOwn ? 'Your Story' : currentGroup.username}
                  </p>
                  <p className="text-white/70 text-[10px] leading-tight">{timeAgo}</p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center text-white"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── Bottom gradient + delete button ────────────────────── */}
            <div
              className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.40) 0%, transparent 100%)' }}
            />
            {currentGroup.isOwn && (
              <button
                onClick={handleDelete}
                className="absolute bottom-8 right-4 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white"
                aria-label="Delete story"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}

            {/* ── Invisible tap zones ────────────────────────────────── */}
            {/* Left zone: go back */}
            <div
              className="absolute left-0 top-0 bottom-0 w-[35%] cursor-pointer"
              onClick={goBack}
              aria-label="Previous story"
            />
            {/* Right zone: go forward */}
            <div
              className="absolute right-0 top-0 bottom-0 w-[35%] cursor-pointer"
              onClick={goNext}
              aria-label="Next story"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
