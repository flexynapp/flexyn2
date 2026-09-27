// With no sleep and no mood logged, every readiness input sits on its
// neutral default and the score comes out at 70 for everyone, a brand new
// account included. The card must not present that as a measurement.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let readiness;
vi.mock('@/hooks/useReadiness', () => ({ useReadiness: () => readiness }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/lib/LanguageContext', () => ({ useLanguage: () => ({ tFallback: (_k, en) => en }) }));
vi.mock('@/hooks/useCountUp', () => ({ default: (v) => v }));

import ReadinessCard from '../ReadinessCard';

const signals = (sleep, soreness, recency) => ({
  sleep: { logged: sleep }, soreness: { logged: soreness }, recency: { logged: recency },
});

describe('ReadinessCard', () => {
  beforeEach(() => { readiness = { score: 70, label: 'Ready', breakdown: signals(false, false, false) }; });

  it('shows no score when nothing that drives it is logged', () => {
    render(<ReadinessCard />);
    expect(screen.queryByText('70')).toBeNull();
    expect(screen.getByText('Not scored')).toBeTruthy();
    expect(screen.getByText("Log last night's sleep to get a score.")).toBeTruthy();
  });

  it('a workout alone is not enough: recency is 15% of the score', () => {
    readiness.breakdown = signals(false, false, true);
    render(<ReadinessCard compact />);
    expect(screen.queryByText('70')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('scores once sleep is logged', () => {
    readiness = { score: 84, label: 'Primed', breakdown: signals(true, false, true) };
    render(<ReadinessCard />);
    expect(screen.getByText('84')).toBeTruthy();
    expect(screen.getByText('Primed')).toBeTruthy();
  });
});
