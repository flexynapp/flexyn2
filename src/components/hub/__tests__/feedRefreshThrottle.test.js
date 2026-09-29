/**
 * The global feed refreshes on a gesture, at most once a minute.
 *
 * Two separate properties, and they are easy to confuse:
 *
 *   1. Posts never arrive on their own. This was ALREADY true — a realtime
 *      INSERT only increments a counter behind a "N new posts" pill, and rows
 *      are never spliced into the list under a reader mid-scroll. The scan
 *      below pins it, because the tempting "improvement" is to have realtime
 *      push straight into the query cache.
 *
 *   2. The two refresh GESTURES are throttled. Scroll-to-top fires while
 *      simply reading, and the tab sits under your thumb, so before the floor
 *      the feed could be made to refetch as fast as a finger moves. The pill
 *      is deliberately NOT throttled: it only exists when a post has actually
 *      arrived, so it cannot be spammed, and refusing to load posts the app
 *      has already announced would read as a bug.
 *
 * This is a source scan because the alternative is mounting HubFeed with its
 * realtime channel, follow graph, IntersectionObserver pagination and six
 * queries — a lot of mock surface for a rule that is three lines of logic.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(process.cwd(), 'src/components/hub/HubFeed.jsx'), 'utf8');

describe('global feed refresh policy', () => {
  it('has a 60s floor between gesture-driven refreshes', () => {
    expect(SRC).toMatch(/REFRESH_FLOOR_MS\s*=\s*60_?000/);
  });

  it('routes both gestures through the throttle, not straight to refetch', () => {
    // The scroll-to-top handler and the active-tab-retap listener must both
    // call requestRefresh(). A direct refetchRef.current() in either one
    // bypasses the floor entirely.
    const scrollHandler = SRC.slice(
      SRC.indexOf('const handleScroll'),
      SRC.indexOf('window.addEventListener(\'scroll\''),
    );
    expect(scrollHandler).toMatch(/requestRefresh\(\)/);
    expect(scrollHandler).not.toMatch(/refetchRef\.current\(\)/);

    const retapHandler = SRC.slice(
      SRC.indexOf('const onRetap'),
      SRC.indexOf('flexyn:active-tab-retap\', onRetap'),
    );
    expect(retapHandler).toMatch(/requestRefresh\(\)/);
    expect(retapHandler).not.toMatch(/refetchRef\.current\(\)/);
  });

  it('the throttle records the timestamp before refetching', () => {
    // If the ref is written after the await/refetch, two taps in the same
    // tick both pass the check and the floor does nothing.
    const fn = SRC.slice(
      SRC.indexOf('const requestRefresh'),
      SRC.indexOf('useEffect(() => {\n    let prevY'),
    );
    const stampAt = fn.indexOf('lastRefreshRef.current = now');
    const refetchAt = fn.indexOf('refetchRef.current()');
    expect(stampAt).toBeGreaterThan(-1);
    expect(refetchAt).toBeGreaterThan(-1);
    expect(stampAt).toBeLessThan(refetchAt);
  });

  it('does not poll the feed on an interval', () => {
    // A refetchInterval on the feed query would make posts arrive on their
    // own, which is the thing being ruled out. (The live-sessions rail has
    // its own interval and is a different query — scope the check to the
    // hubFeed query block.)
    const feedQuery = SRC.slice(
      SRC.indexOf("queryKey: ['hubFeed'"),
      SRC.indexOf('Older-than-cursor pagination'),
    );
    expect(feedQuery).not.toMatch(/refetchInterval/);
  });

  it('realtime increments a counter rather than inserting rows', () => {
    const handler = SRC.slice(
      SRC.indexOf('return onHubPostInsert('),
      SRC.indexOf('}, [user?.id]);'),
    );
    expect(handler).toMatch(/setPendingNewCount\(c => c \+ 1\)/);
    // No cache surgery: these would put a post on screen without a tap.
    expect(handler).not.toMatch(/setQueryData/);
    expect(handler).not.toMatch(/invalidateQueries/);
  });
});

/**
 * "The page refreshed by itself" — Sean, 12 Aug.
 *
 * Not the gesture throttle above. The app-wide QueryClient leaves
 * refetchOnWindowFocus at Tanstack's default of TRUE (deliberately — see
 * src/lib/query-client.js, where a Dashboard left open over dinner showing
 * hour-old counts is the case it exists for). Combined with a 30s staleTime,
 * leaving the tab and returning refetched the feed and moved the list under a
 * reader who had touched nothing.
 *
 * A feed is the one surface where that default is wrong: it is a reading
 * position. Scoped off here rather than globally, because turning it off
 * app-wide would silently revert a decision made for a different screen.
 */
describe('the feed does not refetch on window focus', () => {
  it('opts out explicitly on the hubFeed query', () => {
    const feedQuery = SRC.slice(
      SRC.indexOf("queryKey: ['hubFeed'"),
      SRC.indexOf('Preload the sibling feed tab'),
    );
    expect(feedQuery).toMatch(/refetchOnWindowFocus:\s*false/);
  });

  it('does so locally, leaving the global default alone', () => {
    // Code lines only: that file's comment RECOUNTS a previous explicit
    // `refetchOnWindowFocus: false` and why it was removed, and a scan that
    // cannot tell code from commentary would force the history out.
    const client = readFileSync(resolve(process.cwd(), 'src/lib/query-client.js'), 'utf8')
      .split('\n')
      .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    // If this ever appears globally, every other surface silently loses the
    // catch-up-after-backgrounding behaviour it was given on purpose.
    expect(client).not.toMatch(/refetchOnWindowFocus:\s*false/);
  });
});
