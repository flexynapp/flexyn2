// src/components/hub/HubProfile.jsx
import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { triggerHaptic } from '@/lib/haptic';
import { User as UserIcon, Users as UsersIcon, FileText, X, Loader2, MessageCircle, Palette, MapPin, Heart, Plus, Pencil, Trophy } from 'lucide-react';

// ─── Steel USA overlay — rendered when any user views @sean's profile ─────────
// Fixed to viewport, pointer-events-none, z-0 (behind all UI)
function SteelUsaProfileOverlay() {
  const USA_COLORS = ['#EF4444', '#FFFFFF', '#3B82F6', '#EF4444', '#FFFFFF', '#1D4ED8'];
  const PIXEL_COLORS = ['#94A3B8', '#CBD5E1', '#64748B', '#BAE6FD', '#E2E8F0'];

  const embers = useMemo(() =>
    Array.from({ length: 182 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      size: Math.random() * 3.5 + 1.5,
      color: USA_COLORS[i % USA_COLORS.length],
      duration: Math.random() * 5 + 3,
      delay: Math.random() * 6,
      drift: (Math.random() - 0.5) * 50,
      travel: (Math.random() * 0.45 + 0.35) * (window?.innerHeight || 700),
    })),
  []);

  const pixels = useMemo(() =>
    Array.from({ length: 18 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 2,
      color: PIXEL_COLORS[i % PIXEL_COLORS.length],
      duration: Math.random() * 6 + 4,
      delay: Math.random() * 5,
      dx1: (Math.random() - 0.5) * 24,
      dy1: (Math.random() - 0.5) * 24,
    })),
  []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Subtle steel wash */}
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(160deg, rgba(148,163,184,0.06) 0%, rgba(30,41,59,0.09) 100%)' }}
      />

      {/* Patriotic USA embers */}
      {embers.map(e => (
        <motion.div
          key={`usa-ember-${e.id}`}
          className="absolute rounded-full"
          style={{ left: `${e.x}%`, bottom: 0, width: e.size, height: e.size, background: e.color, filter: 'blur(0.4px)', opacity: 0 }}
          animate={{ y: [0, -e.travel], x: [0, e.drift], opacity: [0, 0.65, 0], scale: [1, 0.35] }}
          transition={{ duration: e.duration, repeat: Infinity, delay: e.delay, ease: 'easeOut' }}
        />
      ))}

      {/* Floating digital pixels */}
      {pixels.map(p => (
        <motion.div
          key={`pixel-${p.id}`}
          className="absolute"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size, background: p.color, borderRadius: 1, opacity: 0 }}
          animate={{ opacity: [0, 0.42, 0], x: [0, p.dx1, 0], y: [0, p.dy1, 0], scale: [0.8, 1.5, 0.8] }}
          transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

// Orange 3-pronged crown — shown as an absolute badge on the avatar for verified admins
function CrownBadge({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 14" fill="none" aria-label="Admin" title="Verified Admin">
      <path d="M1 12h14M2 12L1 4l4 3.5L8 1l3 6.5L15 4l-1 8H2z" fill="#f97316" stroke="#ea6c00" strokeWidth="0.8" strokeLinejoin="round"/>
    </svg>
  );
}

// Converts a 2-letter ISO country code to a regional indicator flag emoji.
// If the value already contains a non-ASCII character (i.e., is already a flag emoji), returns it as-is.
function codeToFlag(code) {
  if (!code) return '';
  if ([...code].some(c => c.codePointAt(0) > 0x7F)) return code; // already emoji
  const upper = code.toUpperCase().slice(0, 2);
  if (upper.length < 2 || !/^[A-Z]{2}$/.test(upper)) return code;
  return String.fromCodePoint(0x1F1E6 - 65 + upper.charCodeAt(0))
       + String.fromCodePoint(0x1F1E6 - 65 + upper.charCodeAt(1));
}
import ThemeSelector from '@/components/ThemeSelector';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { getTier } from '@/lib/xpTier';
import Particles from '@/components/Particles';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import * as hubFollows from '@/lib/data/hubFollows';
import * as hubPosts from '@/lib/data/hubPosts';
import * as me from '@/lib/data/me';
import * as statusNotesData from '@/lib/data/statusNotes';
import HubPostCard from './HubPostCard';
import ThemedScope from '@/components/ThemedScope';
import AvatarUploader from '@/components/AvatarUploader';
import { getLootTitleById } from '@/lib/lootTitles';
import { getLootFrameById } from '@/lib/lootFrames';
import { RARITY } from '@/lib/lootCatalog';
import { useTheme } from '@/lib/ThemeContext';
import { isVerified } from '@/lib/verifiedUsers';
import StoryViewer from '@/components/stories/StoryViewer';
import StatusNoteEditor from '@/components/stories/StatusNoteEditor';
import * as storiesData from '@/lib/data/stories';

const TROPHY_LABELS = {
  '🏆':'Trophy','🥇':'1st Place','🥈':'2nd Place','🥉':'3rd Place','🎯':'Target',
  '💪':'Strength','🔥':'Fire','⚡':'Lightning','🌟':'Star','⭐':'Star',
  '🎖️':'Medal','🏅':'Medal','🏋️':'Lifting','🤸':'Gymnastics','🏊':'Swimming',
  '🚴':'Cycling','🧗':'Climbing','🥊':'Boxing','🥋':'Martial Arts','🎽':'Sports',
  '💯':'100','👑':'Crown','🦁':'Lion','🐺':'Wolf','🦅':'Eagle','🦊':'Fox',
  '🐉':'Dragon','⚔️':'Swords','🛡️':'Shield','💎':'Diamond','🌈':'Rainbow',
  '🌊':'Wave','🎆':'Fireworks','🎇':'Sparkler','🎉':'Party','🎊':'Confetti',
  '🎁':'Gift','🌙':'Moon','☀️':'Sun','🌸':'Blossom','🍀':'Luck','❄️':'Ice',
  '🔮':'Crystal','🌀':'Cyclone','🌪️':'Tornado','🏔️':'Mountain','🌋':'Volcano',
  '🦾':'Strength','🧠':'Brain','💥':'Boom','🎪':'Circus','🎭':'Theater',
  '🎮':'Gaming','🕹️':'Joystick','🎲':'Dice','♟️':'Chess','🎸':'Guitar',
  '🥁':'Drums','🎤':'Mic','🎬':'Film','📸':'Photo','🚀':'Rocket',
  '🛸':'UFO','🌍':'Earth','🌠':'Shooting Star','✨':'Sparkles',
};

// Converts a flag emoji to a Twemoji SVG URL (works on all platforms including Windows Chrome)
function flagUrl(emoji) {
  if (!emoji) return null;
  const points = [...emoji]
    .map(c => c.codePointAt(0))
    .filter(cp => cp !== 0xFE0F) // strip variation selector-16
    .map(cp => cp.toString(16));
  if (!points.length) return null;
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@v14.0.2/assets/svg/${points.join('-')}.svg`;
}

export default function HubProfile({ targetUser = null, onSelectUser = null, onStartConversation = null }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  // Read the user's currently-equipped theme from ThemeContext (always fresh)
  // instead of useAuth().user, which only loads once at bootstrap and doesn't
  // refresh when the user equips a new theme — that's why a freshly-applied
  // theme would show globally but stay default on the profile card.
  // (AuthProvider listens for `flexyn:loot-equipped` / `flexyn:theme-changed`
  // app-wide and refreshes useAuth().user, so this component no longer
  // needs its own listener.)
  const { themeId: liveThemeId, lootThemeId: liveLootThemeId } = useTheme();
  const queryClient = useQueryClient();
  const isSelf = !targetUser || targetUser?.email === user?.email;
  const email = isSelf ? user?.email : targetUser?.email;
  const [openModal, setOpenModal] = useState(null); // 'followers', 'following', or null
  const [unfollowConfirmOpen, setUnfollowConfirmOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [storyViewerOpen, setStoryViewerOpen] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteLocalLiked, setNoteLocalLiked] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [cityDraft, setCityDraft] = useState('');
  const [flagPickerOpen, setFlagPickerOpen] = useState(false);
  const [trophyPickerSlot, setTrophyPickerSlot] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const storyFileRef = useRef(null);

  // Always start a profile view at the top, regardless of where the user
  // scrolled before navigating in. Using 'auto' (not 'smooth') because the
  // new profile data is already mounting underneath — a smooth scroll would
  // race with the layout shift of new content.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [email]);

  // ── last_active_at: update on own profile open, display on others' ────────
  useEffect(() => {
    if (!isSelf || !user?.email) return;
    supabase
      .from('user_profiles')
      .update({ last_active_at: new Date().toISOString() })
      .eq('email', user.email)
      .then(() => {})
      .catch(() => {});
  }, [isSelf, user?.email]);

  // Fetch target user's last_active_at (only when viewing someone else)
  const { data: targetLastActive } = useQuery({
    queryKey: ['lastActive', email],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('last_active_at')
        .eq('email', email)
        .single();
      return data?.last_active_at || null;
    },
    enabled: !isSelf && !!email,
    staleTime: 60_000,
  });

  const activeLabel = (() => {
    if (isSelf || !targetLastActive) return null;
    const diff = Date.now() - new Date(targetLastActive).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 5) return { text: 'Active now', color: 'text-emerald-500' };
    if (diff < 86400000) {
      const h = Math.floor(diff / 3600000);
      return { text: `Active ${h || 1}h ago`, color: 'text-muted-foreground' };
    }
    return null;
  })();

  const { data: targetProfile } = useQuery({
    queryKey: ['hubProfileLookup', email],
    queryFn: async () => {
      if (isSelf) return null;
      // safeSelect strips columns that aren't in the PostgREST schema
      // cache yet (e.g. country_flag / trophy_case if migration 049
      // is pending) and retries — so a mid-migration deploy doesn't
      // crash the Hub. Existing `?.` / `??` fallback patterns on
      // these fields downstream still render correctly when a
      // column is absent.
      const { data } = await safeSelect({
        columns: [
          'email', 'username', 'avatar_url', 'total_xp',
          'preferred_theme', 'loot_theme_id',
          'equipped_title_id', 'equipped_frame_id',
          'city', 'country_flag', 'bio',
          'trophy_case', 'trophy_case_visible',
        ],
        build: (cols) => supabase
          .from('user_profiles')
          .select(cols)
          .eq('email', email)
          .single(),
      });
      if (!data) return targetUser || null;
      return { ...data, username: data.username || targetUser?.username || null };
    },
    enabled: !isSelf && !!email,
    initialData: isSelf ? null : targetUser,
  });

  // Profile stories (for clickable avatar → StoryViewer)
  // Crew stories are scoped to crew_id and must never appear here.
  const { data: profileStories = [] } = useQuery({
    queryKey: ['profileStories', email],
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from('stories')
        .select('*')
        .eq('user_email', email)
        .is('crew_id', null)  // SECURITY: personal stories only
        .gt('expires_at', now)
        .order('created_at', { ascending: true });
      return data ?? [];
    },
    enabled: !!email,
    staleTime: 30_000,
  });

  // Active status note for the profile owner
  const { data: activeNote, refetch: refetchNote } = useQuery({
    queryKey: ['profileNote', email],
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from('status_notes')
        .select('*')
        .eq('user_email', email)
        .gt('expires_at', now)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
    enabled: !!email,
    staleTime: 30_000,
  });

  // Has current viewer liked the note?
  const { data: noteLikedServer = false, refetch: refetchNoteLike } = useQuery({
    queryKey: ['profileNoteLike', activeNote?.id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('status_note_likes')
        .select('id')
        .eq('note_id', activeNote.id)
        .eq('liker_id', user.id)
        .maybeSingle();
      return !!data;
    },
    enabled: !isSelf && !!activeNote?.id && !!user?.id,
  });

  const { data: followers = [] } = useQuery({
    queryKey: ['hubFollowers', email],
    queryFn: () => hubFollows.listFollowers(email),
    enabled: !!email,
  });
  const { data: following = [] } = useQuery({
    queryKey: ['hubFollowing', email],
    queryFn: () => hubFollows.listFollowing(email),
    enabled: !!email,
  });
  const {
    data: amFollowing,
    isLoading: amFollowingLoading,
  } = useQuery({
    queryKey: ['hubIsFollowing', user?.email, email],
    queryFn: () => hubFollows.isFollowing(user.email, email),
    enabled: !isSelf && !!user?.email,
  });

  // Mutual-follow query: does the TARGET also follow ME? Combined with
  // amFollowing this lets us render a small "Friends" / "Mutuals" badge
  // next to the follow button — the classic Twitter/IG signal that the
  // relationship is reciprocal. Knowing the social graph is symmetric
  // changes how openly users interact (less audience-feel, more
  // friends-feel).
  const { data: theyFollowMe } = useQuery({
    queryKey: ['hubTheyFollowMe', email, user?.email],
    queryFn: () => hubFollows.isFollowing(email, user.email),
    enabled: !isSelf && !!user?.email && !!email,
  });
  const isMutualFollow = amFollowing === true && theyFollowMe === true;

  // Anniversary date — the moment this friendship became mutual. Only
  // queried when we KNOW it's mutual (avoids a wasted call for non-
  // mutual or self views). Drives the "Training together since March
  // 2025" line under the bio. Returns ISO string or null.
  const { data: mutualSince } = useQuery({
    queryKey: ['hubMutualSince', user?.email, email],
    queryFn: () => hubFollows.getMutualFollowSince(user.email, email),
    enabled: !isSelf && isMutualFollow && !!user?.email && !!email,
    staleTime: 5 * 60_000, // doesn't change often
  });

  // True only when we have a definitive answer from the server. While the
  // query is still in-flight (or hasn't started because user.email isn't
  // loaded yet), we DON'T know whether the user follows the target — so
  // neither "Follow" nor "Unfollow" should be tappable.
  const followStatusReady = isSelf || (!!user?.email && amFollowing !== undefined);
  const { data: posts = [] } = useQuery({
    queryKey: ['hubProfilePosts', email, amFollowing, isSelf],
    queryFn: () => hubPosts.listForProfile(email, amFollowing, isSelf),
    enabled: !!email,
  });

  // ── Derived display values (needed by mutations below) ──────────────────
  const ownerUsername = isSelf
    ? user?.username
    : (targetUser?.username || targetProfile?.username || (email ? email.split('@')[0] : null));
  const avatarUrl = isSelf ? user?.avatar_url : targetProfile?.avatar_url;

  // ── Follow / unfollow as a mutation ─────────────────────────────────────
  // The canonical TanStack pattern: optimistically write the new state into
  // the ['hubIsFollowing', ...] cache, do the API call, roll back on error,
  // invalidate everything that depends on follow state when settled.
  //
  // This replaces the previous useState + useEffect sync, which had a race
  // where a stale background refetch of amFollowing would overwrite the
  // local "I just followed them" state and revert the button.

  const followMutation = useMutation({
    mutationFn: async () => {
      if (!user?.email || !email) {
        throw new Error('missing-user');
      }
      return hubFollows.follow(user.email, email, { t });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['hubIsFollowing', user?.email, email] });
      const previous = queryClient.getQueryData(['hubIsFollowing', user?.email, email]);
      queryClient.setQueryData(['hubIsFollowing', user?.email, email], true);
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['hubIsFollowing', user?.email, email], ctx.previous);
      }
      toast.error(t('hub.profile.followError'));
      console.error('[HubProfile] follow failed:', err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['hubIsFollowing', user?.email, email] });
      queryClient.invalidateQueries({ queryKey: ['hubFollowers', email] });
      queryClient.invalidateQueries({ queryKey: ['hubFollowing', user?.email] });
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: async () => {
      if (!user?.email || !email) {
        throw new Error('missing-user');
      }
      return hubFollows.unfollow(user.email, email);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['hubIsFollowing', user?.email, email] });
      const previous = queryClient.getQueryData(['hubIsFollowing', user?.email, email]);
      queryClient.setQueryData(['hubIsFollowing', user?.email, email], false);
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['hubIsFollowing', user?.email, email], ctx.previous);
      }
      toast.error(t('hub.profile.unfollowError'));
      console.error('[HubProfile] unfollow failed:', err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['hubIsFollowing', user?.email, email] });
      queryClient.invalidateQueries({ queryKey: ['hubFollowers', email] });
      queryClient.invalidateQueries({ queryKey: ['hubFollowing', user?.email] });
    },
  });

  const startConversationMutation = useMutation({
    mutationFn: async () => {
      if (!user?.email || !email) {
        throw new Error('missing-user');
      }
      if (!onStartConversation) {
        throw new Error('no-handler');
      }
      await onStartConversation({ email, username: ownerUsername, avatar_url: avatarUrl });
    },
    onError: (err) => {
      if (err?.message === 'missing-user') {
        toast.error(t('hub.profile.messageNotReady'));
      } else if (err?.message === 'no-handler') {
        console.error('[HubProfile] message: no onStartConversation handler');
      }
    },
  });

  const handleMessage = () => {
    // Defense in depth — the button itself is disabled in these states,
    // but if a click somehow gets through (synthetic event, focus + Enter,
    // etc.) we still bail rather than firing the mutation against a null user.
    if (startConversationMutation.isPending) return;
    if (!user?.email) return;
    if (!onStartConversation) return;
    if (!email) return;
    startConversationMutation.mutate();
  };

  // Reads strictly from the server-confirmed cache value. While loading,
  // this stays `undefined` and the button renders in its loading state.
  const isFollowingNow = amFollowing === true;
  const followBusy = followMutation.isPending || unfollowMutation.isPending;

  const handleFollow = () => {
    // Multiple gates, all returning silently — the button itself is disabled
    // in any state where these would matter, but we keep the guards as a
    // belt-and-braces defense against race conditions.
    if (followBusy) return;
    if (isSelf) return;
    if (!user?.email) return;
    if (!followStatusReady) return;          // server hasn't told us yet
    if (isFollowingNow) {
      // Unfollow path is destructive — defer haptic until the confirm
      // dialog's actual unfollow action, where it matches "this is
      // happening" semantics.
      setUnfollowConfirmOpen(true);
      return;
    }
    triggerHaptic('primary');
    followMutation.mutate();
  };

  const handleConfirmUnfollow = () => {
    setUnfollowConfirmOpen(false);
    if (!user?.email) return;
    triggerHaptic('warning');
    unfollowMutation.mutate();
  };

  // ── Note handlers ───────────────────────────────────────────────────────────
  const handleNotePost = async (text) => {
    await statusNotesData.postStatusNote(user, text);
    refetchNote();
    setNoteEditorOpen(false);
  };
  const handleNoteDelete = async () => {
    if (!activeNote?.id) return;
    await statusNotesData.deleteStatusNote(activeNote.id);
    refetchNote();
    setNoteEditorOpen(false);
  };
  const handleNoteLike = async () => {
    if (!activeNote?.id || !user?.id || isSelf) return;
    const next = !noteLiked;
    setNoteLocalLiked(next);
    try {
      if (next) {
        await statusNotesData.likeStatusNote(activeNote.id, user);
      } else {
        await statusNotesData.unlikeStatusNote(activeNote.id, user.id);
      }
      refetchNoteLike();
    } catch {
      setNoteLocalLiked(!next);
    }
  };

  // ── Trophy handlers ──────────────────────────────────────────────────────────
  const handleTrophySlotSet = async (slotIdx, emoji) => {
    const next = Array(5).fill(null).map((_, i) => trophyCase[i] ?? null);
    next[slotIdx] = emoji ? { type: 'emoji', value: emoji } : null;
    try {
      await me.update({ trophy_case: next });
      queryClient.invalidateQueries({ queryKey: ['hubProfileLookup', email] });
    } catch {
      toast.error('Could not update trophy case');
    }
    setTrophyPickerSlot(null);
  };
  const handleTrophyVisibility = async () => {
    const next = !trophyVisible;
    try {
      await me.update({ trophy_case_visible: next });
      queryClient.invalidateQueries({ queryKey: ['hubProfileLookup', email] });
    } catch {
      toast.error('Could not update visibility');
    }
  };

  // ── Profile edit save ────────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      await me.update({ city: cityDraft.trim() });
      queryClient.invalidateQueries({ queryKey: ['hubProfileLookup', email] });
      setEditProfileOpen(false);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err?.message || 'Could not save');
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Username-only display ──
  // Hub profiles show the user's @username and nothing else identity-wise.
  // No full_name. No email. Falls back to a privacy-safe placeholder.
  //
  // Username resolution order:
  //   1. targetUser.username  — passed in from search / modal / message hand-off
  //   2. targetProfile.username — refreshed lookup (may be missing if Base44's
  //      User.list() strips custom fields for non-self users)
  //   3. email prefix — last-resort recognizable handle (matches what
  //      HubSearchOverlay shows in its result rows). The user's email is
  //      already known at the row level for navigation purposes, so this
  //      surfaces no new identity. We never show the full email.
  //
  // Only when the email itself is missing do we render the generic
  // "Athlete" placeholder.
  const emailPrefix = email ? email.split('@')[0] : null;
  // For own profile: treat a deleted_ placeholder the same as no username.
  const rawSelfUsername = isSelf ? user?.username : null;
  const selfUsername = (rawSelfUsername && !rawSelfUsername.startsWith('deleted_'))
    ? rawSelfUsername
    : null;

  const displayUsername = isSelf
    ? (selfUsername || emailPrefix)
    : (targetUser?.username || targetProfile?.username || emailPrefix);

  const displayHandle = displayUsername
    ? `@${displayUsername}`
    : (isSelf ? t('hub.profile.anonymousSelf') : t('hub.profile.anonymousAthlete'));

  const initials = displayUsername
    ? displayUsername.slice(0, 2).toUpperCase()
    : '?';

  // Theme scope — render the profile card in the profile owner's theme.
  // Reads BOTH the level-up theme and the loot theme; ThemedScope resolves
  // loot first (matches the global ThemeContext priority) so a user's
  // legendary loot theme is what other viewers see when they navigate to
  // their profile, even if the viewer has a different theme equipped.
  //
  // For self: read from ThemeContext (live, updates immediately on equip).
  // For others: read from the cached profile lookup (refreshes on window
  // focus + 60 s staleTime).
  const ownerThemeId     = isSelf ? liveThemeId     : targetProfile?.preferred_theme;
  const ownerLootThemeId = isSelf ? liveLootThemeId : targetProfile?.loot_theme_id;

  // Equipped Title + Frame — Steam-style profile flair. Both are stored as
  // ids on user_profiles (migration 019). Public read RLS lets every viewer
  // resolve them, so other users see the equipped flair when visiting.
  const equippedTitleId = isSelf ? user?.equipped_title_id : targetProfile?.equipped_title_id;
  const equippedFrameId = isSelf ? user?.equipped_frame_id : targetProfile?.equipped_frame_id;
  const equippedTitle = equippedTitleId ? getLootTitleById(equippedTitleId) : null;
  const equippedFrame = equippedFrameId ? getLootFrameById(equippedFrameId) : null;
  const titleRarity = equippedTitle ? (RARITY[equippedTitle.rarity] ?? RARITY.common) : null;

  // New profile fields (migration 049)
  const city         = isSelf ? (user?.city ?? '')          : (targetProfile?.city ?? '');
  const countryFlag  = isSelf ? (user?.country_flag ?? '')  : (targetProfile?.country_flag ?? '');
  const bio          = isSelf ? (user?.bio ?? '')           : (targetProfile?.bio ?? '');
  const rawTrophy    = isSelf ? (user?.trophy_case ?? [])   : (targetProfile?.trophy_case ?? []);
  const trophyCase   = Array.isArray(rawTrophy) ? rawTrophy : [];
  const trophyVisible = isSelf ? (user?.trophy_case_visible ?? true) : (targetProfile?.trophy_case_visible ?? true);
  const isVerifiedUser = isVerified(displayUsername);
  const noteLiked    = noteLocalLiked || noteLikedServer;

  // Level and XP
  const ownerXp = isSelf ? Number(user?.total_xp) || 0 : Number(targetProfile?.total_xp) || 0;
  const levelData = calculateLevelFromXp(ownerXp);
  const { level, xpInLevel, xpNeeded, progressPercent } = levelData;
  const tier = getTier(level, t);

  // Deleted / reset accounts have username starting with "deleted_".
  // For other people's profiles: show "User not found".
  // For own profile: guard below shows an email-prefix fallback so the layout
  // never renders the deleted_ placeholder (re-onboarding will fix it properly).
  const isDeletedAccount = !isSelf && displayUsername?.startsWith('deleted_');
  const isSelfDeleted = isSelf && user?.username?.startsWith('deleted_');
  if (isDeletedAccount) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <UserIcon className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="font-heading font-bold text-lg mb-1">{t('hub.profile.notFound')}</h2>
        <p className="text-sm text-muted-foreground">{t('hub.profile.notFoundDesc')}</p>
      </div>
    );
  }

  // Show steel USA overlay for @sean's and @keganbergeron's profiles (visible to any visitor)
  const isAdminProfile = ownerUsername === 'sean' || ownerUsername === 'seanj'
    || ownerUsername === 'kegan' || ownerUsername === 'keganbergeron';

  return (
    <ThemedScope themeId={ownerThemeId} lootThemeId={ownerLootThemeId}>
      {isAdminProfile && <SteelUsaProfileOverlay />}

      {/* Header card — gets a steel tint when viewing @sean's profile */}
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="bg-card border rounded-xl p-5 mb-4"
        style={isAdminProfile ? {
          borderColor: 'rgba(148,163,184,0.5)',
          background: 'linear-gradient(135deg, rgba(148,163,184,0.08) 0%, rgba(30,41,59,0.12) 100%)',
          boxShadow: '0 0 24px rgba(148,163,184,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
        } : { borderColor: 'hsl(var(--border))' }}
      >
        <div className="flex items-start gap-4 mb-4">
          {/* Avatar column */}
          <div className="flex flex-col items-center shrink-0">
            {/* Wrapper sized exactly to the avatar — so speech bubble centers on it precisely */}
            <div className="relative" style={{ width: 64, height: 64 }}>

              {/* Speech bubble note above avatar — centered on this 64px container */}
              {activeNote && (
                <div style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 20,
                  maxWidth: 180,
                  minWidth: 80,
                  width: 'max-content',
                }}>
                  <div style={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                    padding: '5px 10px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    textAlign: 'center',
                    position: 'relative',
                    maxWidth: 180,
                  }}>
                    {isSelf ? (
                      <button type="button" onClick={() => setNoteEditorOpen(true)} className="block w-full">
                        <p style={{ fontSize: 10, lineHeight: 1.4, color: 'hsl(var(--foreground))' }}>{activeNote.text}</p>
                      </button>
                    ) : (
                      <p style={{ fontSize: 10, lineHeight: 1.4, color: 'hsl(var(--foreground))' }}>{activeNote.text}</p>
                    )}
                    {/* Tail pointing down */}
                    <div style={{
                      position: 'absolute',
                      bottom: -6,
                      left: '50%',
                      transform: 'translateX(-50%) rotate(45deg)',
                      width: 10,
                      height: 10,
                      background: 'hsl(var(--card))',
                      borderRight: '1px solid hsl(var(--border))',
                      borderBottom: '1px solid hsl(var(--border))',
                    }} />
                  </div>
                </div>
              )}

              {/* Avatar circle with story ring */}
              <div
                className="rounded-full overflow-hidden"
                style={{
                  width: 64,
                  height: 64,
                  cursor: profileStories.length > 0 ? 'pointer' : undefined,
                  boxShadow: profileStories.length > 0
                    ? '0 0 0 2.5px hsl(var(--primary)), 0 0 0 5px hsl(var(--background))'
                    : 'none',
                }}
                onClick={profileStories.length > 0 ? () => setStoryViewerOpen(true) : undefined}
              >
                <AvatarUploader
                  src={avatarUrl}
                  initials={initials}
                  editable={false}
                  size={64}
                  frameCss={equippedFrame?.css}
                  frameAnimation={equippedFrame?.animation}
                />
                {/*
                  editable is intentionally false: the profile edit pencil
                  at the top-right of the card handles avatar swaps. Before,
                  AvatarUploader's own edit-camera + the "Add to story"
                  camera below collided on own-profile views with no
                  stories — two near-identical green camera badges
                  overlapping the avatar.
                */}
              </div>

              {/* Admin crown — top-left, tilted as if resting on the head */}
              {isVerifiedUser && (
                <div style={{ position: 'absolute', top: -8, left: -8, lineHeight: 0, zIndex: 10, transform: 'rotate(-25deg)' }}>
                  <CrownBadge size={22} />
                </div>
              )}

              {/* Camera badge — own profile: tap to add a story */}
              {isSelf && (
                <>
                  <input
                    ref={storyFileRef}
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      e.target.value = '';
                      const result = await storiesData.createStory(user, file);
                      if (result?.limitReached) {
                        toast.error('Story limit reached (10 max)');
                      } else if (!result?.ok) {
                        toast.error('Could not upload story');
                      } else {
                        queryClient.invalidateQueries({ queryKey: ['profileStories', email] });
                        toast.success('Story added!');
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => storyFileRef.current?.click()}
                    className="absolute w-6 h-6 rounded-full flex items-center justify-center"
                    style={{
                      bottom: -3,
                      right: -3,
                      background: 'hsl(var(--primary))',
                      boxShadow: '0 0 0 2px hsl(var(--background))',
                    }}
                    aria-label="Add to story"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                    </svg>
                  </button>
                </>
              )}
            </div>

            {/* Add status note trigger — own profile, no active note */}
            {isSelf && !activeNote && (
              <button
                type="button"
                onClick={() => setNoteEditorOpen(true)}
                className="mt-1.5 text-[9px] font-semibold text-muted-foreground hover:text-primary transition-colors leading-none"
              >
                + note
              </button>
            )}
          </div>

          {/* Identity stack — vertical rhythm tuned for breathing room.
              Each row gets its own dedicated top margin so the card
              doesn't collapse into one dense block. The username +
              handle stay tight (they're one logical unit), then meta
              rows (status / title / location / bio) each get mt-1.5
              for clear separation. */}
          <div className="flex-1 min-w-0">
            {/* Username (main profile name) */}
            <h2 className="font-heading font-bold text-xl leading-tight truncate">
              {displayUsername ? displayUsername.charAt(0).toUpperCase() + displayUsername.slice(1) : ''}
            </h2>
            {/* @handle row — visually paired with the username, no extra mt */}
            <p className="text-sm text-muted-foreground font-medium leading-tight mt-0.5">{displayHandle}</p>
            {activeLabel && (
              <p className={`text-[11px] font-medium leading-tight mt-1.5 flex items-center gap-1 ${activeLabel.color}`}>
                {activeLabel.text === 'Active now' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                )}
                {activeLabel.text}
              </p>
            )}

            {/* Equipped title */}
            {equippedTitle && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-sm leading-none">{equippedTitle.emoji}</span>
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: titleRarity?.color }}
                  title={equippedTitle.description}
                >
                  {equippedTitle.name}
                </span>
              </div>
            )}

            {/* City + flag (Row 2) */}
            {(city || countryFlag) && (
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                <MapPin className="w-3 h-3 shrink-0" />
                {city && <span>{city}</span>}
                {countryFlag && (
                  <img
                    src={flagUrl(codeToFlag(countryFlag))}
                    alt="flag"
                    className="w-4 h-4 object-contain shrink-0"
                  />
                )}
              </div>
            )}

            {/* Bio */}
            {bio && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-3 leading-relaxed">{bio}</p>
            )}

            {/* Training-together anniversary — only renders for mutual
                follows where the friendship is at least 30 days old. On
                the actual anniversary day each year, gets a small 🎂.
                Pure relationship warmth, Strava + Spotify Wrapped vibes. */}
            {!isSelf && mutualSince && (() => {
              const since = new Date(mutualSince);
              const now = new Date();
              const daysOld = Math.floor((now - since) / (1000 * 60 * 60 * 24));
              if (daysOld < 30) return null; // brand-new relationships read as noise
              const monthYear = since.toLocaleString('en-US', { month: 'long', year: 'numeric' });
              // Anniversary glow: within 7 days of the month/day each year.
              const isAnniversaryWeek =
                since.getMonth() === now.getMonth() &&
                Math.abs(now.getDate() - since.getDate()) <= 7;
              return (
                <p className="text-[11px] text-muted-foreground/80 italic mt-2">
                  {isAnniversaryWeek && <span className="mr-1" aria-hidden="true">🎂</span>}
                  {tFallback('hub.profile.trainingSince', 'Training together since {month}').replace('{month}', monthYear)}
                </p>
              );
            })()}

            {/* Edit profile (own, no city/flag yet) */}
            {isSelf && !city && !countryFlag && (
              <button
                type="button"
                onClick={() => { setCityDraft(city); setEditProfileOpen(v => !v); }}
                className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
              >
                <MapPin className="w-3 h-3" />
                Add location
              </button>
            )}
          </div>

          {/* Edit pencil (own profile, city already set) */}
          {isSelf && (city || countryFlag) && (
            <button
              type="button"
              onClick={() => { setCityDraft(city); setEditProfileOpen(v => !v); }}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary transition-colors shrink-0"
              aria-label="Edit location"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Note like button — non-own profile, active note (bubble shown above avatar) */}
        {!isSelf && activeNote && (
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={handleNoteLike}
              className="flex items-center gap-1 text-muted-foreground"
              aria-label={noteLiked ? 'Unlike note' : 'Like note'}
            >
              <Heart
                className={`w-4 h-4 transition-colors ${noteLiked ? 'fill-red-500 text-red-500' : 'text-muted-foreground hover:text-red-400'}`}
              />
              {activeNote.like_count > 0 && (
                <span className="text-[9px] text-muted-foreground">{activeNote.like_count}</span>
              )}
            </button>
          </div>
        )}

        {/* Edit profile panel */}
        <AnimatePresence>
          {isSelf && editProfileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
              className="mb-3"
            >
              <div className="bg-secondary/30 rounded-xl p-3 space-y-3">
                {/* Avatar upload — moved here from the inline avatar
                    badge so it doesn't visually collide with the
                    "Add to story" camera. The pencil is now the
                    single edit-profile entry point. */}
                <div className="flex items-center gap-3">
                  <AvatarUploader
                    src={avatarUrl}
                    initials={initials}
                    editable
                    size={44}
                  />
                  <span className="text-xs text-muted-foreground">Tap to change avatar</span>
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={cityDraft}
                    onChange={e => setCityDraft(e.target.value.slice(0, 40))}
                    placeholder="Your city (e.g. Miami, FL)"
                    className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {countryFlag
                    ? <img src={flagUrl(countryFlag)} alt="flag" className="w-5 h-5 object-contain shrink-0" />
                    : <span className="text-sm shrink-0">🌍</span>
                  }
                  <button
                    type="button"
                    onClick={() => setFlagPickerOpen(true)}
                    className="flex-1 text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {countryFlag ? 'Change flag' : 'Pick country flag →'}
                  </button>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEditProfileOpen(false)}
                    className="flex-1 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-secondary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={savingProfile}
                    className="flex-1 py-1.5 text-xs rounded-lg text-white font-semibold disabled:opacity-60"
                    style={{ background: 'hsl(var(--primary))' }}
                  >
                    {savingProfile ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rank/Level/XP Block */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={`relative flex flex-col gap-3 p-4 rounded-lg mb-4 overflow-hidden ${tier.bg}`}
        >
          <Particles type={tier.particles} />
          
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`px-2 py-1 rounded-md bg-gradient-to-r ${tier.badge} shadow-sm`}>
                <span className="text-xs font-bold text-white drop-shadow">{tier.name}</span>
              </div>
            </div>
            <div className={`text-sm font-heading font-bold ${tier.text}`}>
              {t('levelBar.level').replace('{n}', level)}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="w-full h-2.5 bg-border rounded-full overflow-hidden">
              <motion.div
                className={`h-full bg-gradient-to-r ${tier.bar} rounded-full`}
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{Math.round(xpInLevel)} / {xpNeeded} XP</span>
            </div>
          </div>
        </motion.div>

        {/* Trophy Case */}
        {(trophyVisible || isSelf) && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Trophy Case</span>
              </div>
              {isSelf && (
                <button
                  type="button"
                  onClick={handleTrophyVisibility}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {trophyVisible ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
            {/* Unified trophy card — 5 slots with orange dashed borders */}
            <div className="rounded-xl border border-border bg-secondary/20 overflow-hidden">
              <div className="flex">
                {Array(5).fill(null).map((_, i) => {
                  const slot = trophyCase[i] ?? null;
                  const label = slot ? (TROPHY_LABELS[slot.value] || slot.value) : null;
                  return (
                    <motion.button
                      key={i}
                      type="button"
                      onClick={isSelf ? () => setTrophyPickerSlot(i) : undefined}
                      whileTap={isSelf ? { scale: 0.88 } : {}}
                      className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-3 px-0.5 relative ${
                        isSelf ? 'cursor-pointer hover:bg-secondary/40 active:bg-secondary/60' : 'cursor-default'
                      } transition-colors`}
                      style={i < 4 ? { borderRight: '1px dashed rgba(249,115,22,0.35)' } : {}}
                      aria-label={slot ? `Slot ${i + 1}: ${slot.value}` : `Empty slot ${i + 1}`}
                    >
                      {slot ? (
                        <>
                          <span className="text-4xl leading-none">{slot.value}</span>
                          <span className="text-xs text-neutral-500 leading-tight text-center truncate w-full mt-0.5">{label}</span>
                        </>
                      ) : isSelf ? (
                        <div className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-orange-400/50 w-9 h-9">
                          <Plus className="w-4 h-4" style={{ color: 'hsl(var(--primary) / 0.5)' }} />
                        </div>
                      ) : (
                        <span className="text-muted-foreground/25 text-lg">—</span>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Stat icon={FileText}  label={t('hub.profile.posts')}     value={posts.length} />
          <AnimatedStatButton onClick={() => setOpenModal('followers')} icon={UsersIcon} value={followers.length} label={t('hub.profile.followers')} />
          <AnimatedStatButton onClick={() => setOpenModal('following')} icon={UserIcon} value={following.length} label={t('hub.profile.following')} />
        </div>

        {/* Edit + Themes — inline side-by-side, own profile only */}
        {isSelf && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="flex gap-2 mb-4"
          >
            <button
              onClick={() => { setCityDraft(city); setEditProfileOpen(v => !v); }}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary transition-colors"
            >
              <Pencil className="w-4 h-4 text-muted-foreground" />
              Edit
            </button>
            <button
              onClick={() => setThemeOpen(true)}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary transition-colors"
            >
              <Palette className="w-4 h-4 text-primary" />
              {tFallback('hub.profile.themes', 'Themes')}
            </button>
          </motion.div>
        )}

        {!isSelf && (
          <div className="flex gap-2 items-center">
            {/* Mutual-follow indicator — small "Friends" pill renders only
                when both sides follow each other. Subtle reassurance that
                the relationship is reciprocal. */}
            {isMutualFollow && (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-primary/12 text-primary border border-primary/25"
                title={tFallback('hub.profile.mutualTooltip', 'You follow each other')}
              >
                <span aria-hidden="true">↔</span>
                {tFallback('hub.profile.mutual', 'Friends')}
              </span>
            )}
            <button
              onClick={handleFollow}
              disabled={!followStatusReady || followBusy}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1 disabled:cursor-not-allowed ${
                isFollowingNow
                  ? 'bg-secondary text-foreground hover:bg-destructive/10 hover:text-destructive'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              } ${!followStatusReady ? 'opacity-60' : ''}`}
            >
              {!followStatusReady || followBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isFollowingNow ? (
                t('hub.profile.unfollow')
              ) : (
                t('hub.profile.follow')
              )}
            </button>
            {(() => {
              // Three states for the message button:
              //   1. Auth still loading           → spinner, not tappable
              //   2. Conversation start in flight → spinner + "Working..."
              //   3. Ready                        → MessageCircle + "Message"
              const authReady = !!user?.email && !!onStartConversation;
              const inFlight = startConversationMutation.isPending;
              const disabled = !authReady || inFlight;
              return (
                <button
                  onClick={handleMessage}
                  disabled={disabled}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold border border-border text-foreground hover:bg-secondary transition-colors flex items-center justify-center gap-1.5 disabled:cursor-not-allowed ${
                    !authReady ? 'opacity-60' : ''
                  } ${authReady && !inFlight ? '' : 'disabled:opacity-50'}`}
                  aria-label={t('hub.profile.message')}
                >
                  {disabled
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <MessageCircle className="w-4 h-4" />}
                  {inFlight
                    ? t('hub.profile.working')
                    : t('hub.profile.message')}
                </button>
              );
            })()}
          </div>
        )}
      </motion.div>

      {/* Posts */}
      <h3 className="font-heading font-bold text-base mb-2 px-1">{t('hub.profile.recentPosts')}</h3>
      {posts.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">{t('hub.profile.noPosts')}</p>
      ) : (
        <div className="space-y-3">
          {posts.map(p => <HubPostCard key={p.id} post={p} onAuthorClick={onSelectUser} />)}
        </div>
      )}

      {/* Story Viewer */}
      {storyViewerOpen && profileStories.length > 0 && (
        <StoryViewer
          open={storyViewerOpen}
          groups={[{
            email,
            username: displayUsername || 'athlete',
            avatarUrl,
            storyDmsDisabled: false,
            isOwn: isSelf,
            stories: profileStories,
            hasUnseen: true,
            note: null,
          }]}
          startIndex={0}
          viewedIds={new Set()}
          likedIds={new Set()}
          user={user}
          onClose={() => setStoryViewerOpen(false)}
          onStoriesChange={() => queryClient.invalidateQueries({ queryKey: ['profileStories', email] })}
          onAddStory={() => {}}
        />
      )}

      {/* Status Note Editor */}
      <AnimatePresence>
        {noteEditorOpen && (
          <StatusNoteEditor
            existingNote={activeNote}
            origin={null}
            onPost={handleNotePost}
            onDelete={handleNoteDelete}
            onClose={() => setNoteEditorOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Trophy Slot Picker */}
      <AnimatePresence>
        {trophyPickerSlot !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 pb-safe"
            onClick={() => setTrophyPickerSlot(null)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
              className="bg-card border border-border rounded-t-2xl w-full max-w-lg p-5"
              style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-heading font-bold text-base">Choose Trophy</h3>
                <div className="flex items-center gap-2">
                  {trophyCase[trophyPickerSlot] && (
                    <button
                      type="button"
                      onClick={() => handleTrophySlotSet(trophyPickerSlot, null)}
                      className="text-xs text-destructive hover:opacity-70 transition-opacity"
                    >
                      Remove
                    </button>
                  )}
                  <button type="button" onClick={() => setTrophyPickerSlot(null)} className="p-1 rounded text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {['🏆','🥇','🥈','🥉','🎯','💪','🔥','⚡','🌟','⭐','🎖️','🏅','🏋️','🤸','🏊','🚴','🧗','🥊','🥋','🎽','💯','👑','🦁','🐺','🦅','🦊','🐉','⚔️','🛡️','💎','🌈','🌊','🎆','🎇','🎉','🎊','🎁','🌙','☀️','🌸','🍀','❄️','🔮','🌀','🌪️','🏔️','🌋','🦾','🧠','💥','🎪','🎭','🎮','🕹️','🎲','♟️','🎸','🥁','🎤','🎬','📸','🚀','🛸','🌍','🌠','✨'].map(emoji => (
                  <motion.button
                    key={emoji}
                    type="button"
                    whileTap={{ scale: 0.88 }}
                    onClick={() => handleTrophySlotSet(trophyPickerSlot, emoji)}
                    className="aspect-square flex items-center justify-center text-xl rounded-lg hover:bg-secondary transition-colors"
                  >
                    {emoji}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Flag Picker */}
      <AnimatePresence>
        {flagPickerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            onClick={() => setFlagPickerOpen(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
              className="bg-card border border-border rounded-t-2xl w-full max-w-lg p-5 max-h-[70vh] flex flex-col"
              style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
            >
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h3 className="font-heading font-bold text-base">Country Flag</h3>
                <button type="button" onClick={() => setFlagPickerOpen(false)} className="p-1 rounded text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1">
                <div className="grid grid-cols-8 gap-1">
                  {[['AF','Afghanistan'],['AL','Albania'],['DZ','Algeria'],['AD','Andorra'],['AO','Angola'],['AG','Antigua'],['AR','Argentina'],['AM','Armenia'],['AU','Australia'],['AT','Austria'],['AZ','Azerbaijan'],['BS','Bahamas'],['BH','Bahrain'],['BD','Bangladesh'],['BB','Barbados'],['BY','Belarus'],['BE','Belgium'],['BZ','Belize'],['BJ','Benin'],['BT','Bhutan'],['BO','Bolivia'],['BA','Bosnia'],['BW','Botswana'],['BR','Brazil'],['BN','Brunei'],['BG','Bulgaria'],['BF','Burkina Faso'],['BI','Burundi'],['CV','Cape Verde'],['KH','Cambodia'],['CM','Cameroon'],['CA','Canada'],['CF','Cent. Africa'],['TD','Chad'],['CL','Chile'],['CN','China'],['CO','Colombia'],['KM','Comoros'],['CD','Congo DR'],['CG','Congo'],['CR','Costa Rica'],['CI','Côte dIvoire'],['HR','Croatia'],['CU','Cuba'],['CY','Cyprus'],['CZ','Czechia'],['DK','Denmark'],['DJ','Djibouti'],['DM','Dominica'],['DO','Dom. Republic'],['EC','Ecuador'],['EG','Egypt'],['SV','El Salvador'],['GQ','Eq. Guinea'],['ER','Eritrea'],['EE','Estonia'],['SZ','Eswatini'],['ET','Ethiopia'],['FJ','Fiji'],['FI','Finland'],['FR','France'],['GA','Gabon'],['GM','Gambia'],['GE','Georgia'],['DE','Germany'],['GH','Ghana'],['GR','Greece'],['GD','Grenada'],['GT','Guatemala'],['GN','Guinea'],['GW','Guinea-Bissau'],['GY','Guyana'],['HT','Haiti'],['HN','Honduras'],['HU','Hungary'],['IS','Iceland'],['IN','India'],['ID','Indonesia'],['IR','Iran'],['IQ','Iraq'],['IE','Ireland'],['IL','Israel'],['IT','Italy'],['JM','Jamaica'],['JP','Japan'],['JO','Jordan'],['KZ','Kazakhstan'],['KE','Kenya'],['KI','Kiribati'],['KW','Kuwait'],['KG','Kyrgyzstan'],['LA','Laos'],['LV','Latvia'],['LB','Lebanon'],['LS','Lesotho'],['LR','Liberia'],['LY','Libya'],['LI','Liechtenstein'],['LT','Lithuania'],['LU','Luxembourg'],['MG','Madagascar'],['MW','Malawi'],['MY','Malaysia'],['MV','Maldives'],['ML','Mali'],['MT','Malta'],['MH','Marshall Is.'],['MR','Mauritania'],['MU','Mauritius'],['MX','Mexico'],['MD','Moldova'],['MC','Monaco'],['MN','Mongolia'],['ME','Montenegro'],['MA','Morocco'],['MZ','Mozambique'],['MM','Myanmar'],['NA','Namibia'],['NR','Nauru'],['NP','Nepal'],['NL','Netherlands'],['NZ','New Zealand'],['NI','Nicaragua'],['NE','Niger'],['NG','Nigeria'],['NO','Norway'],['OM','Oman'],['PK','Pakistan'],['PW','Palau'],['PA','Panama'],['PG','Papua NG'],['PY','Paraguay'],['PE','Peru'],['PH','Philippines'],['PL','Poland'],['PT','Portugal'],['QA','Qatar'],['RO','Romania'],['RU','Russia'],['RW','Rwanda'],['KN','St Kitts'],['LC','St Lucia'],['VC','St Vincent'],['WS','Samoa'],['SM','San Marino'],['ST','São Tomé'],['SA','Saudi Arabia'],['SN','Senegal'],['RS','Serbia'],['SC','Seychelles'],['SL','Sierra Leone'],['SG','Singapore'],['SK','Slovakia'],['SI','Slovenia'],['SB','Solomon Is.'],['SO','Somalia'],['ZA','South Africa'],['SS','South Sudan'],['ES','Spain'],['LK','Sri Lanka'],['SD','Sudan'],['SR','Suriname'],['SE','Sweden'],['CH','Switzerland'],['SY','Syria'],['TW','Taiwan'],['TJ','Tajikistan'],['TZ','Tanzania'],['TH','Thailand'],['TL','Timor-Leste'],['TG','Togo'],['TO','Tonga'],['TT','Trinidad'],['TN','Tunisia'],['TR','Turkey'],['TM','Turkmenistan'],['TV','Tuvalu'],['UG','Uganda'],['UA','Ukraine'],['AE','UAE'],['GB','UK'],['US','USA'],['UY','Uruguay'],['UZ','Uzbekistan'],['VU','Vanuatu'],['VE','Venezuela'],['VN','Vietnam'],['YE','Yemen'],['ZM','Zambia'],['ZW','Zimbabwe']].map(([code, name]) => {
                    const emoji = [...code.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0) + 127397)).join('');
                    const imgSrc = flagUrl(emoji);
                    return (
                      <motion.button
                        key={code}
                        type="button"
                        whileTap={{ scale: 0.88 }}
                        onClick={async () => {
                          setFlagPickerOpen(false);
                          try {
                            await me.update({ country_flag: emoji });
                            queryClient.invalidateQueries({ queryKey: ['hubProfileLookup', email] });
                          } catch {
                            toast.error('Could not save flag');
                          }
                        }}
                        className="aspect-square flex flex-col items-center justify-center gap-0.5 rounded hover:bg-secondary transition-colors p-1"
                        title={name}
                      >
                        <img src={imgSrc} alt={name} className="w-6 h-6 object-contain" />
                        <span className="text-[7px] text-muted-foreground leading-none">{code}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Followers/Following Modal */}
      <AnimatePresence>
        {openModal && (
          <FollowingModal
            type={openModal}
            emails={openModal === 'followers' ? followers : following}
            onClose={() => setOpenModal(null)}
            onSelectUser={(selectedUser) => {
              setOpenModal(null);
              if (onSelectUser) onSelectUser(selectedUser);
            }}
          />
        )}
      </AnimatePresence>

      {/* Theme Selector */}
      {isSelf && (
        <ThemeSelector open={themeOpen} onClose={() => setThemeOpen(false)} />
      )}


      {/* Unfollow Confirmation Dialog */}
      <AnimatePresence>
        {unfollowConfirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
            onClick={() => setUnfollowConfirmOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl max-w-sm w-full p-6"
            >
              <h3 className="font-heading font-bold text-lg mb-2">{t('hub.profile.unfollowConfirmTitle')}</h3>
              <p className="text-sm text-muted-foreground mb-6">
                {t('hub.profile.unfollowConfirmDesc').replace('{handle}', ownerUsername ? `@${ownerUsername}` : t('hub.profile.anonymousAthlete'))}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setUnfollowConfirmOpen(false)}
                  className="flex-1 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary transition-colors"
                >
                  {t('hub.profile.unfollowConfirmCancel')}
                </button>
                <button
                  onClick={handleConfirmUnfollow}
                  disabled={followBusy}
                  className="flex-1 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {followBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t('hub.profile.unfollowing')}
                    </>
                  ) : (
                    t('hub.profile.unfollowAction')
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ThemedScope>
  );
}

function FollowingModal({ type, emails, onClose, onSelectUser }) {
  const { t } = useLanguage();
  
  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const { data: allUsers = [] } = useQuery({
    queryKey: ['hubProfileUsers', emails],
    queryFn: async () => {
      if (!emails.length) return [];
      const users = await db.entities.User.list().catch(() => []);
      return users.filter(u => emails.includes(u.email)).map(u => ({
        ...u,
        // Fallback to email prefix if username is stripped by User.list()
        username: u.username || (u.email ? u.email.split('@')[0] : 'athlete'),
        levelData: calculateLevelFromXp(Number(u.total_xp) || 0),
        tier: getTier(calculateLevelFromXp(Number(u.total_xp) || 0).level, t),
      }));
    },
    enabled: !!emails.length,
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl max-w-sm w-full max-h-[70vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="font-heading font-bold text-lg">
            {type === 'followers' ? t('hub.profile.followers') : t('hub.profile.following')}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {allUsers.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-center">
              <p className="text-sm text-muted-foreground">{t('hub.profile.noUsers')}</p>
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {allUsers.map((u) => (
                <motion.button
                  key={u.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => {
                    // Synthesize a username from email prefix if Base44's list call
                    // didn't return one. This guarantees the receiving profile page
                    // has SOMETHING to display as @handle, matching what search shows.
                    onSelectUser({
                      ...u,
                      username: u.username || u.email?.split('@')[0] || null,
                    });
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-secondary/60 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                    {u.avatar_url ? (
                      <img
                        src={u.avatar_url}
                        alt=""
                        width="40"
                        height="40"
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="font-heading font-bold text-sm text-primary">
                        {(u.username || u.email)?.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-bold text-sm truncate">
                      @{u.username || u.email?.split('@')[0] || t('hub.profile.anonymousAthlete')}
                    </p>
                    {u.tier && (
                      <p className={`text-xs truncate ${u.tier.text}`}>{u.tier.name}</p>
                    )}
                  </div>
                  {u.levelData && u.tier && (
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className={`px-2 py-0.5 rounded-md bg-gradient-to-r ${u.tier.badge} shadow-sm`}>
                        <span className="text-xs font-bold text-white drop-shadow">Lv {u.levelData.level}</span>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${u.tier.text}`}>{u.tier.name}</span>
                    </div>
                  )}
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function AnimatedStatButton({ onClick, icon: Icon, value, label }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!value) { setDisplay(0); return; }
    let start = 0;
    const duration = 600;
    const step = 16;
    const increment = value / (duration / step);
    const timer = setInterval(() => {
      start += increment;
      if (start >= value) { setDisplay(value); clearInterval(timer); }
      else setDisplay(Math.floor(start));
    }, step);
    return () => clearInterval(timer);
  }, [value]);
  return (
    <button onClick={onClick} className="bg-secondary/40 rounded-lg p-2 text-center hover:bg-secondary/60 transition-colors">
      <Icon className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
      <p className="font-heading font-bold text-base">{display}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </button>
  );
}

function Stat({ icon: Icon, label, value }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!value) { setDisplay(0); return; }
    let start = 0;
    const duration = 600;
    const step = 16;
    const increment = value / (duration / step);
    const timer = setInterval(() => {
      start += increment;
      if (start >= value) { setDisplay(value); clearInterval(timer); }
      else setDisplay(Math.floor(start));
    }, step);
    return () => clearInterval(timer);
  }, [value]);
  return (
    <div className="bg-secondary/40 rounded-lg p-2 text-center">
      <Icon className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
      <p className="font-heading font-bold text-base">{display}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}