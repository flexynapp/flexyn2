import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { isVerified } from '@/lib/verifiedUsers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ThumbsUp, MessageCircle, Lock, Globe2, Trash2, Bookmark, Flag, Languages, Loader2, BarChart3, Heart, Share2, VolumeX, Ban, Pencil, Repeat2, Check, X, Clock, Film, BarChart2, Users, Volume2, ImageIcon, ChevronDown, MoreVertical, Star } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { supabase } from '@/api/supabaseClient';
import ContentWarningGate from './ContentWarningGate';
import { muteUser } from '@/lib/data/userMutes';
import { blockUserFull } from '@/lib/data/userBlocks';
import { parseISO, differenceInHours } from 'date-fns';
import { formatDate, formatRelativeTime } from '@/lib/intlFormat';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuthorsById, resolveAuthor } from '@/lib/data/useAuthors';
import * as hubReactions from '@/lib/data/hubReactions';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { reportError } from '@/lib/reportError';
import * as hubPosts from '@/lib/data/hubPosts';
import * as stickerReactions from '@/lib/data/stickerReactions';
import HubCommentsInline from './HubCommentsInline';
import PostActivityBlock from './PostActivityBlock';
import ReportDialog from './ReportDialog';
import StickerDisplay from './StickerDisplay';
import StickerPanel from './StickerPanel';
import { toast } from '@/lib/toast';
import { isMealSaved, saveMeal, removeSavedMeal } from '@/lib/savedMeals';
import { translateText, isLikelyAlreadyInLanguage } from '@/lib/translate';
import * as hubSavedPosts from '@/lib/data/hubSavedPosts';
import * as hubPostViews from '@/lib/data/hubPostViews';
import ShareSheetModal from './ShareSheetModal';
import CreatorAnalyticsPanel from './CreatorAnalyticsPanel';
import { getLootTitleById } from '@/lib/lootTitles';
import { getLootFrameById } from '@/lib/lootFrames';
import { cdnImageUrl, cdnFallbackSrc } from '@/lib/imageCdn';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { invalidateFollowGraph } from '@/lib/followGraphCache';

// ── Hashtag renderer ──────────────────────────────────────────────────────────
// Splits post body on #word tokens and renders each as a tappable chip.
// Called in the body section only when onHashtagClick is provided.
function renderBodyWithHashtags(text, onHashtagClick) {
  if (!onHashtagClick) {
    return <>{text}</>;
  }
  const parts = text.split(/(#\w+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^#\w+$/.test(part)) {
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); onHashtagClick(part.toLowerCase()); }}
              className="text-primary font-medium hover:underline focus:outline-none"
            >
              {part}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── Repost card — fetches the original post and renders a compact preview ─────
function RepostCard({ originalPostId, onAuthorClick }) {
  const { tFallback } = useLanguage();
  const [original, setOriginal] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!originalPostId) return;
    import('@/lib/data/hubPosts').then(({ get }) =>
      get(originalPostId)
        .then(setOriginal)
        .catch(() => setOriginal(null))
        .finally(() => setLoading(false))
    );
  }, [originalPostId]);

  if (loading) {
    return (
      <div className="mx-3 mb-3 rounded-xl border border-border bg-secondary/20 p-3 animate-pulse">
        <div className="h-3 bg-muted rounded w-20 mb-2" />
        <div className="h-3 bg-muted rounded w-full" />
      </div>
    );
  }
  if (!original) return null;

  const body = original.body || original.content || '';
  const displayName = original.author_name || 'Athlete';

  return (
    <div
      className="mx-3 mb-3 rounded-xl border border-border bg-secondary/20 p-3 cursor-pointer hover:bg-secondary/40 active:bg-secondary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      onClick={(e) => {
        e.stopPropagation();
        onAuthorClick?.({ id: original.user_id, email: original.author_email });
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAuthorClick?.({ id: original.user_id, email: original.author_email });
        }
      }}
      aria-label={`Open ${displayName}'s profile`}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Repeat2 className="w-3 h-3 text-primary shrink-0" />
        <span className="text-xs font-semibold text-muted-foreground">{displayName}</span>
      </div>
      <p className="text-sm text-foreground line-clamp-3 leading-relaxed">
        {body.startsWith('[POLL_V1]') ? '📊 Poll' : body || tFallback('hub.post.noBody', 'Shared a post')}
      </p>
    </div>
  );
}

function CrownBadge({ size = 14 }) {
  const { tFallback } = useLanguage();
  return (
    <svg width={size} height={size} viewBox="0 0 16 14" fill="none" aria-label={tFallback("hubPostCard.admin", "Admin")} title={tFallback("hubPostCard.verifiedAdmin", "Verified Admin")}>
      <path d="M1 12h14M2 12L1 4l4 3.5L8 1l3 6.5L15 4l-1 8H2z" fill="#f97316" stroke="#ea6c00" strokeWidth="0.8" strokeLinejoin="round"/>
    </svg>
  );
}
// ── Post-type accent border ───────────────────────────────────────────────────
// Post-type accent — deliberately returns nothing now.
//
// This used to be eleven `border-l-4` stripes, one hue per post type
// (violet workout, green cardio, orange meal, amber achievement, indigo
// regimen, blue stats, red video, pink poll…). The 4px coloured left
// border is the single most-cited tell of AI-generated UI — more
// reliable than any other visual signature — and this was it, in
// eleven colours, on the most-scrolled surface in the app.
//
// It also didn't earn its keep. Every one of these post types already
// renders its own activity block immediately below the header: a
// workout post shows sets, a meal post shows macros, a poll shows
// options. The stripe restated in colour what the card says in content
// two lines later, and it spent eight off-budget hues doing it.
//
// Kept as a function returning '' rather than ripped out at the
// call-sites, so the diamond-glow branch below keeps its shape and a
// future per-type treatment (an icon in the header, say) has an obvious
// home. If you add one, don't make it a coloured edge.
function getPostTypeAccent(/* post */) {
  return '';
}

// ── Feature 24: Poll Card ────────────────────────────────────────────────────
const VOTE_KEY = (postId, userEmail) => `poll_vote_${postId}_${userEmail}`;

