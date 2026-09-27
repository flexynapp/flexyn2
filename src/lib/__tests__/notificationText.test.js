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
import { notificationText, LOCALIZED_TYPES, CANNOT_LOCALIZE } from '../notificationText';

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

describe('the live-row specs match what production actually stores', () => {
  // Every field name below was read out of a real production row, and every
  // English template was matched against a real stored title. These pin the
  // mapping so a later edit cannot quietly rename a metadata field and fall
  // back forever — which would look exactly like nothing being wrong.
  const CASES = [
    ['bounty_claim',  { claimant_name: 'seantest' }, 'name=seantest'],
    ['coin_gift',     { senderUsername: 'sean', amount: 10000 }, null],
    ['duel_invite',   { challenger_name: 'kegan', duel_type: 'exercise' }, 'name=kegan'],
    ['post_like',     { actor_name: 'kegan' }, 'name=kegan'],
    ['post_reaction', { actor_name: 'kegan', item_emoji: '🌟' }, 'name=kegan emoji=🌟'],
    ['quest_claimed', { coinsAwarded: 40, questLabel: 'Take a progress photo' }, 'coins=40 quest=Take a progress photo'],
  ];
  it.each(CASES)('%s localizes from its real metadata', (type, metadata, expectInTitle) => {
    const out = notificationText({ type, title: 'STORED', body: 'STORED', metadata }, t);
    expect(out.localized, `${type} fell back — its spec does not match the row`).toBe(true);
    if (expectInTitle) expect(out.title).toContain(expectInTitle);
  });

  it('streak_milestone picks login vs workout from `kind`', () => {
    const base = { day: 7, coinsAwarded: 5, eliteCapsuleAwarded: false };
    expect(notificationText({ type: 'streak_milestone', metadata: { ...base, kind: 'login' } }, t).title)
      .toContain('streak_milestone.login.title');
    expect(notificationText({ type: 'streak_milestone', metadata: { ...base, kind: 'workout' } }, t).title)
      .toContain('streak_milestone.workout.title');
  });

  it('comment_reply keeps the stored body, because it is the COMMENT', () => {
    // The body is what somebody wrote. Templating it would replace their
    // words with a translation of nothing.
    const out = notificationText({
      type: 'comment_reply', title: 'STORED', body: 'Rainy poop',
      metadata: { commenter_name: 'kegan', is_reply: true },
    }, t);
    expect(out.localized).toBe(true);
    expect(out.body).toBe('Rainy poop');
  });

  it('anything still listed as blocked really does stay on stored text', () => {
    // Empty since migration 379. Kept so that adding an entry without also
    // making it fall back fails here.
    for (const type of Object.keys(CANNOT_LOCALIZE)) {
      const out = notificationText({ type, title: 'STORED', body: 'B', metadata: {} }, t);
      expect(out.localized, `${type} claims to localize but its name is not on the row`).toBe(false);
    }
  });

  // ── migration 379 ──────────────────────────────────────────────────────
  // These three named somebody the row identified only by id. 379 resolves
  // the name into metadata on insert and backfills what was already written.

  it('crew wars localize once the opponent NAME is on the row', () => {
    const started = notificationText({ type: 'crew_war_started', title: 'S', metadata: { opponent_crew_name: 'Admin Grind', opponent_crew_id: 'x' } }, t);
    expect(started.localized).toBe(true);
    expect(started.title).toContain('name=Admin Grind');

    for (const [outcome, key] of [['won', 'title_won'], ['lost', 'title_lost'], ['tied', 'title_tied']]) {
      const out = notificationText({ type: 'crew_war_resolved', title: 'S', metadata: { outcome, opponent_crew_name: 'Admin Grind' } }, t);
      expect(out.title, `outcome ${outcome}`).toContain(`crew_war_resolved.${key}`);
    }
  });

  it('a pre-379 crew war row, or one whose crew was deleted, still falls back', () => {
    // The trigger cannot name a crew that no longer exists, and it did not
    // run at all before 379. Both land here, and both must keep their text.
    const out = notificationText({ type: 'crew_war_started', title: 'STORED', metadata: { opponent_crew_id: 'x' } }, t);
    expect(out.localized).toBe(false);
    expect(out.title).toBe('STORED');
  });

  it('nemesis_assigned picks invite, cardio and declined apart', () => {
    const name = { rival_display_name: 'sefseg' };
    expect(notificationText({ type: 'nemesis_assigned', metadata: { ...name } }, t).title)
      .toContain('nemesis_assigned.title_gym');
    expect(notificationText({ type: 'nemesis_assigned', metadata: { ...name, rival_type: 'cardio' } }, t).title)
      .toContain('nemesis_assigned.title_cardio');
    const declined = notificationText({ type: 'nemesis_assigned', metadata: { ...name, result: 'declined' } }, t);
    expect(declined.title).toContain('nemesis_assigned.title_declined');
    expect(declined.body).toContain('body_declined');
    // An unanswered invite is not an invite: without its own branch it
    // rendered as "@name wants to be your Gym Rival" to the person who sent it.
    const expired = notificationText({ type: 'nemesis_assigned', metadata: { ...name, result: 'expired' } }, t);
    expect(expired.title).toContain('nemesis_assigned.title_expired');
    expect(expired.body).toContain('body_expired');
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
