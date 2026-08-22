// A notification row is stored as finished text, so it is frozen in whatever
// language wrote it. notificationText() rebuilds it from `type` + `metadata`
// in the reader's language.
//
// The tests that matter here are the FALLBACK ones. The metadata field names
// in notificationText.js were read from migration source, not from live rows,
// so the module's correctness claim is not "the mapping is right" — it is
// "a wrong mapping degrades to exactly today's behaviour". That is what these
// pin. If someone later widens `resolve()` to accept a missing field, several
// of these go red, which is the point.

import { describe, it, expect } from 'vitest';
import { notificationText, LOCALIZED_TYPES } from '../notificationText';

// A translator that IGNORES the fallback and interpolates a marked template,
// so a test cannot pass just because the English fallback happened to be
// right — the var-dropping blind spot every `(k, en) => en` stub has.
const t = (key, en, vars) => {
  let out = `[${key}]`;
  for (const [k, v] of Object.entries(vars || {})) out += ` ${k}=${v}`;
  return out;
};

const row = (over = {}) => ({
  type: 'friend_follow',
  title: 'STORED TITLE',
  body: 'STORED BODY',
  metadata: { followerName: 'Ada' },
  ...over,
});

describe('falls back rather than guessing', () => {
  it('an unmapped type keeps its stored text', () => {
    const r = row({ type: 'duel_invite' });
    expect(notificationText(r, t)).toEqual({ title: 'STORED TITLE', body: 'STORED BODY', localized: false });
  });

  it('a missing metadata field keeps its stored text', () => {
    // The row predates the writer populating metadata, or the writer was
    // redefined from a stale template. Either way: do not render a hole.
    const r = row({ metadata: {} });
    expect(notificationText(r, t).localized).toBe(false);
    expect(notificationText(r, t).title).toBe('STORED TITLE');
  });

  it('null metadata entirely keeps its stored text', () => {
    expect(notificationText(row({ metadata: null }), t).title).toBe('STORED TITLE');
  });

  it('a row with no type at all does not throw', () => {
    expect(notificationText({ title: 'x' }, t)).toEqual({ title: 'x', body: null, localized: false });
    expect(notificationText(undefined, t).title).toBe('');
  });

  it('an unresolvable BODY keeps the stored body rather than blanking it', () => {
    // Old language beats an empty line.
    const r = row({ type: 'league_promoted', metadata: { toTier: 'Gold' } });
    const out = notificationText(r, t);
    expect(out.title).toContain('tier=Gold');
    expect(out.body).toBe('STORED BODY');
  });
});

describe('rebuilds in the reader language', () => {
  it('uses the metadata field, not the stored title', () => {
    const out = notificationText(row(), t);
    expect(out.localized).toBe(true);
    expect(out.title).toBe('[notifications.row.friend_follow.title] name=Ada');
  });

  it('a type with no body renders none', () => {
    const out = notificationText(row({ type: 'friend_post', metadata: { posterName: 'Ada' } }), t);
    expect(out.body).toBeNull();
  });

  it('zero is a real value, not a missing one', () => {
    // league_held with 0 coins must still localize; treating 0 as absent
    // would drop a whole row back to stored text for a legitimate number.
    const out = notificationText({ type: 'league_held', title: 'S', body: 'S', metadata: { toTier: 'Gold', coinsAwarded: 0 } }, t);
    expect(out.localized).toBe(true);
    expect(out.body).toBe('[notifications.row.league_held.body_default]');
  });

  it('picks the capsule variant only when a capsule was awarded', () => {
    const meta = { toTier: 'Gold', coinsAwarded: 50 };
    expect(notificationText({ type: 'league_promoted', metadata: meta }, t).body)
      .toBe('[notifications.row.league_promoted.body] coins=50');
    expect(notificationText({ type: 'league_promoted', metadata: { ...meta, capsuleAwarded: 'Elite' } }, t).body)
      .toBe('[notifications.row.league_promoted.body_with_capsule] coins=50 capsule=Elite');
  });
});

describe('the catalog backs every spec', () => {
  it('every key a spec names exists in en.json', async () => {
    const en = (await import('../../locales/en.json')).default;
    const missing = [];
    // Re-derive from the module rather than restating the list here: a spec
    // added without catalog rows is the exact defect this file exists under.
    for (const type of LOCALIZED_TYPES) {
      for (const [, v] of Object.entries(en)) void v;
      const prefix = `notifications.row.${type}.`;
      if (!Object.keys(en).some((k) => k.startsWith(prefix))) missing.push(type);
    }
    expect(missing, `types with a spec but no catalog rows: ${missing.join(', ')}`).toEqual([]);
  });
});
