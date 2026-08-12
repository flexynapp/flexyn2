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
import { User as UserIcon, FileText, X, Loader2, MapPin, Heart, Link2, Copy, ExternalLink, TrendingUp, Bookmark } from 'lucide-react';
import ThemeSelector from '@/components/ThemeSelector';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { getTier } from '@/lib/xpTier';
import { buildTrainingWeek, currentStreak } from '@/lib/trainingWeek';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import * as hubFollows from '@/lib/data/hubFollows';
import * as userMutes from '@/lib/data/userMutes';
import { blockUserFull } from '@/lib/data/userBlocks';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import * as hubPosts from '@/lib/data/hubPosts';
import * as hubReactions from '@/lib/data/hubReactions';
import * as me from '@/lib/data/me';
import { selectProfiles } from '@/lib/data/users';
import * as statusNotesData from '@/lib/data/statusNotes';
import { hasAnyProfanity } from '@/lib/useProfanityGuard';
import { reverseGeocode } from '@/lib/geocode';
import { patchProfile } from '@/api/profileCache';
import HubPostCard from './HubPostCard';
import ReferralCard from './ReferralCard';
import ProfileBadgeShowcase from './ProfileBadgeShowcase';
import ProfileLiftStats from './ProfileLiftStats';
import ProfileCompletionMeter from './ProfileCompletionMeter';
import EmptyState from '@/components/EmptyState';
import StoryHighlightsRail from './StoryHighlightsRail';
import ThemedScope from '@/components/ThemedScope';
import AvatarUploader from '@/components/AvatarUploader';
import ProfileTierBanner from './profile/ProfileTierBanner';
import ProfileMetrics from './profile/ProfileMetrics';
import ProfileActions from './profile/ProfileActions';
import ProfileTabs, { ProfileTabPanel } from './profile/ProfileTabs';
import ProfileTrophies from './profile/ProfileTrophies';
import ProfileContestRail from './profile/ProfileContestRail';
import { useHeroContests } from './profile/useHeroContests';
import { getLootTitleById } from '@/lib/lootTitles';
import { getLootFrameById } from '@/lib/lootFrames';
import { RARITY } from '@/lib/lootCatalog';
import { useTheme } from '@/lib/ThemeContext';
import { isVerified, isPoop } from '@/lib/verifiedUsers';
import StoryViewer from '@/components/stories/StoryViewer';
import StatusNoteEditor from '@/components/stories/StatusNoteEditor';
import * as storiesData from '@/lib/data/stories';
import { listEarned as listEarnedTrophies } from '@/lib/data/trophies';
import { safeExternalUrl } from '@/lib/safeUrl';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const GiftCoinsModal = lazy(() => import('./GiftCoinsModal'));
const CreateDuelModal = lazy(() => import('@/components/duels/CreateDuelModal'));
// Hidden easter-egg Snake game — only mounted on the @sean admin profile
// (gated by showSnakeEgg below). Lazy so its canvas/game code stays out
// of the entry + Hub bundles for everyone else.
const SnakeGameModal = lazy(() => import('./SnakeGameModal'));
// Hidden easter-egg "Heavy Bird" — only on the @keganbergeron profile.
const HeavyBirdModal = lazy(() => import('./HeavyBirdModal'));
// Hidden easter-egg "Sweat Jetpack" — only on the @calason44 profile.
// Fat sweating dude propelled by his own sweat. Pixelated retro look.
const SweatJetpackModal = lazy(() => import('./SweatJetpackModal'));
const LeaderboardsModal = lazy(() => import('@/components/LeaderboardsModal'));

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

