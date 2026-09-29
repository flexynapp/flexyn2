// The quest completion cue is app-wide: a completion announced from any page
// lands in the feedback pill with a Claim button, and Claim pays through the
// same path as the Today card.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const claimQuestWithFeedback = vi.fn(async () => ({ success: true }));
vi.mock('@/lib/questClaim', () => ({
  claimQuestWithFeedback: (...a) => claimQuestWithFeedback(...a),
  questLabel: () => 'React to 3 posts',
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@x.com' } }) }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => (k === 'dashboard.claim' ? 'Claim' : k),
    tFallback: (_k, en, vars) => en.replace(/\{(\w+)\}/g, (_, n) => vars?.[n] ?? ''),
  }),
}));

const { default: QuestCompletionWatcher } = await import('../QuestCompletionWatcher');
const { announceQuestCompleted, _resetQuestCompletion } = await import('@/lib/questCompletion');
const store = await import('@/lib/feedbackStore');

function mount() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  render(<QueryClientProvider client={qc}><QuestCompletionWatcher /></QueryClientProvider>);
  return spy;
}

beforeEach(() => {
  _resetQuestCompletion();
  store._reset();
  claimQuestWithFeedback.mockClear();
});

describe('QuestCompletionWatcher', () => {
  it('shows the completion in the pill with a Claim button', () => {
    const invalidate = mount();
    act(() => { announceQuestCompleted({ id: 'r1', user_id: 'me', quest_id: 'react_3', completed_at: 'now' }); });
    const cur = store.getSnapshot().current;
    expect(cur.message).toBe('Quest complete: React to 3 posts');
    expect(cur.action.label).toBe('Claim');
    // Today's card, if it is mounted or cached, refreshes to its Claim state.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dailyQuests'] });
  });

  it('Claim pays through the shared claim path for that row', async () => {
    mount();
    const row = { id: 'r1', user_id: 'me', quest_id: 'react_3', completed_at: 'now' };
    act(() => { announceQuestCompleted(row); });
    await act(async () => { store.getSnapshot().current.action.onClick(); });
    expect(claimQuestWithFeedback).toHaveBeenCalledTimes(1);
    expect(claimQuestWithFeedback.mock.calls[0][0].row).toBe(row);
  });

  it('shows nothing for a row that belongs to someone else', () => {
    mount();
    act(() => { announceQuestCompleted({ id: 'r2', user_id: 'other', quest_id: 'x', completed_at: 'now' }); });
    expect(store.getSnapshot().current).toBeNull();
  });

  it('shows nothing for a row already claimed', () => {
    mount();
    act(() => { announceQuestCompleted({ id: 'r3', user_id: 'me', quest_id: 'x', completed_at: 'now', claimed_at: 'now' }); });
    expect(store.getSnapshot().current).toBeNull();
  });
});
