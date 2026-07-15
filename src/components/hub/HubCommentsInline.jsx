import { useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Trash2, ThumbsUp, X, Flag, Languages, Loader2 } from 'lucide-react';
import { isVerified } from '@/lib/verifiedUsers';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { translateText, isLikelyAlreadyInLanguage } from '@/lib/translate';
import { useMultiProfanityGuard } from '@/lib/useProfanityGuard';
import { useAuthorsById, resolveAuthor } from '@/lib/data/useAuthors';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import { containsProfanity } from '@/lib/profanityFilter';
import * as hubComments from '@/lib/data/hubComments';
import * as hubCommentLikes from '@/lib/data/hubCommentLikes';
import { handle } from '@/lib/userDisplay';
import ReportDialog from './ReportDialog';
import { toast } from 'sonner';

// Orange 3-pronged crown badge for verified admins — defined after all imports
// so Rollup sees a clean import-first module boundary (avoids TDZ risk).
function CrownBadge({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 14" fill="none" aria-label="Admin" title="Verified Admin">
      <path d="M1 12h14M2 12L1 4l4 3.5L8 1l3 6.5L15 4l-1 8H2z" fill="#f97316" stroke="#ea6c00" strokeWidth="0.8" strokeLinejoin="round"/>
    </svg>
  );
}

