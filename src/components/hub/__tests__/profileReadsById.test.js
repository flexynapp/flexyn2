/**
 * The profile page reads another person's follows, posts, stories, notes
 * and highlights by their user id, never by their email.
 *
 * Each of these used to filter on the target's email, which the page could
 * only get from resolve_profile_email: an RPC that returns any user's email
 * to any signed-in caller. That RPC is being retired, so a reader that
 * quietly goes back to an email key would render an empty profile the day it
 * is revoked, with nothing thrown.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

describe('profile reads are keyed by user id', () => {
  const profile = read('src/components/hub/HubProfile.jsx');

  it('stories and notes filter on user_id', () => {
    expect(profile).not.toMatch(/\.eq\('user_email', email\)/);
    expect(profile).toMatch(/from\('stories'\)[\s\S]{0,80}\.eq\('user_id', targetId\)/);
    expect(profile).toMatch(/from\('status_notes'\)[\s\S]{0,80}\.eq\('user_id', targetId\)/);
  });

  it('follow state and posts are asked for by id', () => {
    expect(profile).toMatch(/hubFollows\.isFollowing\(user\.id, targetId\)/);
    expect(profile).toMatch(/hubFollows\.isFollowing\(targetId, user\.id\)/);
    expect(profile).toMatch(/hubFollows\.getMutualFollowSince\(user\.id, targetId\)/);
    expect(profile).toMatch(/hubPosts\.listForProfile\(targetId,/);
    expect(profile).toMatch(/<StoryHighlightsRail\s+userId=\{targetId\}/);
  });

  it('the data layer filters on the id columns', () => {
    expect(read('src/lib/data/hubPosts.js')).toMatch(/filter\(\{ user_id: authorId \}/);
    expect(read('src/lib/data/storyHighlights.js')).toMatch(/\.eq\('user_id', userId\)/);
  });
});
