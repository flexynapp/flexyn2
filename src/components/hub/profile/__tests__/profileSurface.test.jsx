// Render smoke + behaviour tests for the redesigned profile surface.
//
// These four components carry the redesign's structural claims, so the
// assertions here are about those claims, not just "it mounts":
//   • metrics are compact-formatted text, not raw integers
//   • the follow button has three states, including "Follow back"
//   • the earned-trophy grid renders locked slots for what's left
//   • the XP rail exposes its numbers to assistive tech now that the
//     "1,240 / 2,000 XP" caption lives on the banner instead of a card
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileMetrics from '../ProfileMetrics';
import ProfileTierBanner from '../ProfileTierBanner';
import ProfileActions from '../ProfileActions';
import ProfileTrophies from '../ProfileTrophies';
import ProfileTabs, { ProfileTabPanel } from '../ProfileTabs';
import { TROPHIES } from '@/lib/trophyDefinitions';

// These components now read tFallback, and useLanguage() throws outside a
// provider by design. Resolving the real English catalog rather than returning
// key paths, so any assertion here still reads like the screen.
vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});


const FORMS = {
  posts:     { one: 'post', other: 'posts' },
  followers: { one: 'follower', other: 'followers' },
  following: { other: 'following' },
};
const TIER = {
  name: 'Ruby',
  badge: 'from-red-400 via-rose-500 to-pink-500',
  bar: 'from-red-400 to-pink-500',
  bg: 'bg-rose-500/10',
  text: 'text-rose-400',
  glow: 'shadow-rose-500/40',
  particles: 'pulse',
};
const t = (k) => k;
const tFallback = (_k, fb) => fb;

describe('ProfileMetrics', () => {
  it('compact-formats counts instead of printing raw integers', () => {
    render(
      <ProfileMetrics
        postCount={47}
        followerCount={2300}
        followingCount={418}
        forms={FORMS}
        language="en"
      />
    );
    // The old bordered tiles printed "2300". Every reference app prints 2.3K.
    expect(screen.getByText('2.3K')).toBeTruthy();
    expect(screen.queryByText('2300')).toBeNull();
    expect(screen.getByText('418')).toBeTruthy();
    expect(screen.getByText('47')).toBeTruthy();
  });

  it('renders zero rather than a bare label while a count is still null', () => {
    render(
      <ProfileMetrics
        postCount={null}
        followerCount={undefined}
        followingCount={0}
        forms={FORMS}
        language="en"
      />
    );
    expect(screen.getAllByText('0')).toHaveLength(3);
  });

  // A brand-new account showed "0 followers · 0 following · 0 posts" — three
  // zeros in a row, immediately after an eleven-step signup. It reads as a
  // verdict and it isn't information.
  it('offers a next step instead of three zeros on a brand-new account', () => {
    render(
      <ProfileMetrics
        postCount={0}
        followerCount={0}
        followingCount={0}
        onOpenFollowing={vi.fn()}
        forms={FORMS}
        language="en"
      />
    );
    expect(screen.queryAllByText('0')).toHaveLength(0);
    expect(screen.getByText('Find people to follow')).toBeTruthy();
  });

  // The loading case must NOT be mistaken for the empty case, or every
  // profile flashes "Find people to follow" before its real counts land.
  it('does not show the brand-new state while counts are still loading', () => {
    render(
      <ProfileMetrics
        postCount={null}
        followerCount={null}
        followingCount={null}
        forms={FORMS}
        language="en"
      />
    );
    expect(screen.queryByText('Find people to follow')).toBeNull();
  });

  it('returns to the full row as soon as one count is non-zero', () => {
    render(
      <ProfileMetrics
        postCount={0}
        followerCount={0}
        followingCount={4}
        onOpenFollowers={vi.fn()}
        onOpenFollowing={vi.fn()}
        forms={FORMS}
        language="en"
      />
    );
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getAllByText('0')).toHaveLength(2);
  });

  it('only makes the follower/following counts tappable', () => {
    const onFollowers = vi.fn();
    render(
      <ProfileMetrics
        postCount={5}
        followerCount={10}
        followingCount={3}
        onOpenFollowers={onFollowers}
        onOpenFollowing={vi.fn()}
        forms={FORMS}
        language="en"
      />
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(onFollowers).toHaveBeenCalled();
  });
});

