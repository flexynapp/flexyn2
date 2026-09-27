// The Today crew-war card read `score_a` / `score_b`, columns crew_wars does
// not have (they are crew_a_score / crew_b_score), so every running war read
// "Tied at 0". This feeds the component a row in the REAL column shape, the
// one production returns from select('*'), so the same slip fails here.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, en, vars = {}) => en.replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? `{${n}}`),
  }),
}));
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));
vi.mock('@/lib/data/crews', () => ({ getMyCrews: vi.fn(async () => [{ id: 'crewB' }]) }));
vi.mock('@/lib/data/crewWars', () => ({
  getActiveWarForCrew: vi.fn(async () => ({
    id: 'w1', crew_a_id: 'crewA', crew_b_id: 'crewB', crew_a_score: 300, crew_b_score: 1200,
  })),
}));

import CrewWarGlance from '../CrewWarGlance';

describe('CrewWarGlance', () => {
  it('reads the real score columns and orients them to the viewer\'s crew', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><CrewWarGlance /></QueryClientProvider>);
    // The viewer is crew B, so crew_b_score is "mine".
    expect(await screen.findByText('You lead 1200 to 300')).toBeTruthy();
  });
});
