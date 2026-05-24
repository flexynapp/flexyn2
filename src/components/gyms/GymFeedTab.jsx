// src/components/gyms/GymFeedTab.jsx
//
// Social "home page" feed for a gym. Replaces the barebones inline
// FeedTab that lived in GymHub. Adds:
//   • Image upload via the existing avatars bucket
//   • Per-post emoji reactions (🔥 default + picker on long-press)
//   • Inline collapsible comment thread
//   • Pinned post pinned to the top with a "Pinned" chip
//   • Owner-only pin/unpin + delete-any
//   • Relative timestamps
//
// Member-only by RLS — non-members hit the "Join this gym" preview
// gate one level up in GymHub.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useLongPress } from '@/hooks/useLongPress';
import { triggerHaptic } from '@/lib/haptic';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
  Send, Image as ImageIcon, Loader2, Heart, MessageCircle, Pin, MoreHorizontal,
  Trash2, X, Sparkles,
} from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import {
  listFeedPosts, postToFeed, deleteFeedPost,
  toggleFeedReaction, listReactionsForPosts,
  listFeedComments, postFeedComment, deleteFeedComment,
  togglePinPost, uploadFeedImage,
} from '@/lib/data/gymBusinesses';

const QUICK_EMOJIS = ['🔥', '💪', '👏', '🚀', '🎯', '🙌'];
const DEFAULT_EMOJI = '🔥';

