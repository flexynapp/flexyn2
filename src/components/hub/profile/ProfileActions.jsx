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
import { Loader2, MessageCircle, MoreHorizontal, Pencil, Palette, QrCode, Coins, Swords, Eye, EyeOff, UserPlus, UserCheck, VolumeX, Volume2, Ban, Lock, Unlock, StickyNote, Flag } from 'lucide-react';
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
function MenuItem({ icon: Icon, label, onSelect, iconClass = 'text-muted-foreground', disabled = false, hint, description }) {
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
      <Icon className={`w-4 h-4 shrink-0 ${disabled ? 'text-muted-foreground' : iconClass} ${description ? 'self-start mt-0.5' : ''}`} />
      {description ? (
        // A sentence, so it reads as one: sentence case under the label.
        // It used to go through `hint`, the caps micro-label meant for two
        // words like "Coming soon", and wrapped into four lines of capitals.
        <span className="flex flex-col min-w-0">
          <span>{label}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </span>
      ) : (
        <span className={disabled ? 'text-muted-foreground' : undefined}>{label}</span>
      )}
      {hint && (
        <span className="kicker ms-auto">
          {hint}
        </span>
      )}
    </DropdownMenuItem>
  );
}

const ROW_BTN =
  'flex-1 min-w-0 h-11 px-3 rounded-lg bg-muted text-foreground text-sm font-semibold hover:bg-secondary active:bg-secondary transition-colors flex items-center justify-center gap-2';

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
  onAddNote,
  onOpenThemes,
  onOpenQr,
  onOpenDuel,
  onOpenGift,
  onMute,
  onUnmute,
  onBlock,
  onReport,
  onUnblock,
  isBlocked = false,
  isMuted = false,
  onToggleTrophyVisibility,
  isPrivate = false,
  onTogglePrivate,
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
      {/* One full-width row under the centred identity block: two equal
          buttons and the "…" menu. 44px tall, the tap floor, and a muted
          fill rather than an outline, because a row of hairline pills was
          the loudest generated-UI tell on the old header. Follow is the
          only primary; everything else is secondary on purpose. */}
      <div className={`flex items-center gap-2 w-full ${isBlocked ? 'justify-end' : ''}`}>
        {isBlocked ? null : isSelf ? (
          <>
            <button
              type="button"
              onClick={onEditProfile}
              className={ROW_BTN}
            >
              <Pencil className="w-4 h-4 text-muted-foreground" />
              {tFallback('hub.profile.editProfile', 'Edit profile')}
            </button>
            {hasUsername && (
              <button
                type="button"
                onClick={onOpenQr}
                className={ROW_BTN}
              >
                <QrCode className="w-4 h-4 text-muted-foreground" />
                {tFallback('hub.profile.shareProfile', 'Share profile')}
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onFollow}
              disabled={!followStatusReady || followBusy}
              className={`flex-1 min-w-0 h-11 px-4 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed ${
                isFollowingNow
                  ? 'bg-muted text-foreground hover:bg-destructive/10 active:bg-destructive/10 hover:text-destructive active:text-destructive'
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
                  <span className="truncate">{followLabel}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onMessage}
              disabled={!messageReady || messageInFlight}
              className={`${ROW_BTN} disabled:opacity-50 disabled:cursor-not-allowed`}
              aria-label={t('hub.profile.message')}
            >
              {!messageReady || messageInFlight
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <MessageCircle className="w-4 h-4 text-muted-foreground" />}
              <span className="truncate">{t('hub.profile.message')}</span>
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
              className="h-11 w-11 shrink-0 rounded-lg bg-muted text-foreground hover:bg-secondary active:bg-secondary transition-colors flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                {/* The note used to be a dashed "+ note" pill in the header,
                    a to-do sitting on the public face of the page. */}
                {onAddNote && (
                  <MenuItem
                    icon={StickyNote}
                    label={tFallback('profile.addNote', 'Add a note')}
                    onSelect={onAddNote}
                  />
                )}
                <MenuItem
                  icon={trophyVisible ? EyeOff : Eye}
                  label={trophyVisible
                    ? tFallback('hub.profile.hideTrophyCase', 'Hide trophy case')
                    : tFallback('hub.profile.showTrophyCase', 'Show trophy case')}
                  onSelect={onToggleTrophyVisibility}
                />
                {/* Private account. The hint spells out what stays visible,
                    because "private" means different things in different apps
                    and the surprise here would be discovering afterwards that
                    your name and photo were never hidden. They are not — you
                    have to stay recognisable enough for someone to decide to
                    follow you. */}
                {onTogglePrivate && (
                  <MenuItem
                    icon={isPrivate ? Lock : Unlock}
                    iconClass={isPrivate ? 'text-primary' : 'text-muted-foreground'}
                    label={isPrivate
                      ? tFallback('hub.profile.makePublic', 'Private account · On')
                      : tFallback('hub.profile.makePrivate', 'Private account')}
                    onSelect={onTogglePrivate}
                    description={isPrivate
                      ? tFallback('hub.profile.privateOnHint', 'Only followers see your stats, posts and badges')
                      : tFallback('hub.profile.privateOffHint', 'Hide your stats, posts and badges from non-followers')}
                  />
                )}
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
                {(onMute || onUnmute || onBlock || onReport) && <DropdownMenuSeparator />}
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
                {isBlocked
                  ? onUnblock && (
                      <MenuItem
                        icon={Ban}
                        label={tFallback('hub.profile.unblock', 'Unblock')}
                        onSelect={onUnblock}
                      />
                    )
                  : onBlock && (
                      <MenuItem
                        icon={Ban}
                        iconClass="text-destructive"
                        label={tFallback('hub.profile.block', 'Block')}
                        onSelect={onBlock}
                      />
                    )}
                {onReport && (
                  <MenuItem
                    icon={Flag}
                    iconClass="text-destructive"
                    label={tFallback('reportPlayer.menuReport', 'Report player')}
                    onSelect={onReport}
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
