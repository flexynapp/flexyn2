/**
 * Every follower-activity banner ever shown read "Someone just posted".
 *
 * Two independent reads of columns that do not exist:
 *
 *   displayName() returned `post.author_username`. `hub_posts` has no such
 *   column — the name lives in `author_name` — so the `|| 'Someone'` fallback
 *   fired on every post.
 *
 *   summarize() switched on `snap?.kind || post?.kind`. There is no `kind`
 *   column either, and no writer has ever put a `kind` key into
 *   `linked_entity_snapshot` (0 of 28 rows in production carry one). `kind` is
 *   the COMPOSER's in-memory vocabulary, and it does not even match what gets
 *   persisted — the composer maps its own `goal` to `post_type =
 *   'goal_completed'` on the way in. So `kind` was always undefined, fell into
 *   the `!kind` branch, and produced "just posted" for a PR, a meal and a
 *   completed goal alike.
 *
 * Both reads returned undefined rather than throwing, which is why a feature
 * that never once worked looked like a feature nobody had posted into.
 *
 * These render the real component's helpers through the real card, so a
 * regression to any column name that does not exist fails here.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/hubPostsRealtime', () => ({ onHubPostInsert: () => () => {} }));
vi.mock('@/lib/data/hubFollows', () => ({ listFollowingIds: async () => [] }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));

import { __test__ } from '../FollowerActivityBanner';

const EN = JSON.parse(readFileSync(resolve(process.cwd(), 'src/locales/en.json'), 'utf8'));
const { summarize, displayName, SUMMARY_BY_TYPE } = __test__;

describe('who the banner says it is about', () => {
  it('reads author_name', () => {
    expect(displayName({ author_name: 'kegan' }, 'Someone')).toBe('kegan');
  });

  it('does not read author_username, which is not a column', () => {
    // The exact shape of a real row: author_name present, no author_username.
    // Before the fix this returned the fallback for every post that has ever
    // existed, because the property it asked for is not on hub_posts.
    expect(displayName({ author_name: 'kegan', author_username: undefined }, 'Someone')).toBe('kegan');
  });

  it('still falls back when there is genuinely no name', () => {
    expect(displayName({}, 'Someone')).toBe('Someone');
    expect(displayName({ author_name: '' }, 'Someone')).toBe('Someone');
  });
});

describe('what the banner says happened', () => {
  it('distinguishes the post types instead of calling them all a post', () => {
    // The whole defect in one assertion: these three used to be identical.
    const workout = summarize({ post_type: 'workout' });
    const meal    = summarize({ post_type: 'meal' });
    const goal    = summarize({ post_type: 'goal_completed' });
    expect(new Set([workout.key, meal.key, goal.key]).size).toBe(3);
    expect(workout.en).toBe('logged a workout');
    expect(goal.en).toBe('completed a goal');
  });

  it('covers every post_type the app writes', () => {
    // Sourced from HubComposer's postTypeMap plus the video/poll/repost
    // branches and shareAchievement. A type missing here silently degrades to
    // "posted", which is the failure this file exists about.
    for (const t of [
      'status', 'workout', 'cardio', 'meal', 'goal_completed', 'achievement',
      'regimen', 'progress_photo', 'stats', 'video', 'poll', 'repost',
    ]) {
      expect(SUMMARY_BY_TYPE[t], `no summary for post_type '${t}'`).toBeTruthy();
    }
  });

  it('falls back to the generic phrase for a type it has never seen', () => {
    expect(summarize({ post_type: 'something_new_in_2027' }).key).toBe('hub.activityBanner.status');
    expect(summarize({}).key).toBe('hub.activityBanner.status');
  });

  it('uses linked_entity_type only when post_type is absent', () => {
    expect(summarize({ linked_entity_type: 'cardio' }).key).toBe('hub.activityBanner.cardio');
    // post_type wins — it is set on every row, linked_entity_type is null on
    // status, repost and poll.
    expect(summarize({ post_type: 'meal', linked_entity_type: 'cardio' }).key)
      .toBe('hub.activityBanner.meal');
  });

  it('ignores a `kind` that no row has ever carried', () => {
    // Guards the actual regression: reinstating the snapshot read would make
    // this return the goal summary for a row whose post_type says meal.
    expect(summarize({ post_type: 'meal', kind: 'goal', linked_entity_snapshot: { kind: 'goal' } }).key)
      .toBe('hub.activityBanner.meal');
  });
});

describe('the copy is in the catalog', () => {
  it('every fallback English matches en.json exactly', () => {
    // The repo-wide guard in i18nCoverage only inspects LITERAL tFallback
    // arguments, and these are passed from a table — so without this test the
    // table's English could drift from the catalog unnoticed.
    for (const { key, en } of Object.values(SUMMARY_BY_TYPE)) {
      expect(EN[key], `${key} missing from en.json`).toBeDefined();
      expect(EN[key], `${key} disagrees with the call site`).toBe(en);
    }
    expect(EN['hub.activityBanner.someone']).toBe('Someone');
  });

  it('is translated in every released locale', () => {
    const keys = [...Object.values(SUMMARY_BY_TYPE).map((s) => s.key), 'hub.activityBanner.someone'];
    for (const loc of ['es', 'fr', 'de', 'it', 'nl', 'pl', 'pt']) {
      const cat = JSON.parse(readFileSync(resolve(process.cwd(), `src/locales/${loc}.json`), 'utf8'));
      for (const k of keys) {
        expect(cat[k], `${loc} is missing ${k}`).toBeTruthy();
        expect(cat[k], `${loc}:${k} was left in English`).not.toBe(EN[k]);
      }
    }
  });
});