describe('ProfileTierBanner', () => {
  it('states the remaining XP and the level it unlocks', () => {
    render(
      <ProfileTierBanner
        tier={TIER}
        level={54}
        levelLabel="Lv 54"
        levelWord="Lv"
        xpInLevel={1240}
        xpNeeded={2000}
        progressPercent={62}
        isAdminProfile={false}
      />
    );
    // Exactly one. The XP used to render twice — a hairline along the
    // banner's bottom edge AND a floating caption — which is two renderings
    // of one number inviting the reader to check whether they agree.
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(1);

    const bar = bars[0];
    expect(bar.getAttribute('aria-valuenow')).toBe('62');
    // The remaining XP (2000 - 1240) and the level it buys, not the raw
    // position in the level — "760 to go" is the actionable half.
    expect(bar.getAttribute('aria-label')).toContain('760');
    expect(bar.getAttribute('aria-label')).toContain('55');
    expect(screen.getByText('Ruby')).toBeTruthy();
    expect(screen.getByText('54')).toBeTruthy();
  });

  it('renders the primary trophy as a crest, and nothing when there is none', () => {
    const base = {
      tier: TIER, level: 54, levelLabel: 'Lv 54', levelWord: 'Lv',
      xpInLevel: 1240, xpNeeded: 2000, progressPercent: 62,
    };
    const { container, rerender } = render(<ProfileTierBanner {...base} />);
    expect(container.textContent).not.toContain('👑');

    rerender(<ProfileTierBanner {...base} primaryTrophy="👑" />);
    expect(container.textContent).toContain('👑');
  });

  it('draws no week strip at all when it has no week, rather than seven blanks', () => {
    // `workout_logs` is owner-only, so a viewer looking at somebody else's
    // profile gets [] — and `buildTrainingWeek` turns [] into seven days with
    // `trained: false`, not into nothing. HubProfile therefore has to pass []
    // itself; this is the half of the contract the banner owns. Seven grey
    // squares captioned "Trained 0 of the last 7 days" is a claim about a
    // person the viewer has no data on, and it is usually false.
    const base = {
      tier: TIER, level: 54, levelLabel: 'Lv 54', levelWord: 'Lv',
      xpInLevel: 1240, xpNeeded: 2000, progressPercent: 62,
    };
    const { rerender } = render(<ProfileTierBanner {...base} week={[]} />);
    expect(screen.queryByRole('img', { name: /Trained/ })).toBeNull();

    // And it does render once there is a week to render — otherwise the
    // assertion above would pass on a banner that had lost the strip.
    const week = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
      key: `2026-08-0${i + 1}`, label: 'M', trained: i < 3, isToday: i === 3, isFuture: i > 3,
    }));
    rerender(<ProfileTierBanner {...base} week={week} />);
    const strip = screen.getByRole('img', { name: /Trained/ });
    expect(strip.getAttribute('aria-label')).toContain('3');
  });

  it('labels the level so the numeral is not left to be guessed at', () => {
    // It rendered "Ruby 54" — a bare numeral beside a tier name reads just
    // as easily as a rank, a position, or a badge count.
    render(
      <ProfileTierBanner
        tier={TIER}
        level={54}
        levelLabel="Lv 54"
        levelWord="Lv"
        xpInLevel={1240}
        xpNeeded={2000}
        progressPercent={62}
      />
    );
    expect(screen.getByText('Lv')).toBeTruthy();
  });
});

describe('ProfileActions', () => {
  const base = {
    isSelf: false,
    followStatusReady: true,
    followBusy: false,
    onFollow: vi.fn(),
    onMessage: vi.fn(),
    messageReady: true,
    messageInFlight: false,
    menuOpen: false,
    onOpenMenu: vi.fn(),
    onCloseMenu: vi.fn(),
    onEditProfile: vi.fn(),
    onOpenThemes: vi.fn(),
    onOpenQr: vi.fn(),
    onOpenDuel: vi.fn(),
    onOpenGift: vi.fn(),
    onToggleTrophyVisibility: vi.fn(),
    trophyVisible: true,
    canDuelOrGift: true,
    hasUsername: true,
    t,
    tFallback,
  };

  it('offers "Follow back" when the target already follows the viewer', () => {
    render(<ProfileActions {...base} isFollowingNow={false} theyFollowMe />);
    expect(screen.getByText('Follow back')).toBeTruthy();
  });

  it('offers plain follow when the relationship is one-way', () => {
    render(<ProfileActions {...base} isFollowingNow={false} theyFollowMe={false} />);
    expect(screen.getByText('hub.profile.follow')).toBeTruthy();
  });

  it('offers unfollow once following', () => {
    render(<ProfileActions {...base} isFollowingNow theyFollowMe />);
    expect(screen.getByText('hub.profile.unfollow')).toBeTruthy();
  });

  it('keeps the visible row to three controls and hides duel/gift behind the menu', () => {
    const { rerender } = render(
      <ProfileActions {...base} isFollowingNow={false} theyFollowMe={false} />
    );
    // Follow + Message + "…" — nothing else competing above the fold.
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByText('Challenge to a duel')).toBeNull();

    rerender(<ProfileActions {...base} isFollowingNow={false} theyFollowMe={false} menuOpen />);
    expect(screen.getByText('Challenge to a duel')).toBeTruthy();
    expect(screen.getByText('Send a coin gift')).toBeTruthy();
  });

  it('swaps to edit-profile on your own profile', () => {
    render(<ProfileActions {...base} isSelf isFollowingNow={false} theyFollowMe={false} />);
    expect(screen.getByText('Edit profile')).toBeTruthy();
    expect(screen.queryByText('hub.profile.follow')).toBeNull();
  });

  // Themes are off (src/lib/featureFlags.js). The entry stays in the menu
  // and says "Coming soon" rather than disappearing — a control that
  // vanishes reads as a bug, and people who have used it will go looking.
  // Both halves matter: still listed, and genuinely not clickable.
  it('shows Themes as a disabled "Coming soon" entry while themes are off', () => {
    const onOpenThemes = vi.fn();
    render(
      <ProfileActions
        {...base}
        isSelf
        menuOpen
        onOpenThemes={onOpenThemes}
        isFollowingNow={false}
        theyFollowMe={false}
      />
    );

    const themes = screen.getByText('Themes');
    expect(themes).toBeTruthy();
    expect(screen.getByText('Coming Soon')).toBeTruthy();

    const item = themes.closest('[role="menuitem"]');
    expect(item.getAttribute('data-disabled')).not.toBeNull();

    fireEvent.click(item);
    expect(onOpenThemes).not.toHaveBeenCalled();
  });
});

