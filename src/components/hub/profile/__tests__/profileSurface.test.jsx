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
import ProfileActions from '../ProfileActions';
import ProfileTrophies from '../ProfileTrophies';
import ProfileScoreboard from '../ProfileScoreboard';
import ProfileSummaryList, { SummaryRow } from '../ProfileSummaryList';
import { prCounts } from '../ProfileRecentWorkouts';
import { Trophy } from 'lucide-react';
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

describe('ProfileScoreboard', () => {
  it('drops a cell with nothing behind it instead of drawing a zero', () => {
    render(
      <ProfileScoreboard
        cells={[
          { id: 'level', value: 'Lv. 3', label: 'Bronze' },
          false,
          { id: 'trophies', value: '18', label: 'trophies' },
        ]}
      />
    );
    expect(screen.getByText('Lv. 3')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.queryByText('day streak')).toBeNull();
  });

  it('renders nothing at all when every cell is empty', () => {
    const { container } = render(<ProfileScoreboard cells={[false, null]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ProfileSummaryList', () => {
  it('makes a row a button only when it goes somewhere', () => {
    const onClick = vi.fn();
    render(
      <ProfileSummaryList>
        <SummaryRow icon={Trophy} label="Trophies" value="18" onClick={onClick} />
        <SummaryRow icon={Trophy} label="Static" />
      </ProfileSummaryList>
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('prCounts', () => {
  const log = (date, weight) => ({ date, exercises: [{ name: 'Bench', sets: [{ weight, reps: 5 }] }] });

  it('counts a lift only when it beats an EARLIER session, never the first attempt', () => {
    const first = log('2026-09-01', 135);
    const heavier = log('2026-09-08', 155);
    const lighter = log('2026-09-15', 145);
    // Newest first, the order the page receives them in.
    const counts = prCounts([lighter, heavier, first]);
    expect(counts.get(first)).toBe(0);
    expect(counts.get(heavier)).toBe(1);
    expect(counts.get(lighter)).toBe(0);
  });
});
