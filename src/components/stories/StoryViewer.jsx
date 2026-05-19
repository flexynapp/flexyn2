// src/components/stories/StoryViewer.jsx
//
// Full-screen story viewer — rendered via React portal above all layers.
//
// Navigation
//   Tap left 35%   → previous story / person
//   Tap right 35%  → next story / person → close when at end
//   X button       → close
//
// Per-story duration: 8 seconds (STORY_DURATION_MS).
// Images use object-contain so nothing is cropped regardless of aspect ratio.
//
// Own stories
//   "+" button (top-right area)  → onAddStory() — opens file picker in row
//   🗑 button (bottom-right)     → delete story
//   "👁 X seen" bar (bottom)     → tap or swipe-up → InsightsPanel
//
// Other people's stories
//   ❤️ button (bottom-left)      → like / unlike; filled when already liked

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Heart, Plus, Eye, Camera } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as storiesData from '@/lib/data/stories';

const STORY_DURATION_MS = 8000;

// ── Insights panel ────────────────────────────────────────────────────────────
// Slides up from the bottom when the owner taps "👁 X seen".
// Shows likers first (❤️), then viewers (👁).

function MiniAvatar({ profile }) {
  const initials = (profile?.username || '?').slice(0, 2).toUpperCase();
  return profile?.avatar_url ? (
    <img
      src={profile.avatar_url}
      alt={profile.username}
      className="w-9 h-9 rounded-full object-cover shrink-0"
      draggable={false}
    />
  ) : (
    <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
      {initials}
    </div>
  );
}

