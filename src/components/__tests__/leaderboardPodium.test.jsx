import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...p }) => {
      // Strip motion-only props so React doesn't warn about unknown attributes.
      const { initial, animate, exit, transition, whileTap, whileHover, layout, ...rest } = p;
      return React.createElement('div', rest, children);
    },
  }),
}));

const { default: LeaderboardPodium } = await import('../leaderboard/LeaderboardPodium');

const row = (rank, name, display = `${rank}00 XP`) => ({
  id: `u${rank}`, rank, full_name: name, _display: display,
});

describe('LeaderboardPodium', () => {
  it('renders nothing when there are no rankings', () => {
    const { container } = render(<LeaderboardPodium rankings={[]} />);
    expect(container.firstChild).toBeNull();
  });

  // The whole point of a podium is that first place sits centre and tallest.
  // Rendering in rank order would put it on the left like any other list.
  it('orders the three as silver, gold, bronze so first place is centre', () => {
    render(<LeaderboardPodium rankings={[row(1, 'Ann'), row(2, 'Bob'), row(3, 'Cy')]} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAccessibleName(/Rank 2: Bob/);
    expect(items[1]).toHaveAccessibleName(/Rank 1: Ann/);
    expect(items[2]).toHaveAccessibleName(/Rank 3: Cy/);
  });

  it('ignores anything past the top three', () => {
    render(<LeaderboardPodium rankings={[row(1,'A'), row(2,'B'), row(3,'C'), row(4,'D')]} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText('D')).toBeNull();
  });

  // A board with only one or two ranked athletes must still render rather
  // than collapsing — early boards look exactly like this.
  it('renders a partial podium', () => {
    render(<LeaderboardPodium rankings={[row(1, 'Solo')]} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAccessibleName(/Rank 1: Solo/);
  });

  it('falls back to initials when there is no avatar', () => {
    render(<LeaderboardPodium rankings={[row(1, 'Sean Joudrie')]} />);
    expect(screen.getByText('SJ')).toBeInTheDocument();
  });

  it('uses the first two characters when there is only one name part', () => {
    render(<LeaderboardPodium rankings={[row(1, 'kegan')]} />);
    expect(screen.getByText('KE')).toBeInTheDocument();
  });

  it('survives a missing name without throwing', () => {
    render(<LeaderboardPodium rankings={[{ id: 'x', rank: 1, full_name: null, _display: '0 XP' }]} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('renders an avatar when one is present', () => {
    render(<LeaderboardPodium rankings={[{ ...row(1, 'Ann'), avatar_url: 'https://x/a.png' }]} />);
    expect(document.querySelector('img[src="https://x/a.png"]')).not.toBeNull();
  });
});