describe('ProfileTrophies', () => {
  const earned = [{ trophy_id: TROPHIES[0].id }, { trophy_id: TROPHIES[1].id }];

  it('caps locked frames so the grid stays a shape, not a wall', () => {
    const { container } = render(
      <ProfileTrophies
        isSelf={false}
        trophyCase={[]}
        trophyVisible
        earnedTrophies={earned}
        onPickSlot={vi.fn()}
        trophyLabels={{}}
        tFallback={tFallback}
      />
    );
    // The exact remaining count lives in the header; the frames only have
    // to say "there is more". This used to render one frame per unearned
    // trophy, which was fine at a catalog of 18 — migration 323 took it
    // to 73, and 71 padlocks buries the two earned badges above them.
    expect(screen.getByText(`2 / ${TROPHIES.length}`)).toBeTruthy();
    const locks = container.querySelectorAll('.opacity-25');
    expect(locks.length).toBeGreaterThan(0);
    expect(locks.length).toBeLessThanOrEqual(10);
    expect(locks.length).toBeLessThan(TROPHIES.length - 2);
  });

  it('shows the empty-state copy rather than a wall of locks at zero', () => {
    render(
      <ProfileTrophies
        isSelf
        trophyCase={[]}
        trophyVisible
        earnedTrophies={[]}
        onPickSlot={vi.fn()}
        trophyLabels={{}}
        tFallback={tFallback}
      />
    );
    expect(screen.getByText(/first workout/i)).toBeTruthy();
  });

  it('only lets the owner open a slot picker', () => {
    const onPickSlot = vi.fn();
    const { rerender } = render(
      <ProfileTrophies
        isSelf={false}
        trophyCase={[{ type: 'emoji', value: '🥇' }]}
        trophyVisible
        earnedTrophies={earned}
        onPickSlot={onPickSlot}
        trophyLabels={{ '🥇': 'Gold' }}
        tFallback={tFallback}
      />
    );
    // Slot 1 is announced as the primary, not by its index — the position
    // carries meaning now, so the label says what the meaning is.
    fireEvent.click(screen.getByLabelText(/Primary trophy/));
    expect(onPickSlot).not.toHaveBeenCalled();
    // And the other four stay indexed.
    expect(screen.getByLabelText(/Slot 2/)).toBeTruthy();

    rerender(
      <ProfileTrophies
        isSelf
        trophyCase={[{ type: 'emoji', value: '🥇' }]}
        trophyVisible
        earnedTrophies={earned}
        onPickSlot={onPickSlot}
        trophyLabels={{ '🥇': 'Gold' }}
        tFallback={tFallback}
      />
    );
    fireEvent.click(screen.getByLabelText(/Primary trophy/));
    expect(onPickSlot).toHaveBeenCalledWith(0);
  });
});

describe('ProfileTabs', () => {
  const TABS = [
    { id: 'stats', label: 'Stats' },
    { id: 'trophies', label: 'Trophies', count: 8 },
    { id: 'posts', label: 'Posts', count: 47 },
  ];

  it('marks exactly one tab selected and renders only its panel', () => {
    render(
      <>
        <ProfileTabs tabs={TABS} active="stats" onChange={vi.fn()} />
        <ProfileTabPanel id="stats" active="stats">lifts</ProfileTabPanel>
        <ProfileTabPanel id="posts" active="stats">posts</ProfileTabPanel>
      </>
    );
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
    expect(screen.getByText('lifts')).toBeTruthy();
    expect(screen.queryByText('posts')).toBeNull();
  });

  it('moves between tabs with the arrow keys', () => {
    const onChange = vi.fn();
    render(<ProfileTabs tabs={TABS} active="stats" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('trophies');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('posts'); // wraps
  });
});
