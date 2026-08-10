// Guards the single type→category catalog that replaced the two divergent
// maps in NotificationPanel.jsx and pages/Notifications.jsx.
//
// The bug this exists to stop recurring: `coin_gift` was in NEITHER list, so
// six live production rows reported "Unmapped notification types" to Sentry
// on every panel open AND fell into the page's catch-all "system" tab. The
// drift was invisible because both failure modes are silent — a Sentry
// breadcrumb nobody reads, and a row that renders fine in the wrong bucket.

import { describe, it, expect } from 'vitest';
import {
  CATEGORY, CATEGORY_HUE, FILTERS, KNOWN_TYPES,
  categoryFor, hueFor, isKnownType, matchesFilter,
} from '@/lib/notificationCatalog';

// Every type this app has been observed to insert, from a production
// `select distinct type from notifications` on 2026-08-10 plus the types the
// data layer and the cron migrations can write. A type appearing here and
// failing `isKnownType` is exactly the defect above.
const TYPES_IN_PRODUCTION = [
  'quest_expiry_warning', 'welcome_back', 'streak_milestone', 'friend_post',
  'friend_follow', 'post_like', 'duel_invite', 'coin_gift', 'nemesis_assigned',
  'quest_claimed', 'comment_reply', 'bounty_claim', 'post_reaction',
];

describe('notificationCatalog', () => {
  it('classifies every type seen in production', () => {
    const unmapped = TYPES_IN_PRODUCTION.filter(t => !isKnownType(t));
    expect(unmapped).toEqual([]);
  });

  it('puts coin_gift under social, not the catch-all', () => {
    // It is a gift from another human. It used to land in "System".
    expect(categoryFor('coin_gift')).toBe(CATEGORY.SOCIAL);
  });

  it('gives every known type exactly one category, and it is a real one', () => {
    const valid = new Set(Object.values(CATEGORY));
    for (const type of KNOWN_TYPES) {
      expect(valid.has(categoryFor(type))).toBe(true);
    }
  });

  it('every category has a hue, and there are only four', () => {
    for (const c of Object.values(CATEGORY)) {
      expect(CATEGORY_HUE[c]).toBeTruthy();
    }
    // `muted` is the neutral, not a fifth hue — the app allows four.
    const hues = new Set(Object.values(CATEGORY_HUE));
    expect([...hues].filter(h => h !== 'muted')).toHaveLength(3);
  });

  it('every filter but `all` maps to a category, and `all` maps to none', () => {
    const ids = FILTERS.map(f => f.id);
    expect(ids[0]).toBe('all');
    for (const id of ids.slice(1)) {
      expect(Object.values(CATEGORY)).toContain(id);
    }
    // Every category is reachable from the filter row — a category with no
    // filter is a bucket the user can never open.
    for (const c of Object.values(CATEGORY)) expect(ids).toContain(c);
  });

  it('every filter carries both a key and an English fallback', () => {
    for (const f of FILTERS) {
      expect(f.labelKey).toMatch(/^notifications\./);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  describe('an unknown type still reaches the user', () => {
    const FUTURE = 'some_type_the_server_adds_next_month';

    it('is reported as drift', () => {
      expect(isKnownType(FUTURE)).toBe(false);
    });

    it('still shows under All', () => {
      expect(matchesFilter(FUTURE, 'all')).toBe(true);
    });

    it('shows under no other filter, rather than being guessed into one', () => {
      for (const c of Object.values(CATEGORY)) {
        expect(matchesFilter(FUTURE, c)).toBe(false);
      }
    });

    it('takes the neutral tile rather than rendering with no fill', () => {
      expect(hueFor(FUTURE)).toBe('muted');
      expect(hueFor(undefined)).toBe('muted');
    });
  });

  it('matchesFilter treats a missing filter as no filter', () => {
    expect(matchesFilter('friend_post', undefined)).toBe(true);
    expect(matchesFilter('friend_post', null)).toBe(true);
  });
});