function PollCard({ post, userEmail }) {
  const { tFallback } = useLanguage();
  // Parse the poll payload from the post body. Failures and shape
  // mismatches are tracked as `isValid = false` and we render null at
  // the END — Rules of Hooks forbids early returns before hooks below,
  // so we have to compute first and gate the render last.
  let pollData = null;
  try {
    const raw = (post.body || '').replace('[POLL_V1]', '');
    pollData = JSON.parse(raw);
  } catch { /* fall through with pollData = null */ }
  const question = pollData?.question;
  const options  = Array.isArray(pollData?.options) ? pollData.options : null;
  const isValid  = !!(question && options && options.length >= 2);
  const optionCount = options?.length ?? 0;

  // Local voted state (persisted to localStorage + attempted DB write).
  // Hooks unconditional — required by Rules of Hooks — and gated below.
  const [myVote, setMyVote] = useState(() => {
    try { return JSON.parse(localStorage.getItem(VOTE_KEY(post.id, userEmail))); } catch { return null; }
  });
  // vote counts: try to fetch from DB, fall back to local tracking
  const [counts, setCounts] = useState(() => Array.from({ length: optionCount }, () => 0));
  const [totalVotes, setTotalVotes] = useState(0);
  const [voting, setVoting] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineVotes, setTimelineVotes] = useState([]);

  // Fetch existing votes from Supabase (graceful fallback if table missing).
  // Guard the resolved setState with a `cancelled` flag — without it, a
  // user scrolling past a poll mid-flight unmounts the card before the
  // promise resolves, and the setState fires on an unmounted component
  // (React dev warning + slow leak in prod).
  useEffect(() => {
    if (!isValid || !post.id) return;
    let cancelled = false;
    supabase
      .from('poll_votes')
      .select('option_index')
      .eq('post_id', post.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) return; // table might not exist yet
        const c = Array.from({ length: optionCount }, () => 0);
        data.forEach(r => { if (r.option_index >= 0 && r.option_index < optionCount) c[r.option_index]++; });
        setCounts(c);
        setTotalVotes(data.length);
      });
    return () => { cancelled = true; };
  }, [post.id, optionCount, isValid]);

  // Fetch vote timeline when showTimeline is toggled on. Same
  // cancelled-flag pattern as the votes-fetch above.
  useEffect(() => {
    if (!showTimeline || !post.id) return;
    let cancelled = false;
    supabase
      .from('poll_votes')
      .select('option_index, created_at')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setTimelineVotes(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showTimeline, post.id]);

  if (!isValid) return null;

  const handleVote = async (idx) => {
    if (myVote !== null || voting || !userEmail) return;
    setVoting(true);
    // Optimistic update
    setMyVote(idx);
    setCounts(prev => prev.map((c, i) => i === idx ? c + 1 : c));
    setTotalVotes(t => t + 1);
    try {
      localStorage.setItem(VOTE_KEY(post.id, userEmail), JSON.stringify(idx));
    } catch {}
    // Try DB insert (graceful fail if table doesn't exist)
    try {
      await supabase.from('poll_votes').insert({
        post_id: post.id,
        user_email: userEmail,
        option_index: idx,
      });
    } catch { /* table may not exist — local vote already recorded */ }
    setVoting(false);
  };

  return (
    // stopPropagation on pointerup so tapping a poll option doesn't also
    // bubble to the article's double-tap-to-like detector.
    <div className="px-3 pb-3" onPointerUp={(e) => e.stopPropagation()}>
      <div className="rounded-xl border border-border bg-secondary/20 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <BarChart3 className="w-3.5 h-3.5 text-primary" />
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{tFallback("hubPostCard.poll", "Poll")}</p>
        </div>
        <p className="text-sm font-semibold text-foreground mb-3">{question}</p>
        <div className="space-y-2">
          {options.map((opt, i) => {
            const pct = totalVotes > 0 ? Math.round((counts[i] / totalVotes) * 100) : 0;
            const isMyChoice = myVote === i;
            const voted = myVote !== null;
            return (
              <button
                key={i}
                onClick={() => handleVote(i)}
                disabled={voted || voting}
                className={`w-full text-start rounded-lg overflow-hidden border transition-colors ${
                  isMyChoice ? 'border-primary' : 'border-border'
                } ${!voted ? 'hover:border-primary/50 active:bg-secondary/60' : ''}`}
              >
                <div className="relative px-3 py-2">
                  {/* Progress bar bg */}
                  {voted && (
                    <div
                      className={`absolute inset-0 rounded-lg transition-all duration-500 ${isMyChoice ? 'bg-primary/15' : 'bg-secondary/40'}`}
                      style={{ width: `${pct}%` }}
                    />
                  )}
                  <div className="relative flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{opt}</span>
                    {voted && (
                      <span className="text-xs font-bold text-muted-foreground shrink-0">{pct}%</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-2">
          {myVote !== null && (
            <p className="text-micro text-muted-foreground">{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</p>
          )}
          {totalVotes > 0 && (
            <button
              onClick={() => setShowTimeline(v => !v)}
              className="text-micro text-primary font-medium hover:underline ml-auto"
            >
              {showTimeline ? 'Hide timeline' : 'Vote timeline →'}
            </button>
          )}
        </div>
        {/* Vote timeline */}
        {showTimeline && timelineVotes.length > 0 && (
          <div className="mt-3 border-t border-border pt-2">
            <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground mb-2">{tFallback("hubPostCard.voteHistory", "Vote history")}</p>
            <div className="relative ps-3">
              {/* Vertical line */}
              <div className="absolute start-1 top-0 bottom-0 w-px bg-border" />
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {timelineVotes.map((v, i) => {
                  const optLabel = options?.[v.option_index] || `Option ${v.option_index + 1}`;
                  const ts = v.created_at ? new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                  const date = v.created_at ? new Date(v.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
                  return (
                    <div key={i} className="flex items-center gap-2 text-micro">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 -ml-px" />
                      <span className="text-muted-foreground shrink-0">{date} {ts}</span>
                      <span className="font-medium text-foreground truncate">{optLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Collapsible image preview (Twitter/X-style) ──────────────────────────────
// Default: compact blurred thumbnail with "Tap to view" overlay.
// Tap once to expand to full image; tap again to collapse.
function ImagePreview({ src }) {
  const { tFallback } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  // CDN transforms (no-ops until VITE_IMAGE_CDN=1 — see lib/imageCdn.js):
  // the collapsed teaser renders 100px tall + blurred, so it never needs
  // the full upload; the expanded view caps at sensible mobile width.
  const teaserSrc   = cdnImageUrl(src, { width: 320,  quality: 50 });
  const expandedSrc = cdnImageUrl(src, { width: 1080, quality: 75 });
  return (
    <div
      className="border-y border-border bg-black cursor-pointer select-none"
      onClick={() => setExpanded(v => !v)}
      // stopPropagation on pointerup so tapping the image preview to
      // expand/collapse doesn't also bubble to the article's double-tap
      // detector and toggle a like.
      onPointerUp={(e) => e.stopPropagation()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v); }}
      aria-label={expanded ? 'Collapse image' : 'Expand image'}
    >
      {expanded ? (
        <div className="relative">
          <img
            src={expandedSrc}
            alt=""
            className="w-full max-h-[600px] object-contain"
            loading="lazy"
            onError={(e) => {
              if (cdnFallbackSrc(e, src)) return; // transform failed → retry raw
              e.currentTarget.parentElement.style.display = 'none';
            }}
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            className="absolute top-2 end-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 active:bg-black/70 transition-colors"
            aria-label={tFallback("hubPostCard.collapseImage", "Collapse image")}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative overflow-hidden" style={{ height: 100 }}>
          <img
            src={teaserSrc}
            alt=""
            className="w-full h-full object-cover"
            style={{ filter: 'blur(4px)', transform: 'scale(1.05)', opacity: 0.55 }}
            loading="lazy"
            onError={(e) => {
              if (cdnFallbackSrc(e, src)) return; // transform failed → retry raw
              const el = e.currentTarget.closest('[role=button]'); if (el) el.style.display = 'none';
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/85 backdrop-blur-sm border border-border/60 text-xs font-semibold text-foreground shadow-sm">
              <ImageIcon className="w-3.5 h-3.5" />
              {tFallback("hubPostCard.tapToViewPhoto", "Tap to view photo")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Memoized: the Hub feed renders 8-50 of these heavy (motion-laden, ~1450-line)
// cards. Without memo, any HubFeed state change (e.g. the realtime new-posts
// pill bumping a counter) re-rendered every card. Props are `post` + two
// callbacks now stabilized in HubFeed, so memo holds across those updates.
function HubPostCard({ post, onAuthorClick = null, onHashtagClick = null }) {
  const { t, tFallback, language } = useLanguage();
  // onHashtagClick: optional prop to filter feed by a hashtag
  // (passed in by HubFeed when hashtag system is active)
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
  // Confirmations are in-app dialogs rather than window.confirm — see the
  // note at the top of ConfirmDialog for why the browser one is wrong here.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmBlockOpen, setConfirmBlockOpen] = useState(false);
  const [stickerPanelOpen, setStickerPanelOpen] = useState(false);

  const isMealPost = post.post_type === 'meal';

  // ── Saved posts (universal bookmark) ─────────────────────────────────────────
  const [postSaved, setPostSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  useEffect(() => {
    if (!user?.email || !post.id) return;
    hubSavedPosts.isSaved(user.email, post.id).then(setPostSaved).catch(() => {});
  }, [user?.email, post.id]);

  const handleToggleSave = async (e) => {
    e.stopPropagation();
    if (!user?.email || saveLoading) return;
    setSaveLoading(true);
    const next = !postSaved;
    setPostSaved(next);
    try {
      if (next) {
        await hubSavedPosts.save(user.email, post.id);
        toast.success(tFallback('hub.post.saved', 'Post saved'));
      } else {
        await hubSavedPosts.unsave(user.email, post.id);
        toast.success(tFallback('hub.post.unsaved', 'Removed from saved'));
      }
    } catch {
      setPostSaved(!next); // revert
      toast.error(tFallback('hub.post.saveError', 'Could not save post'));
    } finally {
      setSaveLoading(false);
    }
  };

  // ── Share sheet ───────────────────────────────────────────────────────────────
  const [shareSheetOpen, setShareSheetOpen] = useState(false);

  // ── Creator analytics ─────────────────────────────────────────────────────────
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  // ── Video mute toggle ─────────────────────────────────────────────────────────
  const [videoMuted, setVideoMuted] = useState(true);
  const videoRef = useRef(null);

  // `isMine` is read by the view-tracking effect below + its deps array,
  // by handleAvatarTap / delete handler / many JSX conditionals later.
  // It MUST be declared before the useEffect that lists it as a dep —
  // otherwise the deps-array expression `[..., isMine]` evaluates while
  // `isMine` is still in the temporal dead zone and the component
  // throws `ReferenceError: can't access lexical declaration before
  // initialization` (only visible after minification in production —
  // dev mode masks it). This was the cause of the 2026-05-23 prod
  // Hub crash; previously declared at line 473 below.
  const isMine = !!user?.id && post.user_id === user.id;

  // ── View tracking (IntersectionObserver, 2-second dwell) ─────────────────────
  const cardRef = useRef(null);
  const viewTrackedRef = useRef(false);
  useEffect(() => {
    if (!user?.email || !post.id || viewTrackedRef.current || isMine) return;
    const el = cardRef.current;
    if (!el) return;
    let timer = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !viewTrackedRef.current) {
          timer = setTimeout(() => {
            viewTrackedRef.current = true;
            hubPostViews.recordView(post.id, user.email).catch(() => {});
          }, 2000);
        } else {
          if (timer) { clearTimeout(timer); timer = null; }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [user?.email, post.id, isMine]);

  const handleSaveMeal = () => {
    if (mealSaved) {
      removeSavedMeal(post.id);
      setMealSaved(false);
      toast.success(tFallback("hubPostCard.removedFromSavedMeals", "Removed from saved meals"));
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
      toast.success(tFallback("hubPostCard.mealSavedFind", "Meal saved! Find it in + Log Meal → Saved"));
    }
  };
  const desiredRef = useRef(undefined);
  const inFlightRef = useRef(false);
  // One quest credit per card, however many times this post is reacted to.
  const reactionQuestedRef = useRef(false);

  const { data: myReaction } = useQuery({
    queryKey: ['hubReaction', post.id, user?.email],
    queryFn: () => hubReactions.getMyReaction(post.id, user.email),
    enabled: !!user?.email,
  });

  // Emoji reaction (independent from like/dislike). Lazy-fetched per
  // card so the post feed query stays small; reads are LRU-cached by
  // TanStack so the same card doesn't refetch on scroll-back.
  const { data: myEmojiReaction } = useQuery({
    queryKey: ['hubEmojiReaction', post.id, user?.email],
    queryFn: () => hubReactions.getMyEmojiReaction(post.id, user.email),
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  const { data: stickerRxns = [] } = useQuery({
    queryKey: ['stickerReactions', post.id],
    queryFn: () => stickerReactions.getPostReactions(post.id),
    staleTime: 15_000,
    enabled: true,
  });

  const hasDiamond = stickerRxns.some(r => r.variant === 'diamond');

  // Feature 25: sort sticker reactions by rarity (rarest first)
  const RARITY_ORDER = { diamond: 0, legendary: 1, epic: 2, rare: 3, uncommon: 4, common: 5 };
  // Distinct stickers with a count, rarest first. Keyed on emoji AND variant:
  // a gold version is a different object from the plain one, and merging them
  // would misreport what is actually on the post.
  const groupedStickers = (() => {
    const byKey = new Map();
    for (const r of stickerRxns) {
      const key = `${r.item_emoji}|${r.variant || ''}`;
      const hit = byKey.get(key);
      if (hit) hit.count += 1;
      else byKey.set(key, { key, emoji: r.item_emoji, variant: r.variant, count: 1 });
    }
    return [...byKey.values()].sort(
      (a, b) => (RARITY_ORDER[a.variant] ?? 6) - (RARITY_ORDER[b.variant] ?? 6) || b.count - a.count
    );
  })();

  // ── Double-tap to like (refs/state only — callback defined after handleReact)
  const lastTapRef = useRef({ time: 0, x: 0, y: 0 });
  const [heartAnim, setHeartAnim] = useState(null); // { x, y, id }
  const doubleTapGuardRef = useRef(false);

  // ── Long-press avatar preview ─────────────────────────────────────────────
  const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false);
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(avatarPreviewOpen);
  const avatarLongPressRef = useRef(null);

  const startAvatarLongPress = useCallback(() => {
    avatarLongPressRef.current = setTimeout(() => setAvatarPreviewOpen(true), 500);
  }, []);
  const cancelAvatarLongPress = useCallback(() => {
    if (avatarLongPressRef.current) { clearTimeout(avatarLongPressRef.current); avatarLongPressRef.current = null; }
  }, []);

  // `isMine` is now declared earlier in the function body (see the
  // "is this my own post?" block above the view-tracking useEffect)
  // because the deps array of that useEffect references it. Keeping
  // a duplicate `const isMine =` here would be a redeclaration error.
  const authorsById = useAuthorsById();
  const author = resolveAuthor(authorsById, post.user_id, {
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
      let settled;
      while (desiredRef.current !== undefined) {
        const target = desiredRef.current;
        desiredRef.current = undefined;
        await hubReactions.setReaction(post.id, user.email, target);
        settled = target;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hubReaction', post.id, user.email] }),
        queryClient.invalidateQueries({ queryKey: ['hubFeed'] }),
      ]);
      // Quest progress — non-blocking. Counted once per card, and only when
      // the settled state is an actual reaction: `target` is null when the
      // user is REMOVING one, and the loop above coalesces a burst of taps,
      // so without both guards a single post could walk a "react to 3 posts"
      // quest to done by itself.
      if (settled && !reactionQuestedRef.current) {
        reactionQuestedRef.current = true;
        quests.recordAction(user, ACTION_TYPES.HUB_REACTION, 1)
          .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
          .catch(() => {});
      }
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
    // Early-return if the user is mid-logout. `runWorker` reads
    // `user.email` unconditionally, but a card rendered momentarily
    // during the auth transition (where useAuth().user becomes null)
    // would throw `Cannot read properties of undefined`. Wave 54
    // (Hub audit) caught this.
    if (!user?.email) return;
    const next = displayedReaction === type ? null : type;
    setPendingReaction(next);
    desiredRef.current = next;
    if (!inFlightRef.current) runWorker();
  };

  // ── Double-tap-to-like (pointer-event driven) ──────────────────────────────
  // Previously this was wired to BOTH onClick and onTouchStart on the article.
  // On a touch device a single physical tap fires `touchstart` and then a
  // compatibility `click` ~100-200ms later — inside the 300ms double-tap
  // window — so EVERY single tap registered as a double-tap "like". Child
  // controls (Like/Dislike, poll options, image preview) also bubbled up to
  // the article detector, so e.g. tapping Dislike toggled a dislike and then
  // the bubbled fake double-tap toggled a like → the post ended LIKED.
  //
  // Fix: drive the gesture from a SINGLE `onPointerUp` on the article. Pointer
  // events fire exactly once per physical interaction (no compat-click twin),
  // and `e.pointerType` tells us mouse vs touch vs pen. We measure the gap
  // between consecutive pointer-ups; two within 300ms = a double-tap. Child
  // interactive regions call stopPropagation so their taps never reach here.
  const handlePointerUp = useCallback((e) => {
    // Only the primary button / a real tap should count. Ignore synthetic
    // or right/middle clicks.
    if (e.button != null && e.button !== 0) return;
    const now = Date.now();
    const last = lastTapRef.current;
    if (now - last.time < 300) {
      doubleTapGuardRef.current = true;
      // Toggle-safe: only ADD a like; never unlike on a double-tap so a
      // rapid string of taps can't produce a like/unlike storm.
      if (displayedReaction !== 'like') handleReact('like');
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left;
      const y = (e.clientY ?? rect.top + rect.height / 2) - rect.top;
      const id = Date.now();
      setHeartAnim({ x, y, id });
      setTimeout(() => setHeartAnim(a => a?.id === id ? null : a), 700);
      // Reset so a third tap doesn't chain into another "double".
      lastTapRef.current = { time: 0, x: 0, y: 0 };
      // Clear the guard shortly after so subsequent single taps (e.g. on the
      // avatar overlay) work normally.
      setTimeout(() => { doubleTapGuardRef.current = false; }, 350);
      return;
    }
    lastTapRef.current = { time: now, x: e.clientX ?? 0, y: e.clientY ?? 0 };
    doubleTapGuardRef.current = false;
  }, [displayedReaction, handleReact]);

  const authorHandle = post.author_name?.replace(/^@/, '') || 'this user';

  const handleMuteAuthor = async () => {
    try {
      await muteUser(user, post.user_id);
      toast.success(tFallback(
        'hub.post.mutedToast',
        "Muted @{name}. Their posts won't appear in your feed.",
        { name: authorHandle },
      ));
      queryClient.invalidateQueries({ queryKey: ['userMutes', user?.id] });
    } catch (err) {
      reportError(err, { feature: 'hub.mute-author', level: 'warning', userEmail: user?.email, target: post.user_id });
      toast.error(tFallback('hub.post.muteError', 'Could not mute. Try again.'));
    }
  };

  const confirmBlockAuthor = async () => {
    setConfirmBlockOpen(false);
    try {
      await blockUserFull(post.user_id);
      toast.success(tFallback('hub.post.blockedToast', 'Blocked @{name}.', { name: authorHandle }));
      queryClient.invalidateQueries({ queryKey: ['userBlocks', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      // block_user_full ALSO severs mutual follow rows. Invalidate
      // the follow-graph caches so the blocked user disappears
      // from the viewer's following list AND the followers
      // list immediately, instead of waiting for the next
      // 30s feed refetch. (Audit 10 #12.)
      queryClient.invalidateQueries({ queryKey: ['myFollowsForDMs', user?.email] });
      invalidateFollowGraph(queryClient);
    } catch (err) {
      reportError(err, { feature: 'hub.block-author', level: 'warning', userEmail: user?.email, target: post.user_id });
      toast.error(tFallback('hub.post.blockError', 'Could not block. Try again.'));
    }
  };

  const handleDelete = async () => {
    if (!isMine) return;
    setConfirmDeleteOpen(false);
    try {
      await hubPosts.remove(post.id);
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      toast.success(t('hub.postDeleted'));
    } catch {
      toast.error(t('hub.deleteError'));
    }
  };

  // ── Inline post edit ─────────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const handleEditStart = (e) => {
    e.stopPropagation();
    setEditDraft(postBody);
    setEditMode(true);
  };

  const handleEditSave = async (e) => {
    e.stopPropagation();
    const trimmed = editDraft.trim();
    if (!trimmed || trimmed === postBody) { setEditMode(false); return; }
    setEditSaving(true);
    try {
      await hubPosts.update(post.id, { body: trimmed, edited_at: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      queryClient.invalidateQueries({ queryKey: ['hubProfilePosts'] });
      toast.success(tFallback('hub.post.editSaved', 'Post updated'));
      setEditMode(false);
    } catch (err) {
      if (err?.code === 'PROFANITY') {
        toast.error(tFallback('hub.post.profanity', 'Post contains flagged language'));
      } else {
        toast.error(tFallback('hub.post.editError', 'Could not save edit'));
      }
    } finally {
      setEditSaving(false);
    }
  };

  const handleEditCancel = (e) => {
    e.stopPropagation();
    setEditMode(false);
  };

  // ── Repost ───────────────────────────────────────────────────────────────────
  const [reposting, setReposting] = useState(false);
  // Synchronous in-flight guard. `reposting` state is set
  // asynchronously, so a fast double-tap on the repost button could
  // enter handleRepost twice and produce two duplicate reposts. Same
  // pattern fixed in HubComposer + Workout save.
  const repostInFlightRef = useRef(false);
  const handleRepost = async (e) => {
    e.stopPropagation();
    if (!user?.email || reposting || repostInFlightRef.current) return;
    // Privacy clamp: a public repost of a non-public original would
    // expose the original to viewers the author never opted-in to share
    // with. Block reposts of followers/private posts entirely and toast
    // a clear reason; only public originals can be reposted publicly.
    // (Audit 10 #29.)
    const originalPrivacy = (post.privacy || 'public').toLowerCase();
    if (originalPrivacy !== 'public') {
      toast.error(
        tFallback('hub.post.repostPrivate', "Can't repost. The original isn't public.")
      );
      return;
    }
    repostInFlightRef.current = true;
    setReposting(true);
    try {
      await hubPosts.create({
        author_email: user.email,
        author_name: user.username || 'Athlete',
        body: '', // repost body empty — original shown via original_post_id
        privacy: 'public',
        post_type: 'repost',
        original_post_id: post.id,
      });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      toast.success(tFallback('hub.post.reposted', 'Reposted to your feed'));
    } catch {
      toast.error(tFallback('hub.post.repostError', 'Could not repost'));
    } finally {
      repostInFlightRef.current = false;
      setReposting(false);
    }
  };

  // Relative time for recent posts ("3 minutes ago", "2 hours ago"),
  // absolute date for older ones ("> 24 h old). Same pattern as DMs.
  const timeLabel = (() => {
    if (!post.created_date) return '';
    const d = parseISO(post.created_date);
    const hoursOld = differenceInHours(new Date(), d);
    // Intl, not date-fns: date-fns binds no locale and wrote "3 hours ago"
    // and "Mon 3:45PM" under every language.
    if (hoursOld < 24) return formatRelativeTime(d, language);
    if (hoursOld < 24 * 7) return formatDate(d, language, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return formatDate(d, language, { month: 'short', day: 'numeric' });
  })();

  const typeAccent = getPostTypeAccent(post);

  return (
    <article
      ref={cardRef}
      // Two visual signals can stack on a single post:
      //   1. typeAccent — left-edge stripe coloring the post by its category
      //      (purple = regimen, orange = meal, etc.). Always meaningful: the
      //      category is a property of the post itself.
      //   2. hasDiamond glow — cyan halo around the card when at least one
      //      viewer has reacted with the diamond sticker (rarest reaction).
      //      Always meaningful: it's social proof for the post.
      //
      // Previously these collided: the hasDiamond branch dropped typeAccent
      // entirely, so a Regimen post (purple left stripe) lost its category
      // identity the moment someone reacted with diamond — the user reported
      // the regimen post border vanishing into the cyan hue.
      //
      // Fix: keep typeAccent on the diamond branch too. The 4px left-edge
      // stripe sits inside the 1px cyan inset boxShadow and is preserved.
      className={`border rounded-xl overflow-hidden relative ${hasDiamond ? `border-cyan-300/80 ${typeAccent}` : `bg-card border-border ${typeAccent}`}`}
      style={hasDiamond ? {
        background: 'rgba(244,250,255,0.04)',
        boxShadow: '0 0 28px rgba(103,232,249,0.55), 0 0 8px rgba(103,232,249,0.35), 0 0 0 1px rgba(103,232,249,0.30)',
      } : undefined}
      onPointerUp={handlePointerUp}
    >
      {/* Double-tap heart animation */}
      <AnimatePresence>
        {heartAnim && (
          <motion.div
            key={heartAnim.id}
            initial={{ opacity: 0.9, scale: 1, y: 0 }}
            animate={{ opacity: 0, scale: 2, y: -40 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute z-30 pointer-events-none"
            style={{ left: heartAnim.x - 16, top: heartAnim.y - 16 }}
          >
            <Heart className="w-8 h-8 fill-destructive text-destructive drop-shadow-lg" />
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header */}
      <div className="relative flex items-start gap-3 p-3">
        {/* self-center (not the row's items-start) so the avatar stays visually
            centered against the name block whether it's 2 lines (name + meta)
            or 3 (name + title pill + meta). The row keeps items-start so the
            mute/block/flag actions stay pinned to the top-right. */}
        <div
          className="relative w-9 h-9 shrink-0 self-center pointer-events-none"
        >
          <div
            className="w-full h-full rounded-full bg-primary/10 flex items-center justify-center font-heading font-bold text-primary text-sm overflow-hidden"
            style={author.equippedFrameId ? (getLootFrameById(author.equippedFrameId)?.css || {}) : {}}
          >
            {author.avatarUrl ? (
              <img
                src={author.avatarUrl}
                alt=""
                width="36"
                height="36"
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            ) : (
              author.initials
            )}
          </div>
          {isVerified(author.username) && (
            <div className="absolute -top-1.5 -start-1.5 flex items-center justify-center" style={{ lineHeight: 0, transform: 'rotate(-25deg)' }}>
              <CrownBadge size={15} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 pointer-events-none">
          <div className="flex items-baseline gap-1.5 min-w-0">
            {/* min-w-0 lets the handle shrink below its intrinsic width so
                `truncate` actually ellipsizes it. Without it, a long handle
                keeps full width and shoves the shrink-0 trophy / title badge
                past the card edge (clipped) instead of truncating cleanly. */}
            {/* Display name leads when there is one, with the handle after it
                in muted text — the shape every social feed uses, and what
                Sean asked for ("we're posting both the name as well as the
                proper @name"). With no display name the handle keeps the bold
                slot on its own, which is every post today. */}
            <p className={`font-heading font-bold text-sm truncate min-w-0 ${onAuthorClick && post.author_email ? 'hover:underline' : ''}`}>
              {author.displayName || author.handle}
            </p>
            {author.displayName && (
              <p className="text-xs text-muted-foreground truncate min-w-0 shrink">
                {author.handle}
              </p>
            )}
            {author.signatureTrophy && (
              <span className="text-sm leading-none shrink-0" title={tFallback("hubPostCard.signatureTrophy", "Signature trophy")} aria-label={tFallback("hubPostCard.signatureTrophy", "Signature trophy")}>
                {author.signatureTrophy}
              </span>
            )}
          </div>
          {/* Equipped title moved OFF the username line and onto the meta row.
              It was `shrink-0` next to a `truncate` handle, so the badge always
              won the space and long usernames collapsed to "@…". Down here it
              reads as metadata (title · time · privacy), the handle gets the
              full width, and the wrapping row keeps it tidy on narrow cards. */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
            {author.equippedTitleId && (() => {
              const title = getLootTitleById(author.equippedTitleId);
              if (!title) return null;
              return (
                <>
                  <span
                    className="text-micro font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: 'hsl(var(--primary) / 0.12)',
                      color: 'hsl(var(--primary))',
                    }}
                    title={title.description}
                  >
                    {title.emoji} {title.name}
                  </span>
                </>
              );
            })()}
            <span>{timeLabel}</span>
            <span>·</span>
            {post.privacy === 'public' ? (
              <Globe2 className="w-3 h-3" />
            ) : (
              <Lock className="w-3 h-3" />
            )}
            <span className="capitalize">{post.privacy === 'public' ? t('hub.privacy.public') : t('hub.privacy.followers')}</span>
            {/* Collaborators — "with @username" */}
            {Array.isArray(post.collaborator_emails) && post.collaborator_emails.length > 0 && (
              <>
                <span>·</span>
                <span className="flex items-center gap-0.5">
                  <Users className="w-3 h-3" />
                  {tFallback('hub.post.with', 'with')}{' '}
                  {post.collaborator_emails.slice(0, 2).map((e, i) => (
                    <button
                      key={e}
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); onAuthorClick?.({ email: e }); }}
                      className="font-semibold text-foreground hover:underline"
                    >
                      @athlete{i < Math.min(post.collaborator_emails.length, 2) - 1 ? ', ' : ''}
                    </button>
                  ))}
                </span>
              </>
            )}
          </div>
        </div>
        {onAuthorClick && post.author_email && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!doubleTapGuardRef.current) onAuthorClick({ id: post.user_id, email: post.author_email, username: author.username, avatar_url: author.avatarUrl });
            }}
            onMouseDown={(e) => { e.stopPropagation(); startAvatarLongPress(); }}
            onMouseUp={cancelAvatarLongPress}
            onMouseLeave={cancelAvatarLongPress}
            onTouchStart={(e) => { e.stopPropagation(); startAvatarLongPress(); }}
            onTouchEnd={cancelAvatarLongPress}
            onTouchMove={cancelAvatarLongPress}
            // stopPropagation on pointerup so a tap to open the profile
            // doesn't also feed the article's double-tap-to-like detector.
            onPointerUp={(e) => e.stopPropagation()}
            aria-label={`Open ${author.handle}'s profile`}
            className={`absolute inset-0 ${isMine ? 'end-16' : 'end-0'} rounded-tl-xl rounded-tr-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-inset`}
          />
        )}
        {isMine ? (
          <div className="relative flex items-center gap-0.5">
            {/* Don't allow editing polls or reposts — their content is structural */}
            {!postBody.startsWith('[POLL_V1]') && post.post_type !== 'repost' && (
              <button
                onClick={handleEditStart}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-primary active:text-primary transition-colors"
                aria-label={tFallback('hub.edit', 'Edit post')}
                title={tFallback('hub.edit', 'Edit post')}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-destructive active:text-destructive transition-colors"
              aria-label={t('hub.delete')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          // One three-dots menu rather than three naked icons. Mute, block and
          // report are all "act on this author" and are all rare; three
          // permanent destructive-looking icons on every post in the feed
          // spent the row's attention on actions almost nobody takes. Block in
          // particular used to live down in the post body, so the two halves
          // of the same decision sat in different places.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onPointerUp={(e) => e.stopPropagation()}
                className="relative p-1.5 rounded-md text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground transition-colors"
                aria-label={tFallback('hub.post.moreActions', 'More actions')}
                title={tFallback('hub.post.moreActions', 'More actions')}
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onPointerUp={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={handleMuteAuthor}>
                <VolumeX className="w-3.5 h-3.5 me-2" />
                {tFallback('hub.post.muteAuthor', 'Mute author')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setConfirmBlockOpen(true)}>
                <Ban className="w-3.5 h-3.5 me-2" />
                {tFallback('hub.post.blockAuthor', 'Block author')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setReportOpen(true)} className="text-destructive focus:text-destructive">
                <Flag className="w-3.5 h-3.5 me-2" />
                {t('report.buttonLabel')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Feature 24: Poll rendering */}
      {postBody.startsWith('[POLL_V1]') && (
        <PollCard post={post} userEmail={user?.email} />
      )}

      {/* Repost card — show original post inline */}
      {post.post_type === 'repost' && post.original_post_id && (
        <RepostCard originalPostId={post.original_post_id} onAuthorClick={onAuthorClick} />
      )}

      {/* Scheduled badge — only shown when publish_at is in the future */}
      {post.publish_at && new Date(post.publish_at) > new Date() && (
        <div className="px-3 pb-1 flex items-center gap-1.5 text-xs text-primary/80">
          <Clock className="w-3 h-3" />
          <span>{tFallback('hub.post.scheduledFor', 'Scheduled')}: {formatDate(new Date(post.publish_at), language, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
      )}

      {/* Inline edit mode */}
      {editMode ? (
        <div className="px-3 pb-3" onClick={e => e.stopPropagation()}>
          <textarea
            autoFocus
            value={editDraft}
            onChange={e => setEditDraft(e.target.value.slice(0, 2000))}
            className="w-full bg-secondary/30 border border-border rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:border-primary/40 min-h-[80px]"
            rows={3}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleEditSave}
              disabled={editSaving || !editDraft.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
            >
              {editSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              {tFallback('hub.post.save', 'Save')}
            </button>
            <button
              onClick={handleEditCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
            >
              <X className="w-3 h-3" />
              {tFallback('hub.post.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {/* Body */}
      {postBody && !postBody.startsWith('[POLL_V1]') && !editMode && (
        <div className="px-3 pb-3 text-sm break-words">
          {/* Edited badge */}
          {post.edited_at && (
            <div className="flex items-center gap-1 mb-1 text-micro text-muted-foreground/70">
              <Pencil className="w-2.5 h-2.5" />
              <span>{tFallback('hub.post.edited', 'edited')}</span>
            </div>
          )}
          <ContentWarningGate warning={post.content_warning} customLabel={post.content_warning_label}>
            <div className="whitespace-pre-wrap">
              {translation && !showOriginal ? translation.text : renderBodyWithHashtags(postBody, onHashtagClick)}
            </div>
          </ContentWarningGate>
          {/* Translate / Show original — hide once we know the post is already in the user's language */}
          {canTranslate && !isLikelyAlreadyInLanguage(postBody, language) && (
            <div className="mt-1.5 flex items-center gap-2 text-micro text-muted-foreground">
              {translation ? (
                <button
                  onClick={() => setShowOriginal((v) => !v)}
                  className="flex items-center gap-1 hover:text-primary active:text-primary transition-colors"
                >
                  <Languages className="w-3 h-3" />
                  {showOriginal
                    ? (tFallback('hub.post.showTranslation', 'Show translation'))
                    : (tFallback('hub.post.showOriginal', 'Show original'))}
                </button>
              ) : translating ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {tFallback('hub.post.translating', 'Translating…')}
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
                  className="flex items-center gap-1 hover:text-primary active:text-primary transition-colors"
                >
                  <Languages className="w-3 h-3" />
                  {tFallback('hub.post.translate', 'Translate')}
                </button>
              )}
              {translation?.sourceLang && translation.sourceLang !== language && !showOriginal && (
                <span className="text-muted-foreground/70">
                  · {tFallback('hub.post.translatedFrom', 'translated from')} {translation.sourceLang}
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

      {/* Image — collapsed by default, tap to expand (Twitter-style) */}
      {post.image_url && (
        <ContentWarningGate warning={post.content_warning} customLabel={post.content_warning_label}>
          <ImagePreview src={post.image_url} />
        </ContentWarningGate>
      )}

      {/* Video — TikTok-style: autoplay muted, tap to mute/unmute */}
      {post.video_url && (
        <ContentWarningGate warning={post.content_warning} customLabel={post.content_warning_label}>
          <div
            className="relative border-y border-border bg-black"
            // stopPropagation on pointerup so tapping the video (mute toggle)
            // doesn't bubble to the article's double-tap-to-like detector.
            onPointerUp={(e) => e.stopPropagation()}
          >
            <video
              ref={videoRef}
              src={post.video_url}
              className="w-full max-h-[520px] object-contain"
              autoPlay
              loop
              muted={videoMuted}
              playsInline
              onClick={(e) => { e.stopPropagation(); setVideoMuted(m => !m); }}
              onError={(e) => { const w = e.currentTarget.parentElement; if (w) w.style.display = 'none'; }}
            />
            {/* Mute indicator */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setVideoMuted(m => !m); }}
              className="absolute bottom-2 end-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white"
              aria-label={videoMuted ? 'Unmute' : 'Mute'}
            >
              {videoMuted
                ? <VolumeX className="w-3.5 h-3.5" />
                : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            {/* Video type badge */}
            <div className="absolute top-2 start-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-micro font-bold">
              <Film className="w-3 h-3" />
              VIDEO
            </div>
          </div>
        </ContentWarningGate>
      )}

      {/* Actions */}
      {/* stopPropagation on pointerup so taps on Like/Dislike/comment/share
          don't bubble to the article's double-tap-to-like detector. Without
          this, tapping Dislike would toggle a dislike AND register as a fake
          double-tap "like", leaving the post liked. */}
      <div
        className="flex items-center gap-1 px-2 py-2 border-t border-border"
        onPointerUp={(e) => e.stopPropagation()}
      >
        <ActionButton
          icon={ThumbsUp}
          count={likeCount}
          active={displayedReaction === 'like'}
          activeColor="text-primary"
          onClick={() => handleReact('like')}
          label={tFallback('hub.post.like', 'Like')}
          pressed={displayedReaction === 'like'}
        />
        <ActionButton
          icon={MessageCircle}
          count={post.comment_count || 0}
          active={commentsOpen}
          activeColor="text-primary"
          onClick={() => setCommentsOpen(o => !o)}
          label={tFallback('hub.post.comments', 'Comments')}
          expanded={commentsOpen}
        />
        {/* Save meal (meal-specific: also saves to meal library) */}
        {isMealPost && (
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={handleSaveMeal}
            className={`p-2 rounded-md transition-colors ${mealSaved ? 'text-primary' : 'text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground'}`}
            aria-label={mealSaved ? 'Remove from saved meals' : 'Save meal'}
          >
            <Bookmark className={`w-4 h-4 ${mealSaved ? 'fill-current' : ''}`} />
          </motion.button>
        )}
        {/* Creator analytics — own posts only */}
        {isMine && (
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={(e) => { e.stopPropagation(); setAnalyticsOpen(o => !o); }}
            className={`p-2 rounded-md transition-colors ${analyticsOpen ? 'text-primary bg-secondary' : 'text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground'}`}
            aria-label={tFallback("hubPostCard.postAnalytics", "Post analytics")}
            title={tFallback("hubPostCard.viewAnalytics", "View analytics")}
          >
            <BarChart2 className="w-4 h-4" />
          </motion.button>
        )}

        {/* Repost — only for other people's posts (don't repost your own) */}
        {!isMine && post.post_type !== 'repost' && (
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={handleRepost}
            disabled={reposting}
            className="p-2 rounded-md text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-primary active:text-primary transition-colors disabled:opacity-50"
            aria-label={tFallback('hub.post.repost', 'Repost')}
            title={tFallback('hub.post.repost', 'Repost')}
          >
            {reposting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat2 className="w-4 h-4" />}
          </motion.button>
        )}

        {/* Sticker — grey star, immediately before Share. Until now the only
            way to reach the sticker panel was the waterfall of existing
            stickers BELOW the row, which does not render until a post already
            has one: a post with zero stickers had no way to get its first.
            Takes the ml-auto that Share used to carry so the pair sits
            together at the trailing end. */}
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={(e) => { e.stopPropagation(); setStickerPanelOpen(o => !o); }}
          className={`ms-auto p-2 rounded-md transition-colors ${
            stickerPanelOpen
              ? 'text-primary bg-secondary'
              : 'text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground'
          }`}
          aria-label={tFallback('hub.post.addSticker', 'Add a sticker')}
          aria-expanded={stickerPanelOpen}
          title={tFallback('hub.post.addSticker', 'Add a sticker')}
        >
          <Star className={`w-4 h-4 ${stickerPanelOpen ? 'fill-current' : ''}`} />
        </motion.button>

        {/* Share — opens ShareSheetModal with DM + external options */}
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={(e) => { e.stopPropagation(); setShareSheetOpen(true); }}
          className="p-2 rounded-md text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground transition-colors"
          aria-label={tFallback("hubPostCard.sharePost", "Share post")}
        >
          <Share2 className="w-4 h-4" />
        </motion.button>
      </div>

      {/* ── Sticker reaction waterfall ─────────────────────────────────────── */}
      {stickerRxns.length > 0 && (
        <button
          onClick={() => setStickerPanelOpen(o => !o)}
          className="flex items-center gap-1 px-3 py-1.5 hover:bg-secondary active:bg-secondary transition-colors w-full text-start"
        >
          {/* One tile per DISTINCT sticker, with a count when several people
              gave the same one — rather than one circle per person. Ten
              identical stickers used to render as ten overlapping copies of
              the same picture, which reads as noise instead of as ten people
              agreeing. Still anonymous: a count, never a name. */}
          <div className="flex items-center" style={{ marginRight: 6 }}>
            {groupedStickers.slice(0, 6).map((g, i) => (
              <div
                key={g.key}
                className="w-7 h-7 rounded-full bg-card border-2 border-background flex items-center justify-center overflow-visible"
                style={{ marginLeft: i === 0 ? 0 : -10, zIndex: i, position: 'relative' }}
              >
                <StickerDisplay emoji={g.emoji} variant={g.variant} size={22} />
                {g.count > 1 && (
                  <span className="absolute -bottom-1 -end-1 min-w-4 h-4 px-0.5 rounded-sm bg-secondary border border-background text-micro font-bold leading-none flex items-center justify-center tabular-nums">
                    {g.count}×
                  </span>
                )}
              </div>
            ))}
          </div>
          {groupedStickers.length > 6 && (
            <span className="text-xs text-muted-foreground">+{groupedStickers.length - 6}</span>
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
            // Comments are inside the article, and the article runs
            // double-tap-to-like on pointerup. Without this, double-tapping a
            // COMMENT liked the POST — the gesture was landing one level up.
            onPointerUp={(e) => e.stopPropagation()}
          >
            <HubCommentsInline
              post={post}
              open={commentsOpen}
              onClose={() => setCommentsOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Creator analytics panel — own posts only, toggled by BarChart2 button */}
      <AnimatePresence initial={false}>
        {analyticsOpen && isMine && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <CreatorAnalyticsPanel postId={post.id} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share sheet */}
      <ShareSheetModal post={post} open={shareSheetOpen} onClose={() => setShareSheetOpen(false)} />

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

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={tFallback('hub.post.confirmDeleteTitle', 'Delete this post?')}
        description={tFallback('hub.post.confirmDeleteDesc', "This can't be undone.")}
        confirmLabel={tFallback('common.yesDelete', 'Yes, delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleDelete}
        destructive
      />

      <ConfirmDialog
        open={confirmBlockOpen}
        onOpenChange={setConfirmBlockOpen}
        title={tFallback('hub.post.confirmBlockTitle', 'Block @{name}?', { name: authorHandle })}
        description={tFallback(
          'hub.post.confirmBlockDesc',
          "They won't see your profile, posts, or stories, and you won't see theirs. You can unblock from Settings.",
        )}
        confirmLabel={tFallback('hub.post.confirmBlockAction', 'Yes, block')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirmBlockAuthor}
        destructive
      />

      {/* Long-press avatar preview sheet */}
      <AnimatePresence>
        {avatarPreviewOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            onClick={(e) => { e.stopPropagation(); setAvatarPreviewOpen(false); }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-t-2xl w-full max-w-md p-5"
              style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
            >
              <div className="flex items-center gap-4 mb-5">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center font-heading font-bold text-primary text-xl overflow-hidden shrink-0">
                  {author.avatarUrl
                    ? <img
                        src={author.avatarUrl}
                        alt=""
                        width="64"
                        height="64"
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    : author.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-base truncate">{author.handle}</p>
                  {author.username && <p className="text-sm text-muted-foreground">@{author.username}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                {!isMine && onAuthorClick && (
                  <button
                    onClick={() => {
                      setAvatarPreviewOpen(false);
                      onAuthorClick({ id: post.user_id, email: post.author_email, username: author.username, avatar_url: author.avatarUrl });
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
                  >
                    {tFallback("hubPostCard.viewProfile", "View Profile")}
                  </button>
                )}
                <button
                  onClick={() => setAvatarPreviewOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
                >
                  {tFallback("discovery.dismiss", "Dismiss")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

// `label` is required. This rendered a bare lucide icon — an <svg> with no
// title — plus an optional number, and neither call site passed a name, so a
// screen reader announced "button" and "button", or "12, button" and "3,
// button". WCAG 4.1.2 Name, Role, Value, Level A. The two most-used controls
// on the surface were the only two in this action row without a name; save
// meal, analytics, repost, sticker and share all had one.
//
// The name is sr-only TEXT rather than an aria-label on purpose. An aria-label
// replaces the element's content as the accessible name, which would have
// taken the count away from exactly the users this is for — "Like" instead of
// "Like 12". As content it concatenates, so the count survives. Same pattern
// as the dialog close button.
//
// State goes on the element, not in the label: `aria-pressed` for the like
// toggle and `aria-expanded` for the comment disclosure, so the name stays
// stable while the state changes under it.
function ActionButton({ icon: Icon, count, active, activeColor, onClick, label, pressed, expanded }) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      aria-pressed={pressed}
      aria-expanded={expanded}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active ? `${activeColor} bg-secondary` : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
      }`}
    >
      <Icon className={`w-4 h-4 ${active ? 'fill-current' : ''}`} />
      <span className="sr-only">{label}</span>
      {count > 0 && <span>{count}</span>}
    </motion.button>
  );
}

// Exported for the test: ActionButton is the defect surface, and rendering it
// directly is what lets the accessible NAME be asserted rather than the markup
// that is supposed to produce one.
export const __test__ = { ActionButton };

export default memo(HubPostCard);