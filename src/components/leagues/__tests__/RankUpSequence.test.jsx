import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});
vi.mock('@/lib/haptic', () => ({ triggerHaptic: vi.fn() }));

import RankUpSequence from '@/components/leagues/RankUpSequence';

const tier = { kind: 'tier', from: { tier: 'silver', level: 4 }, to: { tier: 'gold', level: 1 } };
// Each beat schedules the next after React renders, so step the clock
// one beat at a time.
const step = (...ms) => ms.forEach((m) => act(() => { vi.advanceTimersByTime(m); }));

const level = { kind: 'level', from: { tier: 'gold', level: 2 }, to: { tier: 'gold', level: 3 } };

describe('RankUpSequence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('strains on the old league first, then lands on the new one', () => {
    render(<RankUpSequence move={tier} strength={{ score: 262, next_tier: 'platinum', next_floor: 325 }} onClose={() => {}} />);
    expect(screen.getByText(/Silver League IV/)).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    step(450, 1700, 200);
    expect(screen.getByRole('heading', { name: 'Gold League' })).toBeInTheDocument();
    expect(screen.getByText('Promoted')).toBeInTheDocument();
    // The road ahead: the next league and how far the score is from it.
    expect(screen.getByText(/Next: Platinum League/)).toBeInTheDocument();
    expect(screen.getByText(/262 of 325/)).toBeInTheDocument();
  });

  it('a tap mid-strain goes straight to the landing', () => {
    render(<RankUpSequence move={tier} onClose={() => {}} />);
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('heading', { name: 'Gold League' })).toBeInTheDocument();
  });

  it('a level step names the level and skips the break', () => {
    render(<RankUpSequence move={level} onClose={() => {}} />);
    step(450, 900, 10);
    expect(screen.getByRole('heading', { name: 'Gold League III' })).toBeInTheDocument();
    expect(screen.getByText('New level')).toBeInTheDocument();
  });

  it('a demotion is quiet and ends on the way back', () => {
    const down = { kind: 'down', from: { tier: 'gold', level: 3 }, to: { tier: 'silver', level: 1 } };
    render(<RankUpSequence move={down} strength={{ score: 220, next_tier: 'gold', next_floor: 250 }} onClose={() => {}} />);
    step(450, 1800, 10);
    expect(screen.getByRole('heading', { name: 'Silver League' })).toBeInTheDocument();
    expect(screen.getByText('Moved down')).toBeInTheDocument();
    expect(screen.getByText(/Down from Gold League III/)).toBeInTheDocument();
    expect(screen.getByText(/Back to Gold League/)).toBeInTheDocument();
    expect(screen.getByText(/220 of 250/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Win it back' })).toBeInTheDocument();
  });

  it('the top league says so instead of a next target', () => {
    const top = { kind: 'tier', from: { tier: 'diamond', level: 2 }, to: { tier: 'legend', level: 1 } };
    render(<RankUpSequence move={top} strength={{ score: 500 }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByText(/top league/)).toBeInTheDocument();
  });

  it('closes from the button and views the league from the second one', () => {
    const onClose = vi.fn();
    const onViewLeague = vi.fn();
    render(<RankUpSequence move={tier} onClose={onClose} onViewLeague={onViewLeague} />);
    fireEvent.click(screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: 'View standings' }));
    expect(onClose).toHaveBeenCalled();
    expect(onViewLeague).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep climbing' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
