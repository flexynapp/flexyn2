import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ThumbsUp, ThumbsDown, MessageCircle, Lock, Globe2, Trash2, Bookmark } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuthorsByEmail, resolveAuthor } from '@/lib/data/useAuthors';
import * as hubReactions from '@/lib/data/hubReactions';
import * as hubPosts from '@/lib/data/hubPosts';
import HubCommentsInline from './HubCommentsInline';
import PostActivityBlock from './PostActivityBlock';
import { toast } from 'sonner';
import { isMealSaved, saveMeal, removeSavedMeal } from '@/lib/savedMeals';

export default function HubPostCard({ post, onAuthorClick = null }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [pendingReaction, setPendingReaction] = useState(undefined);
  const [mealSaved, setMealSaved] = useState(() => isMealSaved(post.id));

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
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-heading font-bold text-primary text-sm overflow-hidden pointer-events-none">
          {author.avatarUrl ? (
            <img src={author.avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            author.initials
          )}
        </div>
        <div className="flex-1 min-w-0 pointer-events-none">
          <p className={`font-heading font-bold text-sm truncate ${onAuthorClick && post.author_email ? 'hover:underline' : ''}`}>
            {author.handle}
          </p>
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
        {isMine && (
          <button
            onClick={handleDelete}
            className="relative p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive transition-colors"
            aria-label={t('hub.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Body */}
      {postBody && (
        <div className="px-3 pb-3 text-sm whitespace-pre-wrap break-words">
          {postBody}
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