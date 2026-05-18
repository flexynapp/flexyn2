import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ThumbsUp, ThumbsDown, MessageCircle, Lock, Globe2, Trash2, Bookmark, Flag, Sticker, Languages, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuthorsByEmail, resolveAuthor } from '@/lib/data/useAuthors';
import * as hubReactions from '@/lib/data/hubReactions';
import * as hubPosts from '@/lib/data/hubPosts';
import * as stickerReactions from '@/lib/data/stickerReactions';
import HubCommentsInline from './HubCommentsInline';
import PostActivityBlock from './PostActivityBlock';
import ReportDialog from './ReportDialog';
import StickerDisplay from './StickerDisplay';
import StickerPanel from './StickerPanel';
import { toast } from 'sonner';
import { isMealSaved, saveMeal, removeSavedMeal } from '@/lib/savedMeals';
import { translateText, isLikelyAlreadyInLanguage } from '@/lib/translate';
import { getLootTitleById } from '@/lib/lootTitles';
import { getLootFrameById } from '@/lib/lootFrames';

export default function HubPostCard({ post, onAuthorClick = null }) {
  const { t, language } = useLanguage();
  // On-demand translation state. Translation is shown alongside (or in place
  // of) the original body when the user taps "Translate".
  const [translation, setTranslation] = useState(null); // { text, sourceLang } | null
  const [translating, setTranslating]   = useState(false);
  const [translateError, setTranslateError] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false); // toggle when translation exists
  const [canTranslate, setCanTranslate] = useState(true); // false once we know post is already in user's language

  // Reset translation state when:
  //   • The user's selected language changes (so the next render shows the
  //     original — they can re-tap Translate to get the new target language)
  //   • The 'flexyn:language-changed' event fires (immediate cross-component
  //     reset triggered by LanguagePicker → setLanguage)
  useEffect(() => {
    setTranslation(null);
    setShowOriginal(false);
    setTranslateError(null);
    setCanTranslate(true);
  }, [language]);
  useEffect(() => {
    const handler = () => {
      setTranslation(null);
      setShowOriginal(false);
      setTranslateError(null);
      setCanTranslate(true);
    };
    window.addEventListener('flexyn:language-changed', handler);
    return () => window.removeEventListener('flexyn:language-changed', handler);
  }, []);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [pendingReaction, setPendingReaction] = useState(undefined);
  const [mealSaved, setMealSaved] = useState(() => isMealSaved(post.id));
  const [reportOpen, setReportOpen] = useState(false);
  const [stickerPanelOpen, setStickerPanelOpen] = useState(false);

  const isMealPost = post.post_type === 'meal';

  const handleSaveMeal = () => {
    if (mealSaved) {
      removeSavedMeal(post.id);
      setMealSaved(false);
      toast.success('Removed from saved meals');
    } else {
      const snap = post.linked_entity_snapshot || {};
      saveMeal({
        id: post.id,
        food_name: snap.food_name || postBody || 'Community Meal',
        calories: snap.calories || 0,
        protein_g: snap.protein_g || 0,
        carbs_g: snap.carbs_g || 0,
        fat_g: snap.fat_g || 0,
        image_url: post.image_url || null,
        author_name: post.author_name || null,
      });
      setMealSaved(true);
      toast.success('Meal saved! Find it in + Log Meal → Saved');
    }
  };
  const desiredRef = useRef(undefined);
  const inFlightRef = useRef(false);

  const { data: myReaction } = useQuery({
    queryKey: ['hubReaction', post.id, user?.email],
    queryFn: () => hubReactions.getMyReaction(post.id, user.email),
    enabled: !!user?.email,
  });

  const { data: stickerRxns = [] } = useQuery({
    queryKey: ['stickerReactions', post.id],
    queryFn: () => stickerReactions.getPostReactions(post.id),
    staleTime: 15_000,
    enabled: true,
  });

  const isMine = post.author_email === user?.email;
  const authorsByEmail = useAuthorsByEmail();
  const author = resolveAuthor(authorsByEmail, post.author_email, {
    author_name: post.author_name,
    author_avatar_url: post.author_avatar_url,
  });

  const serverReaction = myReaction?.reaction_type ?? null;
  const displayedReaction = pendingReaction !== undefined ? pendingReaction : serverReaction;

  const adjust = (target) =>
    (displayedReaction === target ? 1 : 0) - (serverReaction === target ? 1 : 0);
  // Fall back to `content` for posts created before migration 004
  const postBody     = post.body || post.content || '';
  const likeCount    = Math.max(0, (post.like_count    || 0) + adjust('like'));
  const dislikeCount = Math.max(0, (post.dislike_count || 0) + adjust('dislike'));

  const runWorker = async () => {
    inFlightRef.current = true;
    try {
      while (desiredRef.current !== undefined) {
        const target = desiredRef.current;
        desiredRef.current = undefined;
        await hubReactions.setReaction(post.id, user.email, target);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hubReaction', post.id, user.email] }),
        queryClient.invalidateQueries({ queryKey: ['hubFeed'] }),
      ]);
      setPendingReaction(undefined);
    } catch {
      desiredRef.current = undefined;
      setPendingReaction(undefined);
      toast.error(t('hub.reactionError'));
    } finally {
      inFlightRef.current = false;
    }
  };

  const handleReact = (type) => {
    const next = displayedReaction === type ? null : type;
    setPendingReaction(next);
    desiredRef.current = next;
    if (!inFlightRef.current) runWorker();
  };

  const handleDelete = async () => {
    if (!isMine) return;
    if (!window.confirm(t('hub.confirmDelete'))) return;
    try {
      await hubPosts.remove(post.id);
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      toast.success(t('hub.postDeleted'));
    } catch {
      toast.error(t('hub.deleteError'));
    }
  };

  const timeLabel = post.created_date ? format(parseISO(post.created_date), 'MMM d, h:mma') : '';

  return (
    <article className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="relative flex items-start gap-3 p-3">
        <div
          className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-heading font-bold text-primary text-sm overflow-hidden pointer-events-none"
          style={author.equippedFrameId ? (getLootFrameById(author.equippedFrameId)?.css || {}) : {}}
        >
          {author.avatarUrl ? (
            <img src={author.avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            author.initials
          )}
        </div>
        <div className="flex-1 min-w-0 pointer-events-none">
          <div className="flex items-baseline gap-1.5 truncate">
            <p className={`font-heading font-bold text-sm truncate ${onAuthorClick && post.author_email ? 'hover:underline' : ''}`}>
              {author.handle}
            </p>
            {author.equippedTitleId && (() => {
              const title = getLootTitleById(author.equippedTitleId);
              if (!title) return null;
              return (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    background: 'hsl(var(--primary) / 0.12)',
                    color: 'hsl(var(--primary))',
                  }}
                  title={title.description}
                >
                  {title.emoji} {title.name}
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{timeLabel}</span>
            <span>·</span>
            {post.privacy === 'public' ? (
              <Globe2 className="w-3 h-3" />
            ) : (
              <Lock className="w-3 h-3" />
            )}
            <span className="capitalize">{post.privacy === 'public' ? t('hub.privacy.public') : t('hub.privacy.followers')}</span>
          </div>
        </div>
        {onAuthorClick && post.author_email && (
          <button
            type="button"
            onClick={() => onAuthorClick({
              email: post.author_email,
              username: author.username,
              avatar_url: author.avatarUrl,
            })}
            aria-label={`Open ${author.handle}'s profile`}
            className={`absolute inset-0 ${isMine ? 'right-12' : 'right-0'} rounded-tl-xl rounded-tr-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-inset`}
          />
        )}
        {isMine ? (
          <button
            onClick={handleDelete}
            className="relative p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive transition-colors"
            aria-label={t('hub.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => setReportOpen(true)}
            className="relative p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive transition-colors"
            aria-label={t('report.buttonLabel')}
            title={t('report.buttonLabel')}
          >
            <Flag className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Body */}
      {postBody && (
        <div className="px-3 pb-3 text-sm break-words">
          <div className="whitespace-pre-wrap">
            {translation && !showOriginal ? translation.text : postBody}
          </div>
          {/* Translate / Show original — hide once we know the post is already in the user's language */}
          {canTranslate && !isLikelyAlreadyInLanguage(postBody, language) && (
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              {translation ? (
                <button
                  onClick={() => setShowOriginal((v) => !v)}
                  className="flex items-center gap-1 hover:text-primary transition-colors"
                >
                  <Languages className="w-3 h-3" />
                  {showOriginal
                    ? (t('hub.post.showTranslation') === 'hub.post.showTranslation' ? 'Show translation' : t('hub.post.showTranslation'))
                    : (t('hub.post.showOriginal') === 'hub.post.showOriginal' ? 'Show original' : t('hub.post.showOriginal'))}
                </button>
              ) : translating ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t('hub.post.translating') === 'hub.post.translating' ? 'Translating…' : t('hub.post.translating')}
                </span>
              ) : (
                <button
                  onClick={async () => {
                    if (translating) return;
                    setTranslating(true);
                    setTranslateError(null);
                    try {
                      const result = await translateText(postBody, language, 'auto');
                      const translated = result?.translatedText?.trim();
                      // Known API error strings that should never be shown as post content
                      const isApiError = translated && /PLEASE SELECT TWO DISTINCT|MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE/i.test(translated);
                      if (translated && translated !== postBody.trim() && !isApiError) {
                        setTranslation({ text: result.translatedText, sourceLang: result.sourceLang });
                        setShowOriginal(false);
                      } else {
                        // Same language or all engines failed — hide the button so it
                        // doesn't keep appearing for posts already in the user's language.
                        setCanTranslate(false);
                      }
                    } catch (err) {
                      console.warn('[HubPostCard] translation failed:', err);
                      setCanTranslate(false);
                    } finally {
                      setTranslating(false);
                    }
                  }}
                  className="flex items-center gap-1 hover:text-primary transition-colors"
                >
                  <Languages className="w-3 h-3" />
                  {t('hub.post.translate') === 'hub.post.translate' ? 'Translate' : t('hub.post.translate')}
                </button>
              )}
              {translation?.sourceLang && translation.sourceLang !== language && !showOriginal && (
                <span className="text-muted-foreground/70">
                  · {t('hub.post.translatedFrom') === 'hub.post.translatedFrom' ? 'translated from' : t('hub.post.translatedFrom')} {translation.sourceLang}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Activity block — renders snapshot data (cardio map, workout
          summary, meal macros, etc.) attached to the post at create time.
          Falls back to a render-time fetch of the source entity for the
          author's own posts when no snapshot is present. */}
      <PostActivityBlock post={post} />

      {/* Image */}
      {post.image_url && (
        <div className="border-y border-border bg-black">
          <img
            src={post.image_url}
            alt=""
            className="w-full max-h-[600px] object-contain"
            loading="lazy"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 px-2 py-2 border-t border-border">
        <ActionButton
          icon={ThumbsUp}
          count={likeCount}
          active={displayedReaction === 'like'}
          activeColor="text-primary"
          onClick={() => handleReact('like')}
        />
        <ActionButton
          icon={ThumbsDown}
          count={dislikeCount}
          active={displayedReaction === 'dislike'}
          activeColor="text-destructive"
          onClick={() => handleReact('dislike')}
        />
        <ActionButton
          icon={MessageCircle}
          count={post.comment_count || 0}
          active={commentsOpen}
          activeColor="text-primary"
          onClick={() => setCommentsOpen(o => !o)}
        />
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setStickerPanelOpen(o => !o)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            stickerPanelOpen || stickerRxns.length > 0
              ? 'text-primary bg-secondary'
              : 'text-muted-foreground hover:bg-secondary'
          }`}
        >
          <Sticker className="w-4 h-4" />
          {stickerRxns.length > 0 && <span>{stickerRxns.length}</span>}
        </motion.button>
        {isMealPost && (
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={handleSaveMeal}
            className={`ml-auto p-2 rounded-md transition-colors ${mealSaved ? 'text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
            aria-label={mealSaved ? 'Remove from saved meals' : 'Save meal'}
          >
            <Bookmark className={`w-4 h-4 ${mealSaved ? 'fill-current' : ''}`} />
          </motion.button>
        )}
      </div>

      {/* ── Sticker reaction waterfall ─────────────────────────────────────── */}
      {stickerRxns.length > 0 && (
        <button
          onClick={() => setStickerPanelOpen(o => !o)}
          className="flex items-center gap-1 px-3 py-1.5 hover:bg-secondary transition-colors w-full text-left"
        >
          {/* Overlapping sticker circles — waterfall effect */}
          <div className="flex items-center" style={{ marginRight: 6 }}>
            {stickerRxns.slice(0, 6).map((r, i) => (
              <div
                key={r.id}
                className="w-7 h-7 rounded-full bg-card border-2 border-background flex items-center justify-center overflow-visible"
                style={{ marginLeft: i === 0 ? 0 : -10, zIndex: i, position: 'relative' }}
              >
                <StickerDisplay emoji={r.item_emoji} variant={r.variant} size={22} />
              </div>
            ))}
          </div>
          {stickerRxns.length > 6 && (
            <span className="text-xs text-muted-foreground">+{stickerRxns.length - 6}</span>
          )}
        </button>
      )}

      {/* Sticker panel (picker + viewer) */}
      <AnimatePresence>
        {stickerPanelOpen && (
          <div className="px-3 pb-3 pt-1">
            <StickerPanel
              postId={post.id}
              onClose={() => setStickerPanelOpen(false)}
              onAuthorClick={onAuthorClick}
            />
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {commentsOpen && (
          <motion.div
            key="comments"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <HubCommentsInline
              post={post}
              open={commentsOpen}
              onClose={() => setCommentsOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Report dialog — only rendered for other people's posts */}
      {!isMine && (
        <ReportDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          reportedType="post"
          reportedId={post.id}
          reportedAuthorEmail={post.author_email}
        />
      )}
    </article>
  );
}

function ActionButton({ icon: Icon, count, active, activeColor, onClick }) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active ? `${activeColor} bg-secondary` : 'text-muted-foreground hover:bg-secondary'
      }`}
    >
      <Icon className={`w-4 h-4 ${active ? 'fill-current' : ''}`} />
      {count > 0 && <span>{count}</span>}
    </motion.button>
  );
}