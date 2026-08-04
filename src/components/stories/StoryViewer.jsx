// src/components/stories/StoryViewer.jsx
//
// Full-screen story viewer — rendered via React portal above all layers.
//
// Navigation
//   Tap left 35%   → previous story / person
//   Tap right 35%  → next story / person → close when at end
//   X button       → close
//
// Own stories
//   Camera + (top)          → onAddStory() — open file picker
//   👁 View Insights (bottom) → InsightsPanel (likers then viewers)
//   🗑 (bottom-right)        → delete with confirm prompt
//
// Non-own stories
//   ❤️ (bottom-left)         → like / unlike
//   Reply bar (bottom)       → sends a DM to the story owner
//                              (hidden if owner has story DMs disabled)
//
// All stories: ❤️ like button (own stories enabled for testing)

import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Heart, Eye, Send, Flag, MessageCircle, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from '@/lib/toast';
import StoryReactionPicker from './StoryReactionPicker';
import ReportDialog from '@/components/hub/ReportDialog';
import AddToHighlightModal from './AddToHighlightModal';
import * as storiesData from '@/lib/data/stories';
import { cdnImageUrl, cdnFallbackSrc } from '@/lib/imageCdn';
import StoryOverlayRenderer from './StoryOverlayRenderer';

const STORY_DURATION_MS = 8000;

const FONT_MAP = {
  normal:  "'Figtree', system-ui, sans-serif",
  serious: "Georgia, 'Times New Roman', serif",
  casual:  "'Comic Sans MS', 'Chalkboard SE', cursive",
};

// ── Overlay text display ──────────────────────────────────────────────────────

function StoryOverlayText({ style, containerRef }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (!ref.current || !containerRef?.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x    = (style.xFrac ?? 0) * rect.width;
    const y    = (style.yFrac ?? 0) * rect.height;
    ref.current.style.transform =
      `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${style.scale ?? 1}) rotate(${style.rotation ?? 0}deg)`;
  });

  return (
    <div
      ref={ref}
      className="absolute pointer-events-none"
      style={{
        left:       '50%',
        top:        '50%',
        transform:  'translate(-50%, -50%)',
        fontSize:   '28px',
        fontWeight: 'bold',
        fontFamily: FONT_MAP[style.font ?? 'normal'],
        color:      style.color ?? '#ffffff',
        textShadow: '0 2px 10px rgba(0,0,0,0.95)',
        whiteSpace: 'pre-wrap',
        textAlign:  'center',
        maxWidth:   '80vw',
        lineHeight: 1.3,
      }}
    >
      {style.text}
    </div>
  );
}

// ── Insights panel ────────────────────────────────────────────────────────────

