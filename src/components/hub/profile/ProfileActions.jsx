// src/components/hub/profile/ProfileActions.jsx
//
// The action row, and the overflow sheet behind it.
//
// Previously these controls sat ~750px down the page — below the level bar,
// both trophy sections, the stat tiles, the highlights rail, the lift stats
// and the badge showcase. The single most important action on a stranger's
// profile required a scroll to reach. They now sit on the avatar's baseline.
//
// Shape follows Bluesky's HeaderStandardButtons: at most three controls, of
// which exactly one is primary, and a "…" that absorbs everything else. That
// is what keeps a header calm no matter how many capabilities the app grows —
// Duel and Gift are good features, but neither is why anyone opens a profile.
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, MessageCircle, MoreHorizontal, Pencil, Palette, QrCode, Coins, Swords, Eye, EyeOff, UserPlus, UserCheck } from 'lucide-react';

function SheetItem({ icon: Icon, label, onClick, iconClass = 'text-muted-foreground' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-start text-sm font-medium hover:bg-secondary active:bg-secondary/70 transition-colors"
    >
      <Icon className={`w-4 h-4 shrink-0 ${iconClass}`} />
      {label}
    </button>
  );
}

function OverflowSheet({ open, onClose, children, title }) {
  // Escape closes, and body scroll locks — the trophy/flag pickers in this
  // feature already establish the bottom-sheet pattern, so this matches them.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="bg-card border border-border rounded-t-2xl w-full max-w-lg p-2"
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          >
            <div className="w-9 h-1 rounded-full bg-border mx-auto my-2" aria-hidden="true" />
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function ProfileActions({
  isSelf,
  // follow
  isFollowingNow,
  theyFollowMe,
  followStatusReady,
  followBusy,
  onFollow,
  // message
  onMessage,
  messageReady,
  messageInFlight,
  // overflow
  menuOpen,
  onOpenMenu,
  onCloseMenu,
  onEditProfile,
  onOpenThemes,
  onOpenQr,
  onOpenDuel,
  onOpenGift,
  onToggleTrophyVisibility,
  trophyVisible,
  canDuelOrGift,
  hasUsername,
  t,
  tFallback,
}) {
  // Three states, not two. "Follow back" is a small thing that makes an app
  // feel like it's paying attention, and `theyFollowMe` is already queried
  // for the Friends pill — it just wasn't being used here.
  const followLabel = isFollowingNow
    ? t('hub.profile.unfollow')
    : theyFollowMe
      ? tFallback('hub.profile.followBack', 'Follow back')
      : t('hub.profile.follow');

  const menuTitle = tFallback('hub.profile.moreActions', 'More actions');

  return (
    <>
      <div className="flex items-center gap-2 pb-1">
        {isSelf ? (
          <button
            type="button"
            onClick={onEditProfile}
            className="h-9 px-4 rounded-full border border-border text-sm font-semibold hover:bg-secondary transition-colors flex items-center gap-1.5"
          >
            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            {tFallback('hub.profile.editProfile', 'Edit profile')}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onFollow}
              disabled={!followStatusReady || followBusy}
              className={`h-9 px-4 rounded-full text-sm font-bold transition-colors flex items-center justify-center gap-1.5 disabled:cursor-not-allowed ${
                isFollowingNow
                  ? 'bg-secondary text-foreground hover:bg-destructive/10 hover:text-destructive'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              } ${!followStatusReady ? 'opacity-60' : ''}`}
            >
              {!followStatusReady || followBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {isFollowingNow
                    ? <UserCheck className="w-4 h-4" />
                    : <UserPlus className="w-4 h-4" />}
                  {followLabel}
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onMessage}
              disabled={!messageReady || messageInFlight}
              className="h-9 w-9 rounded-full border border-border text-foreground hover:bg-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={t('hub.profile.message')}
              title={t('hub.profile.message')}
            >
              {!messageReady || messageInFlight
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <MessageCircle className="w-4 h-4" />}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onOpenMenu}
          className="h-9 w-9 rounded-full border border-border text-foreground hover:bg-secondary transition-colors flex items-center justify-center"
          aria-label={menuTitle}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      <OverflowSheet open={menuOpen} onClose={onCloseMenu} title={menuTitle}>
        {isSelf ? (
          <>
            <SheetItem
              icon={Palette}
              iconClass="text-primary"
              label={tFallback('hub.profile.themes', 'Themes')}
              onClick={() => { onCloseMenu(); onOpenThemes(); }}
            />
            {hasUsername && (
              <SheetItem
                icon={QrCode}
                label={tFallback('hub.profile.shareProfile', 'Share profile')}
                onClick={() => { onCloseMenu(); onOpenQr(); }}
              />
            )}
            <SheetItem
              icon={trophyVisible ? EyeOff : Eye}
              label={trophyVisible
                ? tFallback('hub.profile.hideTrophyCase', 'Hide trophy case')
                : tFallback('hub.profile.showTrophyCase', 'Show trophy case')}
              onClick={() => { onCloseMenu(); onToggleTrophyVisibility(); }}
            />
          </>
        ) : (
          <>
            {canDuelOrGift && (
              <>
                <SheetItem
                  icon={Swords}
                  iconClass="text-primary"
                  label={tFallback('hub.profile.duel', 'Challenge to a duel')}
                  onClick={() => { onCloseMenu(); onOpenDuel(); }}
                />
                <SheetItem
                  icon={Coins}
                  iconClass="text-yellow-500"
                  label={tFallback('hub.profile.gift', 'Send a coin gift')}
                  onClick={() => { onCloseMenu(); onOpenGift(); }}
                />
              </>
            )}
            {hasUsername && (
              <SheetItem
                icon={QrCode}
                label={tFallback('hub.profile.shareProfile', 'Share profile')}
                onClick={() => { onCloseMenu(); onOpenQr(); }}
              />
            )}
          </>
        )}
      </OverflowSheet>
    </>
  );
}
