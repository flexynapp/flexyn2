// A share card whose post has no stored snapshot re-reads the shared row by
// id, for its author only. That read used to go through db.entities[name],
// where 'Workout' was never a valid name, so a workout card's fallback always
// came back empty. It now calls each table's data module.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const gets = {
  workout: vi.fn(), cardio: vi.fn(), meal: vi.fn(), goal: vi.fn(), regimen: vi.fn(),
};
let currentUser = { id: 'u1', email: 'me@x.co' };

vi.mock('@/lib/data/workouts', () => ({ get: (...a) => gets.workout(...a) }));
vi.mock('@/lib/data/cardio', () => ({ get: (...a) => gets.cardio(...a) }));
vi.mock('@/lib/data/nutrition', () => ({ get: (...a) => gets.meal(...a) }));
vi.mock('@/lib/data/goals', () => ({ get: (...a) => gets.goal(...a) }));
vi.mock('@/lib/data/regimens', () => ({ get: (...a) => gets.regimen(...a), list: vi.fn(async () => []), create: vi.fn() }));
vi.mock('@/lib/intl', () => ({
  useDateFormatter: () => (d) => String(d),
  useNumberFormatter: () => (n) => String(n),
}));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, tFallback: (_k, fb) => fb, language: 'en' }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: currentUser }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => 'mi' }));
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => 'lbs' }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PostActivityBlock = (await import('@/components/hub/PostActivityBlock')).default;

const show = (post) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PostActivityBlock post={post} />
  </QueryClientProvider>,
);

const post = (type, extra = {}) => ({
  id: 'p1',
  post_type: type,
  linked_entity_type: type,
  linked_entity_id: 'row1',
  linked_entity_snapshot: null,
  author_email: 'me@x.co',
  ...extra,
});

beforeEach(() => {
  currentUser = { id: 'u1', email: 'me@x.co' };
  for (const fn of Object.values(gets)) { fn.mockReset(); fn.mockResolvedValue(null); }
});

describe('share card fallback read', () => {
  it.each([
    ['workout', 'workout'],
    ['cardio', 'cardio'],
    ['meal', 'meal'],
    ['goal', 'goal'],
    ['goal_completed', 'goal'],
    ['regimen', 'regimen'],
  ])('a %s post reads its row by id through the data module', async (type, key) => {
    show(post(type));
    await waitFor(() => expect(gets[key]).toHaveBeenCalledWith('row1'));
    for (const [k, fn] of Object.entries(gets)) if (k !== key) expect(fn).not.toHaveBeenCalled();
  });

  it('renders the workout it read back', async () => {
    gets.workout.mockResolvedValue({ regimen_name: 'Push Day', date: '2026-09-01', exercises: [] });
    show(post('workout'));
    expect(await screen.findByText('Push Day')).toBeTruthy();
  });

  it('reads nothing for an achievement, which has no table', async () => {
    show(post('achievement'));
    await new Promise((r) => setTimeout(r, 20));
    for (const fn of Object.values(gets)) expect(fn).not.toHaveBeenCalled();
  });

  it('reads nothing for someone who is not the author', async () => {
    currentUser = { id: 'u2', email: 'other@x.co' };
    show(post('workout'));
    await new Promise((r) => setTimeout(r, 20));
    expect(gets.workout).not.toHaveBeenCalled();
  });

  it('reads nothing when the post already carries a snapshot', async () => {
    show(post('workout', { linked_entity_snapshot: { regimen_name: 'Stored', exercises: [] } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(gets.workout).not.toHaveBeenCalled();
  });
});
