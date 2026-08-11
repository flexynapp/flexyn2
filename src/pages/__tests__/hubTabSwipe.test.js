/**
 * The Hub feed-tab swipe, and the rules it has to obey.
 *
 * A swipe handler is four judgement calls that are all easy to get backwards,
 * and all four are invisible in a screenshot:
 *
 *   1. Which direction advances. Dragging LEFT moves you to the tab on the
 *      right, because the content follows your thumb. Getting this inverted
 *      still "works" and feels wrong in a way testers describe as "laggy".
 *   2. RTL. The strip is laid out with logical properties, so in Arabic the
 *      visually-first tab is on the right. The gesture has to flip with it or
 *      it drives the strip backwards for those users.
 *   3. Vertical rejection. The feed scrolls in Y. A drag that is mostly
 *      vertical must not steal the scroll.
 *   4. The ends. Swiping past the first or last tab must do nothing rather
 *      than wrap, because wrapping makes the strip's position meaningless.
 *
 * The resolver below is the same logic the component runs, extracted so it can
 * be checked without mounting Hub (six providers, a realtime channel and a
 * router). It is exported from the page module so there is one implementation
 * rather than a copy that can drift.
 */
import { describe, it, expect } from 'vitest';
import { SWIPE_TABS, resolveSwipeTarget } from '@/pages/Hub';

const drag = (x, y = 0, vx = 0) => ({ offset: { x, y }, velocity: { x: vx, y: 0 } });

describe('swipe direction', () => {
  it('dragging left advances to the next tab', () => {
    expect(resolveSwipeTarget('pump', drag(-100), false)).toBe('squad');
    expect(resolveSwipeTarget('squad', drag(-100), false)).toBe('crews');
  });

  it('dragging right goes back', () => {
    expect(resolveSwipeTarget('crews', drag(100), false)).toBe('squad');
    expect(resolveSwipeTarget('squad', drag(100), false)).toBe('pump');
  });

  it('mirrors in RTL so the gesture matches the strip', () => {
    expect(resolveSwipeTarget('pump', drag(100), true)).toBe('squad');
    expect(resolveSwipeTarget('squad', drag(-100), true)).toBe('pump');
  });
});

describe('what does NOT count as a swipe', () => {
  it('ignores a short, slow drag', () => {
    expect(resolveSwipeTarget('pump', drag(-30, 0, 50), false)).toBe(null);
  });

  it('accepts a short but FAST flick', () => {
    // Requiring distance alone makes flicking feel broken.
    expect(resolveSwipeTarget('pump', drag(-30, 0, 900), false)).toBe('squad');
  });

  it('ignores a mostly-vertical drag so the feed can scroll', () => {
    expect(resolveSwipeTarget('pump', drag(-80, 200), false)).toBe(null);
  });
});

describe('the ends of the strip', () => {
  it('does not wrap off the first tab', () => {
    expect(resolveSwipeTarget('pump', drag(150), false)).toBe(null);
  });

  it('does not wrap off the last tab', () => {
    expect(resolveSwipeTarget('crews', drag(-150), false)).toBe(null);
  });

  it('returns null for a tab that is not on the strip', () => {
    // 'activity' is reached from the header. A swipe must not strand someone
    // there or fling them out of it.
    expect(resolveSwipeTarget('activity', drag(-150), false)).toBe(null);
    expect(SWIPE_TABS).not.toContain('activity');
  });
});

describe('the strip itself', () => {
  it('is the three feed tabs in visual order', () => {
    expect(SWIPE_TABS).toEqual(['pump', 'squad', 'crews']);
  });
});