// Poop badge — shown on certain special users
function PoopBadge({ size = 22 }) {
  return (
    <span style={{ fontSize: size, lineHeight: 1, display: 'block' }} aria-label="💩" title="💩">💩</span>
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

// ── QR Code generator ─────────────────────────────────────────────────────────
// Uses the public qrserver.com API — no package needed, no CORS issues.
// Returns a URL to a PNG image of the QR code.
function generateQrUrl(text) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(text)}&margin=10`;
}

// ── QR Code modal ─────────────────────────────────────────────────────────────
function QRModal({ url, username, onClose }) {
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
            alt="Profile QR code"
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
            Share
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

export default function HubProfile({ targetUser = null, onSelectUser = null, onStartConversation = null, highlightPostId = null, onHighlightConsumed = null }) {
  const { t, tFallback, language } = useLanguage();
  const { user, checkUserAuth } = useAuth();
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
  const [noteLocalLiked, setNoteLocalLiked] = useState(false);
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
  // Profile body tab. Resets to 'stats' when the viewed profile changes,
  // otherwise navigating person → person would strand you on someone else's
  // Posts tab with no visual explanation of why.
  const [activeTab, setActiveTab] = useState('stats');
  // Leaderboards open in place from the league pill rather than routing —
  // LeaderboardsModal is self-contained and the user is mid-profile.
  const [leaguesOpen, setLeaguesOpen] = useState(false);
  const storyFileRef = useRef(null);
  const navigate = useNavigate();

  // Always start a profile view at the top, regardless of where the user
  // scrolled before navigating in. Using 'auto' (not 'smooth') because the
  // new profile data is already mounting underneath — a smooth scroll would
  // race with the layout shift of new content.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    setActiveTab('stats');
    setMenuOpen(false);
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
      // the public_profiles view; the target's email (for the still
      // email-keyed follow/DM/post queries) is resolved separately via
      // the resolve_profile_email RPC below.
      const { data } = await safeSelect({
        columns: [
          'id', 'username', 'display_name', 'avatar_url', 'total_xp',
          'preferred_theme', 'loot_theme_id',
          'equipped_title_id', 'equipped_frame_id',
          'city', 'country_flag', 'bio',
          'trophy_case', 'trophy_case_visible',
          'website_url', 'signature_trophy',
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
    // username, and with the 60s default staleTime a seeded-but-sparse
    // initialData would suppress the refetch and strand the header on the
    // "Athlete" placeholder — so leave it unset and let the query fetch.
    initialData: isSelf ? null : (targetUser?.username ? targetUser : undefined),
  });

  // For an id-only target we still need the target's email for the parts of
  // this component that remain email-keyed (isFollowing / getMutualFollowSince
  // read hub_follows.*_email; listForProfile reads hub_posts.author_email;
  // stories/notes read *_email). We can no longer read it off the
  // public_profiles view (email was dropped), so resolve it server-side via
  // the narrow resolve_profile_email RPC (SECURITY DEFINER, reads
  // user_profiles directly). This is a single-row lookup by id, never a bulk
  // read, and the email is used only as a query key — never displayed.
  const { data: resolvedTargetEmail } = useQuery({
    queryKey: ['resolveProfileEmail', targetId],
    queryFn: async () => {
      const { data } = await supabase.rpc('resolve_profile_email', { p_id: targetId });
      return data || null;
    },
    enabled: !isSelf && !!targetId && !targetEmailProp,
    staleTime: 5 * 60_000,
  });

  // Resolved target email for the rest of this component. Prefer the nav
  // prop (email-link targets carry it); otherwise the RPC-resolved value.
  // Declared post-query so the lookups above stay id-first.
  const email = isSelf ? user?.email : (targetEmailProp || resolvedTargetEmail || null);

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

  // Follower / following lists as user_ids (the modal resolves them by id
  // via User.list().id — never off the view's email). Legacy email-targets
  // (no targetId) show empty lists rather than reading the view.
  const { data: followerIds = [] } = useQuery({
    queryKey: ['hubFollowers', targetId],
    queryFn: () => hubFollows.listFollowersIds(targetId),
    enabled: !!targetId,
  });
  const { data: followingIds = [] } = useQuery({
    queryKey: ['hubFollowing', targetId],
    queryFn: () => hubFollows.listFollowingIds(targetId),
    enabled: !!targetId,
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
  const [likesOpen, setLikesOpen] = useState(false);
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

  // Leaving your own profile closes the mode. Without this, tapping through
  // to someone else and coming back would land you in a view of your likes
  // with no memory of having opened it.
  useEffect(() => { if (!isSelf) setLikesOpen(false); }, [isSelf]);

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
    if (activeTab !== 'posts') { setActiveTab('posts'); return; }

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
  }, [highlightPostId, sortedPosts, activeTab, onHighlightConsumed]);

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
      queryClient.invalidateQueries({ queryKey: ['hubFollowers', targetId] });
      queryClient.invalidateQueries({ queryKey: ['hubFollowing', user?.email] });
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
      queryClient.invalidateQueries({ queryKey: ['hubFollowers', targetId] });
      queryClient.invalidateQueries({ queryKey: ['hubFollowing', user?.email] });
    },
  });

  // The target key handed to the conversation starter. `targetId` is
  // available synchronously from the nav target; `email` is not — it comes
  // from an async resolve_profile_email query, because email left the
  // public_profiles view in mig 220. Preferring the id is what stops the
  // Message button from depending on that round-trip at all.
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
      toast.error('Could not update trophy case');
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
      toast.error('Could not update visibility');
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
      toast.error('Could not update signature');
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
        toast.info(tFallback('hub.profile.locationNoName', "Couldn't name that spot — type it in instead."));
      }
    } catch (err) {
      // PERMISSION_DENIED is a choice, not a fault, so it does not report to
      // Sentry and does not read as an error state.
      if (err?.code === 1) {
        toast.info(tFallback('hub.profile.locationDenied', 'Location is off for Flexyn — type your city instead.'));
      } else {
        reportError(err, { feature: 'profile.use-current-location', level: 'warning' });
        toast.error(tFallback('hub.profile.locationFailed', "Couldn't get your location — type it in instead."));
      }
    } finally {
      setLocating(false);
    }
  };

  // ── Profile edit save ────────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (hasAnyProfanity(bioDraft, cityDraft)) {
      toast.error('Please remove inappropriate language before saving.');
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
      toast.success('Saved. Looking sharp.');
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
  const isMutedTarget = !!email && myMutes.some(
    m => (m.muted_email || '').toLowerCase() === email.toLowerCase()
  );

  const handleMute = async () => {
    setMenuOpen(false);
    try {
      await userMutes.muteUser(user, email);
      toast.success(tFallback('hub.profile.mutedToast', 'Muted {handle}.', { handle: displayHandle }));
      queryClient.invalidateQueries({ queryKey: ['userMutes', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
    } catch (err) {
      reportError(err, { feature: 'hub.profile-mute', level: 'warning', userEmail: user?.email, target: email });
      toast.error(tFallback('hub.profile.muteError', 'Could not mute — try again.'));
    }
  };

  const handleUnmute = async () => {
    setMenuOpen(false);
    try {
      await userMutes.unmuteUser(user.id, email);
      toast.success(tFallback('hub.profile.unmutedToast', 'Unmuted {handle}.', { handle: displayHandle }));
      queryClient.invalidateQueries({ queryKey: ['userMutes', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
    } catch (err) {
      reportError(err, { feature: 'hub.profile-unmute', level: 'warning', userEmail: user?.email, target: email });
      toast.error(tFallback('hub.profile.unmuteError', 'Could not unmute — try again.'));
    }
  };

  const handleConfirmBlock = async () => {
    setConfirmBlockOpen(false);
    try {
      await blockUserFull(email);
      toast.success(tFallback('hub.profile.blockedToast', 'Blocked {handle}.', { handle: displayHandle }));
      // block_user_full severs mutual follows too, so the follow-graph caches
      // have to go with it — same set HubPostCard invalidates.
      queryClient.invalidateQueries({ queryKey: ['userBlocks', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
      queryClient.invalidateQueries({ queryKey: ['hubFollowing', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['hubFollowers', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['myFollowsForDMs', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['hubIsFollowing', user?.email, email] });
    } catch (err) {
      reportError(err, { feature: 'hub.profile-block', level: 'warning', userEmail: user?.email, target: email });
      toast.error(tFallback('hub.profile.blockError', 'Could not block — try again.'));
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
  const { data: heroLogs = [] } = useQuery({
    queryKey: ['profileLifts', email],
    queryFn: async () => {
      if (!email) return [];
      try {
        return await db.entities.WorkoutLog.filter({ created_by: email }, '-date', 500);
      } catch { return []; }
    },
    enabled: !!email,
    staleTime: 5 * 60_000,
  });
  // Both derived from the same logs on purpose — a server-side streak counter
  // and a client-side week strip will eventually disagree across a timezone
  // boundary, and then the user believes neither.
  const trainingWeek = useMemo(() => buildTrainingWeek(heroLogs, new Date(), language), [heroLogs, language]);
  const trainingStreak = useMemo(() => currentStreak(heroLogs), [heroLogs]);

  // Live contests — self only; there's no server surface exposing another
  // user's rival pairing or their crew's war, and adding one is a privacy
  // decision, not a UI one.
  const { league: heroLeague, rival: heroRival, war: heroWar } = useHeroContests({ user, isSelf });

  const isVerifiedUser = isVerified(displayUsername);
  const isPoopUser = isPoop(displayUsername);
  const noteLiked    = noteLocalLiked || noteLikedServer;

  // Hidden easter egg — only on the @sean admin profile. isVerified() is
  // the app's admin signal (maps to the spec's is_admin), so this is the
  // strict "@sean + admin" gate. Visible to any viewer of that profile.
  const showSnakeEgg =
    (ownerUsername === 'sean' || displayHandle === '@sean') && isVerified(ownerUsername);

  // Second hidden egg — "Heavy Bird", only on the @keganbergeron profile.
  const showBirdEgg =
    ownerUsername === 'keganbergeron' || ownerUsername === 'kegan' || displayHandle === '@keganbergeron';

  // Third hidden egg — "Sweat Jetpack", on @calason44 and @jaxf profiles.
  // Fat sweating dude with sweat as the thrust, pixelated retro style.
  const showSweatEgg =
    ownerUsername === 'calason44' || displayHandle === '@calason44'
    || ownerUsername === 'jaxf'   || displayHandle === '@jaxf';

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

      {/* ── Tier banner ─────────────────────────────────────────────────
          The XP tier used to be an 84px card at 10% opacity, three items
          down the page. xpTier.js hand-tunes ten gradients; this is what
          they look like when you let them run. */}
      <ProfileTierBanner
        tier={tier}
        level={level}
        levelLabel={t('levelBar.level').replace('{n}', level)}
        // The bare word, taken from the same translated template rather than
        // stripping digits out of the formatted string — locales that write
        // the number first would lose the wrong part otherwise. Trim only:
        // several locales abbreviate WITH a period ("Ур. {n}", "Poz. {n}")
        // and that period is part of the word, not trailing punctuation.
        levelWord={t('levelBar.level').replace('{n}', '').trim()}
        xpInLevel={xpInLevel}
        xpNeeded={xpNeeded}
        progressPercent={progressPercent}
        isAdminProfile={isAdminProfile}
        week={trainingWeek}
        streak={trainingStreak}
        tFallback={tFallback}
        // Slot 1 IS the primary — the trophy case is already an ordered
        // array, so "most prized" needs no new column, just the convention
        // that position one means something. ProfileTrophies marks it.
        primaryTrophy={trophyVisible ? (trophyCase[0]?.value ?? null) : null}
        contests={(heroLeague || heroRival || heroWar) ? (
          <ProfileContestRail
            league={heroLeague}
            rival={heroRival}
            war={heroWar}
            language={language}
            tFallback={tFallback}
            onOpenLeague={() => setLeaguesOpen(true)}
            // The rival card lives on Workout; the crew war lives in the Hub
            // crews section, which listens for this event (the same hand-off
            // CrewDMInviteCard uses). ?rival=1 scrolls to the card and opens
            // it — plain /workout left the user to go find the thing they
            // just tapped.
            onOpenRival={() => navigate('/workout?rival=1')}
            onOpenWar={() => {
              navigate('/hub');
              if (heroWar?.crewId) {
                window.dispatchEvent(new CustomEvent('flexyn:open-crew', { detail: { crewId: heroWar.crewId } }));
              }
            }}
          />
        ) : null}
      />

      {/* ── Identity ────────────────────────────────────────────────────
          One block. No card, no border, no fill — separation is whitespace
          and type weight, which is what every reference implementation
          does and what ten stacked bordered cards can't. */}
      <div className="mb-5">
        <div className="flex items-end justify-between gap-3" style={{ marginTop: -44 }}>

          {/* Avatar overlapping the banner seam. The ring is the PAGE
              BACKGROUND colour rather than a border colour — that's the
              detail that makes it read as punched out of the banner
              instead of placed on top of it. */}
          {/* z-10 so the avatar always wins the paint order against the
              banner's own positioned children. The XP rail is inset to clear
              it, but the banner is `position: relative` and anything absolute
              added inside it later would otherwise draw over this face. */}
          <div className="relative shrink-0 z-10" style={{ width: 88, height: 88 }}>

            {/* Status note — floats over the banner, sticker-style. */}
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
                  {isSelf ? (
                    <button type="button" onClick={() => setNoteEditorOpen(true)} className="block w-full">
                      <p className="text-xs leading-snug text-foreground">{activeNote.text}</p>
                    </button>
                  ) : (
                    <p className="text-xs leading-snug text-foreground">{activeNote.text}</p>
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
                width: 88,
                height: 88,
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
                variant="overlay"
                size={82}
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
                      toast.error('Story limit reached (10 max)');
                    } else if (!result?.ok) {
                      toast.error('Could not upload story');
                    } else {
                      queryClient.invalidateQueries({ queryKey: ['profileStories', email] });
                      toast.success("Story's up.");
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
                  aria-label="Add to story"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Actions — on the avatar's baseline, ~700px earlier than they
              used to be. Exactly one primary; the rest behind "…". */}
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
            onToggleLikes={() => setLikesOpen(v => !v)}
            likesOpen={likesOpen}
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
            onMute={!isSelf && email ? handleMute : undefined}
            onUnmute={!isSelf && email ? handleUnmute : undefined}
            onBlock={!isSelf && email ? () => { setMenuOpen(false); setConfirmBlockOpen(true); } : undefined}
            isMuted={isMutedTarget}
            onToggleTrophyVisibility={handleTrophyVisibility}
            trophyVisible={trophyVisible}
            canDuelOrGift={!!targetProfile?.id}
            hasUsername={!!displayUsername}
            t={t}
            tFallback={tFallback}
          />
        </div>

        {/* Two lines ONLY when there are two things to say.
            //
            // This used to render the username twice — "Test2" capitalised
            // above "@test2" muted underneath — one identity taking two rows
            // to say the same word, so the second line was removed. A chosen
            // display name is the second piece of information that was
            // missing, so the two-line shape becomes correct again — but only
            // for someone who set one. Everyone else keeps the single line,
            // which is the same screen they have now. */}
        <div className="mt-3">
          {displayName && (
            <h2 className="font-heading font-bold text-xl leading-tight min-w-0 truncate">
              {displayName}
              {signatureTrophy && (
                <span className="ms-1.5 align-middle" title="Signature trophy" aria-label="Signature trophy">{signatureTrophy}</span>
              )}
            </h2>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {/* A <p> rather than a second <h2> when the display name already
                took that role — two h2s for one identity is a heading order
                a screen reader reads as two separate sections. */}
            {displayName ? (
              <p className="text-sm text-muted-foreground leading-tight min-w-0 truncate">
                {displayHandle}
              </p>
            ) : (
              <h2 className="font-heading font-bold text-xl leading-tight min-w-0 truncate">
                {displayHandle}
                {/* The trophy rides whichever line is the NAME, so it never
                    renders twice when both lines exist. */}
                {signatureTrophy && (
                  <span className="ms-1.5 align-middle" title="Signature trophy" aria-label="Signature trophy">{signatureTrophy}</span>
                )}
              </h2>
            )}

            {/* 👾 Hidden easter-egg triggers — same per-user gates as before,
                now inline with the name instead of floating in the old
                button row. Still lazy-loaded. */}
            {showSnakeEgg && (
              <button
                type="button"
                onClick={() => setSnakeOpen(true)}
                aria-label={tFallback('hub.profile.secretGame', 'Secret game')}
                title="???"
                className="p-1 rounded-md text-base leading-none opacity-70 hover:opacity-100 hover:scale-110 transition-transform shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span aria-hidden="true">👾</span>
              </button>
            )}
            {showBirdEgg && (
              <button
                type="button"
                onClick={() => setBirdOpen(true)}
                aria-label={tFallback('hub.profile.secretGame', 'Secret game')}
                title="???"
                className="p-1 rounded-md text-base leading-none opacity-70 hover:opacity-100 hover:scale-110 transition-transform shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span aria-hidden="true">👾</span>
              </button>
            )}
            {showSweatEgg && (
              <button
                type="button"
                onClick={() => setSweatOpen(true)}
                aria-label={tFallback('hub.profile.secretGame', 'Secret game')}
                title="???"
                className="p-1 rounded-md text-base leading-none opacity-70 hover:opacity-100 hover:scale-110 transition-transform shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span aria-hidden="true">👾</span>
              </button>
            )}
          </div>
        </div>

        {/* Pill row — activity, equipped title and mutual status were three
            separate stacked rows. They're one wrapping line now. */}
        {(activeLabel || equippedTitle || isMutualFollow || (isSelf && !activeNote)) && (
          <div className="flex items-center flex-wrap gap-2 mt-2.5">
            {activeLabel && (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                activeLabel.text === 'Active now'
                  ? 'bg-success/10 border-success/30 text-success dark:text-success'
                  : 'bg-muted/60 border-border/50 text-muted-foreground'
              }`}>
                {activeLabel.text === 'Active now' ? (
                  <motion.span
                    className="w-2 h-2 rounded-full bg-success shrink-0"
                    animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
                )}
                {activeLabel.text}
              </span>
            )}

            {equippedTitle && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border"
                style={{
                  color: titleRarity?.color,
                  borderColor: `${titleRarity?.color}55`,
                  background: `${titleRarity?.color}14`,
                }}
                title={equippedTitle.description}
              >
                <span aria-hidden="true">{equippedTitle.emoji}</span>
                {equippedTitle.name}
              </span>
            )}

            {isMutualFollow && (
              <span
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/25"
                title={tFallback('hub.profile.mutualTooltip', 'You follow each other')}
              >
                <span aria-hidden="true">↔</span>
                {tFallback('hub.profile.mutual', 'Friends')}
              </span>
            )}

            {isSelf && !activeNote && (
              <button
                type="button"
                onClick={() => setNoteEditorOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-dashed border-border text-muted-foreground hover:text-primary active:text-primary hover:border-primary/40 transition-colors"
              >
                + {tFallback('hub.profile.addNote', 'note')}
              </button>
            )}
          </div>
        )}

        {/* Bio — 12px → 14px. It's the one piece of copy the owner wrote. */}
        {(isPoopUser || bio) && (
          <p className="text-sm text-foreground/90 mt-3 leading-relaxed whitespace-pre-line">
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
            className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-primary hover:underline break-all"
          >
            <Link2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[220px]">{websiteUrl.replace(/^https?:\/\//i, '')}</span>
            <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
          </a>
        )}

        {/* Location + anniversary — merged onto one line. Two facts about
            where and how long, not two stacked rows. */}
        {(city || countryFlag || (!isSelf && mutualSince)) && (
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-2.5 text-sm text-muted-foreground">
            {(city || countryFlag) && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                {city && <span>{city}</span>}
                {countryFlag && (
                  <img loading="lazy" src={flagUrl(codeToFlag(countryFlag))}
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
                  {tFallback('hub.profile.trainingSince', 'Training together since {month}').replace('{month}', monthYear)}
                </span>
              );
            })()}
          </div>
        )}

        {/* Metrics as text. Three bordered tiles and three 16ms count-up
            timers used to live here. */}
        <ProfileMetrics
          postCount={posts.length}
          followerCount={followerIds.length}
          followingCount={followingIds.length}
          onOpenFollowers={() => setOpenModal('followers')}
          onOpenFollowing={() => setOpenModal('following')}
          language={language}
          forms={{
            posts: { one: tFallback('hub.profile.post', 'post'), other: tFallback('hub.profile.posts', 'posts') },
            followers: { one: tFallback('hub.profile.follower', 'follower'), other: tFallback('hub.profile.followers', 'followers') },
            following: { other: tFallback('hub.profile.following', 'following') },
          }}
        />

        {/* Note like — non-own profile with an active note. */}
        {!isSelf && activeNote && (
          <button
            type="button"
            onClick={handleNoteLike}
            className="flex items-center gap-1.5 mt-3 text-sm text-muted-foreground"
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
            className="mb-3"
          >
            <div className="bg-secondary/30 rounded-xl p-3 space-y-3">
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
                  placeholder="Your city (e.g. Miami, FL)"
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
                  ? <img loading="lazy" src={flagUrl(countryFlag)} alt="flag" className="w-5 h-5 object-contain shrink-0" />
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
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Signature trophy</p>
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
                  <p className="text-xs text-muted-foreground/60 mt-1">Tap the active one to remove it.</p>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditProfileOpen(false)}
                  className="flex-1 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
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
                  {savingProfile ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Story highlights rail (mig 099). Own profile shows a
          "+ New" tile + their albums; non-own only shows albums
          (hides entirely if empty).

          `email` — the RESOLVED value — not `targetUser?.email`. Since mig
          220 dropped email from public_profiles, in-app navigation is
          id-only, so the nav prop carries no email and these three
          components were being handed undefined on every other-user
          profile. Their queries sat disabled and the sections silently
          rendered nothing, which reads as "this person has no data"
          rather than as the bug it is. `email` falls back to the
          resolve_profile_email RPC that this component already runs. */}
      <StoryHighlightsRail
        userEmail={email}
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

      {/* ── Body tabs ──────────────────────────────────────────────────
          Lift stats, badges, completion, referral, two trophy blocks and
          the post list were seven stacked sections. Three destinations
          now, each with room to breathe. */}
      {likesOpen && isSelf ? (
        // Liked posts takes over the whole tab area — no tab strip, because
        // this is a different view of the profile rather than a fourth
        // destination inside it. The ribbon in the action row is lit, which is
        // what says where you are and how to get back.
        <div className="mt-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            {tFallback('hub.profile.likedPosts', 'Liked posts')}
          </h3>
          {likedLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : likedPosts.length === 0 ? (
            <EmptyState
              icon={Bookmark}
              title={tFallback('hub.profile.noLikesTitle', 'Nothing here yet')}
              body={tFallback('hub.profile.noLikesBody', 'Head to the Hub and start liking posts — they’ll collect here.')}
            />
          ) : (
            <div className="space-y-3">
              {likedPosts.map(p => (
                <HubPostCard key={p.id} post={p} onAuthorClick={onSelectUser} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
      <ProfileTabs
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'stats', label: tFallback('hub.profile.tabStats', 'Stats') },
          { id: 'trophies', label: tFallback('hub.profile.tabTrophies', 'Trophies'), count: earnedTrophies.length },
          { id: 'posts', label: tFallback('hub.profile.tabPosts', 'Posts'), count: posts.length },
        ]}
      />

      <ProfileTabPanel id="stats" active={activeTab}>
        {/* Lift stats — top 3 1RM lifts + total tonnage + longest
            streak. Self-hides on cold accounts (zero workouts logged). */}
        {/*
          `peer` + `peer-empty:` handles the cold-account case. Every child
          here self-hides when it has nothing to show — which used to be
          invisible, because these were inline sections you'd simply never
          see. Behind a *named tab* the same behaviour becomes a tab that
          leads to a blank screen. When all of them return null this wrapper
          is genuinely childless, `:empty` matches, and the fallback below
          takes over. Declarative, so it re-resolves on its own when the
          lift-stats query lands.
        */}
        <div className="peer">
          <ProfileLiftStats
            userEmail={email}
            longestStreak={isSelf
              ? user?.longest_workout_streak
              : targetUser?.longest_workout_streak}
            isOwn={isSelf}
            username={displayUsername}
          />

          {/* Recent badges — drives the "earn one more badge" identity
              investment loop. Self-hides when there's nothing to flex. */}
          <ProfileBadgeShowcase
            userEmail={email}
            userId={isSelf ? user?.id : targetProfile?.id}
            isOwn={isSelf}
          />

          {/* Profile completion meter — own profile only, dismissible
              once at 100%. */}
          {isSelf && (
            <ProfileCompletionMeter user={user} targetProfile={targetProfile} />
          )}

          {/* Referral card — own profile only. Every share is an unpaid
              distribution opportunity. */}
          {isSelf && (
            <div className="mb-4">
              <ReferralCard />
            </div>
          )}
        </div>

        <div className="hidden peer-empty:block">
          <EmptyState
            icon={TrendingUp}
            title={isSelf
              ? tFallback('hub.profile.noStatsSelfTitle', 'No stats yet')
              : tFallback('hub.profile.noStatsTitle', 'Nothing logged yet')}
            body={isSelf
              ? tFallback('hub.profile.noStatsSelfBody', 'Log a workout and your best lifts, tonnage and streak show up here.')
              : tFallback('hub.profile.noStatsBody', 'Their lifts and badges will appear here once they start training.')}
          />
        </div>
      </ProfileTabPanel>

      <ProfileTabPanel id="trophies" active={activeTab}>
        <ProfileTrophies
          isSelf={isSelf}
          trophyCase={trophyCase}
          trophyVisible={trophyVisible}
          earnedTrophies={earnedTrophies}
          onPickSlot={setTrophyPickerSlot}
          trophyLabels={TROPHY_LABELS}
          tFallback={tFallback}
        />
      </ProfileTabPanel>

      <ProfileTabPanel id="posts" active={activeTab}>
        {posts.length > 1 && (
          <div className="flex items-center justify-end mb-3">
            <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs font-bold">
              <button type="button"
                onClick={() => setProfilePostSort('newest')}
                className={`px-3 py-1.5 transition-colors ${profilePostSort === 'newest' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground active:text-foreground'}`}>
                New
              </button>
              <button type="button"
                onClick={() => setProfilePostSort('popular')}
                className={`px-3 py-1.5 border-s border-border transition-colors ${profilePostSort === 'popular' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground active:text-foreground'}`}>
                Top
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
              : tFallback('hub.profile.noPostsBody', 'Check back later — new posts will appear here.')}
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
      </ProfileTabPanel>
        </>
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
          onStoriesChange={() => queryClient.invalidateQueries({ queryKey: ['profileStories', email] })}
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
                            // Same reason as the trophy / bio handlers above:
                            // on your OWN profile `countryFlag` reads from
                            // useAuth().user, not the hubProfileLookup cache
                            // (which is null for self). Invalidating that
                            // query alone left the flag persisted server-side
                            // and invisible until a full reload.
                            await checkUserAuth?.();
                            queryClient.invalidateQueries({ queryKey: ['hubProfileLookup', email] });
                          } catch {
                            toast.error('Could not save flag');
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

      {/* Leaderboards — opened by the hero's league pill. Lazy so the whole
          leaderboard surface stays out of the profile chunk for the users who
          never tap it. */}
      {leaguesOpen && (
        <Suspense fallback={null}>
          <LeaderboardsModal open={leaguesOpen} onClose={() => setLeaguesOpen(false)} />
        </Suspense>
      )}

      {/* Profile QR code modal */}
      <AnimatePresence>
        {qrOpen && displayUsername && (
          <QRModal
            url={`${typeof window !== 'undefined' ? window.location.origin : 'https://flexyn.netlify.app'}/@${displayUsername}`}
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
                {t('hub.profile.unfollowConfirmDesc').replace('{handle}', ownerUsername ? `@${ownerUsername}` : t('hub.profile.anonymousAthlete'))}
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

      {/* 👾 Heavy Bird — easter egg, only on the @keganbergeron profile.
          Mounted on open (the canvas engine runs only while shown). */}
      {showBirdEgg && birdOpen && (
        <Suspense fallback={null}>
          <HeavyBirdModal
            onClose={() => setBirdOpen(false)}
            userId={user?.id}
            onUnlockCosmetic={() => toast.success('🏆 315 lb Club unlocked!')}
          />
        </Suspense>
      )}

      {/* 👾 Sweat Jetpack — easter egg, only on the @calason44 profile.
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

  const { data: allUsers = [] } = useQuery({
    queryKey: ['hubProfileUsers', ids],
    queryFn: async () => {
      if (!ids.length) return [];
      const users = await db.entities.User.list().catch(() => []);
      // Resolve the follower/following rows by user_id — never off the
      // view's email column (which no longer exists).
      return users.filter(u => ids.includes(u.id)).map(u => ({
        ...u,
        username: u.username || 'athlete',
        levelData: calculateLevelFromXp(Number(u.total_xp) || 0),
        tier: getTier(calculateLevelFromXp(Number(u.total_xp) || 0).level, t),
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
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary active:bg-secondary transition-colors">
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
                    {u.tier && (
                      <p className={`text-xs truncate ${u.tier.text}`}>{u.tier.name}</p>
                    )}
                  </div>
                  {u.levelData && u.tier && (
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className={`px-2 py-0.5 rounded-md bg-gradient-to-r ${u.tier.badge} shadow-sm`}>
                        <span className="text-xs font-bold text-white drop-shadow">Lv {u.levelData.level}</span>
                      </div>
                      <span className={`text-xs font-bold uppercase tracking-widest ${u.tier.text}`}>{u.tier.name}</span>
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