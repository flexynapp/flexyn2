// src/components/hub/HubProfile.jsx
// NOTE: All imports are consolidated at the top before any function declarations.
// Having code before import statements confuses Rollup's module-ordering
// algorithm and can produce TDZ (Cannot access 'X' before initialization) errors
// in the Hub bundle. Keep imports-first as an invariant here.
import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import { triggerHaptic } from '@/lib/haptic';
import { initialsFor } from '@/lib/initials';
import { User as UserIcon, FileText, X, Loader2, MapPin, Heart, Link2, Copy, ExternalLink, Bookmark, ChevronLeft, Medal, Swords, Shield, Trophy, Dumbbell, Lock } from 'lucide-react';
import ThemeSelector from '@/components/ThemeSelector';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { currentStreak } from '@/lib/trainingWeek';
import { useNumberFormatter } from '@/lib/intl';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { buildPRIndex } from '@/lib/data/personalRecords';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import * as hubFollows from '@/lib/data/hubFollows';
import { invalidateFollowGraph } from '@/lib/followGraphCache';
import * as userMutes from '@/lib/data/userMutes';
import { blockUserFull } from '@/lib/data/userBlocks';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import * as hubPosts from '@/lib/data/hubPosts';
import * as hubReactions from '@/lib/data/hubReactions';
import * as me from '@/lib/data/me';
import { selectProfiles } from '@/lib/data/users';
import * as usersData from '@/lib/data/users';
import * as statusNotesData from '@/lib/data/statusNotes';
import { hasAnyProfanity } from '@/lib/useProfanityGuard';
import { reverseGeocode } from '@/lib/geocode';
import { patchProfile } from '@/api/profileCache';
import HubPostCard from './HubPostCard';
import ReferralCard from './ReferralCard';
import ProfileLiftStats from './ProfileLiftStats';
import ProfileCompletionMeter from './ProfileCompletionMeter';
import EmptyState from '@/components/EmptyState';
import StoryHighlightsRail from './StoryHighlightsRail';
import ThemedScope from '@/components/ThemedScope';
import AvatarUploader from '@/components/AvatarUploader';
import ProfileMetrics from './profile/ProfileMetrics';
import ProfileActions from './profile/ProfileActions';
import ProfileTrophies from './profile/ProfileTrophies';
import ProfileLeaguePlate from './profile/ProfileLeaguePlate';
import ProfileSummaryList, { SummaryRow } from './profile/ProfileSummaryList';
import ProfileRecentWorkouts from './profile/ProfileRecentWorkouts';
import { useHeroContests } from './profile/useHeroContests';
import { getLootTitleById } from '@/lib/lootTitles';
import { getLootFrameById } from '@/lib/lootFrames';
import { RARITY } from '@/lib/lootCatalog';
import { useTheme } from '@/lib/ThemeContext';
import { isVerified, isPoop, hasSnakeEgg, hasBirdEgg, hasSweatEgg } from '@/lib/verifiedUsers';
import StoryViewer from '@/components/stories/StoryViewer';
import StatusNoteEditor from '@/components/stories/StatusNoteEditor';
import * as storiesData from '@/lib/data/stories';
import { listEarned as listEarnedTrophies } from '@/lib/data/trophies';
import { safeExternalUrl } from '@/lib/safeUrl';
import { flagSrc } from '@/lib/flags';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { shareOrigin } from '@/lib/appOrigin';
import * as workouts from '@/lib/data/workouts';

const GiftCoinsModal = lazy(() => import('./GiftCoinsModal'));
const CreateDuelModal = lazy(() => import('@/components/duels/CreateDuelModal'));
// Hidden easter-egg Snake game — only mounted on the @sean admin profile
// (gated by showSnakeEgg below). Lazy so its canvas/game code stays out
// of the entry + Hub bundles for everyone else.
const SnakeGameModal = lazy(() => import('./SnakeGameModal'));
// Hidden easter-egg "Heavy Bird" — only on its account (see verifiedUsers.js).
const HeavyBirdModal = lazy(() => import('./HeavyBirdModal'));
// Hidden easter-egg "Sweat Jetpack" — only on its accounts (see verifiedUsers.js).
// Fat sweating dude propelled by his own sweat. Pixelated retro look.
const SweatJetpackModal = lazy(() => import('./SweatJetpackModal'));
const LeagueStandingsModal = lazy(() => import('@/components/dashboard/LeagueStandingsModal'));

// Poop badge — shown on certain special users
function PoopBadge({ size = 22 }) {
  return (
    <span style={{ fontSize: size, lineHeight: 1, display: 'block' }} aria-label="💩" title="💩">💩</span>
  );
}

// Orange 3-pronged crown — shown as an absolute badge on the avatar for verified admins
function CrownBadge({ size = 18 }) {
  const { tFallback } = useLanguage();
  return (
    <svg width={size} height={size} viewBox="0 0 16 14" fill="none" aria-label={tFallback("hubProfile.admin", "Admin")} title={tFallback("hubProfile.verifiedAdmin", "Verified Admin")}>
      <path d="M1 12h14M2 12L1 4l4 3.5L8 1l3 6.5L15 4l-1 8H2z" fill="#f97316" stroke="#ea6c00" strokeWidth="0.8" strokeLinejoin="round"/>
    </svg>
  );
}