function InsightsPanel({ storyId, onClose }) {
  const { data: insights, isLoading } = useQuery({
    queryKey: ['storyInsights', storyId],
    queryFn:  () => storiesData.getStoryInsights(storyId),
    enabled:  !!storyId,
    staleTime: 15_000,
  });

  const viewers = insights?.viewers ?? [];
  const likers  = insights?.likers  ?? [];

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.05, bottom: 0.3 }}
      onDragEnd={(_, info) => { if (info.offset.y > 70) onClose(); }}
      onClick={e => e.stopPropagation()}
      className="absolute bottom-0 left-0 right-0 bg-card rounded-t-3xl z-20 max-h-[72vh] flex flex-col"
      style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
    >
      {/* Drag handle */}
      <div className="flex justify-center pt-3 pb-1 shrink-0">
        <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
      </div>

      <div className="flex items-center justify-between px-5 py-3 shrink-0">
        <h3 className="font-heading font-bold text-base">Story Insights</h3>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-y-auto px-5 pb-2">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Likers */}
            {likers.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Heart className="w-3.5 h-3.5 fill-red-500 text-red-500" />
                  Likes · {likers.length}
                </p>
                <div className="space-y-3">
                  {likers.map(l => (
                    <div key={l.liker_id} className="flex items-center gap-3">
                      <MiniAvatar profile={l.profile} />
                      <span className="font-medium text-sm">
                        {l.profile?.username || l.liker_email?.split('@')[0] || 'Someone'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Viewers */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" />
                Views · {viewers.length}
              </p>
              {viewers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No views yet.</p>
              ) : (
                <div className="space-y-3">
                  {viewers.map(v => (
                    <div key={v.viewer_id} className="flex items-center gap-3">
                      <MiniAvatar profile={v.profile} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {v.profile?.username || 'Someone'}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {(() => { try { return formatDistanceToNow(new Date(v.viewed_at), { addSuffix: true }); } catch { return ''; } })()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ── Main viewer ───────────────────────────────────────────────────────────────

export default function StoryViewer({
  open,
  groups,           // StoryGroup[] — only groups that have at least one story
  startIndex,
  viewedIds,        // Set<storyId> at open time
  likedIds,         // Set<storyId> the current user has already liked
  user,             // full auth user object  {id, email}
  onClose,
  onStoriesChange,  // called after delete → invalidates feed query
  onAddStory,       // called when "+" tapped inside viewer → opens file picker
}) {
  const queryClient = useQueryClient();

  const [groupIdx, setGroupIdx]     = useState(0);
  const [storyIdx, setStoryIdx]     = useState(0);
  const [tick, setTick]             = useState(0);
  const [insightsOpen, setInsightsOpen] = useState(false);
  // Local liked state — seeded from prop, updated optimistically
  const [localLiked, setLocalLiked] = useState(new Set());
  const timerRef = useRef(null);

  // ── sync state on open ────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setGroupIdx(Math.max(0, Math.min(startIndex, groups.length - 1)));
      setStoryIdx(0);
      setTick(t => t + 1);
      setInsightsOpen(false);
      setLocalLiked(new Set(likedIds));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startIndex]);

  const currentGroup = groups[groupIdx];
  const currentStory = currentGroup?.stories[storyIdx];

  // ── mark viewed ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !currentStory || !user?.id) return;
    if (!viewedIds.has(currentStory.id)) {
      storiesData.markStoryViewed(currentStory.id, user.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentStory?.id, user?.id]);

  // ── navigation ────────────────────────────────────────────────────────────
  const goNext = useCallback(() => {
    const group = groups[groupIdx];
    if (!group) return;
    setInsightsOpen(false);
    if (storyIdx < group.stories.length - 1) {
      setStoryIdx(i => i + 1);
      setTick(t => t + 1);
    } else {
      const next = groups.findIndex((_, i) => i > groupIdx);
      if (next >= 0) { setGroupIdx(next); setStoryIdx(0); setTick(t => t + 1); }
      else onClose();
    }
  }, [groupIdx, storyIdx, groups, onClose]);

  const goBack = useCallback(() => {
    setInsightsOpen(false);
    if (storyIdx > 0) {
      setStoryIdx(i => i - 1);
      setTick(t => t + 1);
      return;
    }
    let prev = -1;
    for (let i = groupIdx - 1; i >= 0; i--) { prev = i; break; }
    if (prev >= 0) {
      setGroupIdx(prev);
      setStoryIdx(Math.max(0, groups[prev].stories.length - 1));
      setTick(t => t + 1);
    }
  }, [groupIdx, storyIdx, groups]);

  // ── auto-advance (paused while insights open) ─────────────────────────────
  useEffect(() => {
    if (!open || !currentStory || insightsOpen) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(goNext, STORY_DURATION_MS);
    return () => clearTimeout(timerRef.current);
  }, [open, tick, insightsOpen, goNext]);

  // ── delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!currentStory) return;
    const { ok } = await storiesData.deleteStory(currentStory.id);
    if (!ok) { toast.error('Could not delete story.'); return; }
    onStoriesChange();
    if (currentGroup.stories.length > 1) {
      setStoryIdx(storyIdx > 0 ? storyIdx - 1 : 0);
      setTick(t => t + 1);
    } else {
      onClose();
    }
  };

  // ── like / unlike ─────────────────────────────────────────────────────────
  const handleLike = async (e) => {
    e.stopPropagation();
    if (!currentStory || !user) return;
    const already = localLiked.has(currentStory.id);
    // Optimistic
    setLocalLiked(prev => {
      const next = new Set(prev);
      already ? next.delete(currentStory.id) : next.add(currentStory.id);
      return next;
    });
    if (already) {
      await storiesData.unlikeStory(currentStory.id, user.id);
    } else {
      await storiesData.likeStory(currentStory.id, user);
    }
    queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
  };

  // ── insights bar tap ──────────────────────────────────────────────────────
  const handleInsightsTap = (e) => {
    e.stopPropagation();
    setInsightsOpen(v => !v);
  };

  const timeAgo = (() => {
    try { return currentStory ? formatDistanceToNow(new Date(currentStory.created_at), { addSuffix: true }) : ''; }
    catch { return ''; }
  })();

  if (!currentGroup || !currentStory) return null;

  const isLiked = localLiked.has(currentStory.id);

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
          {/* ── Image (object-contain preserves full photo, no cropping) ── */}
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
                className="absolute inset-0 w-full h-full object-contain"
                draggable={false}
              />
            </AnimatePresence>

            {/* Top gradient */}
            <div
              className="absolute top-0 left-0 right-0 h-36 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)' }}
            />

            {/* ── Progress bars ───────────────────────────────────────── */}
            <div
              className="absolute top-0 left-0 right-0 flex gap-1 px-3"
              style={{ paddingTop: 'max(14px, env(safe-area-inset-top))' }}
            >
              {currentGroup.stories.map((s, i) => (
                <div key={s.id} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
                  {i < storyIdx ? (
                    <div className="h-full w-full bg-white" />
                  ) : i === storyIdx ? (
                    <motion.div
                      key={`bar-${tick}`}
                      className="h-full bg-white origin-left"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: insightsOpen ? undefined : 1 }}
                      transition={{ duration: STORY_DURATION_MS / 1000, ease: 'linear' }}
                    />
                  ) : null}
                </div>
              ))}
            </div>

            {/* ── User info + controls row ────────────────────────────── */}
            <div
              className="absolute left-0 right-0 flex items-center justify-between px-3 mt-2"
              style={{ top: 'max(30px, calc(env(safe-area-inset-top) + 16px))' }}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-white/40 shrink-0">
                  {currentGroup.avatarUrl ? (
                    <img src={currentGroup.avatarUrl} alt="" className="w-full h-full object-cover" draggable={false} />
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

              <div className="flex items-center gap-2">
                {/* "+" add another story — only for own */}
                {currentGroup.isOwn && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onAddStory?.(); }}
                    className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center text-white"
                    aria-label="Add another story"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                )}
                {/* Close */}
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center text-white"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── Bottom gradient ──────────────────────────────────────── */}
            <div
              className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%)' }}
            />

            {/* ── Bottom action bar ────────────────────────────────────── */}
            <div
              className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-4"
              style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
            >
              {/* Like button — non-own stories only */}
              {!currentGroup.isOwn ? (
                <motion.button
                  whileTap={{ scale: 0.82 }}
                  onClick={handleLike}
                  className="w-11 h-11 rounded-full bg-black/40 flex items-center justify-center"
                  aria-label={isLiked ? 'Unlike' : 'Like'}
                >
                  <Heart
                    className={`w-5 h-5 transition-colors ${isLiked ? 'fill-red-500 text-red-500' : 'text-white'}`}
                  />
                </motion.button>
              ) : (
                /* Spacer so center / right stay aligned */
                <div className="w-11" />
              )}

              {/* Insights tap — own stories only */}
              {currentGroup.isOwn ? (
                <button
                  onClick={handleInsightsTap}
                  className="flex flex-col items-center gap-0.5 text-white/80"
                  aria-label="View insights"
                >
                  <Eye className="w-4 h-4" />
                  <span className="text-[10px] font-medium">View Insights</span>
                </button>
              ) : (
                <div />
              )}

              {/* Delete — own stories only */}
              {currentGroup.isOwn ? (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                  className="w-11 h-11 rounded-full bg-black/40 flex items-center justify-center text-white"
                  aria-label="Delete story"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              ) : (
                <div className="w-11" />
              )}
            </div>

            {/* ── Invisible tap zones (don't cover bottom 80px) ───────── */}
            <div
              className="absolute left-0 top-0 w-[35%] cursor-pointer"
              style={{ bottom: '80px' }}
              onClick={goBack}
              aria-label="Previous story"
            />
            <div
              className="absolute right-0 top-0 w-[35%] cursor-pointer"
              style={{ bottom: '80px' }}
              onClick={goNext}
              aria-label="Next story"
            />

            {/* ── Insights panel (slides up inside the viewer) ────────── */}
            <AnimatePresence>
              {insightsOpen && currentGroup.isOwn && (
                <InsightsPanel
                  storyId={currentStory.id}
                  onClose={() => setInsightsOpen(false)}
                />
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