export default function HubCommentsInline({ post, open, onClose }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  // Navigate to the canonical profile route for a tapped @mention.
  // The user_id is resolved by renderCommentBody via the authorsById map.
  const handleMentionClick = useCallback((userId) => {
    if (!userId) return;
    onClose?.();
    navigate(`/hub?profile=${encodeURIComponent(userId)}`);
  }, [navigate, onClose]);
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

  const authorsById = useAuthorsById();

  // ── @mention autocomplete ─────────────────────────────────────────────────
  const inputRef = useRef(null);
  const [mentionQuery, setMentionQuery] = useState(''); // text after the @
  const [mentionActive, setMentionActive] = useState(false);

  // Build a flat list of known handles from authorsById for autocomplete
  const knownHandles = useMemo(() => {
    return Object.values(authorsById).map(a => ({
      email:  a.email,
      handle: a.username || '',
    })).filter(a => a.handle);
  }, [authorsById]);

  const mentionResults = useMemo(() => {
    if (!mentionActive || mentionQuery.length < 1) return [];
    const q = mentionQuery.toLowerCase();
    return knownHandles.filter(a => a.handle.toLowerCase().startsWith(q)).slice(0, 6);
  }, [mentionActive, mentionQuery, knownHandles]);

  // Called on every keystroke in the comment input
  const handleDraftChange = useCallback((value) => {
    draftGuard.handleChange(value, setDraft);
    // Detect @mention: find the last @ in the string
    const caretPos = inputRef.current?.selectionStart ?? value.length;
    const textBefore = value.slice(0, caretPos);
    const mentionMatch = textBefore.match(/@(\w*)$/);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      setMentionActive(true);
    } else {
      setMentionActive(false);
      setMentionQuery('');
    }
  }, [draftGuard]);

  // Insert selected @handle into draft, replacing the partial @query
  const insertMention = useCallback((handle) => {
    const caretPos = inputRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, caretPos).replace(/@(\w*)$/, `@${handle} `);
    const after  = draft.slice(caretPos);
    const next = before + after;
    setDraft(next);
    setMentionActive(false);
    setMentionQuery('');
    // Restore focus
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const pos = before.length;
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }, [draft]);

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
        author_name: handle(user),
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
    } catch (err) {
      // Surface the actual cause so we can diagnose RLS / schema issues.
      // The previous swallow-everything catch made every cause look
      // identical. The toast now shows the error code so users can
      // report it without opening DevTools, and the full error +
      // payload echo to console for deeper diagnostics.
      console.error('[HubCommentsInline] post failed:', err, {
        post_id: post?.id,
        author_email: user?.email,
        has_username: !!user?.username,
        body_length: trimmed.length,
        is_reply: !!replyTarget?.id,
      });
      const code = err?.code || err?.status;
      const msg = err?.message || '';
      if (code === 'PROFANITY') {
        toast.error(t('hub.composer.profanityError'));
      } else if (code === '42501' || /policy|permission|rls/i.test(msg)) {
        toast.error(t('hub.comments.postError') + ' (permission denied)');
      } else if (code === '23502' || /not[- ]null/i.test(msg)) {
        toast.error(t('hub.comments.postError') + ' (missing required field)');
      } else if (code === '23503' || /foreign key|fkey/i.test(msg)) {
        toast.error(t('hub.comments.postError') + ' (post no longer exists)');
      } else if (code === '23514' || /check constraint|too long/i.test(msg)) {
        toast.error(t('hub.comments.postError') + ' (too long)');
      } else if (code === 'PGRST204' || code === '42703') {
        toast.error(t('hub.comments.postError') + ' (schema mismatch — pending migration)');
      } else if (/network|fetch|timeout/i.test(msg)) {
        toast.error(t('hub.comments.postError') + ' (network — try again)');
      } else {
        // Last-resort: include the code in the toast so the user can
        // tell us what they hit. Truncated so a verbose message
        // doesn't blow out the toast width.
        const codeHint = code ? ` (${code})` : msg ? ` (${msg.slice(0, 40)})` : '';
        toast.error(t('hub.comments.postError') + codeHint);
      }
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
                  authorsById={authorsById}
                  isLiked={isLikedDisplayed(c.id)}
                  likeCount={likeCountFor(c)}
                  onLike={() => handleLike(c.id)}
                  onReply={() => setReplyTarget({ id: c.id, handle: resolveAuthor(authorsById, c.user_id, { author_name: c.author_name }).handle })}
                  onDelete={() => handleDelete(c)}
                  showReply
                  t={t}
                  postAuthorEmail={post.author_email}
                  onMentionClick={handleMentionClick}
                />

                {/* Replies toggle + list */}
                {replies.length > 0 && (
                  <div className="ms-9 mt-1 space-y-2">
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
                              authorsById={authorsById}
                              isLiked={isLikedDisplayed(r.id)}
                              likeCount={likeCountFor(r)}
                              onLike={() => handleLike(r.id)}
                              onDelete={() => handleDelete(r)}
                              showReply={false}
                              t={t}
                              postAuthorEmail={post.author_email}
                              onMentionClick={handleMentionClick}
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

      {/* Composer with @mention autocomplete */}
      <div className="border-t border-border px-3 py-2">
        {/* Mention dropdown — floats above the input */}
        <AnimatePresence>
          {mentionActive && mentionResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="mb-1.5 rounded-xl border border-border bg-card shadow-lg overflow-hidden"
            >
              {mentionResults.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertMention(a.handle); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary transition-colors text-start"
                >
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {a.handle.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="font-medium">@{a.handle}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setMentionActive(false); return; }
              if (e.key === 'Enter' && !e.shiftKey && !mentionActive) {
                e.preventDefault();
                handlePost();
              }
            }}
            onBlur={() => setTimeout(() => setMentionActive(false), 150)}
            placeholder={replyTarget
              ? t('hub.comments.replyPlaceholder')
              : 'Comment… use @ to mention someone'}
            maxLength={500}
            className="flex-1 px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            onClick={handlePost}
            disabled={posting || !draft.trim()}
            className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <ProfanityWarningDialog open={draftGuard.open} onContinue={draftGuard.onContinue} />
    </div>
  );
}

// ── @mention renderer ─────────────────────────────────────────────────────────
// Splits comment body on @username tokens. Each mention becomes a button
// that navigates to the mentioned user's profile (resolved via the
// authorsById map already passed into CommentRow). When the handle
// can't be resolved (no map entry — comment from outside the post's
// author cohort), falls back to a non-clickable highlight so the user
// still sees the mention styling.
// (Audit 10 #2 — mentions used to render as plain styled <span>, tap
// did nothing.)
function renderCommentBody(text, authorsById, onMentionClick) {
  if (!text) return null;
  const parts = text.split(/(@\w+)/g);
  // Index handle (everything after @) → user_id for tap resolution.
  const handleToUserId = (() => {
    const map = new Map();
    Object.values(authorsById || {}).forEach(a => {
      const u = (a?.username || '').toLowerCase();
      if (u && a.id) map.set(u, a.id);
    });
    return map;
  })();
  return parts.map((part, i) => {
    if (!/^@\w+$/.test(part)) return <span key={i}>{part}</span>;
    const handle = part.slice(1).toLowerCase();
    const userId = handleToUserId.get(handle);
    if (!userId || !onMentionClick) {
      return <span key={i} className="font-semibold text-primary">{part}</span>;
    }
    return (
      <button
        key={i}
        type="button"
        onClick={(e) => { e.stopPropagation(); onMentionClick(userId); }}
        className="font-semibold text-primary hover:underline"
      >
        {part}
      </button>
    );
  });
}

// ── CommentRow sub-component ──────────────────────────────────────────────────

function CommentRow({ comment: c, user, authorsById, isLiked, likeCount, onLike, onReply, onDelete, showReply, t, postAuthorEmail, onMentionClick }) {
  const { language } = useLanguage();
  const [reportOpen, setReportOpen] = useState(false);
  const [translation, setTranslation] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [canTranslate, setCanTranslate] = useState(true);
  const author = resolveAuthor(authorsById, c.user_id, {
    author_name: c.author_name,
    author_avatar_url: c.author_avatar_url,
  });
  const isMine = c.user_id === user?.id;
  const timeLabel = c.created_date ? format(parseISO(c.created_date), 'MMM d, h:mma') : '';
  const displayBody = translation && !showOriginal ? translation.text : c.body;

  return (
    <>
      <div className="flex items-start gap-2">
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0 text-xs font-bold overflow-hidden">
          {author.avatarUrl ? (
            <img loading="lazy" src={author.avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            author.initials
          )}
        </div>

        {/* Bubble + actions */}
        <div className="flex-1 min-w-0">
          {c._orphan && (
            <p className="text-[10px] text-muted-foreground italic mb-0.5 ms-2">
              ↳ Reply to a deleted comment
            </p>
          )}
          <div className="bg-secondary/50 rounded-2xl px-3 py-2">
            <div className="flex items-center gap-1 flex-wrap">
              <p className="text-xs font-bold leading-tight">{author.handle}</p>
              {isVerified(author.handle?.replace('@', '')) && (
                <span className="shrink-0 leading-none" style={{ lineHeight: 0 }}>
                  <CrownBadge size={13} />
                </span>
              )}
            </div>
            <p className="text-sm whitespace-pre-wrap break-words mt-0.5">
              {renderCommentBody(displayBody, authorsById, onMentionClick)}
            </p>
          </div>

          {/* Action row */}
          <div className="flex items-center gap-3 mt-1 ms-2 text-[11px] text-muted-foreground flex-wrap">
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

            {/* Translate */}
            {canTranslate && c.body && !isLikelyAlreadyInLanguage(c.body, language) && (
              translation ? (
                <button
                  onClick={() => setShowOriginal(v => !v)}
                  className="flex items-center gap-0.5 hover:text-primary transition-colors"
                >
                  <Languages className="w-3 h-3" />
                  {showOriginal ? 'Show translation' : 'Show original'}
                </button>
              ) : translating ? (
                <span className="flex items-center gap-0.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Translating…
                </span>
              ) : (
                <button
                  onClick={async () => {
                    if (translating) return;
                    setTranslating(true);
                    try {
                      const result = await translateText(c.body, language, 'auto');
                      const translated = result?.translatedText?.trim();
                      const isApiError = translated && /PLEASE SELECT TWO DISTINCT|MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE/i.test(translated);
                      if (translated && translated !== c.body.trim() && !isApiError) {
                        setTranslation({ text: result.translatedText });
                        setShowOriginal(false);
                      } else {
                        setCanTranslate(false);
                      }
                    } catch {
                      setCanTranslate(false);
                    } finally {
                      setTranslating(false);
                    }
                  }}
                  className="flex items-center gap-0.5 hover:text-primary transition-colors"
                >
                  <Languages className="w-3 h-3" />
                  Translate
                </button>
              )
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