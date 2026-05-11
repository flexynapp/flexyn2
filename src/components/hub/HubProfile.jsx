// src/components/hub/HubProfile.jsx
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { User as UserIcon, Users as UsersIcon, FileText, X, Loader2, MessageCircle, Palette } from 'lucide-react';
import ThemeSelector from '@/components/ThemeSelector';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { getTier } from '@/lib/xpTier';
import Particles from '@/components/Particles';
import { db } from '@/api/db';
import * as hubFollows from '@/lib/data/hubFollows';
import * as hubPosts from '@/lib/data/hubPosts';
import * as users from '@/lib/data/users';
import HubPostCard from './HubPostCard';
import ThemedScope from '@/components/ThemedScope';
import AvatarUploader from '@/components/AvatarUploader';
import { getLootTitleById } from '@/lib/lootTitles';
import { getLootFrameById } from '@/lib/lootFrames';
import { RARITY } from '@/lib/lootCatalog';
import { useTheme } from '@/lib/ThemeContext';

export default function HubProfile({ targetUser = null, onSelectUser = null, onStartConversation = null }) {
  const { t } = useLanguage();
  const { user, checkUserAuth } = useAuth();
  // Read the user's currently-equipped theme from ThemeContext (always fresh)
  // instead of useAuth().user, which only loads once at bootstrap and doesn't
  // refresh when the user equips a new theme — that's why a freshly-applied
  // theme would show globally but stay default on the profile card.
  const { themeId: liveThemeId, lootThemeId: liveLootThemeId } = useTheme();
  const queryClient = useQueryClient();
  const isSelf = !targetUser || targetUser?.email === user?.email;

  // Refresh AuthContext when ANY cosmetic is equipped/unequipped so the
  // self-profile (which reads equipped_title_id / equipped_frame_id from
  // useAuth) reflects the change immediately. Without this the bag UI saves
  // to the DB but the profile card keeps showing the previously-cached state.
  useEffect(() => {
    const handler = () => { checkUserAuth?.(); };
    window.addEventListener('flexyn:loot-equipped', handler);
    window.addEventListener('flexyn:theme-changed', handler);
    return () => {
      window.removeEventListener('flexyn:loot-equipped', handler);
      window.removeEventListener('flexyn:theme-changed', handler);
    };
  }, [checkUserAuth]);
  const email = isSelf ? user?.email : targetUser?.email;
  const [openModal, setOpenModal] = useState(null); // 'followers', 'following', or null
  const [unfollowConfirmOpen, setUnfollowConfirmOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  // Always start a profile view at the top, regardless of where the user
  // scrolled before navigating in. Using 'auto' (not 'smooth') because the
  // new profile data is already mounting underneath — a smooth scroll would
  // race with the layout shift of new content.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [email]);

  // Refetch the target user's profile to get up-to-date XP, theme, and avatar.
  // We do NOT trust this query for `username` — the display layer reads
  // `targetUser.username` first (passed in from the parent) and only falls
  // through to this if it's missing. This avoids a class of bugs where a
  // stale or field-stripped User.list() response overwrites a known-good
  // username that came in via the navigation prop.
  const { data: targetProfile } = useQuery({
    queryKey: ['hubProfileLookup', email],
    queryFn: async () => {
      if (isSelf) return null;
      const list = await users.list().catch(() => []);
      const found = list.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!found) {
        // List call returned but the user isn't visible to us. Return the
        // navigation-prop snapshot so downstream readers have something to
        // work with. Do NOT return null — that would clear avatarUrl/theme/XP.
        return targetUser || null;
      }
      // Preserve username from targetUser if the list entry doesn't carry it.
      // This happens when Base44 strips custom fields from cross-user reads.
      return {
        ...found,
        username: found.username || targetUser?.username || null,
      };
    },
    enabled: !isSelf && !!email,
    initialData: isSelf ? null : targetUser,
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
      return hubFollows.follow(user.email, email);
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
      setUnfollowConfirmOpen(true);
      return;
    }
    followMutation.mutate();
  };

  const handleConfirmUnfollow = () => {
    setUnfollowConfirmOpen(false);
    if (!user?.email) return;
    unfollowMutation.mutate();
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

  return (
    <ThemedScope themeId={ownerThemeId} lootThemeId={ownerLootThemeId}>
      {/* Header card */}
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="bg-card border border-border rounded-xl p-5 mb-4"
      >
        <div className="flex items-center gap-4 mb-4">
          <AvatarUploader
            src={avatarUrl}
            initials={initials}
            editable={isSelf}
            size={64}
            frameCss={equippedFrame?.css}
            frameAnimation={equippedFrame?.animation}
          />
          <div className="flex-1 min-w-0">
            <h2 className="font-heading font-bold text-lg truncate">{displayHandle}</h2>
            {/* Equipped Title — text label below the @handle, colored by rarity.
                Not shown when nothing is equipped. Visible to other users. */}
            {equippedTitle && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-base leading-none">{equippedTitle.emoji}</span>
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: titleRarity?.color }}
                  title={equippedTitle.description}
                >
                  {equippedTitle.name}
                </span>
              </div>
            )}
          </div>
        </div>

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

        {/* Themes button — own profile only */}
        {isSelf && (
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            onClick={() => setThemeOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-2 mb-4 rounded-lg border border-border text-sm font-medium hover:bg-secondary transition-colors"
          >
            <Palette className="w-4 h-4 text-primary" />
            {t('hub.profile.themes')}
          </motion.button>
        )}

        {/* Showcase slot — reserved for equipped loot items, capsule rewards,
            and custom themes earned through the loot/inventory system.
            Rendered in the profile owner's ThemedScope so equipped custom
            themes here will preview correctly when other users view this
            profile. Populated from a future User.equipped_showcase_items field. */}
        {false && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mb-4"
          >
            {/* ProfileShowcase component will be rendered here */}
          </motion.div>
        )}

        <div className="grid grid-cols-3 gap-2 mb-4">
          <Stat icon={FileText}  label={t('hub.profile.posts')}     value={posts.length} />
          <button onClick={() => setOpenModal('followers')} className="bg-secondary/40 rounded-lg p-2 text-center hover:bg-secondary/60 transition-colors">
            <UsersIcon className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
            <p className="font-heading font-bold text-base">{followers.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('hub.profile.followers')}</p>
          </button>
          <button onClick={() => setOpenModal('following')} className="bg-secondary/40 rounded-lg p-2 text-center hover:bg-secondary/60 transition-colors">
            <UserIcon className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
            <p className="font-heading font-bold text-base">{following.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('hub.profile.following')}</p>
          </button>
        </div>

        {!isSelf && (
          <div className="flex gap-2">
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
                      <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
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

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="bg-secondary/40 rounded-lg p-2 text-center">
      <Icon className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
      <p className="font-heading font-bold text-base">{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}