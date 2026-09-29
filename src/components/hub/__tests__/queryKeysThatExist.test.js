/**
 * Five invalidations aimed at query keys nothing was registered under.
 *
 * react-query's invalidateQueries is silent about a key that matches no query.
 * It does not warn, it does not throw, it returns a resolved promise. So a
 * mistyped or renamed key is a no-op that reads exactly like working code —
 * and in three of these five, the comment sitting directly above the call
 * described the bug it was supposed to have fixed as already fixed.
 *
 *   ActivityFeed  ['unreadNotificationCount', …]  registered by nothing at all.
 *                 The two calls were the ONLY mention of that string in the
 *                 repo. Tapping Activity did not clear the bell badge.
 *   StoryViewer   ['storyViewedIds', …]           registered by nothing. Seen
 *                 state lives in ['storiesFeed', …], so a story you had just
 *                 watched kept its orange unseen ring.
 *   StoriesRow    invalidated ['hubFollowing'] while its own list is
 *                 ['hubFollowingIds', …]. Element-wise matching, not string
 *                 prefixes, so the two never met.
 *   HubProfile    invalidated ['hubFollowing', <email>] while its own lists are
 *                 keyed by <uuid>. Your own following count did not move.
 *   HubFeed       keyed the feed on `following.length`. Unfollow one person and
 *                 follow another and the key is unchanged, so the stale rows
 *                 are served.
 *
 * The first test is the general one and the reason this file is worth having:
 * every key an invalidation names must be a key some query registers. It is
 * scoped to the Hub surface rather than the whole app, because ~20 other
 * invalidations elsewhere have not been audited and widening it later is the
 * intended direction.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOTS = [
  'src/components/hub',
  'src/components/stories',
  'src/components/crews',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') walk(p, out);
    } else if (/\.jsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

// Every .js/.jsx in the app, so a key REGISTERED anywhere counts as real.
const ALL = walk(resolve(process.cwd(), 'src'));
const SURFACE = ROOTS.flatMap((r) => walk(resolve(process.cwd(), r)));
const src = (p) => readFileSync(p, 'utf8');

// A key is REGISTERED only where a cache entry is established. Harvesting
// every `queryKey:` would count the invalidations themselves, so each dead key
// would vouch for itself and the scan below could never fail — which is how it
// was first written here, and it passed against all five live bugs.
const CACHE_WRITER = /(?:invalidate|cancel|remove|refetch)Queries\s*\(\s*\{[\s\S]*?\}\s*\)/g;
const registered = new Set();
for (const f of ALL) {
  const withoutInvalidations = src(f).replace(CACHE_WRITER, '');
  for (const m of withoutInvalidations.matchAll(/queryKey:\s*\[\s*'([^']+)'/g)) registered.add(m[1]);
}

describe('every invalidated key is a key something registers', () => {
  it('holds across the Hub, stories and crews surfaces', () => {
    const dead = [];
    for (const f of SURFACE) {
      const text = src(f);
      for (const m of text.matchAll(/invalidateQueries\(\{\s*queryKey:\s*\[\s*'([^']+)'/g)) {
        if (!registered.has(m[1])) {
          const line = text.slice(0, m.index).split('\n').length;
          dead.push(`${f.replace(process.cwd() + '/', '')}:${line}  '${m[1]}'`);
        }
      }
    }
    expect(dead, 'these invalidations name a key no query registers, so they do nothing').toEqual([]);
  });

  it('would actually catch a dead key', () => {
    // The scan is only worth anything if an invalidation of something nobody
    // registers is NOT in `registered`. Written the obvious way it was: the
    // harvest matched `queryKey:` inside invalidateQueries too, so every dead
    // key registered itself and the check was decorative.
    expect(registered.has('unreadNotificationCount'), 'a removed key must not count as registered').toBe(false);
    expect(registered.has('storyViewedIds')).toBe(false);
    expect(registered.has('notificationsUnread'), 'a real one still must').toBe(true);
    expect(registered.has('storiesFeed')).toBe(true);
  });

  it('finds keys at all, so the scan cannot pass by matching nothing', () => {
    // The check above is vacuously true if the regex stops matching. Both
    // sides have to be non-empty for it to mean anything.
    expect(registered.size).toBeGreaterThan(30);
    const invalidations = SURFACE.reduce(
      (n, f) => n + [...src(f).matchAll(/invalidateQueries\(\{\s*queryKey:\s*\[\s*'([^']+)'/g)].length, 0);
    expect(invalidations).toBeGreaterThan(20);
  });
});

describe('the specific five', () => {
  const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
  // Comment lines stripped before scanning for a dead key name: each fix's
  // comment quotes the key it replaced, and the file explaining a defect
  // should not be what re-triggers the check for it.
  const code = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it('ActivityFeed clears the bell the bell actually reads', () => {
    const f = read('src/components/hub/ActivityFeed.jsx');
    expect(f).toMatch(/queryKey: \['notificationsUnread', user\?\.id\]/);
    expect(f).toMatch(/queryKey: \['notificationsList', user\?\.id\]/);
    expect(code('src/components/hub/ActivityFeed.jsx')).not.toMatch(/unreadNotificationCount/);
  });

  it('StoryViewer refreshes the tray that holds seen-state', () => {
    const f = read('src/components/stories/StoryViewer.jsx');
    expect(code('src/components/stories/StoryViewer.jsx')).not.toMatch(/storyViewedIds/);
    expect(f).toMatch(/markStoryViewed[\s\S]{0,600}?queryKey: \['storiesFeed'\]/);
  });

  it('StoriesRow invalidates its own id-keyed follow list', () => {
    expect(read('src/components/stories/StoriesRow.jsx'))
      .toMatch(/queryKey: \['hubFollowingIds', user\?\.id\]\s*\}\);/);
  });

  it('HubProfile invalidates every follow-graph key, whoever it is keyed on', () => {
    const f = read('src/components/hub/HubProfile.jsx');
    // Two follow mutations plus the block handler, each through the prefix
    // helper, which matches the id-keyed lists and the feeds alike.
    expect((f.match(/invalidateFollowGraph\(queryClient\)/g) || []).length).toBe(3);
    // No surface registers the email shape any more, so an email-keyed
    // invalidation would be a silent no-op.
    expect(f).not.toMatch(/queryKey: \['hubFollow(ing|ers)', user\?\.email\]/);
  });

  it('HubFeed keys on the follow set, not its size', () => {
    const f = read('src/components/hub/HubFeed.jsx');
    expect(f).toMatch(/const followingKey = useMemo\(\(\) => \[\.\.\.following\]\.sort\(\)\.join\('\|'\), \[following\]\)/);
    expect(f, 'the size is what made an unfollow-plus-follow invisible')
      .not.toMatch(/queryKey: \['hubFeed'[^\]]*following\.length/);
    // Query key, prefetch key and the older-page reset all have to agree.
    expect((f.match(/followingKey/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it('matches the fix a sibling hook already shipped for the same bug', () => {
    // useHubUnreadDot hit this and documented it. If that precedent changes
    // shape, HubFeed should be re-read rather than left diverged.
    expect(read('src/hooks/useHubUnreadDot.js'))
      .toMatch(/\[\.\.\.followingIds\]\.sort\(\)\.join\('\|'\)/);
  });
});
