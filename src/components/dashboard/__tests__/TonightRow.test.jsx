// The Recovery card: readiness heads it, sleep / mood / steps sit under it,
// and a missing value offers "Log" rather than a blank.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let stepLog = null;
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: stepLog }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/lib/LanguageContext', () => ({ useLanguage: () => ({ tFallback: (_k, en) => en }) }));
vi.mock('@/hooks/useCountUp', () => ({ default: (v) => v }));
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));
vi.mock('@/lib/data/stepLogs', () => ({ getTodayStepLog: vi.fn() }));
vi.mock('@/lib/data/moodLogs', () => ({ MOOD_LABELS: ['Awful', 'Bad', 'Okay', 'Good', 'Great'] }));

import TonightRow from '../TonightRow';

const signals = (sleep, soreness) => ({ sleep: { logged: sleep }, soreness: { logged: soreness } });

describe('TonightRow (Recovery)', () => {
  it('shows the score once sleep is logged, and Log for what is missing', () => {
    stepLog = null;
    const onOpen = vi.fn();
    render(<TonightRow
      readiness={{ score: 84, label: 'Primed', breakdown: signals(true, false), sleep: { hours: 7.5 }, mood: null }}
      onOpen={onOpen}
    />);
    expect(screen.getByText('84')).toBeTruthy();
    expect(screen.getByText('Primed')).toBeTruthy();
    expect(screen.getAllByText('Log')).toHaveLength(2); // mood and steps
    fireEvent.click(screen.getByText('Primed'));
    expect(onOpen).toHaveBeenCalledWith();
  });

  it('does not present the neutral default as a score', () => {
    stepLog = { steps: 4000 };
    render(<TonightRow
      readiness={{ score: 70, label: 'Ready', breakdown: signals(false, false), sleep: null, mood: null }}
      onOpen={() => {}}
    />);
    expect(screen.queryByText('70')).toBeNull();
    expect(screen.getByText('Not scored')).toBeTruthy();
  });
});