export default function GymFeedTab({ gymId, gymOwnerId }) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const isOwner = !!(user?.id && gymOwnerId && user.id === gymOwnerId);

  // ── Posts ─────────────────────────────────────────────────────────
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['gymFeed', gymId],
    queryFn:  () => listFeedPosts(gymId, 50),
    enabled:  !!gymId,
    staleTime: 30_000,
  });

  // Reactions — fetched in one batch query for the visible post set.
  // Cache key keyed by gymId + post count so a single new arrival
  // doesn't invalidate the whole reaction map (audit C-2). The
  // post-id list is passed at fetch time, not embedded in the key.
  const postIds = useMemo(() => posts.map(p => p.id), [posts]);
  const { data: reactionMap = {} } = useQuery({
    queryKey: ['gymFeedReactions', gymId, postIds.length],
    queryFn:  () => listReactionsForPosts(postIds, user?.id),
    enabled:  !!gymId && postIds.length > 0,
    staleTime: 30_000,
  });

  // Pinned post (if any) bubbled to the top of the rendered order.
  // Memoized so typing in the composer doesn't recompute on every
  // keystroke (audit C-3).
  const sortedPosts = useMemo(() => {
    const pinned = posts.filter(p => p.is_pinned);
    const rest   = posts.filter(p => !p.is_pinned);
    return [...pinned, ...rest];
  }, [posts]);

  // ── Composer state ────────────────────────────────────────────────
  const [body, setBody] = useState('');
  const [pendingMedia, setPendingMedia] = useState(null);  // { previewUrl, file }
  const [posting, setPosting] = useState(false);
  const fileInputRef = useRef(null);

  const handleFilePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setPendingMedia({ previewUrl, file });
  };

  const handlePost = async () => {
    if (posting) return;
    if (!body.trim() && !pendingMedia) {
      toast.error('Add some text or an image.');
      return;
    }
    setPosting(true);
    let mediaUrl = null;
    if (pendingMedia?.file) {
      mediaUrl = await uploadFeedImage(gymId, pendingMedia.file);
      if (!mediaUrl) {
        setPosting(false);
        toast.error('Image upload failed.');
        return;
      }
    }
    const res = await postToFeed(gymId, body || '', mediaUrl);
    setPosting(false);
    if (res.ok) {
      setBody('');
      if (pendingMedia?.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl);
      setPendingMedia(null);
      qc.invalidateQueries({ queryKey: ['gymFeed', gymId] });
    } else {
      toast.error("Couldn't post — try again.");
    }
  };

  const handleDeletePost = async (postId) => {
    if (!confirm('Delete this post?')) return;
    const res = await deleteFeedPost(postId);
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['gymFeed', gymId] });
    } else {
      toast.error("Couldn't delete.");
    }
  };

  const handleTogglePin = async (postId) => {
    const res = await togglePinPost(postId);
    if (res.ok) {
      toast.success(res.pinned ? 'Pinned to the top.' : 'Unpinned.');
      qc.invalidateQueries({ queryKey: ['gymFeed', gymId] });
    } else {
      toast.error(res.error || "Couldn't pin.");
    }
  };

  return (
    <div className="space-y-3">
      {/* Composer */}
      <div className="rounded-2xl border border-border bg-card p-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 500))}
          placeholder="Share with your gym community…"
          rows={2}
          className="resize-none border-0 focus-visible:ring-0 px-0 mb-1"
        />
        {pendingMedia && (
          <div className="relative rounded-xl overflow-hidden mb-2 max-h-64">
            <img src={pendingMedia.previewUrl} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(pendingMedia.previewUrl);
                setPendingMedia(null);
              }}
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center"
              aria-label="Remove image"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFilePick}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-8 h-8 rounded-full bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center"
              title="Add image"
              aria-label="Add image"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
            <span className="text-[10px] text-muted-foreground tabular-nums">{body.length}/500</span>
          </div>
          <Button size="sm" onClick={handlePost} disabled={posting} className="gap-1.5">
            {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Post
          </Button>
        </div>
      </div>

      {/* Posts */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : sortedPosts.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Be the first to post"
          body="Welcome to your gym's social space. Share PRs, organize meetups, or just say hi."
        />
      ) : (
        <AnimatePresence initial={false}>
          {sortedPosts.map(post => (
            <FeedPostCard
              key={post.id}
              post={post}
              rxn={reactionMap[post.id] || { counts: {}, mine: new Set() }}
              meId={user?.id}
              isOwner={isOwner}
              onDelete={handleDeletePost}
              onTogglePin={handleTogglePin}
              onReactionChange={() =>
                qc.invalidateQueries({ queryKey: ['gymFeedReactions', gymId] })}
              onCommentChange={() =>
                qc.invalidateQueries({ queryKey: ['gymFeed', gymId] })}
            />
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}

// ── Single post card ──────────────────────────────────────────────
function FeedPostCard({ post, rxn, meId, isOwner, onDelete, onTogglePin, onReactionChange, onCommentChange }) {
  const isAuthor = meId && post.author_id === meId;
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // In-flight guard — without it rapid double-taps fire overlapping
  // toggles and the server-side atomic guard ends up oscillating
  // (audit C-1).
  const rxnBusyRef = useRef(false);

  // Long-press the heart to open the emoji picker; tap = toggle 🔥.
  const longPress = useLongPress(() => setPickerOpen(true), { ms: 320 });

  const handleQuickTap = async () => {
    if (pickerOpen) { setPickerOpen(false); return; }
    if (rxnBusyRef.current) return;
    rxnBusyRef.current = true;
    triggerHaptic?.('light');
    try { await toggleFeedReaction(post.id, DEFAULT_EMOJI); }
    finally { rxnBusyRef.current = false; }
    onReactionChange?.();
  };

  const handlePick = async (emoji) => {
    setPickerOpen(false);
    if (rxnBusyRef.current) return;
    rxnBusyRef.current = true;
    triggerHaptic?.('light');
    try { await toggleFeedReaction(post.id, emoji); }
    finally { rxnBusyRef.current = false; }
    onReactionChange?.();
  };

  // Top emoji by count + total for the heart-button label
  const topEmoji = (() => {
    const entries = Object.entries(rxn.counts).sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] || null;
  })();
  const totalRxn = Object.values(rxn.counts).reduce((s, n) => s + n, 0);
  const iReacted = rxn.mine && rxn.mine.size > 0;

  const timeLabel = (() => {
    try { return formatDistanceToNow(parseISO(post.created_at), { addSuffix: true }); }
    catch { return ''; }
  })();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      className={`rounded-2xl border bg-card p-3 ${
        post.is_pinned ? 'border-primary/40 shadow-sm shadow-primary/10' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {post.is_pinned && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/25">
                <Pin className="w-2.5 h-2.5" /> Pinned
              </span>
            )}
            <span className="text-sm font-semibold truncate">
              @{post.author_email?.split('@')[0] || 'member'}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">{timeLabel}</span>
        </div>
        {(isAuthor || isOwner) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(v => !v)}
              className="w-7 h-7 rounded-full bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center"
              aria-label="Post menu"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 rounded-lg bg-card border border-border shadow-lg z-20 py-1">
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); onTogglePin(post.id); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-secondary"
                  >
                    <Pin className="w-3 h-3" />
                    {post.is_pinned ? 'Unpin' : 'Pin to top'}
                  </button>
                )}
                {(isAuthor || isOwner) && (
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); onDelete(post.id); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {post.body && (
        <p className="text-sm whitespace-pre-wrap leading-relaxed mb-2">{post.body}</p>
      )}
      {post.media_url && (
        <div className="rounded-xl overflow-hidden mb-2 -mx-1">
          <img src={post.media_url} alt="" className="w-full max-h-96 object-cover" loading="lazy" />
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-1 pt-1 mt-1 border-t border-border/40">
        <div className="relative">
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            {...longPress.bind}
            onClick={(e) => { if (longPress.consumeClick(e)) handleQuickTap(); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              iReacted ? 'text-orange-500 bg-orange-500/10' : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            <span className="text-base leading-none">
              {topEmoji || (iReacted ? DEFAULT_EMOJI : '')}
              {!topEmoji && !iReacted && <Heart className="w-4 h-4" />}
            </span>
            {totalRxn > 0 && <span className="tabular-nums">{totalRxn}</span>}
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
                      rxn.mine?.has(e) ? 'bg-secondary' : ''
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button
          type="button"
          onClick={() => setCommentsOpen(o => !o)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            commentsOpen ? 'text-primary bg-secondary' : 'text-muted-foreground hover:bg-secondary'
          }`}
        >
          <MessageCircle className="w-3.5 h-3.5" />
          {post.comment_count > 0 ? post.comment_count : 'Comment'}
        </button>
      </div>

      {commentsOpen && (
        <FeedComments postId={post.id} meId={meId} isPostAuthorOrGymOwner={isAuthor || isOwner} onChange={onCommentChange} />
      )}
    </motion.div>
  );
}

// ── Inline comments ────────────────────────────────────────────────
function FeedComments({ postId, meId, isPostAuthorOrGymOwner, onChange }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [body, setBody]         = useState('');
  const [posting, setPosting]   = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setComments(await listFeedComments(postId));
    setLoading(false);
  }, [postId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!body.trim() || posting) return;
    setPosting(true);
    const res = await postFeedComment(postId, body);
    setPosting(false);
    if (res.ok) {
      setBody('');
      refresh();
      onChange?.();
    } else {
      toast.error("Couldn't comment.");
    }
  };

  const handleDelete = async (commentId) => {
    if (!confirm('Delete this comment?')) return;
    const res = await deleteFeedComment(commentId);
    if (res.ok) {
      refresh();
      onChange?.();
    } else {
      toast.error("Couldn't delete.");
    }
  };

  return (
    <div className="mt-2 pt-2 border-t border-border/40">
      {loading ? (
        <div className="flex justify-center py-2"><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /></div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">No comments yet. Say something.</p>
      ) : (
        <ul className="space-y-1.5">
          {comments.map(c => {
            const canDelete = meId && (c.author_id === meId || isPostAuthorOrGymOwner);
            return (
              <li key={c.id} className="group flex items-start gap-2">
                <div className="w-6 h-6 rounded-full bg-secondary shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 rounded-xl bg-secondary/40 px-2.5 py-1.5">
                  <p className="text-[11px] text-muted-foreground">
                    @{c.author_email?.split('@')[0]} ·{' '}
                    {(() => { try { return formatDistanceToNow(parseISO(c.created_at), { addSuffix: true }); } catch { return ''; } })()}
                  </p>
                  <p className="text-xs whitespace-pre-wrap">{c.body}</p>
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full text-muted-foreground hover:text-destructive flex items-center justify-center"
                    aria-label="Delete comment"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2 mt-2">
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 1000))}
          placeholder="Write a comment…"
          className="flex-1 h-8 px-2 rounded-md border border-border bg-background text-xs"
        />
        <button
          type="submit"
          disabled={!body.trim() || posting}
          className="px-3 h-8 rounded-md bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50"
        >
          {posting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Send'}
        </button>
      </form>
    </div>
  );
}
