import { useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Trash2, ThumbsUp, MessageCircle, X, Flag } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useMultiProfanityGuard } from '@/lib/useProfanityGuard';
import { useAuthorsByEmail, resolveAuthor } from '@/lib/data/useAuthors';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import { containsProfanity } from '@/lib/profanityFilter';
import * as hubComments from '@/lib/data/hubComments';
import * as hubCommentLikes from '@/lib/data/hubCommentLikes';
import ReportDialog from './ReportDialog';
import { toast } from 'sonner';

export default function HubCommentsInline({ post, open, onClose }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const draftGuard = useMultiProfanityGuard();
  const [posting, setPosting] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const [expandedThreads, setExpandedThreads] = useState(new Set());
  const [pendingLikes, setPendingLikes] = useState(new Map());
  const desiredLikeRef = useRef(new Map());
  const inFlightRef = useRef(false);

  const authorsByEmail = useAuthorsByEmail();

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['hubComments', post.id],
    queryFn: () => hubComments.listForPost(post.id),
    enabled: open,
  });

  const thread = useMemo(() => hubComments.buildThread(comments), [comments]);

  const { data: likedSet } = useQuery({
    queryKey: ['hubCommentLikes', post.id, user?.email],
    queryFn: async () => {
      const ids = comments.map(c => c.id);
      if (!user?.email || ids.length === 0) return new Set();
      return hubCommentLikes.listLikedCommentIds(user.email, ids);
    },
    enabled: !!user?.email && comments.length > 0,
  });

  // ── Like helpers ─────────────────────────────────────────────────────────

  const isLikedDisplayed = (commentId) => {
    const pending = pendingLikes.get(commentId);
    if (pending !== undefined) return pending;
    return likedSet?.has(commentId) || false;
  };

  const likeCountFor = (comment) => {
    const server = Number(comment.like_count || 0);
    const pending = pendingLikes.get(comment.id);
    if (pending === undefined) return server;
    const wasLiked = likedSet?.has(comment.id) || false;
    return Math.max(0, server + ((pending ? 1 : 0) - (wasLiked ? 1 : 0)));
  };

  const runLikeWorker = async () => {
    inFlightRef.current = true;
    try {
      while (desiredLikeRef.current.size > 0) {
        const entries = Array.from(desiredLikeRef.current.entries());
        desiredLikeRef.current.clear();
        await Promise.all(
          entries.map(([cid, target]) =>
            hubCommentLikes.setLiked(cid, user.email, target)
          )
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hubComments', post.id] }),
        queryClient.invalidateQueries({ queryKey: ['hubCommentLikes', post.id, user.email] }),
      ]);
      setPendingLikes(new Map());
    } catch {
      desiredLikeRef.current.clear();
      setPendingLikes(new Map());
      toast.error(t('hub.comments.likeError'));
    } finally {
      inFlightRef.current = false;
    }
  };

  const handleLike = (commentId) => {
    if (!user?.email) return;
    const currentlyLiked = isLikedDisplayed(commentId);
    const target = !currentlyLiked;
    setPendingLikes(prev => {
      const next = new Map(prev);
      next.set(commentId, target);
      return next;
    });
    desiredLikeRef.current.set(commentId, target);
    if (!inFlightRef.current) runLikeWorker();
  };

  // ── Post / reply ──────────────────────────────────────────────────────────

  const handlePost = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (containsProfanity(trimmed)) {
      toast.error(t('hub.composer.profanityError'));
      return;
    }
    setPosting(true);
    try {
      await hubComments.create({
        post_id: post.id,
        author_email: user.email,
        author_name: user.username ? `@${user.username}` : (user.email?.split('@')[0] || 'Athlete'),
        body: trimmed,
        ...(replyTarget?.id ? { parent_comment_id: replyTarget.id } : {}),
      });
      setDraft('');
      if (replyTarget?.id) {
        setExpandedThreads(prev => new Set(prev).add(replyTarget.id));
      }
      setReplyTarget(null);
      queryClient.invalidateQueries({ queryKey: ['hubComments', post.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
    } catch {
      toast.error(t('hub.comments.postError'));
    } finally {
      setPosting(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (comment) => {
    if (comment.author_email !== user?.email) return;
    if (!window.confirm(t('hub.comments.confirmDelete'))) return;
    try {
      await hubComments.remove(comment.id, post.id);
      queryClient.invalidateQueries({ queryKey: ['hubComments', post.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
    } catch {
      toast.error(t('hub.comments.deleteError'));
    }
  };

  if (!open) return null;

  return (
    <div className="border-t border-border bg-card">
      {/* Comment list */}
      <div className="px-3 pt-3 pb-2 max-h-[60vh] overflow-y-auto space-y-3">
        {isLoading ? (
          <p className="text-center text-sm text-muted-foreground py-4">{t('common.loading')}</p>
        ) : thread.topLevel.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">{t('hub.comments.empty')}</p>
        ) : (
          thread.topLevel.map(c => {
            const replies = thread.repliesByParent.get(c.id) || [];
            const isExpanded = expandedThreads.has(c.id);
            return (
              <div key={c.id}>
                <CommentRow
                  comment={c}
                  user={user}
                  authorsByEmail={authorsByEmail}
                  isLiked={isLikedDisplayed(c.id)}
                  likeCount={likeCountFor(c)}
                  onLike={() => handleLike(c.id)}
                  onReply={() => setReplyTarget({ id: c.id, handle: resolveAuthor(authorsByEmail, c.author_email, { author_name: c.author_name }).handle })}
                  onDelete={() => handleDelete(c)}
                  showReply
                  t={t}
                  postAuthorEmail={post.author_email}
                />

                {/* Replies toggle + list */}
                {replies.length > 0 && (
                  <div className="ml-9 mt-1 space-y-2">
                    <button
                      onClick={() =>
                        setExpandedThreads(prev => {
                          const next = new Set(prev);
                          isExpanded ? next.delete(c.id) : next.add(c.id);
                          return next;
                        })
                      }
                      className="text-[11px] font-semibold text-primary hover:opacity-70 transition-opacity"
                    >
                      {isExpanded
                        ? t('hub.comments.hideReplies')
                        : replies.length === 1
                          ? t('hub.comments.viewReply')
                          : t('hub.comments.viewReplies').replace('{count}', replies.length)}
                    </button>
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          key="replies"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18, ease: 'easeOut' }}
                          style={{ overflow: 'hidden' }}
                          className="space-y-2"
                        >
                          {replies.map(r => (
                            <CommentRow
                              key={r.id}
                              comment={r}
                              user={user}
                              authorsByEmail={authorsByEmail}
                              isLiked={isLikedDisplayed(r.id)}
                              likeCount={likeCountFor(r)}
                              onLike={() => handleLike(r.id)}
                              onDelete={() => handleDelete(r)}
                              showReply={false}
                              t={t}
                              postAuthorEmail={post.author_email}
                            />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Reply-mode indicator */}
      {replyTarget && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/40 border-t border-border text-xs">
          <span className="text-muted-foreground">
            {t('hub.comments.replyingTo')}{' '}
            <span className="font-bold text-foreground">{replyTarget.handle}</span>
          </span>
          <button
            onClick={() => setReplyTarget(null)}
            aria-label={t('hub.comments.cancelReply')}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border px-3 py-2 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => draftGuard.handleChange(e.target.value, setDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handlePost();
            }
          }}
          placeholder={replyTarget ? t('hub.comments.replyPlaceholder') : t('hub.comments.placeholder')}
          maxLength={500}
          className="flex-1 px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          onClick={handlePost}
          disabled={posting || !draft.trim()}
          className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      <ProfanityWarningDialog open={draftGuard.open} onContinue={draftGuard.onContinue} />
    </div>
  );
}

// ── CommentRow sub-component ──────────────────────────────────────────────────

function CommentRow({ comment: c, user, authorsByEmail, isLiked, likeCount, onLike, onReply, onDelete, showReply, t, postAuthorEmail }) {
  const [reportOpen, setReportOpen] = useState(false);
  const author = resolveAuthor(authorsByEmail, c.author_email, {
    author_name: c.author_name,
    author_avatar_url: c.author_avatar_url,
  });
  const isMine = c.author_email === user?.email;
  const timeLabel = c.created_date ? format(parseISO(c.created_date), 'MMM d, h:mma') : '';

  return (
    <>
      <div className="flex items-start gap-2">
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0 text-xs font-bold overflow-hidden">
          {author.avatarUrl ? (
            <img src={author.avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            author.initials
          )}
        </div>

        {/* Bubble + actions */}
        <div className="flex-1 min-w-0">
          <div className="bg-secondary/50 rounded-2xl px-3 py-2">
            <p className="text-xs font-bold leading-tight">{author.handle}</p>
            <p className="text-sm whitespace-pre-wrap break-words mt-0.5">{c.body}</p>
          </div>

          {/* Action row */}
          <div className="flex items-center gap-3 mt-1 ml-2 text-[11px] text-muted-foreground">
            <span>{timeLabel}</span>

            {/* Like */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={onLike}
              className={`flex items-center gap-1 transition-colors ${isLiked ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              aria-label={isLiked ? t('hub.comments.liked') : t('hub.comments.like')}
            >
              <ThumbsUp className={`w-3.5 h-3.5 ${isLiked ? 'fill-current' : ''}`} />
              {likeCount > 0 && <span>{likeCount}</span>}
            </motion.button>

            {/* Reply */}
            {showReply && (
              <button
                onClick={onReply}
                className="hover:text-foreground transition-colors font-medium"
              >
                {t('hub.comments.reply')}
              </button>
            )}

            {/* Report — only for other people's comments */}
            {!isMine && (
              <button
                onClick={() => setReportOpen(true)}
                className="hover:text-destructive transition-colors"
                aria-label={t('report.buttonLabel')}
                title={t('report.buttonLabel')}
              >
                <Flag className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Delete — own comments only */}
        {isMine && (
          <button
            onClick={onDelete}
            className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
            aria-label="Delete comment"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Report dialog */}
      {!isMine && (
        <ReportDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          reportedType="comment"
          reportedId={c.id}
          reportedAuthorEmail={c.author_email}
        />
      )}
    </>
  );
}