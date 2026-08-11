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
import { Loader2, MessageCircle, MoreHorizontal, Pencil, Palette, QrCode, Coins, Swords, Eye, EyeOff, UserPlus, UserCheck, VolumeX, Volume2, Ban } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { THEMES_ENABLED } from '@/lib/featureFlags';

// A dropdown anchored to the "…" button, not a sheet from the bottom of the
// screen. A bottom sheet is the right shape for a surface with its own
// content — the referral sheet earns one — but this is a short list of
// actions belonging to a specific control, and travelling the full height of
// the phone to answer a tap in the header reads as heavier than the action
// is. Radix handles the anchoring, collision flipping, outside-click,
// Escape, focus return and RTL side-swapping; the app already wraps it at
// components/ui/dropdown-menu.
function MenuItem({ icon: Icon, label, onSelect, iconClass = 'text-muted-foreground', disabled = false, hint }) {
  return (
    <DropdownMenuItem
      // Synchronous on purpose. The obvious defensive move here is to defer
      // with requestAnimationFrame so Radix finishes returning focus to the
      // trigger before the modal mounts — that's the standard fix when the
      // target is a Radix Dialog, which fights for focus. None of these are:
      // ThemeSelector, GiftCoinsModal and CreateDuelModal are all plain
      // framer-motion overlays, so there is no race to lose. And rAF is
      // paused in a hidden or throttled tab, so deferring would mean a
      // backgrounded tab silently swallowing the tap.
      onSelect={disabled ? (e) => e.preventDefault() : onSelect}
      disabled={disabled}
      // Radix already applies pointer-events-none + 50% opacity to a
      // disabled item and takes it out of the keyboard walk; the hint is
      // what turns "greyed out" from a dead end into a promise.
      className={`gap-2.5 py-2.5 ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${disabled ? 'text-muted-foreground' : iconClass}`} />
      <span className={disabled ? 'text-muted-foreground' : undefined}>{label}</span>
      {hint && (
        <span className="ms-auto text-micro font-semibold uppercase tracking-wide text-muted-foreground">
          {hint}
        </span>
      )}
    </DropdownMenuItem>
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
  onMute,
  onUnmute,
  onBlock,
  isMuted = false,
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
            className="h-9 px-4 rounded-full border border-border text-sm font-semibold hover:bg-secondary active:bg-secondary transition-colors flex items-center gap-1.5"
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
                  ? 'bg-secondary text-foreground hover:bg-destructive/10 active:bg-destructive/10 hover:text-destructive active:text-destructive'
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
              className="h-9 w-9 rounded-full border border-border text-foreground hover:bg-secondary active:bg-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={t('hub.profile.message')}
              title={t('hub.profile.message')}
            >
              {!messageReady || messageInFlight
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <MessageCircle className="w-4 h-4" />}
            </button>
          </>
        )}

        {/* Controlled, so HubProfile's "close the menu when the viewed
            profile changes" effect still works — navigating person to
            person shouldn't leave a menu hanging open over someone new.
            Radix closes it on select/outside/Escape by itself. */}
        <DropdownMenu open={menuOpen} onOpenChange={(o) => (o ? onOpenMenu() : onCloseMenu())}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-9 w-9 rounded-full border border-border text-foreground hover:bg-secondary active:bg-secondary transition-colors flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={menuTitle}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>

          {/* align="end" pins it to the button's trailing edge — logical, so
              it mirrors correctly in Arabic. collisionPadding keeps it off
              the screen edge and lets it flip above the button when the
              profile is scrolled far enough down. */}
          <DropdownMenuContent align="end" sideOffset={6} collisionPadding={12} className="w-56">
            {isSelf ? (
              <>
                {/* Themes are off (see src/lib/featureFlags.js). The entry
                    stays in the menu rather than disappearing: people who
                    have used it before will go looking, and an item that
                    silently vanished reads as something broken, where a
                    greyed one that says "Coming soon" reads as a decision. */}
                <MenuItem
                  icon={Palette}
                  iconClass="text-primary"
                  label={tFallback('hub.profile.themes', 'Themes')}
                  onSelect={onOpenThemes}
                  disabled={!THEMES_ENABLED}
                  // Reusing levelBar.comingSoon rather than minting a new
                  // key: it's the same two words and it already ships in
                  // all 15 languages, where a new key would be English-only
                  // on 14 of them.
                  hint={THEMES_ENABLED ? undefined : tFallback('levelBar.comingSoon', 'Coming Soon')}
                />
                {hasUsername && (
                  <MenuItem
                    icon={QrCode}
                    label={tFallback('hub.profile.shareProfile', 'Share profile')}
                    onSelect={onOpenQr}
                  />
                )}
                <MenuItem
                  icon={trophyVisible ? EyeOff : Eye}
                  label={trophyVisible
                    ? tFallback('hub.profile.hideTrophyCase', 'Hide trophy case')
                    : tFallback('hub.profile.showTrophyCase', 'Show trophy case')}
                  onSelect={onToggleTrophyVisibility}
                />
              </>
            ) : (
              <>
                {canDuelOrGift && (
                  <>
                    <MenuItem
                      icon={Swords}
                      iconClass="text-primary"
                      label={tFallback('hub.profile.duel', 'Challenge to a duel')}
                      onSelect={onOpenDuel}
                    />
                    <MenuItem
                      icon={Coins}
                      iconClass="text-primary"
                      label={tFallback('hub.profile.gift', 'Send a coin gift')}
                      onSelect={onOpenGift}
                    />
                  </>
                )}
                {hasUsername && (
                  <MenuItem
                    icon={QrCode}
                    label={tFallback('hub.profile.shareProfile', 'Share profile')}
                    onSelect={onOpenQr}
                  />
                )}

                {/* Moderation. Unmute in particular is the point of this
                    block: muting was reachable from any post, unmuting only
                    from Settings → Privacy, so the two halves of one decision
                    lived in different places and the undo was unfindable.
                    Whichever state you are in, the opposite action is here. */}
                {(onMute || onUnmute || onBlock) && <DropdownMenuSeparator />}
                {isMuted
                  ? onUnmute && (
                      <MenuItem
                        icon={Volume2}
                        label={tFallback('hub.profile.unmute', 'Unmute')}
                        onSelect={onUnmute}
                      />
                    )
                  : onMute && (
                      <MenuItem
                        icon={VolumeX}
                        label={tFallback('hub.profile.mute', 'Mute')}
                        onSelect={onMute}
                      />
                    )}
                {onBlock && (
                  <MenuItem
                    icon={Ban}
                    iconClass="text-destructive"
                    label={tFallback('hub.profile.block', 'Block')}
                    onSelect={onBlock}
                  />
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