// ── QR Code generator ─────────────────────────────────────────────────────────
// Uses the public qrserver.com API — no package needed, no CORS issues.
// Returns a URL to a PNG image of the QR code.
function generateQrUrl(text) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(text)}&margin=10`;
}

// ── QR Code modal ─────────────────────────────────────────────────────────────
function QRModal({ url, username, onClose }) {
  const { tFallback } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const qrImgUrl = generateQrUrl(url);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `@${username} on Flexyn`, url });
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    handleCopy();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-card border border-border rounded-t-2xl w-full max-w-sm p-6 flex flex-col items-center gap-4"
        style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-between w-full">
          <h3 className="font-heading font-bold text-base">@{username}'s QR Code</h3>
          <button type="button" onClick={onClose} className="p-1 rounded text-muted-foreground hover:bg-secondary active:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative w-52 h-52 rounded-xl border border-border overflow-hidden bg-white">
          {!imgLoaded && <div className="absolute inset-0 bg-muted animate-pulse" />}
          <img loading="lazy" src={qrImgUrl}
            alt={tFallback("hubProfile.profileQrCode", "Profile QR code")}
            className="w-full h-full object-contain"
            onLoad={() => setImgLoaded(true)}
          />
        </div>
        <p className="text-xs text-muted-foreground text-center break-all px-2">{url}</p>
        <div className="flex gap-2 w-full">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-secondary active:bg-secondary transition-colors"
          >
            <Copy className="w-4 h-4" />
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            {tFallback("achievements.share.label", "Share")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

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
  // ─── 2026-05-29 expansion — fitness + competitive + nature + elemental ──
  '🐅':'Tiger','🐻':'Bear','🦈':'Shark','🐍':'Snake','🐎':'Horse',
  '🦌':'Stag','🦬':'Bison','🐂':'Bull','🦏':'Rhino','🐊':'Crocodile',
  '🦂':'Scorpion','🕷️':'Spider','🐝':'Hornet','🦋':'Butterfly','🪐':'Saturn',
  '🌞':'Sun','🌚':'Eclipse','🌖':'Waning','🌗':'Half','🌘':'Crescent',
  '☄️':'Comet','🌅':'Sunrise','🌃':'Skyline','🗻':'Peak','🏟️':'Stadium',
  '⛰️':'Summit','🗽':'Statue','🏛️':'Temple','⛩️':'Shrine','🛕':'Sanctum',
  '🧿':'Evil Eye','🪬':'Hamsa','🔱':'Trident','⚜️':'Fleur-de-lis','♾️':'Infinity',
  '🌹':'Rose','🌻':'Sunflower','🍁':'Maple','🌴':'Palm','🌵':'Cactus',
  '🎺':'Trumpet','🪗':'Accordion','🥇':'Gold','🪙':'Coin','💰':'Bag',
  '🎰':'Jackpot','🃏':'Wild Card','🎯':'Bullseye','⛓️':'Chain','🪓':'Axe',
  '🗡️':'Dagger','🏹':'Bow','🔨':'Hammer','⚒️':'Forge','⚙️':'Gear',
  '🔩':'Bolt','🪜':'Ladder','🪧':'Sign','🎪':'Big Top',
};

export default function HubProfile({ targetUser = null, onSelectUser = null, onStartConversation = null, highlightPostId = null, onHighlightConsumed = null }) {
  const { t, tFallback, language } = useLanguage();
  const { user, checkUserAuth } = useAuth();
  const fmtNumber = useNumberFormatter();
  const { weightUnit } = useWeightUnit();
  // Read the user's currently-equipped theme from ThemeContext (always fresh)
  // instead of useAuth().user, which only loads once at bootstrap and doesn't
  // refresh when the user equips a new theme — that's why a freshly-applied
  // theme would show globally but stay default on the profile card.
  // (AuthProvider listens for `flexyn:loot-equipped` / `flexyn:theme-changed`
  // app-wide and refreshes useAuth().user, so this component no longer
  // needs its own listener.)
  const { themeId: liveThemeId, lootThemeId: liveLootThemeId } = useTheme();
  const queryClient = useQueryClient();
  const isSelf = !targetUser
    || (targetUser?.id && targetUser.id === user?.id)
    || (targetUser?.email && targetUser.email === user?.email);
  // The target may arrive keyed by id (new profile route) or by email (legacy
  // links). targetKey drives the lookups below (id preferred). The resolved
  // `email` used by the rest of this component's still-email-keyed machinery is
  // derived AFTER the profile query (from the prop, else the fetched row) —
  // declared there to avoid a TDZ, since these lookups no longer depend on it.
  const targetId = isSelf ? user?.id : (targetUser?.id ?? null);
  const targetEmailProp = isSelf ? user?.email : (targetUser?.email ?? null);
  const targetKey = targetId ?? targetEmailProp;
  const [openModal, setOpenModal] = useState(null); // 'followers', 'following', or null
  const [unfollowConfirmOpen, setUnfollowConfirmOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [storyViewerOpen, setStoryViewerOpen] = useState(false);
  // Highlight album viewer — opens StoryViewer with the album's items
  // shaped as a single group. activeHighlightItems is the resolved
  // story array; while it's loading we don't render the viewer.
  const [activeHighlight, setActiveHighlight] = useState(null);
  const [activeHighlightItems, setActiveHighlightItems] = useState([]);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteExpanded, setNoteExpanded] = useState(false);
  // null = no local override; the server's answer stands.
  const [noteLocalLiked, setNoteLocalLiked] = useState(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  // Declared up here rather than beside the avatar because it is read ~950
  // lines below AND inside a deps array; a const read before its declaration
  // line throws in production even where dev mode tolerates it (CLAUDE.md's
  // TDZ section — this exact shape crashed the Hub on 2026-05-23).
  const avatarEditable = isSelf && editProfileOpen;
  const [cityDraft, setCityDraft] = useState('');
  const [locating, setLocating] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [usernameDraft, setUsernameDraft] = useState('');
  const [usernameBusy, setUsernameBusy] = useState(false);
  // Mirrors user.is_private so the menu label flips immediately. The server
  // value stays authoritative; this only exists because the menu re-renders
  // before the auth user object round-trips.
  const [isPrivateLocal, setIsPrivateLocal] = useState(null);
  // `??` not `||`: false is a real value here, and `||` would fall through it
  // to the server value on every un-private, so turning privacy OFF would
  // leave the menu still reading "On".
  const isPrivateNow = isPrivateLocal ?? !!user?.is_private;
  // Holds the handle awaiting the "this spends your 30 days" confirmation.
  const [pendingHandle, setPendingHandle] = useState(null);
  const [bioDraft, setBioDraft] = useState('');
  const [websiteUrlDraft, setWebsiteUrlDraft] = useState('');
  const [flagPickerOpen, setFlagPickerOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  // Duel-from-profile modal. Screenshot feedback: "There should be a
  // button to dual someone" on the profile page. Reuses
  // CreateDuelModal which already knows how to pre-fill with an
  // opponentId + username, the same flow Nemesis uses.
  const [duelOpen, setDuelOpen] = useState(false);
  const [snakeOpen, setSnakeOpen] = useState(false);
  const [birdOpen, setBirdOpen] = useState(false);
  const [sweatOpen, setSweatOpen] = useState(false);
  const [trophyPickerSlot, setTrophyPickerSlot] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);
  // Overflow ("…") sheet — absorbs Themes, Share, Duel, Gift and trophy
  // visibility so the action row can stay at three controls.
  const [menuOpen, setMenuOpen] = useState(false);
  // Which detail replaces the summary: null (the summary), 'lifts',
  // 'trophies', 'posts' or 'liked'. Resets when the viewed profile changes,
  // otherwise navigating person → person would strand you on someone else's
  // Posts with no visual explanation of why.
  const [section, setSection] = useState(null);
  // The League row opens this week's standings in place. It used to open
  // the global leaderboards, so a row reading "Bronze, place 2 of 8" led to
  // a screen that showed neither.
  const [leagueOpen, setLeagueOpen] = useState(false);
  const storyFileRef = useRef(null);
  const eggTimerRef = useRef(null);
  const eggFiredRef = useRef(false);
  useEffect(() => () => clearTimeout(eggTimerRef.current), []);
  const navigate = useNavigate();

  // Always start a profile view at the top, regardless of where the user
  // scrolled before navigating in. Using 'auto' (not 'smooth') because the
  // new profile data is already mounting underneath — a smooth scroll would
  // race with the layout shift of new content.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    setSection(null);
    setMenuOpen(false);
    // Everything else scoped to the profile being viewed. The note like was
    // the visible one: like A's note, open B, and B's heart was filled.
    setNoteLocalLiked(null);
    setNoteExpanded(false);
    setEditProfileOpen(false);
    setLeagueOpen(false);
    setTrophyPickerSlot(null);
    setActiveHighlight(null);
  }, [targetKey]);

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
    queryKey: ['lastActive', targetKey],
    queryFn: async () => {
      // maybeSingle so a missing row returns null cleanly instead of
      // throwing PGRST116, which the surrounding try-less code path
      // would surface to the user as a broken activity pill.
      // Cross-user read → public_profiles view (falls back to
      // user_profiles while the view migration is pending).
      const { data } = await selectProfiles((from) => from
        .select('last_active_at')
        .eq('id', targetId)
        .maybeSingle());
      return data?.last_active_at || null;
    },
    // id-only: legacy email-targets (no id) simply skip the activity pill
    // rather than filtering the view by a column that no longer exists.
    enabled: !isSelf && !!targetId,
    staleTime: 60_000,
  });

  const activeLabel = (() => {
    if (isSelf || !targetLastActive) return null;
    const diff = Date.now() - new Date(targetLastActive).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 5) return { text: 'Active now', color: 'text-success' };
    if (diff < 86400000) {
      const h = Math.floor(diff / 3600000);
      return { text: `Active ${h || 1}h ago`, color: 'text-muted-foreground' };
    }
    return null;
  })();

  const { data: targetProfile } = useQuery({
    queryKey: ['hubProfileLookup', targetKey],
    queryFn: async () => {
      if (isSelf) return null;
      // id-only lookup. A legacy email-target (no id) can't be resolved
      // through the view anymore — fall back to whatever the nav prop
      // carried rather than filtering the view by a dropped column.
      if (!targetId) return targetUser || null;
      // safeSelect strips columns that aren't in the PostgREST schema
      // cache yet (e.g. country_flag / trophy_case if migration 049
      // is pending) and retries — so a mid-migration deploy doesn't
      // crash the Hub. Existing `?.` / `??` fallback patterns on
      // these fields downstream still render correctly when a
      // column is absent. NOTE: no `email` column — it was removed from
      // the public_profiles view, and nothing on this page needs it.
      const { data } = await safeSelect({
        columns: [
          'id', 'username', 'display_name', 'avatar_url', 'total_xp', 'league_tier',
          'preferred_theme', 'loot_theme_id',
          'equipped_title_id', 'equipped_frame_id',
          'city', 'country_flag', 'bio',
          'trophy_case', 'trophy_case_visible',
          'website_url', 'signature_trophy', 'workout_streak', 'is_private',
        ],
        build: (cols) => selectProfiles((from) => from
          .select(cols)
          .eq('id', targetId)
          .single()),
      });
      if (!data) return targetUser || null;
      return { ...data, username: data.username || targetUser?.username || null };
    },
    enabled: !isSelf && !!targetKey,
    // Only seed from the prop when it actually carries display data (email
    // links pass {email, username, avatar}). An id-only target ({id}) has no
    // username, and a seeded-but-sparse initialData would render the header
    // from a payload that has no username in it at all.
    initialData: isSelf ? null : (targetUser?.username ? targetUser : undefined),
    // …and every seed IS sparse. A nav payload carries username and avatar;
    // it never carries total_xp, current_level, bio, city or the trophy case.
    // react-query stamps initialData with the current time unless told
    // otherwise, so the default 60s staleTime counted the seed as fresh and
    // suppressed the fetch — leaving a real athlete reading Level 1 / 0 XP /
    // no bio for a full minute, which is indistinguishable from a new account.
    // `0` means "this seed is already stale": it still paints immediately, so
    // there is no placeholder flash, and the real row is fetched at once.
    initialDataUpdatedAt: 0,
  });

  // Everything on this page is keyed by user id. `email` is only ever the
  // viewer's own (or whatever a legacy email link carried); the page never
  // looks up anyone else's address.
  const email = isSelf ? user?.email : (targetEmailProp || null);

  // Profile stories (for clickable avatar → StoryViewer)
  // Crew stories are scoped to crew_id and must never appear here.
  const { data: profileStories = [] } = useQuery({
    queryKey: ['profileStories', targetId],
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from('stories')
        .select('*')
        .eq('user_id', targetId)
        .is('crew_id', null)  // SECURITY: personal stories only
        .gt('expires_at', now)
        .order('created_at', { ascending: true });
      return data ?? [];
    },
    enabled: !!targetId,
    staleTime: 30_000,
  });

  // Active status note for the profile owner
  const { data: activeNote, refetch: refetchNote } = useQuery({
    queryKey: ['profileNote', targetId],
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from('status_notes')
        .select('*')
        .eq('user_id', targetId)
        .gt('expires_at', now)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
    enabled: !!targetId,
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

  // Follower / following lists as user_ids (the modal resolves them by id
  // via User.list().id — never off the view's email). Legacy email-targets
  // (no targetId) show empty lists rather than reading the view.
  const { data: followerIds = [], isLoading: followersLoading } = useQuery({
    queryKey: ['hubFollowers', targetId],
    queryFn: () => hubFollows.listFollowersIds(targetId),
    enabled: !!targetId,
  });
  const { data: followingIds = [], isLoading: followingLoading } = useQuery({
    queryKey: ['hubFollowing', targetId],
    queryFn: () => hubFollows.listFollowingIds(targetId),
    enabled: !!targetId,
  });
  const {
    data: amFollowing,
    isLoading: amFollowingLoading,
  } = useQuery({
    queryKey: ['hubIsFollowing', user?.id, targetId],
    queryFn: () => hubFollows.isFollowing(user.id, targetId),
    enabled: !isSelf && !!user?.id && !!targetId,
  });

  // Mutual-follow query: does the TARGET also follow ME? Combined with
  // amFollowing this lets us render a small "Friends" / "Mutuals" badge
  // next to the follow button — the classic Twitter/IG signal that the
  // relationship is reciprocal. Knowing the social graph is symmetric
  // changes how openly users interact (less audience-feel, more
  // friends-feel).
  const { data: theyFollowMe } = useQuery({
    queryKey: ['hubTheyFollowMe', targetId, user?.id],
    queryFn: () => hubFollows.isFollowing(targetId, user.id),
    enabled: !isSelf && !!user?.id && !!targetId,
  });
  const isMutualFollow = amFollowing === true && theyFollowMe === true;

  // Anniversary date — the moment this friendship became mutual. Only
  // queried when we KNOW it's mutual (avoids a wasted call for non-
  // mutual or self views). Drives the "Training together since March
  // 2025" line under the bio. Returns ISO string or null.
  const { data: mutualSince } = useQuery({
    queryKey: ['hubMutualSince', user?.id, targetId],
    queryFn: () => hubFollows.getMutualFollowSince(user.id, targetId),
    enabled: !isSelf && isMutualFollow && !!user?.id && !!targetId,
    staleTime: 5 * 60_000, // doesn't change often
  });

  // True only when we have a definitive answer from the server. While the
  // query is still in-flight (or hasn't started because user.id isn't
  // loaded yet), we DON'T know whether the user follows the target — so
  // neither "Follow" nor "Unfollow" should be tappable.
  const followStatusReady = isSelf || (!!user?.id && amFollowing !== undefined);
  const { data: posts = [], isLoading: postsLoading } = useQuery({
    queryKey: ['hubProfilePosts', targetId, amFollowing, isSelf],
    queryFn: () => hubPosts.listForProfile(targetId, amFollowing, isSelf),
    enabled: !!targetId,
  });
  const [profilePostSort, setProfilePostSort] = useState('newest'); // 'newest' | 'popular'
  const sortedPosts = useMemo(() => {
    if (profilePostSort === 'popular') {
      return [...posts].sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
    }
    return posts;
  }, [posts, profilePostSort]);

  // ── Liked posts ──────────────────────────────────────────────────────────
  // A mode rather than a fourth tab: switching it on replaces the whole
  // Stats/Trophies/Posts area. Your likes are private and stay private — the
  // query reads hub_reactions by created_by, which RLS scopes to your own
  // rows, so there is no shape of this request that could return anyone
  // else's. That is why the control only exists on your own profile.
  const likesOpen = section === 'liked';
  const { data: likedPosts = [], isLoading: likedLoading } = useQuery({
    queryKey: ['myLikedPosts', user?.email],
    queryFn: async () => {
      const ids = await hubReactions.listMyLikedPostIds(user.email);
      if (!ids.length) return [];
      // Ordered by when YOU liked them, which listByIds preserves. A post
      // that has since been deleted drops out rather than rendering blank.
      return hubPosts.listByIds(ids);
    },
    enabled: isSelf && likesOpen && !!user?.email,
    staleTime: 30_000,
  });


  // ── Landing on a shared post ─────────────────────────────────────────────
  // A link built by the share sheet carries ?post=<id>. Opening it used to
  // drop you on the author's profile with nothing indicating which post was
  // meant — on a prolific account, twenty rows above the one being discussed.
  //
  // Three things have to line up before we can scroll: the Posts tab has to be
  // the active one, the posts query has to have resolved, and the row has to
  // have rendered. So this waits on the ref rather than firing on mount.
  const postRefs = useRef({});
  const [landedPostId, setLandedPostId] = useState(null);
  const highlightHandledRef = useRef(null);

  useEffect(() => {
    if (!highlightPostId) return;
    // Guard per id, not a boolean: a second shared link opened while this
    // profile is already mounted still deserves a scroll.
    if (highlightHandledRef.current === highlightPostId) return;
    if (!sortedPosts.some(p => p.id === highlightPostId)) return;
    if (section !== 'posts') { setSection('posts'); return; }

    const el = postRefs.current[highlightPostId];
    if (!el) return;   // rendering; the effect re-runs when the ref lands

    highlightHandledRef.current = highlightPostId;
    // rAF so the tab panel has painted at its real height — scrolling into a
    // panel that is still laying out lands at the wrong offset.
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setLandedPostId(highlightPostId);
    });
    // The outline is a pointer, not a state. Four seconds is long enough to
    // find on a slow scroll and short enough that it doesn't become part of
    // how the post looks.
    const t = setTimeout(() => {
      setLandedPostId(null);
      onHighlightConsumed?.();
    }, 4000);
    return () => clearTimeout(t);
  }, [highlightPostId, sortedPosts, section, onHighlightConsumed]);

  // ── Derived display values (needed by mutations below) ──────────────────
  const ownerUsername = isSelf
    ? user?.username
    : (targetUser?.username || targetProfile?.username || null);
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
      // Prefer ids so an id-only target (no email in scope) is still
      // followable and we never depend on the peer's view email.
      const followerRef = user?.id || user?.email;
      const followeeRef = targetId || email;
      if (!followerRef || !followeeRef) {
        throw new Error('missing-user');
      }
      return hubFollows.follow(followerRef, followeeRef, { t });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['hubIsFollowing', user?.id, targetId] });
      const previous = queryClient.getQueryData(['hubIsFollowing', user?.id, targetId]);
      queryClient.setQueryData(['hubIsFollowing', user?.id, targetId], true);
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['hubIsFollowing', user?.id, targetId], ctx.previous);
      }
      toast.error(t('hub.profile.followError'));
      console.error('[HubProfile] follow failed:', err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['hubIsFollowing', user?.id, targetId] });
      queryClient.invalidateQueries({ queryKey: ['hubMutualSince', user?.id, targetId] });
      // Every follow-graph cache, whoever's id it is keyed on: the viewer's
      // own lists, this profile's follower count, and the feeds built from
      // them.
      invalidateFollowGraph(queryClient);
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: async () => {
      const followerRef = user?.id || user?.email;
      const followeeRef = targetId || email;
      if (!followerRef || !followeeRef) {
        throw new Error('missing-user');
      }
      return hubFollows.unfollow(followerRef, followeeRef);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['hubIsFollowing', user?.id, targetId] });
      const previous = queryClient.getQueryData(['hubIsFollowing', user?.id, targetId]);
      queryClient.setQueryData(['hubIsFollowing', user?.id, targetId], false);
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['hubIsFollowing', user?.id, targetId], ctx.previous);
      }
      toast.error(t('hub.profile.unfollowError'));
      console.error('[HubProfile] unfollow failed:', err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['hubIsFollowing', user?.id, targetId] });
      queryClient.invalidateQueries({ queryKey: ['hubMutualSince', user?.id, targetId] });
      // Every follow-graph cache, whoever's id it is keyed on: the viewer's
      // own lists, this profile's follower count, and the feeds built from
      // them.
      invalidateFollowGraph(queryClient);
    },
  });

  // The target key handed to the conversation starter: the id, which is
  // present synchronously on every nav target. The server resolves it.
  const messageTargetKey = targetId || email || null;

  const startConversationMutation = useMutation({
    mutationFn: async () => {
      if (!user?.email) throw new Error('missing-user');
      if (!onStartConversation) throw new Error('no-handler');
      if (!messageTargetKey) throw new Error('missing-target');
      await onStartConversation({
        id: targetId || null,
        email,
        username: ownerUsername,
        avatar_url: avatarUrl,
      });
    },
    onError: (err) => {
      // Every branch surfaces something. This button used to be able to
      // fail with no feedback whatsoever.
      if (err?.message === 'missing-user') {
        toast.error(t('hub.profile.messageNotReady'));
        return;
      }
      toast.error(t('hub.profile.messageNotReady'));
      reportError(err instanceof Error ? err : new Error(String(err)), {
        feature: 'dm.start',
        level: 'warning',
        userEmail: user?.email,
        reason: err?.message || 'unknown',
      });
    },
  });

  const handleMessage = () => {
    if (startConversationMutation.isPending) return;
    // Anything else that would have bailed silently now goes through the
    // mutation so onError can speak. The old version returned early on
    // four separate conditions with no toast, no log and no navigation —
    // which is exactly what "nothing occurs, not even an error code"
    // looked like from the outside.
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
      // checkUserAuth, not just the query invalidation. On your OWN profile
      // `trophyCase` is read from useAuth().user, not from the
      // hubProfileLookup cache (which is null for self) — so invalidating the
      // query alone left the write persisted server-side and invisible until
      // a reload. Same pattern handleSetSignature and handleSaveProfile
      // already use. More noticeable now that slot 1 also drives the banner
      // crest: you'd pick a trophy and nothing anywhere would change.
      await checkUserAuth?.();
      queryClient.invalidateQueries({ queryKey: ['hubProfileLookup', email] });
    } catch {
      toast.error(tFallback("hubProfile.couldNotUpdateTrophyCase", "Could not update trophy case"));
    }
    setTrophyPickerSlot(null);
  };
  const handleTrophyVisibility = async () => {
    const next = !trophyVisible;
    try {
      await me.update({ trophy_case_visible: next });
      await checkUserAuth?.();
      queryClient.invalidateQueries({ queryKey: ['hubProfileLookup', email] });
    } catch {
      toast.error(tFallback("hubProfile.couldNotUpdateVisibility", "Could not update visibility"));
    }
  };

  // ── Signature trophy — pin one trophy-case emoji next to your name ──────────
  const handleSetSignature = async (emoji) => {
    const next = signatureTrophy === emoji ? null : emoji;
    try {
      await me.update({ signature_trophy: next });
      await checkUserAuth?.();
      queryClient.invalidateQueries({ queryKey: ['hubProfileLookup', email] });
      queryClient.invalidateQueries({ queryKey: ['hubAuthorsList'] });
    } catch {
      toast.error(tFallback("hubProfile.couldNotUpdateSignature", "Could not update signature"));
    }
  };

  // ── "Use current location" ───────────────────────────────────────────────
  // The field stays free text on purpose — someone typing "Gotham City" is a
  // supported answer, not input to be validated. This only offers to FILL it;
  // whatever lands is still editable, and a decline leaves the existing value
  // untouched rather than clearing it, because losing a city you typed is a
  // worse outcome than not getting the shortcut.
  const handleUseCurrentLocation = async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error(tFallback('hub.profile.locationUnsupported', "This device can't share a location."));
      return;
    }
    setLocating(true);
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,   // a city name does not need 5m of GPS
          timeout: 10_000,
          maximumAge: 300_000,
        });
      });
      const label = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      if (label) {
        setCityDraft(label.slice(0, 40));
      } else {
        // Reached the service, got nothing nameable back. Distinct from a
        // failed lookup, and distinct from "you have no location".
        toast.info(tFallback('hub.profile.locationNoName', "Couldn't name that spot. Type it in instead."));
      }
    } catch (err) {
      // PERMISSION_DENIED is a choice, not a fault, so it does not report to
      // Sentry and does not read as an error state.
      if (err?.code === 1) {
        toast.info(tFallback('hub.profile.locationDenied', 'Location is off for Flexyn. Type your city instead.'));
      } else {
        reportError(err, { feature: 'profile.use-current-location', level: 'warning' });
        toast.error(tFallback('hub.profile.locationFailed', "Couldn't get your location. Type it in instead."));
      }
    } finally {
      setLocating(false);
    }
  };

  // ── Profile edit save ────────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (hasAnyProfanity(bioDraft, cityDraft, displayNameDraft)) {
      toast.error(tFallback('common.profanity.beforeSaving', 'Please remove inappropriate language before saving.'));
      return;
    }
    setSavingProfile(true);
    try {
      const updates = {
        city: cityDraft.trim(),
        bio: bioDraft.trim() || null,
        // Empty means "show my @handle alone" — stored as NULL rather than '',
        // so the render check stays a single truthiness test.
        display_name: displayNameDraft.trim() || null,
      };
      // website_url: normalise — prepend https:// if the user omitted a scheme
      const rawUrl = websiteUrlDraft.trim();
      if (rawUrl) {
        updates.website_url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      } else {
        updates.website_url = null;
      }
      await me.update(updates);
      // For the OWN profile the card reads from useAuth().user (not the
      // hubProfileLookup cache, which is null for self), so refresh the
      // auth user to reflect the new bio / city / link immediately.
      await checkUserAuth?.();
      queryClient.invalidateQueries({ queryKey: ['hubProfileLookup', email] });
      setEditProfileOpen(false);
      toast.success(tFallback('hub.profile.saved', 'Saved. Looking sharp.'));
    } catch (err) {
      // Never err.message: it is a developer string in English, e.g.
      // 'Profanity detected in field "display_name"'.
      reportError(err, { feature: 'profile.save', level: 'warning' });
      toast.error(tFallback('hub.profile.saveFailed', 'Could not save'));
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
  const emailPrefix = null;
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

  // The CHOSEN public name, above the handle — Twitter's shape, which is what
  // Sean asked for. Deliberately NOT `full_name`: that column holds the name
  // people typed into a signup form (19 of its 21 values are two-part real
  // names), and publishing it here would expose them without anyone opting
  // in. `display_name` is null until someone sets it, and null means the
  // handle renders alone exactly as it does today — so nothing changes for
  // the 57 accounts that have not chosen one.
  // Trimmed for the same reason as in resolveAuthor: "   " is truthy, and an
  // untrimmed value renders a bold empty heading above the handle.
  const displayName = ((isSelf
    ? user?.display_name
    : (targetUser?.display_name || targetProfile?.display_name)) || '').trim() || null;

  // ── Private account ──────────────────────────────────────────────────────
  //
  // The flag is the whole mechanism: migration 351 gates hub_follows,
  // user_trophies, hub_posts and the stats half of public_profiles on it, so
  // there is nothing to hide in the client and nothing here that could be
  // bypassed by hiding it badly.
  //
  // patchProfile is REQUIRED, not belt-and-braces. `db.auth.me()` answers from
  // a module-level cache and only re-reads when that cache is empty, so
  // invalidating the query key refetches and hands back the same stale object
  // — the toggle would flip, then revert on the next mount while the database
  // held the new value. That exact bug hit all four Settings privacy toggles
  // (CLAUDE.md, Profile cache).
  const handleTogglePrivate = async () => {
    const next = !isPrivateNow;
    setMenuOpen(false);
    try {
      await me.update({ is_private: next });
      patchProfile({ is_private: next });
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      setIsPrivateLocal(next);
      toast.success(next
        ? tFallback('hub.profile.nowPrivate', 'Your account is private. Only followers can see your stats, posts and badges.')
        : tFallback('hub.profile.nowPublic', 'Your account is public again.'));
    } catch (err) {
      reportError(err, { feature: 'profile.toggle-private', level: 'warning' });
      toast.error(tFallback('hub.profile.privateFailed', "Couldn't change that. Try again."));
    }
  };

  // ── Changing the @handle ─────────────────────────────────────────────────
  //
  // Two steps by design. The user already HAS a handle, so a change spends an
  // allowance they cannot get back for a month — that has to be said before
  // it is spent, not reported afterwards as a refusal. Someone claiming a
  // handle for the first time has nothing to spend and goes straight through.
  //
  // The server is the authority on all of it: this confirmation is a courtesy,
  // and set_username() enforces uniqueness and the cooldown regardless of what
  // this component believes.
  const commitUsername = async (next) => {
    setUsernameBusy(true);
    const res = await me.setUsername(next);
    setUsernameBusy(false);
    setPendingHandle(null);

    if (res?.ok) {
      // Patch with what the SERVER returned, never with what we sent — it
      // lowercases and strips a leading '@', so the two differ on most calls.
      // (CLAUDE.md, Profile cache: invalidating the query key alone re-reads
      // the module-level cache and hands back the stale object.)
      patchProfile({ username: res.username, username_changed_at: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      // The header and the Done button read the handle from AuthContext,
      // which the cache patch does not reach. Without this the page kept the
      // old @handle and Done re-armed, offering to spend the 30 days again.
      await checkUserAuth?.();
      setUsernameDraft(res.username || next);
      if (res.reason !== 'unchanged') {
        toast.success(tFallback('hub.profile.handleChanged', 'Your handle is now @{handle}.', { handle: res.username }));
      }
      return;
    }

    const messages = {
      taken:     tFallback('hub.profile.handleTaken', 'This username is not available.'),
      invalid:   tFallback('hub.profile.handleInvalid', '3–20 characters, letters, numbers and underscores only.'),
      reserved:  tFallback('hub.profile.handleReserved', 'This username is reserved.'),
      cooldown:  tFallback('hub.profile.handleCooldown', 'You can only change your handle once every 30 days.'),
      // The migration has not been run yet. Distinct from a refusal, because
      // there is nothing the user can do about it and retrying will not help.
      unavailable: tFallback('hub.profile.handleUnavailable', "Handle changes aren't switched on yet."),
    };
    toast.error(messages[res?.reason] || tFallback('hub.profile.handleRejected', "Couldn't change your handle."));
  };

  const handleUsernameSubmit = () => {
    const next = usernameDraft.trim().replace(/^@/, '');
    if (!next || next.toLowerCase() === (displayUsername || '').toLowerCase()) return;
    // `username_changed_at` is null until the first CHANGE, so a first claim
    // skips the warning entirely — there is no allowance to spend yet.
    const hasHandleAlready = !!displayUsername;
    if (hasHandleAlready) { setPendingHandle(next); return; }
    commitUsername(next);
  };

  // ── Mute / block from the profile ────────────────────────────────────────
  // Muting was reachable from any post; UNMUTING only from Settings → Privacy.
  // So the action and its undo lived in different places, and someone who
  // muted a person had no way to find the reversal from the person's own page.
  // Both live here now, whichever state you are in.
  const [confirmBlockOpen, setConfirmBlockOpen] = useState(false);
  const { data: myMutes = [] } = useQuery({
    queryKey: ['userMutes', user?.id],
    queryFn: () => userMutes.listMutes(user.id),
    enabled: !isSelf && !!user?.id,
  });
  const isMutedTarget = !!targetId && myMutes.some(m => m.muted_id === targetId);

  const handleMute = async () => {
    setMenuOpen(false);
    try {
      await userMutes.muteUser(user, targetId);
      toast.success(tFallback('hub.profile.mutedToast', 'Muted {handle}.', { handle: displayHandle }));
      queryClient.invalidateQueries({ queryKey: ['userMutes', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
    } catch (err) {
      reportError(err, { feature: 'hub.profile-mute', level: 'warning', userEmail: user?.email, target: targetId });
      toast.error(tFallback('hub.profile.muteError', 'Could not mute. Try again.'));
    }
  };

  const handleUnmute = async () => {
    setMenuOpen(false);
    try {
      await userMutes.unmuteUser(user.id, targetId);
      toast.success(tFallback('hub.profile.unmutedToast', 'Unmuted {handle}.', { handle: displayHandle }));
      queryClient.invalidateQueries({ queryKey: ['userMutes', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
    } catch (err) {
      reportError(err, { feature: 'hub.profile-unmute', level: 'warning', userEmail: user?.email, target: targetId });
      toast.error(tFallback('hub.profile.unmuteError', 'Could not unmute. Try again.'));
    }
  };

  const handleConfirmBlock = async () => {
    setConfirmBlockOpen(false);
    try {
      await blockUserFull(targetId);
      toast.success(tFallback('hub.profile.blockedToast', 'Blocked {handle}.', { handle: displayHandle }));
      // block_user_full severs mutual follows too, so the follow-graph caches
      // have to go with it — same set HubPostCard invalidates.
      queryClient.invalidateQueries({ queryKey: ['userBlocks', user?.id] });
      // block_user_full has just severed the follow rows in BOTH directions.
      invalidateFollowGraph(queryClient);
      queryClient.invalidateQueries({ queryKey: ['myFollowsForDMs', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['hubIsFollowing', user?.id, targetId] });
    } catch (err) {
      reportError(err, { feature: 'hub.profile-block', level: 'warning', userEmail: user?.email, target: targetId });
      toast.error(tFallback('hub.profile.blockError', 'Could not block. Try again.'));
    }
  };

  // Shared helper so this and the header avatar can't drift again. Passing
  // only the username keeps this surface username-only, per the note above.
  const initials = initialsFor({ username: displayUsername });

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
  const websiteUrl   = isSelf ? (user?.website_url ?? '')   : (targetProfile?.website_url ?? '');
  const rawTrophy    = isSelf ? (user?.trophy_case ?? [])   : (targetProfile?.trophy_case ?? []);
  const trophyCase   = Array.isArray(rawTrophy) ? rawTrophy : [];
  const trophyVisible = isSelf ? (user?.trophy_case_visible ?? true) : (targetProfile?.trophy_case_visible ?? true);
  const signatureTrophy = isSelf ? (user?.signature_trophy ?? '') : (targetProfile?.signature_trophy ?? '');

  // Auto-awarded earned trophies (separate from the decorative case).
  // Query by user_id, NOT email: grant_eligible_trophies stores
  // user_trophies.user_id (from auth.uid(), always correct) alongside
  // user_email — but for guest / anonymous users the RPC records an EMPTY
  // user_email (auth.users.email is ''), while the profile carries the
  // canonical `guest_<uid>@flexyn.guest`. Reading by email then missed the
  // rows entirely, so guests' earned trophies showed as "none". user_id is
  // the stable identifier and matches for every account type.
  // Fallback: on ?profile= deep links targetProfile can briefly be just
  // { email } with no id (profile row not fetched / missing), which would
  // leave the query disabled and that user's trophies never rendering.
  // Query by email in that window — the id branch stays primary (a
  // guest's own profile always has user.id, so guests never hit the
  // email branch where their server-side user_email is '').
  const trophyUserId = isSelf ? user?.id : targetProfile?.id;
  const trophyKey = trophyUserId ?? email;
  const trophyByEmail = !trophyUserId;
  const { data: earnedTrophies = [] } = useQuery({
    queryKey: ['userTrophies', trophyKey, trophyByEmail],
    queryFn: () => listEarnedTrophies(trophyKey, trophyByEmail),
    enabled: !!trophyKey,
    staleTime: 5 * 60_000,
  });
  // ── Training week + streak for the hero ────────────────────────────────
  // Same query key and same fetcher as ProfileLiftStats, so this is a cache
  // hit rather than a second round-trip — the Stats tab and the banner share
  // one read of the log list.
  //
  // SELF ONLY. `workout_logs` carries a single owner policy — `created_by =
  // current_user_email() OR user_id = auth.uid()` — so filtering it by
  // somebody else's email returns [] rather than an error. There is no
  // server surface that exposes another athlete's training days, and adding
  // one is a privacy decision rather than a UI one (the same reasoning as
  // useHeroContests below).
  const { data: heroLogs = [] } = useQuery({
    queryKey: ['profileLifts', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        return await workouts.list(user.id, 500);
      } catch { return []; }
    },
    enabled: isSelf && !!user?.id,
    staleTime: 5 * 60_000,
  });
  // Both derived from the same logs on purpose — a server-side streak counter
  // and a client-side week strip will eventually disagree across a timezone
  // boundary, and then the user believes neither.
  const trainingStreak = useMemo(() => currentStreak(heroLogs), [heroLogs]);
  // The strongest estimated 1RM, for the Workouts row's subtitle. Same
  // index ProfileLiftStats ranks on, so the row and the page it opens
  // never name different lifts.
  const bestLift = useMemo(() => {
    const top = Object.entries(buildPRIndex(heroLogs))
      .filter(([, rm]) => rm > 0)
      .sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    const [key, rm] = top;
    const unit = weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lb';
    return {
      name: key.charAt(0).toUpperCase() + key.slice(1),
      label: `${fmtNumber(Math.round(fromLbs(rm, weightUnit)))} ${unit}`,
    };
  }, [heroLogs, weightUnit, fmtNumber]);

  // Live contests — self only; there's no server surface exposing another
  // user's rival pairing or their crew's war, and adding one is a privacy
  // decision, not a UI one.
  const { league: heroLeague, rival: heroRival, war: heroWar } = useHeroContests({ user, isSelf });

  // Easter eggs, keyed on the account id (see verifiedUsers.js).
  const isVerifiedUser = isVerified(targetId);
  const isPoopUser = isPoop(targetId);
  const noteLiked    = noteLocalLiked ?? !!noteLikedServer;
  const showSnakeEgg = hasSnakeEgg(targetId);
  const showBirdEgg = hasBirdEgg(targetId);
  const showSweatEgg = hasSweatEgg(targetId);

  // A long press on the avatar opens whichever egg this profile has. The
  // click that ends the press is swallowed, or the same gesture would also
  // open the story viewer underneath.
  const openEgg = showSnakeEgg ? () => setSnakeOpen(true)
    : showBirdEgg ? () => setBirdOpen(true)
      : showSweatEgg ? () => setSweatOpen(true)
        : null;
  const cancelEggPress = () => clearTimeout(eggTimerRef.current);
  const eggPressHandlers = openEgg && !avatarEditable ? {
    onPointerDown: () => {
      eggFiredRef.current = false;
      cancelEggPress();
      eggTimerRef.current = setTimeout(() => {
        eggFiredRef.current = true;
        triggerHaptic('primary');
        openEgg();
      }, 650);
    },
    onPointerUp: cancelEggPress,
    onPointerLeave: cancelEggPress,
    onPointerCancel: cancelEggPress,
    onClickCapture: (e) => {
      if (!eggFiredRef.current) return;
      eggFiredRef.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
    onContextMenu: (e) => e.preventDefault(),
  } : {};

  // Level and XP
  const ownerXp = isSelf ? Number(user?.total_xp) || 0 : Number(targetProfile?.total_xp) || 0;
  const levelData = calculateLevelFromXp(ownerXp);
  const { level, xpInLevel, xpNeeded } = levelData;
  // Your own streak is derived from your logs; nobody else's logs are
  // readable, so their plate uses the server's workout_streak, which
  // public_profiles returns only when their stats are visible to you.
  const scoreStreak = isSelf ? trainingStreak : (Number(targetProfile?.workout_streak) || 0);
  // The plate needs a level to print. public_profiles returns total_xp as
  // NULL on a private profile you don't follow, and printing "Lv. 1" there
  // would be a guess, so a hidden profile gets no plate at all.
  const showPlate = isSelf || (targetProfile != null && targetProfile.total_xp != null);
  // A private profile you don't follow. public_profiles hides the stats and
  // the follow graph is gated, so without this the page read as an empty
  // account: zero followers, "Nothing posted yet", no trophies. Say what it
  // is instead of implying there is nothing there.
  const isHiddenPrivate = !isSelf && targetProfile?.is_private === true && targetProfile.total_xp == null;
  const plateLeagueId = isSelf ? (heroLeague?.tierId ?? user?.league_tier ?? null) : (targetProfile?.league_tier ?? null);
  const levelProgress = Number.isFinite(xpNeeded) && xpNeeded > 0 ? xpInLevel / xpNeeded : 0;

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

  const SECTION_LABELS = {
    lifts: tFallback('profile.workouts', 'Workouts'),
    trophies: tFallback('hub.profile.tabTrophies', 'Trophies'),
    posts: tFallback('hub.profile.tabPosts', 'Posts'),
    liked: tFallback('hub.profile.likedPosts', 'Liked posts'),
  };

  const postsList = (
    <>
          {posts.length > 1 && (
            <div className="flex items-center justify-end mb-3">
              <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs font-bold">
                <button type="button"
                  aria-pressed={profilePostSort === 'newest'}
                  onClick={() => setProfilePostSort('newest')}
                  className={`px-3 py-1.5 transition-colors ${profilePostSort === 'newest' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground active:text-foreground'}`}>
                  {tFallback('profile.sortNewest', 'Newest')}
                </button>
                <button type="button"
                  aria-pressed={profilePostSort === 'popular'}
                  onClick={() => setProfilePostSort('popular')}
                  className={`px-3 py-1.5 border-s border-border transition-colors ${profilePostSort === 'popular' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground active:text-foreground'}`}>
                  {tFallback('profile.sortTop', 'Top')}
                </button>
              </div>
            </div>
          )}
          {sortedPosts.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={isSelf
                ? tFallback('hub.profile.noPostsSelfTitle', 'No posts yet')
                : tFallback('hub.profile.noPostsTitle', 'Nothing posted yet')}
              body={isSelf
                ? tFallback('hub.profile.noPostsSelfBody', 'Share a workout, PR, or progress photo to fill out your profile.')
                : tFallback('hub.profile.noPostsBody', 'Check back later. New posts will appear here.')}
            />
          ) : (
            <div className="space-y-3">
              {sortedPosts.map(p => (
                <div
                  key={p.id}
                  ref={(el) => { postRefs.current[p.id] = el; }}
                  // Amber-orange, not a literal yellow: the palette has exactly
                  // four state hues (primary / destructive / success / info) and
                  // adding a fifth is banned. `primary` is hue 26, which is the
                  // warm highlight Sean was reaching for and is already the
                  // app's "look here" colour.
                  className={`rounded-2xl transition-shadow duration-500 ${
                    landedPostId === p.id
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : ''
                  }`}
                >
                  <HubPostCard post={p} onAuthorClick={onSelectUser} />
                </div>
              ))}
            </div>
          )}
    </>
  );

  return (
    <ThemedScope themeId={ownerThemeId} lootThemeId={ownerLootThemeId}>
      {/* Bouncing poop screensaver — DVD-style, faded behind jackson's profile */}
      {isPoopUser && (
        <>
          <style>{`
            @keyframes poop-x { 0%,100% { left:4%; } 50% { left:calc(100% - 72px); } }
            @keyframes poop-y { 0%,100% { top:8%;  } 50% { top:calc(100% - 72px);  } }
          `}</style>
          <div style={{ position:'fixed', inset:0, overflow:'hidden', pointerEvents:'none', zIndex:1 }}>
            <span style={{
              position: 'absolute',
              fontSize: 56,
              opacity: 0.07,
              userSelect: 'none',
              animation: 'poop-x 7s linear infinite alternate, poop-y 11s linear infinite alternate',
            }}>💩</span>
          </div>
        </>
      )}

      {/* ── Identity ────────────────────────────────────────────────────
          Centred, no cover. The tier banner that used to sit above this
          (rust texture, floating dots, a 120px emoji crest and a week strip
          fighting for one 176px band) is gone: the level lives in the
          scoreboard below as a number with its context, which is what the
          banner was trying to say. Kegan's pick, option C "Athlete summary",
          2026-09-29. */}
      {showPlate && (
        <ProfileLeaguePlate
          leagueId={plateLeagueId}
          level={level}
          progress={levelProgress}
          streak={scoreStreak}
          onOpenLeague={isSelf && heroLeague ? () => setLeagueOpen(true) : undefined}
          t={t}
          tFallback={tFallback}
          fmtNumber={fmtNumber}
        />
      )}
      <div className={`flex flex-col items-center text-center ${showPlate ? '' : 'pt-6'}`}>
        {/* Long-press on the avatar opens the per-profile easter egg game.
            It used to be a 👾 button beside the name, which put an emoji on
            every visitor's view of three profiles. */}
        <div
          className="relative shrink-0 select-none"
          style={{ width: 96, height: 96, marginTop: showPlate ? -48 : (activeNote ? 48 : 0), WebkitTouchCallout: 'none' }}
          {...eggPressHandlers}
        >
            {/* Status note — floats above the avatar, sticker-style. */}
            {activeNote && (
              <div style={{
                position: 'absolute',
                bottom: 'calc(100% + 10px)',
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
                  padding: '6px 10px',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.22)',
                  textAlign: 'center',
                  position: 'relative',
                  maxWidth: 180,
                }}>
                  {/* `break-words` is the actual fix for the overflow, and it
                      is not the obvious one. The bubble was already capped at
                      180px, so a normal note wrapped and stayed inside it —
                      but a note that is ONE unbroken 60-character token ("e"
                      ×60) has no space to wrap at, so it ran straight past the
                      cap and off the banner. `overflow-wrap: anywhere` lets a
                      word break mid-token when there is nowhere else to break.

                      The clamp is the second half: two lines, then "…". Own
                      note taps through to the editor (which shows the whole
                      thing in a textarea); someone else's expands in place, the
                      same rule the stories-row bubble follows. */}
                  {isSelf ? (
                    <button type="button" onClick={() => setNoteEditorOpen(true)} className="block w-full">
                      <p className="text-xs leading-snug text-foreground break-words line-clamp-2">{activeNote.text}</p>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setNoteExpanded(v => !v)}
                      aria-expanded={noteExpanded}
                      aria-label={noteExpanded
                        ? tFallback('stories.collapseNote', 'Collapse note')
                        : tFallback('stories.expandNote', 'Read full note')}
                      className="block w-full"
                    >
                      <p className={`text-xs leading-snug text-foreground break-words ${noteExpanded ? '' : 'line-clamp-2'}`}>
                        {activeNote.text}
                      </p>
                    </button>
                  )}
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

            {/* Story ring sits OUTSIDE the punch-out ring so the two read
                as separate signals rather than one thick band. */}
            {profileStories.length > 0 && (
              <div
                aria-hidden="true"
                className="absolute rounded-full pointer-events-none"
                style={{ inset: -5, border: '2.5px solid hsl(var(--primary))' }}
              />
            )}

            <div
              className="rounded-full overflow-hidden"
              style={{
                width: 96,
                height: 96,
                border: '3px solid hsl(var(--background))',
                cursor: profileStories.length > 0 && !avatarEditable ? 'pointer' : undefined,
              }}
              onClick={profileStories.length > 0 && !avatarEditable ? () => setStoryViewerOpen(true) : undefined}
            >
              {/* While Edit Profile is open the photo IS the avatar control —
                  greyed, with a white plus. Outside edit mode it is inert and
                  the tap belongs to the story viewer, so the two gestures
                  never contend for the same pixel. */}
              <AvatarUploader
                src={avatarUrl}
                initials={initials}
                editable={avatarEditable}
                // The header reads avatar_url from AuthContext, which the
                // uploader's query invalidations never touch.
                onChange={() => checkUserAuth?.()}
                variant="overlay"
                neutral
                size={90}
                frameCss={equippedFrame?.css}
                frameAnimation={equippedFrame?.animation}
              />
            </div>

            {/* The crown is WORN, not pinned beside the head. It used to sit
                at top:-6 left:-8 rotated -25deg, which on an 88px avatar puts
                it entirely OUTSIDE the circle — the rim at that height starts
                around x=16, and the badge ended at x=14. So it read as a
                loose graphic floating to the left of the photo rather than as
                a mark on the person.

                Centred and overlapping instead, matching the small crown in
                ProfileMenu (top:-7, left:50%, translateX(-50%) rotate(-10deg))
                — that one was already right, which is why it reads correctly
                in the corner nav while this one did not. Same geometry, scaled:
                a 22px badge dropped 10px above the rim overlaps the top of the
                head by ~9px. */}
            {isVerifiedUser && (
              <div style={{
                position: 'absolute',
                top: -10,
                left: '50%',
                transform: 'translateX(-50%) rotate(-10deg)',
                lineHeight: 0,
                zIndex: 10,
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
              }}>
                <CrownBadge size={22} />
              </div>
            )}
            {isPoopUser && (
              <div style={{ position: 'absolute', top: -8, left: -10, lineHeight: 0, zIndex: 10 }}>
                <PoopBadge size={24} />
              </div>
            )}

            {/* Hidden while editing: the plus overlay owns the whole circle
                then, and a second camera pip on top of it would offer two
                different uploads through one control. */}
            {isSelf && !avatarEditable && (
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
                      toast.error(tFallback('hub.profile.storyLimit', 'Story limit reached, {n} max', { n: 10 }));
                    } else if (!result?.ok) {
                      toast.error(tFallback('hub.profile.storyUploadFailed', 'Could not upload story'));
                    } else {
                      queryClient.invalidateQueries({ queryKey: ['profileStories', targetId] });
                      toast.success(tFallback('hub.profile.storyPosted', 'Your story is up.'));
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => storyFileRef.current?.click()}
                  className="absolute w-7 h-7 rounded-full flex items-center justify-center"
                  style={{
                    bottom: 0,
                    insetInlineEnd: 0,
                    background: 'hsl(var(--primary))',
                    boxShadow: '0 0 0 2.5px hsl(var(--background))',
                  }}
                  aria-label={tFallback('hub.profile.addToStory', 'Add to story')}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                  </svg>
                </button>
              </>
            )}
        </div>

        {/* Name. Two lines only when there are two things to say: a chosen
            display name above "@handle · Title", otherwise the handle IS the
            name. The equipped title is plain text in its rarity colour; it
            was an emoji chip, and a chip is a control-shaped thing that did
            nothing. */}
        <h2 className="font-display text-2xl !leading-tight mt-3 max-w-full truncate">
          {displayName || displayHandle}
          {signatureTrophy && (
            <span className="ms-1.5 align-middle" title={tFallback("hubPostCard.signatureTrophy", "Signature trophy")} aria-label={tFallback("hubProfile.signatureTrophy", "Signature trophy")}>{signatureTrophy}</span>
          )}
        </h2>
        {(displayName || equippedTitle) && (
          <p className="text-sm text-muted-foreground mt-1 max-w-full truncate">
            {displayName && <span>{displayHandle}</span>}
            {displayName && equippedTitle && <span aria-hidden="true"> · </span>}
            {equippedTitle && (
              <span className="font-semibold" style={{ color: titleRarity?.color }} title={equippedTitle.description}>
                {equippedTitle.name}
              </span>
            )}
          </p>
        )}

        {/* Presence and relationship, as one quiet line of text. They were
            two pills with borders, fills and a pulsing dot. */}
        {(activeLabel || isMutualFollow) && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mt-1.5">
            {activeLabel && (
              <>
                <span
                  aria-hidden="true"
                  className={`w-2 h-2 rounded-full shrink-0 ${activeLabel.text === 'Active now' ? 'bg-success' : 'bg-muted-foreground opacity-40'}`}
                />
                <span className={activeLabel.text === 'Active now' ? 'text-success' : undefined}>{activeLabel.text}</span>
              </>
            )}
            {activeLabel && isMutualFollow && <span aria-hidden="true">·</span>}
            {isMutualFollow && (
              <span title={tFallback('hub.profile.mutualTooltip', 'You follow each other')}>
                {tFallback('hub.profile.mutual', 'Friends')}
              </span>
            )}
          </p>
        )}

        {/* Bio — 12px → 14px. It's the one piece of copy the owner wrote. */}
        {(isPoopUser || bio) && (
          <p className="text-sm text-foreground mt-2 leading-relaxed whitespace-pre-line max-w-sm">
            {isPoopUser ? 'I eat poop 💩' : bio}
          </p>
        )}

        {/* Link in bio — href still passes through safeExternalUrl so a
            saved javascript:/data: value can't execute for viewers. */}
        {websiteUrl && safeExternalUrl(websiteUrl) && (
          <a
            href={safeExternalUrl(websiteUrl)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-foreground hover:underline break-all"
          >
            <Link2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate max-w-[220px]">{websiteUrl.replace(/^https?:\/\//i, '')}</span>
            <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
          </a>
        )}

        {/* Location + anniversary — merged onto one line. Two facts about
            where and how long, not two stacked rows. */}
        {(city || countryFlag || (!isSelf && mutualSince)) && (
          <div className="flex items-center justify-center flex-wrap gap-x-2 gap-y-1 mt-2 text-sm text-muted-foreground">
            {(city || countryFlag) && (
              <span className="inline-flex items-center gap-1.5">
                {/* The pin marks a place. A flag alone is a country, and a
                    pin beside nothing read as a missing city. */}
                {city && <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                {city && <span>{city}</span>}
                {countryFlag && (
                  <img loading="lazy" src={flagSrc(countryFlag)}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    alt="flag"
                    className="w-4 h-4 object-contain shrink-0"
                  />
                )}
              </span>
            )}
            {!isSelf && mutualSince && (() => {
              const since = new Date(mutualSince);
              const now = new Date();
              const daysOld = Math.floor((now - since) / (1000 * 60 * 60 * 24));
              if (daysOld < 30) return null; // brand-new relationships read as noise
              const monthLocale = language === 'zh' ? 'zh-CN' : language === 'ja' ? 'ja-JP' : language;
              const monthYear = since.toLocaleString(monthLocale, { month: 'long', year: 'numeric' });
              const isAnniversaryWeek =
                since.getMonth() === now.getMonth() &&
                Math.abs(now.getDate() - since.getDate()) <= 7;
              return (
                <span className="inline-flex items-center gap-1">
                  {(city || countryFlag) && <span aria-hidden="true" className="opacity-40">·</span>}
                  {isAnniversaryWeek && <span aria-hidden="true">🎂</span>}
                  {tFallback('hub.profile.trainingSince', 'Training together since {month}', { month: monthYear })}
                </span>
              );
            })()}
          </div>
        )}

        {/* Metrics as text. Three bordered tiles and three 16ms count-up
            timers used to live here. */}
        {!isHiddenPrivate && <ProfileMetrics
          center
          // undefined while loading, so the line holds its space rather
          // than flashing zeros (or "Find people to follow") first.
          postCount={postsLoading ? undefined : posts.length}
          followerCount={followersLoading ? undefined : followerIds.length}
          followingCount={followingLoading ? undefined : followingIds.length}
          isSelf={isSelf}
          onFindPeople={() => navigate('/hub')}
          onOpenFollowers={() => setOpenModal('followers')}
          onOpenFollowing={() => setOpenModal('following')}
          language={language}
          forms={{
            posts: { one: tFallback('hub.profile.post', 'Post'), other: tFallback('hub.profile.posts', 'Posts') },
            followers: { one: tFallback('hub.profile.follower', 'Follower'), other: tFallback('hub.profile.followers', 'Followers') },
            following: { other: tFallback('hub.profile.following', 'Following') },
          }}
        />}

        {/* Note like — non-own profile with an active note. */}
        {!isSelf && activeNote && (
          <button
            type="button"
            onClick={handleNoteLike}
            className="inline-flex items-center gap-1.5 mt-2 text-sm text-muted-foreground"
            aria-label={noteLiked ? 'Unlike note' : 'Like note'}
          >
            <Heart
              className={`w-4 h-4 transition-colors ${noteLiked ? 'fill-destructive text-destructive' : 'text-muted-foreground hover:text-destructive active:text-destructive'}`}
            />
            {activeNote.like_count > 0 && (
              <span className="tabular-nums">{activeNote.like_count}</span>
            )}
          </button>
        )}

        <div className="w-full mt-4">
        <ProfileActions
          isSelf={isSelf}
          isFollowingNow={isFollowingNow}
          theyFollowMe={theyFollowMe === true}
          followStatusReady={followStatusReady}
          followBusy={followBusy}
          onFollow={handleFollow}
          onMessage={handleMessage}
          messageReady={!!user?.email && !!onStartConversation && !!messageTargetKey}
          messageInFlight={startConversationMutation.isPending}
          menuOpen={menuOpen}
          onOpenMenu={() => setMenuOpen(true)}
          onCloseMenu={() => setMenuOpen(false)}
          onAddNote={isSelf && !activeNote ? () => setNoteEditorOpen(true) : undefined}
          isPrivate={isPrivateNow}
          onTogglePrivate={isSelf ? handleTogglePrivate : undefined}
          onEditProfile={() => {
            setCityDraft(city);
            setBioDraft(bio);
            setWebsiteUrlDraft(websiteUrl);
            setDisplayNameDraft(displayName || '');
            setUsernameDraft(displayUsername || '');
            setEditProfileOpen(v => !v);
          }}
          onOpenThemes={() => setThemeOpen(true)}
          onOpenQr={() => setQrOpen(true)}
          onOpenDuel={() => setDuelOpen(true)}
          onOpenGift={() => setGiftOpen(true)}
          onMute={!isSelf && targetId ? handleMute : undefined}
          onUnmute={!isSelf && targetId ? handleUnmute : undefined}
          onBlock={!isSelf && targetId ? () => { setMenuOpen(false); setConfirmBlockOpen(true); } : undefined}
          isMuted={isMutedTarget}
          onToggleTrophyVisibility={handleTrophyVisibility}
          trophyVisible={trophyVisible}
          canDuelOrGift={!!targetProfile?.id}
          hasUsername={!!displayUsername}
          t={t}
          tFallback={tFallback}
        />
        </div>
      </div>

      {/* Edit profile panel */}
      <AnimatePresence>
        {isSelf && editProfileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
            className="mt-6"
          >
            <div className="bg-secondary/30 rounded-xl p-3 space-y-3">
              {/* Profile completion used to sit on the public page as a
                  progress bar. It is a to-do for the owner, so it lives
                  where the fields it counts are edited. */}
              <ProfileCompletionMeter user={user} targetProfile={targetProfile} />
              {/* The avatar control used to live HERE, as a 44px circle beside
                  the words "Tap to change avatar" — a second, smaller copy of
                  the photo already on screen 300px above, which read as a
                  different thing rather than as the same one. It now lives on
                  the real photo (see the header), so this row is gone and the
                  panel opens straight into the fields. */}
              {/* Display name — the name people see, above the handle.
                  Blank is a valid answer and means "just show my @handle",
                  which is what every account does today. */}
              <div className="flex items-center gap-2">
                <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={displayNameDraft}
                  onChange={e => setDisplayNameDraft(e.target.value.slice(0, 40))}
                  placeholder={tFallback('hub.profile.displayNamePlaceholder', 'Display name (optional)')}
                  aria-label={tFallback('hub.profile.displayName', 'Display name')}
                  className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
                />
              </div>

              {/* @handle — its own field with its own commit, because it does
                  NOT go through the profile save: it is unique, rate-limited,
                  and enforced server-side by set_username(). Underlined, as
                  Sean described, so it reads as somewhere you type. */}
              <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                <span className="text-sm text-muted-foreground shrink-0 w-3.5 text-center">@</span>
                <input
                  type="text"
                  value={usernameDraft}
                  onChange={e => setUsernameDraft(e.target.value.replace(/^@/, '').slice(0, 20))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleUsernameSubmit(); } }}
                  placeholder={tFallback('hub.profile.handlePlaceholder', 'your handle')}
                  aria-label={tFallback('hub.profile.handle', 'Username')}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50 border-b border-dashed border-border focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={handleUsernameSubmit}
                  disabled={usernameBusy || !usernameDraft.trim() || usernameDraft.trim().toLowerCase() === (displayUsername || '').toLowerCase()}
                  className="shrink-0 px-2.5 h-8 rounded-lg bg-secondary text-xs font-semibold disabled:opacity-40 hover:opacity-80 active:opacity-80 transition-opacity"
                >
                  {usernameBusy
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : tFallback('common.done', 'Done')}
                </button>
              </div>
              {/* Says the rule BEFORE it is spent, not after it is refused. */}
              <p className="text-micro text-muted-foreground -mt-1.5 ps-5">
                {tFallback('hub.profile.handleRule', 'Letters, numbers and underscores. You can change this once every 30 days.')}
              </p>

              {/* Bio */}
              <div className="flex items-start gap-2 pt-1 border-t border-border/40">
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1.5" />
                <div className="flex-1">
                  <textarea
                    value={bioDraft}
                    onChange={e => setBioDraft(e.target.value.slice(0, 160))}
                    placeholder={tFallback('hub.profile.bioPlaceholder', 'Write a short bio…')}
                    rows={3}
                    className="w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50 resize-none leading-relaxed"
                  />
                  <div className="text-xs text-muted-foreground/60 text-end">{bioDraft.length}/160</div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                {/* The pin is the control, per Sean's walkthrough: tap it and
                    it fills the field. It is a real button with a 44px hit
                    box (the HIG floor) even though the glyph is 14px. */}
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={locating}
                  aria-label={tFallback('hub.profile.useCurrentLocation', 'Use current location')}
                  title={tFallback('hub.profile.useCurrentLocation', 'Use current location')}
                  className="w-11 h-11 -ms-3.5 shrink-0 flex items-center justify-center text-muted-foreground hover:text-primary active:text-primary disabled:opacity-50 transition-colors"
                >
                  {locating
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <MapPin className="w-3.5 h-3.5" />}
                </button>
                <input
                  type="text"
                  value={cityDraft}
                  onChange={e => setCityDraft(e.target.value.slice(0, 40))}
                  placeholder={tFallback('hub.profile.cityPlaceholder', 'Your city (e.g. Miami, FL)')}
                  className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
                />
              </div>
              {/* Link in bio */}
              <div className="flex items-center gap-2 border-t border-border/40 pt-1">
                <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <input
                  type="url"
                  value={websiteUrlDraft}
                  onChange={e => setWebsiteUrlDraft(e.target.value.slice(0, 200))}
                  placeholder="yourwebsite.com"
                  className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              <div className="flex items-center gap-2">
                {countryFlag
                  ? <img loading="lazy" src={flagSrc(countryFlag)} alt="flag" className="w-5 h-5 object-contain shrink-0" />
                  : <span className="text-sm shrink-0">🌍</span>
                }
                <button
                  type="button"
                  onClick={() => setFlagPickerOpen(true)}
                  className="flex-1 text-start text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                >
                  {countryFlag ? 'Change flag' : 'Pick country flag →'}
                </button>
              </div>
              {/* Signature trophy — pin one trophy-case emoji next to
                  your name on the feed + profile. */}
              {trophyCase.some(tt => tt?.value) && (
                <div className="border-t border-border/40 pt-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">{tFallback("hubPostCard.signatureTrophy", "Signature trophy")}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {trophyCase.filter(tt => tt?.value).map((tt, i) => {
                      const active = signatureTrophy === tt.value;
                      return (
                        <button
                          key={`${tt.value}-${i}`}
                          type="button"
                          onClick={() => handleSetSignature(tt.value)}
                          aria-pressed={active}
                          className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-colors ${
                            active ? 'bg-primary/20 ring-2 ring-primary' : 'bg-secondary/60 hover:bg-secondary active:bg-secondary'
                          }`}
                        >
                          {tt.value}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground/60 mt-1">{tFallback('hub.profile.tapActiveToRemove', 'Tap the active one to remove it.')}</p>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditProfileOpen(false)}
                  className="flex-1 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
                >
                  {tFallback("coach.plan.cancel", "Cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={savingProfile}
                  className="flex-1 py-1.5 text-xs rounded-lg text-white font-semibold disabled:opacity-60"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  {savingProfile ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Story highlights rail (mig 099). Renders nothing until the owner
          has an album: an empty dashed "New" circle was a to-do on the
          public face of the page. Albums are still created from a story
          (Add to highlight), and once one exists the rail offers "New".
          Keyed by user id: in-app navigation carries no email for anyone
          else. */}
      <div className="mt-6">
        <StoryHighlightsRail
          userId={targetId}
          isOwn={isSelf}
          onOpenAlbum={async (h) => {
            // Lazy-import to keep the highlights surface out of the
            // hub-profile entry chunk for users who never open one.
            const { listItemsForHighlight } = await import('@/lib/data/storyHighlights');
            const items = await listItemsForHighlight(h.id);
            // Items come back joined with the underlying stories row;
            // unwrap the nested `stories` and filter out any orphans
            // (the parent story was deleted but the highlight item
            // still points at the dangling id).
            const stories = (items || [])
              .map(it => it.stories)
              .filter(Boolean);
            if (stories.length === 0) {
              toast.error(tFallback('highlight.empty', 'This album is empty.'));
              return;
            }
            setActiveHighlight(h);
            setActiveHighlightItems(stories);
          }}
        />
      </div>

      {/* ── Summary or one detail ────────────────────────────────────────
          The summary is a scoreboard, one grouped list and (on your own
          page) your recent workouts. Each list row opens its detail in
          place of the summary, with a back row above it, so there is one
          thing on screen at a time instead of a tab strip over four
          stacked sections. */}
      {section ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setSection(null)}
            className="self-start inline-flex items-center gap-1 h-11 -ms-2 px-2 rounded-lg text-sm font-semibold text-foreground hover:bg-secondary active:bg-secondary transition-colors"
          >
            <ChevronLeft className="w-4 h-4 rtl:scale-x-[-1]" aria-hidden="true" />
            {SECTION_LABELS[section]}
          </button>

          {section === 'lifts' && (
            <ProfileLiftStats
              userId={isSelf ? user?.id : null}
              longestStreak={isSelf ? user?.longest_workout_streak : targetUser?.longest_workout_streak}
              isOwn={isSelf}
              username={displayUsername}
            />
          )}

          {section === 'trophies' && (
            <ProfileTrophies
              isSelf={isSelf}
              trophyCase={trophyCase}
              trophyVisible={trophyVisible}
              earnedTrophies={earnedTrophies}
              onPickSlot={setTrophyPickerSlot}
              trophyLabels={TROPHY_LABELS}
              tFallback={tFallback}
            />
          )}

          {section === 'liked' && isSelf && (
            likedLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : likedPosts.length === 0 ? (
              <EmptyState
                icon={Bookmark}
                title={tFallback('hub.profile.noLikesTitle', 'Nothing here yet')}
                body={tFallback('hub.profile.noLikesBody', 'Head to the Hub and start liking posts, they’ll collect here.')}
              />
            ) : (
              <div className="space-y-3">
                {likedPosts.map(p => (
                  <HubPostCard key={p.id} post={p} onAuthorClick={onSelectUser} />
                ))}
              </div>
            )
          )}

          {section === 'posts' && postsList}
        </div>
      ) : isHiddenPrivate ? (
        <div className="flex flex-col items-center text-center gap-2 py-10" data-testid="profile-private-notice">
          <Lock className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-base font-semibold">{tFallback('publicProfile.thisProfileIsPrivate', 'This profile is private')}</p>
          {amFollowing !== true && (
            <p className="text-sm text-muted-foreground max-w-xs">
              {tFallback('profile.privateFollowHint', 'Follow to see their stats, posts and trophies.')}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <ProfileSummaryList>
            {heroLeague && (
              <SummaryRow
                icon={Medal}
                label={tFallback('profile.league', 'League')}
                sub={tFallback('profile.leagueSub', '{tier}, place {r} of {t} this week', {
                  tier: heroLeague.tierId
                    ? tFallback(`trophy.seasonTier.${heroLeague.tierId}`, heroLeague.tierLabel)
                    : tFallback('league.leagueSuffix', 'League'),
                  r: heroLeague.rank, t: heroLeague.total,
                })}
                onClick={() => setLeagueOpen(true)}
              />
            )}
            {heroRival && (
              <SummaryRow
                icon={Swords}
                label={tFallback('profile.rival', 'Rival')}
                sub={tFallback('profile.rivalSub', 'You {a}, your rival {b} this week', {
                  a: fmtNumber(Math.round(heroRival.mine)), b: fmtNumber(Math.round(heroRival.theirs)),
                })}
                // ?rival=1 scrolls to the card on Workout and opens it.
                onClick={() => navigate('/workout?rival=1')}
              />
            )}
            {heroWar && (
              <SummaryRow
                icon={Shield}
                label={tFallback('profile.crewWar', 'Crew war')}
                sub={tFallback('profile.crewWarSub', 'Your crew {a}, theirs {b}', {
                  a: fmtNumber(Math.round(heroWar.mine)), b: fmtNumber(Math.round(heroWar.theirs)),
                })}
                // Router state, not the flexyn:open-crew event. This row
                // lives on /profile, where Hub is not mounted, so an event
                // fired beside navigate() landed before anything listened and
                // the tap opened the Hub feed. Hub reads openCrewId on mount.
                onClick={() => navigate('/hub', heroWar?.crewId ? { state: { openCrewId: heroWar.crewId } } : undefined)}
              />
            )}
            {isSelf && heroLogs.length > 0 && (
              <SummaryRow
                icon={Dumbbell}
                label={tFallback('profile.workouts', 'Workouts')}
                sub={bestLift ? tFallback('profile.bestLiftSub', 'Best lift: {name} {rm}', { name: bestLift.name, rm: bestLift.label }) : undefined}
                value={fmtNumber(heroLogs.length)}
                onClick={() => setSection('lifts')}
              />
            )}
            {trophyVisible && (
              <SummaryRow
                icon={Trophy}
                label={tFallback('hub.profile.tabTrophies', 'Trophies')}
                value={earnedTrophies.length > 0 ? fmtNumber(earnedTrophies.length) : undefined}
                onClick={() => setSection('trophies')}
              />
            )}
            <SummaryRow
              icon={FileText}
              label={tFallback('hub.profile.tabPosts', 'Posts')}
              value={posts.length > 0 ? fmtNumber(posts.length) : undefined}
              onClick={() => setSection('posts')}
            />
            {isSelf && (
              <SummaryRow
                icon={Bookmark}
                label={tFallback('hub.profile.likedPosts', 'Liked posts')}
                onClick={() => setSection('liked')}
              />
            )}
            {isSelf && <ReferralCard asRow />}
          </ProfileSummaryList>

          {isSelf && <ProfileRecentWorkouts logs={heroLogs} tFallback={tFallback} />}
        </div>
      )}


      {/* Duel challenge modal — opened by the Swords button above.
          Pre-filled with the profile's id + username so the user lands
          straight on the configure step. */}
      {duelOpen && targetProfile?.id && (
        <Suspense fallback={null}>
          <CreateDuelModal
            opponentId={targetProfile.id}
            opponentUsername={ownerUsername}
            onClose={() => setDuelOpen(false)}
            onCreated={() => setDuelOpen(false)}
          />
        </Suspense>
      )}

      {giftOpen && (
        <Suspense fallback={null}>
          <GiftCoinsModal
            open={giftOpen}
            onClose={() => setGiftOpen(false)}
            recipient={{
              id:       targetProfile?.id ?? targetId,
              email,
              username: targetProfile?.username,
            }}
          />
        </Suspense>
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
          onStoriesChange={() => queryClient.invalidateQueries({ queryKey: ['profileStories', targetId] })}
          onAddStory={() => {}}
        />
      )}

      {/* Highlight album viewer — same StoryViewer component, but the
          story list comes from the chosen album rather than the
          user's current 24-hour story window. */}
      {activeHighlight && activeHighlightItems.length > 0 && (
        <StoryViewer
          open={true}
          groups={[{
            email,
            username: activeHighlight.title || displayUsername || 'athlete',
            avatarUrl,
            storyDmsDisabled: true,
            isOwn: isSelf,
            stories: activeHighlightItems,
            hasUnseen: false,
            note: null,
          }]}
          startIndex={0}
          viewedIds={new Set()}
          likedIds={new Set()}
          user={user}
          onClose={() => { setActiveHighlight(null); setActiveHighlightItems([]); }}
          onStoriesChange={() => {}}
          onAddStory={() => {}}
          onRemoveFromHighlight={isSelf ? async (storyId) => {
            const { removeStoryFromHighlight } = await import('@/lib/data/storyHighlights');
            const res = await removeStoryFromHighlight(activeHighlight.id, storyId);
            if (res?.ok) {
              // Trim locally so the open viewer reflects the removal; the
              // parent guard unmounts the viewer when the last item goes.
              setActiveHighlightItems((prev) => prev.filter((s) => s.id !== storyId));
            }
            return res;
          } : undefined}
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
                <h3 className="font-heading font-bold text-base">{tFallback("hubProfile.chooseTrophy", "Choose Trophy")}</h3>
                <div className="flex items-center gap-2">
                  {trophyCase[trophyPickerSlot] && (
                    <button
                      type="button"
                      onClick={() => handleTrophySlotSet(trophyPickerSlot, null)}
                      className="text-xs text-destructive hover:opacity-70 transition-opacity"
                    >
                      {tFallback("gymEquip.remove", "Remove")}
                    </button>
                  )}
                  <button type="button" onClick={() => setTrophyPickerSlot(null)} className="p-1 rounded text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {['🏆','🥇','🥈','🥉','🎯','💪','🔥','⚡','🌟','⭐','🎖️','🏅','🏋️','🤸','🏊','🚴','🧗','🥊','🥋','🎽','💯','👑','🦁','🐺','🦅','🦊','🐉','⚔️','🛡️','💎','🌈','🌊','🎆','🎇','🎉','🎊','🎁','🌙','☀️','🌸','🍀','❄️','🔮','🌀','🌪️','🏔️','🌋','🦾','🧠','💥','🎪','🎭','🎮','🕹️','🎲','♟️','🎸','🥁','🎤','🎬','📸','🚀','🛸','🌍','🌠','✨','🐅','🐻','🦈','🐍','🐎','🦌','🦬','🐂','🦏','🐊','🦂','🕷️','🐝','🦋','🪐','🌞','🌚','☄️','🌅','🗻','🏟️','⛰️','🗽','🏛️','⛩️','🛕','🧿','🪬','🔱','⚜️','♾️','🌹','🌻','🍁','🌴','🌵','🎺','🪗','🪙','💰','🎰','🃏','⛓️','🪓','🗡️','🏹','🔨','⚒️','⚙️','🔩'].map(emoji => (
                  <motion.button
                    key={emoji}
                    type="button"
                    whileTap={{ scale: 0.88 }}
                    onClick={() => handleTrophySlotSet(trophyPickerSlot, emoji)}
                    className="aspect-square flex items-center justify-center text-xl rounded-lg hover:bg-secondary active:bg-secondary transition-colors"
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
                <h3 className="font-heading font-bold text-base">{tFallback("hubProfile.countryFlag", "Country Flag")}</h3>
                <button type="button" onClick={() => setFlagPickerOpen(false)} className="p-1 rounded text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1">
                <div className="grid grid-cols-8 gap-1">
                  {[['AF','Afghanistan'],['AL','Albania'],['DZ','Algeria'],['AD','Andorra'],['AO','Angola'],['AG','Antigua'],['AR','Argentina'],['AM','Armenia'],['AU','Australia'],['AT','Austria'],['AZ','Azerbaijan'],['BS','Bahamas'],['BH','Bahrain'],['BD','Bangladesh'],['BB','Barbados'],['BY','Belarus'],['BE','Belgium'],['BZ','Belize'],['BJ','Benin'],['BT','Bhutan'],['BO','Bolivia'],['BA','Bosnia'],['BW','Botswana'],['BR','Brazil'],['BN','Brunei'],['BG','Bulgaria'],['BF','Burkina Faso'],['BI','Burundi'],['CV','Cape Verde'],['KH','Cambodia'],['CM','Cameroon'],['CA','Canada'],['CF','Cent. Africa'],['TD','Chad'],['CL','Chile'],['CN','China'],['CO','Colombia'],['KM','Comoros'],['CD','Congo DR'],['CG','Congo'],['CR','Costa Rica'],['CI','Côte dIvoire'],['HR','Croatia'],['CU','Cuba'],['CY','Cyprus'],['CZ','Czechia'],['DK','Denmark'],['DJ','Djibouti'],['DM','Dominica'],['DO','Dom. Republic'],['EC','Ecuador'],['EG','Egypt'],['SV','El Salvador'],['GQ','Eq. Guinea'],['ER','Eritrea'],['EE','Estonia'],['SZ','Eswatini'],['ET','Ethiopia'],['FJ','Fiji'],['FI','Finland'],['FR','France'],['GA','Gabon'],['GM','Gambia'],['GE','Georgia'],['DE','Germany'],['GH','Ghana'],['GR','Greece'],['GD','Grenada'],['GT','Guatemala'],['GN','Guinea'],['GW','Guinea-Bissau'],['GY','Guyana'],['HT','Haiti'],['HN','Honduras'],['HU','Hungary'],['IS','Iceland'],['IN','India'],['ID','Indonesia'],['IR','Iran'],['IQ','Iraq'],['IE','Ireland'],['IL','Israel'],['IT','Italy'],['JM','Jamaica'],['JP','Japan'],['JO','Jordan'],['KZ','Kazakhstan'],['KE','Kenya'],['KI','Kiribati'],['KW','Kuwait'],['KG','Kyrgyzstan'],['LA','Laos'],['LV','Latvia'],['LB','Lebanon'],['LS','Lesotho'],['LR','Liberia'],['LY','Libya'],['LI','Liechtenstein'],['LT','Lithuania'],['LU','Luxembourg'],['MG','Madagascar'],['MW','Malawi'],['MY','Malaysia'],['MV','Maldives'],['ML','Mali'],['MT','Malta'],['MH','Marshall Is.'],['MR','Mauritania'],['MU','Mauritius'],['MX','Mexico'],['MD','Moldova'],['MC','Monaco'],['MN','Mongolia'],['ME','Montenegro'],['MA','Morocco'],['MZ','Mozambique'],['MM','Myanmar'],['NA','Namibia'],['NR','Nauru'],['NP','Nepal'],['NL','Netherlands'],['NZ','New Zealand'],['NI','Nicaragua'],['NE','Niger'],['NG','Nigeria'],['NO','Norway'],['OM','Oman'],['PK','Pakistan'],['PW','Palau'],['PA','Panama'],['PG','Papua NG'],['PY','Paraguay'],['PE','Peru'],['PH','Philippines'],['PL','Poland'],['PT','Portugal'],['QA','Qatar'],['RO','Romania'],['RU','Russia'],['RW','Rwanda'],['KN','St Kitts'],['LC','St Lucia'],['VC','St Vincent'],['WS','Samoa'],['SM','San Marino'],['ST','São Tomé'],['SA','Saudi Arabia'],['SN','Senegal'],['RS','Serbia'],['SC','Seychelles'],['SL','Sierra Leone'],['SG','Singapore'],['SK','Slovakia'],['SI','Slovenia'],['SB','Solomon Is.'],['SO','Somalia'],['ZA','South Africa'],['SS','South Sudan'],['ES','Spain'],['LK','Sri Lanka'],['SD','Sudan'],['SR','Suriname'],['SE','Sweden'],['CH','Switzerland'],['SY','Syria'],['TW','Taiwan'],['TJ','Tajikistan'],['TZ','Tanzania'],['TH','Thailand'],['TL','Timor-Leste'],['TG','Togo'],['TO','Tonga'],['TT','Trinidad'],['TN','Tunisia'],['TR','Turkey'],['TM','Turkmenistan'],['TV','Tuvalu'],['UG','Uganda'],['UA','Ukraine'],['AE','UAE'],['GB','UK'],['US','USA'],['UY','Uruguay'],['UZ','Uzbekistan'],['VU','Vanuatu'],['VE','Venezuela'],['VN','Vietnam'],['YE','Yemen'],['ZM','Zambia'],['ZW','Zimbabwe']].map(([code, name]) => {
                    const emoji = [...code.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0) + 127397)).join('');
                    const imgSrc = flagSrc(emoji);
                    return (
                      <motion.button
                        key={code}
                        type="button"
                        whileTap={{ scale: 0.88 }}
                        onClick={async () => {
                          setFlagPickerOpen(false);
                          try {
                            await me.update({ country_flag: emoji });
                            // Same reason as the trophy / bio handlers above:
                            // on your OWN profile `countryFlag` reads from
                            // useAuth().user, not the hubProfileLookup cache
                            // (which is null for self). Invalidating that
                            // query alone left the flag persisted server-side
                            // and invisible until a full reload.
                            await checkUserAuth?.();
                            queryClient.invalidateQueries({ queryKey: ['hubProfileLookup', email] });
                          } catch {
                            toast.error(tFallback("hubProfile.couldNotSaveFlag", "Could not save flag"));
                          }
                        }}
                        className="aspect-square flex flex-col items-center justify-center gap-0.5 rounded hover:bg-secondary active:bg-secondary transition-colors p-1"
                        title={name}
                      >
                        <img loading="lazy" src={imgSrc} alt={name} className="w-6 h-6 object-contain" />
                        <span className="text-xs text-muted-foreground leading-none">{code}</span>
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
            ids={openModal === 'followers' ? followerIds : followingIds}
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

      {/* League standings, opened by the League row. Lazy so the standings
          stay out of the profile chunk for users who never tap it. */}
      {leagueOpen && (
        <Suspense fallback={null}>
          <LeagueStandingsModal open={leagueOpen} onClose={() => setLeagueOpen(false)} />
        </Suspense>
      )}

      {/* Profile QR code modal */}
      <AnimatePresence>
        {qrOpen && displayUsername && (
          <QRModal
            url={`${shareOrigin() || 'https://flexyn.netlify.app'}/@${displayUsername}`}
            username={displayUsername}
            onClose={() => setQrOpen(false)}
          />
        )}
      </AnimatePresence>


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
                {t('hub.profile.unfollowConfirmDesc', { handle: ownerUsername ? `@${ownerUsername}` : t('hub.profile.anonymousAthlete') })}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setUnfollowConfirmOpen(false)}
                  className="flex-1 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary active:bg-secondary transition-colors"
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

      <ConfirmDialog
        open={confirmBlockOpen}
        onOpenChange={setConfirmBlockOpen}
        title={tFallback('hub.profile.confirmBlockTitle', 'Block {handle}?', { handle: displayHandle })}
        description={tFallback(
          'hub.profile.confirmBlockDesc',
          "They won't see your profile, posts, or stories, and you won't see theirs. You can unblock from Settings.",
        )}
        confirmLabel={tFallback('hub.profile.confirmBlockAction', 'Yes, block')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleConfirmBlock}
        destructive
      />

      {/* Spending the 30-day allowance. Not destructive-styled: changing your
          own handle is a normal thing to do, it is just rate-limited, and
          painting it red would read as a warning about harm rather than about
          a budget. */}
      <ConfirmDialog
        open={!!pendingHandle}
        onOpenChange={(o) => { if (!o && !usernameBusy) setPendingHandle(null); }}
        title={tFallback('hub.profile.confirmHandleTitle', 'Change your handle to @{handle}?', { handle: pendingHandle || '' })}
        description={tFallback(
          'hub.profile.confirmHandleDesc',
          'You can only change your name once every 30 days. Are you sure you want to do this?',
        )}
        confirmLabel={tFallback('hub.profile.confirmHandleAction', 'Yes, change it')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => commitUsername(pendingHandle)}
      />

      {/* 👾 Iron Snake — easter egg, only mounted on the @sean profile.
          The modal manages its own enter/exit + portal internally. */}
      {showSnakeEgg && (
        <Suspense fallback={null}>
          <SnakeGameModal
            open={snakeOpen}
            onClose={() => setSnakeOpen(false)}
            userId={user?.id}
          />
        </Suspense>
      )}

      {/* 👾 Heavy Bird — easter egg, only on its account (see verifiedUsers.js).
          Mounted on open (the canvas engine runs only while shown). */}
      {showBirdEgg && birdOpen && (
        <Suspense fallback={null}>
          <HeavyBirdModal
            onClose={() => setBirdOpen(false)}
            userId={user?.id}
            onUnlockCosmetic={() => toast.success(tFallback("hubProfile.315LbClubUnlocked", "🏆 315 lb Club unlocked!"))}
          />
        </Suspense>
      )}

      {/* 👾 Sweat Jetpack — easter egg, only on its accounts (see verifiedUsers.js).
          Mounted on open so the canvas engine isn't burning cycles on
          every other profile's render path. */}
      {showSweatEgg && sweatOpen && (
        <Suspense fallback={null}>
          <SweatJetpackModal
            onClose={() => setSweatOpen(false)}
            userId={user?.id}
          />
        </Suspense>
      )}
    </ThemedScope>
  );
}

function FollowingModal({ type, ids, onClose, onSelectUser }) {
  const { t } = useLanguage();

  // Lock body scroll when modal is open
  useBodyScrollLock();

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ['hubProfileUsers', ids],
    queryFn: async () => {
      if (!ids.length) return [];
      // Resolve the follower/following rows by user_id — never off the
      // view's email column (which no longer exists). Only these ids: this
      // used to fetch every profile in the app and filter here.
      const users = await usersData.listByIds(ids).catch(() => []);
      return users.map(u => ({
        ...u,
        // total_xp is NULL on a private profile you don't follow. That is
        // "hidden", not "level 1", so no level is printed for it.
        level: u.total_xp == null ? null : calculateLevelFromXp(Number(u.total_xp) || 0).level,
      }));
    },
    enabled: !!ids.length,
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
          <button onClick={onClose} aria-label={t('common.close')} className="w-11 h-11 -me-2 flex items-center justify-center rounded-lg hover:bg-secondary active:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : allUsers.length === 0 ? (
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
                      username: u.username || null,
                    });
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-secondary/60 active:bg-secondary/60 transition-colors text-start"
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
                        {(u.username || 'athlete').slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-bold text-sm truncate">
                      @{u.username || t('hub.profile.anonymousAthlete')}
                    </p>
                  </div>
                  {/* Level only. The XP tier name was printed twice here, in
                      caps on a gradient pill, and it is a different ladder
                      from the leagues it shares names with. */}
                  {u.level != null && (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                      {t('levelBar.level', { n: u.level })}
                    </span>
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