function MiniAvatar({ profile }) {
  const initials = (profile?.username || '?').slice(0, 2).toUpperCase();
  return profile?.avatar_url ? (
    <img loading="lazy" src={profile.avatar_url} alt={profile.username}
      className="w-9 h-9 rounded-full object-cover shrink-0" draggable={false} />
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
      className="absolute bottom-0 start-0 end-0 bg-card rounded-t-3xl z-20 max-h-[72vh] flex flex-col"
      style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
    >
      <div className="flex justify-center pt-3 pb-1 shrink-0">
        <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
      </div>
      <div className="flex items-center justify-between px-5 py-3 shrink-0">
        <h3 className="font-heading font-bold text-base">Story Insights</h3>
        <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
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
            {likers.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Heart className="w-3.5 h-3.5 fill-red-500 text-red-500" />Likes · {likers.length}
                </p>
                <div className="space-y-3">
                  {likers.map(l => (
                    <div key={l.liker_id} className="flex items-center gap-3">
                      <MiniAvatar profile={l.profile} />
                      <span className="font-medium text-sm">
                        {l.profile?.username || 'Someone'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" />Views · {viewers.length}
              </p>
              {viewers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No views yet.</p>
              ) : (
                <div className="space-y-3">
                  {viewers.map(v => (
                    <div key={v.viewer_id} className="flex items-center gap-3">
                      <MiniAvatar profile={v.profile} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{v.profile?.username || 'Someone'}</p>
                        <p className="text-micro text-muted-foreground">
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

// ── Delete confirmation ───────────────────────────────────────────────────────

function DeletePrompt({ onConfirm, onCancel }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60" aria-hidden="true" onClick={onCancel}>
      <div className="bg-card rounded-2xl p-6 mx-6 text-center" onClick={e => e.stopPropagation()}>
        <p className="font-heading font-bold text-base mb-1">Remove this story?</p>
        <p className="text-sm text-muted-foreground mb-5">This can't be undone.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-bold">Remove</button>
        </div>
      </div>
    </div>
  );
}

// ── Main viewer ───────────────────────────────────────────────────────────────

export default function StoryViewer({
  open, groups, startIndex, viewedIds, likedIds, user,
  onClose, onStoriesChange, onAddStory,
  // Album mode only: when provided, an owner viewing a highlight album
  // gets a "remove from this album" control per story. Receives the
  // story id, returns { ok } (or a promise of it).
  onRemoveFromHighlight,
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Re-render every 60s so the expiration countdown ticks down.
  const [, setCountdownTick] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => setCountdownTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, [open]);

  const [groupIdx,      setGroupIdx]      = useState(0);
  const [storyIdx,      setStoryIdx]      = useState(0);
  const [tick,          setTick]          = useState(0);
  const [insightsOpen,  setInsightsOpen]  = useState(false);
  const [deletePrompt,  setDeletePrompt]  = useState(false);
  const [reportOpen,    setReportOpen]    = useState(false);
  // Reply box is hidden until the viewer taps the comment button.
  const [commentOpen,   setCommentOpen]   = useState(false);
  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false);
  const [localLiked,    setLocalLiked]    = useState(new Set());
  const [reply,         setReply]         = useState('');
  const [replyFocused,  setReplyFocused]  = useState(false);
  const [replySending,  setReplySending]  = useState(false);
  const timerRef      = useRef(null);
  const mediaRef      = useRef(null);  // container for overlay text positioning
  const slideDir      = useRef(0);     // 0 = same group, 1 = forward, -1 = back
  const replyInputRef = useRef(null);  // focused on swipe-up gesture
  // Local dedupe — `viewedIds` is a prop that only refreshes when the
  // parent query is invalidated, so a user rapidly advancing through
  // stories could double-call markStoryViewed for the same row.
  const viewedLocalRef = useRef(new Set());

  useEffect(() => {
    if (open) {
      setGroupIdx(Math.max(0, Math.min(startIndex, groups.length - 1)));
      setStoryIdx(0);
      setTick(t => t + 1);
      setInsightsOpen(false);
      setDeletePrompt(false);
      setLocalLiked(new Set(likedIds));
      setReply('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startIndex]);

  const currentGroup = groups[groupIdx];
  const currentStory = currentGroup?.stories[storyIdx];
  const isVideo      = currentStory?.media_type === 'video';

  // Preload upcoming images so advancing doesn't flash black for a beat
  // (the bitmap decodes while the text overlay paints instantly otherwise).
  // Covers the next few in the current group + the first of the next group.
  useEffect(() => {
    if (!open) return;
    const urls = [];
    const group = groups[groupIdx];
    if (group?.stories) {
      for (let i = storyIdx + 1; i < Math.min(group.stories.length, storyIdx + 4); i += 1) {
        const s = group.stories[i];
        // Preload the SAME transformed URL the viewer renders — a raw-URL
        // preload would warm the wrong cache entry (see lib/imageCdn.js).
        if (s && s.media_type !== 'video' && s.image_url) urls.push(cdnImageUrl(s.image_url, { width: 1080, quality: 80 }));
      }
    }
    const nextFirst = groups[groupIdx + 1]?.stories?.[0];
    if (nextFirst && nextFirst.media_type !== 'video' && nextFirst.image_url) urls.push(cdnImageUrl(nextFirst.image_url, { width: 1080, quality: 80 }));
    // Track the preloaded Image instances so the cleanup can abort
    // their in-flight decode + drop the references for the GC. Without
    // this, advancing through a story tray quickly stacks N×4 Image
    // objects on the heap before the browser eventually reclaims them
    // — visible as a stutter on the next swipe on lower-end devices.
    const preloaded = urls.map((u) => {
      const img = new Image();
      img.src = u;
      return img;
    });
    return () => {
      for (const img of preloaded) {
        try { img.src = ''; } catch { /* ignore */ }
      }
    };
  }, [open, groupIdx, storyIdx, groups]);

  useEffect(() => {
    if (!open || !currentStory || !user?.id) return;
    if (viewedIds.has(currentStory.id) || viewedLocalRef.current.has(currentStory.id)) return;
    viewedLocalRef.current.add(currentStory.id);
    storiesData.markStoryViewed(currentStory.id, user.id)
      .then(() => {
        // Refresh the parent's viewedIds query so the local dedupe
        // converges with server state once the row lands.
        queryClient.invalidateQueries({ queryKey: ['storyViewedIds', user.id] });
      })
      .catch(() => {
        // Drop from local set so a retry can fire on next mount.
        viewedLocalRef.current.delete(currentStory.id);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentStory?.id, user?.id]);

  const goNext = useCallback(() => {
    const group = groups[groupIdx];
    if (!group) return;
    setInsightsOpen(false); setDeletePrompt(false); setReply('');
    if (storyIdx < group.stories.length - 1) {
      slideDir.current = 0;
      setStoryIdx(i => i + 1); setTick(t => t + 1);
    } else {
      const next = groups.findIndex((_, i) => i > groupIdx);
      if (next >= 0) { slideDir.current = 1; setGroupIdx(next); setStoryIdx(0); setTick(t => t + 1); }
      else onClose();
    }
  }, [groupIdx, storyIdx, groups, onClose]);

  const goBack = useCallback(() => {
    setInsightsOpen(false); setDeletePrompt(false); setReply('');
    if (storyIdx > 0) { slideDir.current = 0; setStoryIdx(i => i - 1); setTick(t => t + 1); return; }
    let prev = -1;
    for (let i = groupIdx - 1; i >= 0; i--) { prev = i; break; }
    if (prev >= 0) {
      slideDir.current = -1;
      setGroupIdx(prev);
      setStoryIdx(Math.max(0, groups[prev].stories.length - 1));
      setTick(t => t + 1);
    }
  }, [groupIdx, storyIdx, groups]);

  // Tap-to-pause / hold-to-pause for the center area (Instagram
  // pattern). The previous tap-zone layout had a dead 30% center
  // strip that landed on the media with no handler. Now press-and-
  // hold or single-tap on center toggles a manual pause flag.
  // (Audit 10 #75, #76.)
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [holdPaused, setHoldPaused] = useState(false);
  // Reset pause flags whenever the user navigates to a different
  // story so a paused story doesn't keep a stuck-paused state for the
  // NEXT story they advance to.
  useEffect(() => {
    setManuallyPaused(false);
    setHoldPaused(false);
  }, [storyIdx, groupIdx]);
  const paused = insightsOpen || deletePrompt || replyFocused || manuallyPaused || holdPaused;

  useEffect(() => {
    if (!open || !currentStory || paused) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(goNext, STORY_DURATION_MS);
    return () => clearTimeout(timerRef.current);
  }, [open, tick, paused, goNext]);

  const handleDelete = async () => {
    if (!currentStory) return;
    const { ok } = await storiesData.deleteStory(currentStory.id);
    if (!ok) { toast.error('Could not delete story.'); return; }
    onStoriesChange();
    if (currentGroup.stories.length > 1) { setStoryIdx(storyIdx > 0 ? storyIdx - 1 : 0); setTick(t => t + 1); }
    else onClose();
  };

  // Album mode: unpin the current story from this highlight (doesn't
  // delete the underlying story). The parent trims its item list, so the
  // group shrinks; step back / close mirroring the delete flow.
  const handleRemoveFromHighlight = async () => {
    if (!currentStory || !onRemoveFromHighlight) return;
    const res = await onRemoveFromHighlight(currentStory.id);
    if (res && res.ok === false) { toast.error('Could not remove from album.'); return; }
    toast.success('Removed from album.');
    if (currentGroup.stories.length > 1) { setStoryIdx(storyIdx > 0 ? storyIdx - 1 : 0); setTick(t => t + 1); }
    else onClose();
  };

  const handleLike = async (e) => {
    e.stopPropagation();
    if (!currentStory || !user) return;
    const already = localLiked.has(currentStory.id);
    // Optimistic toggle + revert-on-failure. The previous version had
    // no catch, so an RLS rejection / network blip left the local
    // state liked while the server had nothing — the InsightsPanel
    // count silently disagreed with the visible heart. (Audit 10 #65.)
    setLocalLiked(prev => { const n = new Set(prev); already ? n.delete(currentStory.id) : n.add(currentStory.id); return n; });
    try {
      // likeStory / unlikeStory return a plain boolean — true on
      // success, false on RLS rejection / network failure. The
      // previous `res.ok === false` check assumed an `{ ok }` shape
      // that the helpers don't return, so failure was never detected
      // and the optimistic heart stayed lit even when the server
      // rejected. Fix from my own wave-30 work — caught in self-audit.
      const ok = already
        ? await storiesData.unlikeStory(currentStory.id, user.id)
        : await storiesData.likeStory(currentStory.id, user);
      if (ok !== true) throw new Error('like_failed');
      try { navigator.vibrate?.(already ? 6 : 12); } catch {}
      queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
    } catch {
      // Revert and surface a toast so the user knows the heart didn't stick.
      setLocalLiked(prev => { const n = new Set(prev); already ? n.add(currentStory.id) : n.delete(currentStory.id); return n; });
      toast.error('Could not update like — try again.');
    }
  };

  const handleSendReply = async () => {
    if (!reply.trim() || !currentGroup || replySending) return;
    setReplySending(true);
    const res = await storiesData.sendStoryReply(currentGroup.user_id, user, reply.trim());
    setReplySending(false);
    if (res?.ok) {
      setReply('');
      // Show an "Open" action on the success toast so the user can
      // jump straight into the new (or existing) DM thread. The
      // conversation already exists server-side; this just navigates.
      toast.success('Reply sent!', res.conversationId ? {
        action: {
          label: 'Open',
          onClick: () => {
            onClose?.();
            navigate(`/messages?conv=${encodeURIComponent(res.conversationId)}`);
          },
        },
      } : undefined);
    } else if (res?.reason === 'dms_disabled') {
      toast.error("They don't accept story replies.");
    } else {
      toast.error('Could not send reply — try again.');
    }
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
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 60 }}
          transition={{ duration: 0.22 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.2, bottom: 0.35 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 90 || info.velocity.y > 700) onClose();
            else if (!currentGroup?.isOwn && (info.offset.y < -55 || info.velocity.y < -350)) {
              // Swipe up → focus reply input so keyboard opens immediately
              replyInputRef.current?.focus();
            }
          }}
          className="fixed inset-0 z-[10000] bg-black flex flex-col select-none"
        >
          <div ref={mediaRef} className="relative flex-1 overflow-hidden">

            {/* ── Media ───────────────────────────────────────────────── */}
            <AnimatePresence mode="wait" initial={false}>
              {isVideo ? (
                <motion.video key={currentStory.id} src={currentStory.image_url}
                  autoPlay loop muted playsInline
                  initial={{ opacity: 0, x: slideDir.current === 1 ? '60%' : slideDir.current === -1 ? '-60%' : 0 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: slideDir.current === 1 ? '-20%' : slideDir.current === -1 ? '20%' : 0 }}
                  transition={{ duration: slideDir.current !== 0 ? 0.28 : 0.18, ease: 'easeOut' }}
                  style={{ filter: currentStory.overlay_style?.filter ?? 'none' }}
                  className="absolute inset-0 w-full h-full object-contain" />
              ) : (
                <motion.img key={currentStory.id} src={cdnImageUrl(currentStory.image_url, { width: 1080, quality: 80 })} alt=""
                  onError={(e) => {
                    if (cdnFallbackSrc(e, currentStory.image_url)) return; // transform failed → retry raw
                    e.currentTarget.style.display = 'none';
                  }}
                  initial={{ opacity: 0, x: slideDir.current === 1 ? '60%' : slideDir.current === -1 ? '-60%' : 0 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: slideDir.current === 1 ? '-20%' : slideDir.current === -1 ? '20%' : 0 }}
                  transition={{ duration: slideDir.current !== 0 ? 0.28 : 0.18, ease: 'easeOut' }}
                  style={{ filter: currentStory.overlay_style?.filter ?? 'none' }}
                  className="absolute inset-0 w-full h-full object-contain" draggable={false} />
              )}
            </AnimatePresence>

            {/* ── Overlay text ─────────────────────────────────────────── */}
            {currentStory.overlay_style?.text ? (
              <StoryOverlayText style={currentStory.overlay_style} containerRef={mediaRef} />
            ) : currentStory.overlay_text ? (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-white text-2xl font-bold text-center px-8 break-words leading-snug"
                  style={{ textShadow: '0 2px 10px rgba(0,0,0,0.95)' }}>
                  {currentStory.overlay_text}
                </p>
              </div>
            ) : null}

            {/* ── Multi-overlay layer (emoji/text/sticker/poll/countdown, mig 111+112) ──
                Rendered above the base media and the legacy overlay_text
                so a story can carry BOTH. Coordinates are normalized so
                the same row renders identically at any aspect ratio.
                Interactive overlays (poll) re-enable pointer-events
                on their own container. */}
            {Array.isArray(currentStory.overlays) && currentStory.overlays.length > 0 && (
              <div className="absolute inset-0 pointer-events-none">
                <StoryOverlayRenderer
                  overlays={currentStory.overlays}
                  storyId={currentStory.id}
                  userId={user?.id}
                  isOwn={!!currentGroup.isOwn}
                />
              </div>
            )}

            {/* ── Top gradient ─────────────────────────────────────────── */}
            <div className="absolute top-0 start-0 end-0 h-36 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)' }} />

            {/* ── Progress bars ────────────────────────────────────────── */}
            <div className="absolute top-0 start-0 end-0 flex gap-1 px-3"
              style={{ paddingTop: 'max(14px, env(safe-area-inset-top))' }}>
              {currentGroup.stories.map((s, i) => (
                <div key={s.id} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
                  {i < storyIdx ? <div className="h-full w-full bg-white" /> :
                   i === storyIdx ? (
                    <motion.div key={`bar-${tick}`} className="h-full bg-white origin-left"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: paused ? undefined : 1 }}
                      transition={{ duration: STORY_DURATION_MS / 1000, ease: 'linear' }} />
                  ) : null}
                </div>
              ))}
            </div>

            {/* ── User info + controls ─────────────────────────────────── */}
            <div className="absolute start-0 end-0 flex items-center justify-between px-3 mt-2"
              style={{ top: 'max(30px, calc(env(safe-area-inset-top) + 16px))' }}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-white/40 shrink-0">
                  {currentGroup.avatarUrl
                    ? <img loading="lazy" src={currentGroup.avatarUrl} alt="" className="w-full h-full object-cover" draggable={false} />
                    : <div className="w-full h-full bg-white/20 flex items-center justify-center text-micro font-bold text-white">
                        {currentGroup.username.slice(0, 2).toUpperCase()}
                      </div>
                  }
                </div>
                <div>
                  <p className="text-white font-semibold text-sm leading-tight drop-shadow-md">
                    {currentGroup.isOwn ? 'Your Story' : currentGroup.username}
                  </p>
                  {/* Just how long ago it was posted (seconds / minutes /
                      hours / days). The expiry countdown that used to sit
                      beside this was noise — stories always last 24h. */}
                  <div className="flex items-center gap-1.5">
                    <p className="text-white/70 text-micro leading-tight">{timeAgo}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Report — viewers only (you can't report your own story).
                    Mirrors the flag affordance on post cards. */}
                {!currentGroup.isOwn && (
                  <button onClick={(e) => { e.stopPropagation(); setReportOpen(true); }}
                    className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center text-white" aria-label="Report story">
                    <Flag className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onClose(); }}
                  className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center text-white"
                  style={{ position: 'relative', zIndex: 200, pointerEvents: 'all' }}
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── Bottom gradient ──────────────────────────────────────── */}
            <div className="absolute bottom-0 start-0 end-0 h-40 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%)' }} />

            {/* ── Bottom bar — own stories ──────────────────────────────
                Insights + delete only. You can't like your own story, and the
                save actions (add-to-highlight, download) were removed — a
                story lives 24h and then it's gone. */}
            {currentGroup.isOwn && (
              <div className="absolute bottom-0 start-0 end-0 flex items-end justify-center gap-10 px-4"
                style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
                {/* View Insights */}
                <button onClick={(e) => { e.stopPropagation(); setInsightsOpen(v => !v); }}
                  className="flex flex-col items-center gap-0.5 text-white/80" aria-label="View insights">
                  <Eye className="w-4 h-4" />
                  <span className="text-micro font-medium">View Insights</span>
                </button>

                {/* Delete */}
                <button onClick={(e) => { e.stopPropagation(); setDeletePrompt(true); }}
                  className="w-11 h-11 rounded-full bg-black/40 flex items-center justify-center text-white" aria-label="Delete story">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* ── Bottom bar — non-own stories ─────────────────────────── */}
            {!currentGroup.isOwn && (
              <div className="absolute bottom-0 start-0 end-0 px-3"
                style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>

                {/* Story context thumbnail — always shown above reply bar */}
                {currentStory?.image_url && !currentGroup.storyDmsDisabled && (
                  <div className="flex items-center gap-2 mb-2.5 ms-1" onClick={e => e.stopPropagation()}>
                    <div
                      className="rounded-xl overflow-hidden shrink-0"
                      style={{ width: 52, height: 52, opacity: 0.75, boxShadow: '0 0 0 1.5px rgba(255,255,255,0.25)' }}
                    >
                      <img loading="lazy" src={currentStory.image_url}
                        className="w-full h-full object-cover"
                        alt=""
                        draggable={false}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    </div>
                    <div>
                      <p className="text-white/80 text-xs font-semibold leading-tight drop-shadow">Replying to story</p>
                      <p className="text-white/45 text-micro leading-tight mt-0.5">{currentGroup.username}</p>
                    </div>
                  </div>
                )}

                {/* Emoji reactions (migration 097). Picker row above
                    the like + reply row — taps fire reactToStory(). */}
                <div className="mb-2">
                  <StoryReactionPicker storyId={currentStory?.id} />
                </div>

                {/* Two centered actions: like + comment. The reply box only
                    appears once the user taps comment, so the default view
                    stays clean. */}
                {!commentOpen && (
                  <div className="flex items-center justify-center gap-10">
                    <motion.button whileTap={{ scale: 0.82 }} onClick={handleLike}
                      className="w-12 h-12 rounded-full bg-black/40 flex items-center justify-center shrink-0" aria-label={isLiked ? 'Unlike' : 'Like'}>
                      <Heart className={`w-6 h-6 transition-colors ${isLiked ? 'fill-red-500 text-red-500' : 'text-white'}`} />
                    </motion.button>
                    {!currentGroup.storyDmsDisabled && (
                      <motion.button whileTap={{ scale: 0.82 }}
                        onClick={(e) => { e.stopPropagation(); setCommentOpen(true); setTimeout(() => replyInputRef.current?.focus(), 60); }}
                        className="w-12 h-12 rounded-full bg-black/40 flex items-center justify-center shrink-0" aria-label="Comment">
                        <MessageCircle className="w-6 h-6 text-white" />
                      </motion.button>
                    )}
                  </div>
                )}

                <div className={commentOpen ? 'flex items-center gap-2' : 'hidden'}>
                  {!currentGroup.storyDmsDisabled && (
                    <div className="flex-1 flex items-center gap-2 bg-black/40 rounded-full px-4 py-2.5 border border-white/25 min-w-0"
                      onClick={e => e.stopPropagation()}>
                      <input
                        ref={replyInputRef}
                        type="text"
                        value={reply}
                        onChange={e => setReply(e.target.value)}
                        onFocus={() => setReplyFocused(true)}
                        onBlur={() => setReplyFocused(false)}
                        onKeyDown={e => { if (e.key === 'Enter' && reply.trim()) handleSendReply(); }}
                        placeholder={`Reply to ${currentGroup.username}…`}
                        className="flex-1 bg-transparent text-white text-sm placeholder-white/45 outline-none min-w-0"
                      />
                      {reply.trim() && (
                        <button onClick={handleSendReply} disabled={replySending}
                          className="text-primary shrink-0 disabled:opacity-50" aria-label="Send reply">
                          {replySending
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Send className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Tap zones (stop 90px from bottom) ───────────────────── */}
            <div className="absolute start-0 top-0 w-[35%] cursor-pointer" style={{ bottom: '90px' }}
              onClick={goBack} aria-label="Previous story" />
            <div className="absolute end-0 top-0 w-[35%] cursor-pointer" style={{ bottom: '90px' }}
              onClick={goNext} aria-label="Next story" />
            {/* Center 30% — tap to toggle pause, hold to pause for as
                long as the press is held. Matches Instagram /
                Snapchat conventions; the previous dead-center strip
                surprised every user who came from those apps. */}
            <div
              className="absolute top-0 cursor-pointer"
              style={{ left: '35%', right: '35%', bottom: '90px' }}
              onClick={() => setManuallyPaused(p => !p)}
              onPointerDown={() => setHoldPaused(true)}
              onPointerUp={() => setHoldPaused(false)}
              onPointerCancel={() => setHoldPaused(false)}
              onPointerLeave={() => setHoldPaused(false)}
              aria-label="Tap to pause"
            />

            {/* ── Delete confirm ───────────────────────────────────────── */}
            {deletePrompt && (
              <DeletePrompt
                onConfirm={() => { setDeletePrompt(false); handleDelete(); }}
                onCancel={() => setDeletePrompt(false)}
              />
            )}

            {/* ── Insights panel ───────────────────────────────────────── */}
            <AnimatePresence>
              {insightsOpen && currentGroup.isOwn && (
                <InsightsPanel storyId={currentStory.id} onClose={() => setInsightsOpen(false)} />
              )}
            </AnimatePresence>

            {/* ── Add-to-highlight modal (mig 099) ─────────────────────── */}
            {highlightPickerOpen && currentGroup.isOwn && (
              <AddToHighlightModal
                open={highlightPickerOpen}
                onClose={() => setHighlightPickerOpen(false)}
                storyId={currentStory?.id}
              />
            )}

            {/* Report a story — viewers only. */}
            {reportOpen && !currentGroup.isOwn && (
              <div onClick={(e) => e.stopPropagation()}>
                <ReportDialog
                  open={reportOpen}
                  onClose={() => setReportOpen(false)}
                  reportedType="story"
                  reportedId={currentStory?.id}
                  reportedAuthorEmail={currentGroup?.email || null}
                />
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
