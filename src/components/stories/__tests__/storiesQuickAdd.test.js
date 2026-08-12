/**
 * Quick Add in the stories rail: friends-of-friends only, at most 5, last.
 *
 * Sean, 12 Aug: "quick add should only ever offer you people that are a friend
 * of a friend. Absolutely no randoms. And from there it should only show no
 * more than five."
 *
 * `getRecommendations` deliberately mixed RECENT SIGNUPS into half the slots,
 * and that behaviour exists for a reason worth keeping elsewhere: a brand new
 * account is in nobody's network, so without it new users are invisible to
 * every established user ("we've had like 10 new users and none of them shown
 * up"). Hence an OPTION rather than a rewrite — flipping it globally would
 * quietly re-create that problem on whatever surface adopts it next.
 *
 * The cap is asserted in TWO places on purpose. Capping only the fetch leaves
 * a cached list, written before the cap existed, still painting twelve items
 * on the next app open — and a stale cache is exactly the kind of thing that
 * makes a fix look like it didn't work.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ROW    = read('src/components/stories/StoriesRow.jsx');
const FOLLOWS = read('src/lib/data/hubFollows.js');

describe('friend-of-friend only', () => {
  it('the rail asks for fofOnly', () => {
    expect(ROW).toMatch(/getRecommendations\([^)]*fofOnly:\s*true/s);
  });

  it('fofOnly zeroes the recent-signups slots', () => {
    expect(FOLLOWS).toMatch(/recentSlots\s*=\s*fofOnly\s*\?\s*0\s*:/);
  });

  it('is an option, so other surfaces keep the recent-signup behaviour', () => {
    // Default false. If this ever defaults true, new accounts silently stop
    // reaching established users everywhere.
    expect(FOLLOWS).toMatch(/fofOnly\s*=\s*false/);
  });

  it('skips the recent query entirely rather than running limit(0)', () => {
    expect(FOLLOWS).toMatch(/recentSlots === 0/);
  });
});

describe('the cap of 5', () => {
  it('is applied at fetch', () => {
    expect(ROW).toMatch(/getRecommendations\(user\.id, followingIds, 5/);
  });

  it('is applied again at render, so a stale cache cannot exceed it', () => {
    expect(ROW).toMatch(/visibleQaList\s*=[^;]*\.slice\(0,\s*5\)/s);
  });
});

describe('the Add Story control', () => {
  it('is restored, with a dashed ring', () => {
    expect(ROW).toMatch(/strokeDasharray/);
    expect(ROW).toMatch(/stories\.add/);
  });

  it('rotates, but only for users who have not asked it not to', () => {
    // "Animating forever" was the stated objection to the original. Honouring
    // prefers-reduced-motion is what makes restoring it defensible.
    expect(ROW).toMatch(/motion-safe:animate-\[spin_24s_linear_infinite\]/);
  });

  it('is unconditional — no `noStory` gate', () => {
    // The badge it replaces was gated on having no story, so it disappeared
    // the moment you posted and left no way to add a second one.
    const btn = ROW.slice(ROW.indexOf('stories.add') - 1200, ROW.indexOf('stories.add'));
    expect(btn).not.toMatch(/noStory/);
  });

  it('drives the same file input as the old path — one upload flow', () => {
    expect(ROW).toMatch(/const openStoryPicker = useCallback\(\(\) => \{\s*fileRef\.current\?\.click\(\)/s);
  });

  it('does not leave the duplicate own-avatar badge behind', () => {
    // Two controls for one action is what got the slot removed originally.
    expect(ROW).not.toMatch(/group\.isOwn && noStory && !isUploading && \(/);
  });
});
