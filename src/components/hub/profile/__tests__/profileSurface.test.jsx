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

const LABELS = { posts: 'posts', followers: 'followers', following: 'following' };
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
        labels={LABELS}
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
        labels={LABELS}
        language="en"
      />
    );
    expect(screen.getAllByText('0')).toHaveLength(3);
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
        labels={LABELS}
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
  it('exposes the XP numbers that used to be a visible caption', () => {
    render(
      <ProfileTierBanner
        tier={TIER}
        level={54}
        levelLabel="Level 54"
        xpInLevel={1240}
        xpNeeded={2000}
        progressPercent={62}
        isAdminProfile={false}
      />
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('62');
    expect(bar.getAttribute('aria-label')).toContain('1240');
    expect(bar.getAttribute('aria-label')).toContain('2000');
    expect(screen.getByText('Ruby')).toBeTruthy();
    expect(screen.getByText('54')).toBeTruthy();
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
});

describe('ProfileTrophies', () => {
  const earned = [{ trophy_id: TROPHIES[0].id }, { trophy_id: TROPHIES[1].id }];

  it('renders a locked frame for every trophy not yet earned', () => {
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
    expect(screen.getByText(`2 / ${TROPHIES.length}`)).toBeTruthy();
    const locks = container.querySelectorAll('.opacity-25');
    expect(locks).toHaveLength(TROPHIES.length - 2);
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
    fireEvent.click(screen.getByLabelText(/Slot 1/));
    expect(onPickSlot).not.toHaveBeenCalled();

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
    fireEvent.click(screen.getByLabelText(/Slot 1/));
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
