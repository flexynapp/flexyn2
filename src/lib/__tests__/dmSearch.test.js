import { describe, it, expect } from 'vitest';
import {
  normalizeQuery,
  stripProtocolMarker,
  conversationSearchFields,
  conversationMatchesQuery,
  filterConversationsByQuery,
} from '@/lib/dmSearch';

const ME = 'me-id';
const PROFILES = {
  'u-dave': { id: 'u-dave', username: 'dave_lifts' },
  'u-anna': { id: 'u-anna', username: 'AnnaSquats' },
};
const OPTS = { profilesById: PROFILES, selfId: ME };

const conv = (over = {}) => ({
  id: 'c1',
  participant_ids: [ME, 'u-dave'],
  latestMessage: { body: 'see you at the gym' },
  title: null,
  ...over,
});

describe('normalizeQuery', () => {
  it('lower-cases and trims', () => {
    expect(normalizeQuery('  DaVe  ')).toBe('dave');
  });

  it('returns empty string for non-strings and blank input', () => {
    expect(normalizeQuery('   ')).toBe('');
    expect(normalizeQuery(undefined)).toBe('');
    expect(normalizeQuery(null)).toBe('');
    expect(normalizeQuery(42)).toBe('');
  });
});

describe('stripProtocolMarker', () => {
  it('leaves ordinary text untouched', () => {
    expect(stripProtocolMarker('see you at the gym')).toBe('see you at the gym');
  });

  it('keeps the human fallback line after a marker', () => {
    expect(stripProtocolMarker("[TRADE_RESPONSE_V1]abc:accepted\n✅ I'd like to do this trade"))
      .toBe("✅ I'd like to do this trade");
  });

  it('yields nothing for a marker with only a payload and no fallback', () => {
    expect(stripProtocolMarker('[TRADE_OFFER_V1]{"item":"belt"}')).toBe('');
  });

  it('tolerates non-strings', () => {
    expect(stripProtocolMarker(undefined)).toBe('');
    expect(stripProtocolMarker(null)).toBe('');
  });
});

describe('conversationSearchFields', () => {
  it('resolves the OTHER participant, never the viewer', () => {
    const fields = conversationSearchFields(conv(), OPTS);
    expect(fields).toContain('dave_lifts');
  });

  it('includes the group title and the last-message preview', () => {
    const fields = conversationSearchFields(
      conv({ title: 'Leg Day Crew', latestMessage: { body: 'who is in' } }),
      OPTS,
    );
    expect(fields).toEqual(expect.arrayContaining(['Leg Day Crew', 'who is in']));
  });

  it('falls back to last_message_preview when no latestMessage is loaded', () => {
    const fields = conversationSearchFields(
      conv({ latestMessage: null, last_message_preview: 'legacy preview' }),
      OPTS,
    );
    expect(fields).toContain('legacy preview');
  });

  it('drops unresolved usernames instead of emitting null', () => {
    const fields = conversationSearchFields(
      conv({ participant_ids: [ME, 'u-unknown'] }),
      OPTS,
    );
    expect(fields.every(f => typeof f === 'string' && f.length > 0)).toBe(true);
  });
});

describe('conversationMatchesQuery', () => {
  it('matches on username, case-insensitively', () => {
    expect(conversationMatchesQuery(conv(), 'DAVE', OPTS)).toBe(true);
    expect(conversationMatchesQuery(conv({ participant_ids: [ME, 'u-anna'] }), 'annasquats', OPTS)).toBe(true);
  });

  it('matches on a substring in the middle of a username', () => {
    expect(conversationMatchesQuery(conv(), 'lifts', OPTS)).toBe(true);
  });

  it('matches on the last-message preview', () => {
    expect(conversationMatchesQuery(conv(), 'gym', OPTS)).toBe(true);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(conversationMatchesQuery(conv(), '   dave   ', OPTS)).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(conversationMatchesQuery(conv(), 'zzzz', OPTS)).toBe(false);
  });

  it('never matches on a raw protocol marker', () => {
    const c = conv({ latestMessage: { body: '[TRADE_OFFER_V1]{"item":"belt"}' } });
    expect(conversationMatchesQuery(c, 'trade_offer_v1', OPTS)).toBe(false);
  });

  it('an empty query matches everything, so clearing restores the list', () => {
    expect(conversationMatchesQuery(conv(), '', OPTS)).toBe(true);
    expect(conversationMatchesQuery(conv(), '   ', OPTS)).toBe(true);
  });
});

describe('filterConversationsByQuery', () => {
  const dave = conv({ id: 'dave', participant_ids: [ME, 'u-dave'], latestMessage: { body: 'see you at the gym' } });
  const anna = conv({ id: 'anna', participant_ids: [ME, 'u-anna'], latestMessage: { body: 'nice PR' } });
  const group = conv({ id: 'group', participant_ids: [ME, 'u-anna'], title: 'Leg Day Crew', latestMessage: { body: 'who is in' } });
  const list = [dave, anna, group];

  it('narrows to username matches', () => {
    expect(filterConversationsByQuery(list, 'dave', OPTS).map(c => c.id)).toEqual(['dave']);
  });

  it('narrows to preview matches', () => {
    expect(filterConversationsByQuery(list, 'PR', OPTS).map(c => c.id)).toEqual(['anna']);
  });

  it('finds a group by its title', () => {
    expect(filterConversationsByQuery(list, 'leg day', OPTS).map(c => c.id)).toEqual(['group']);
  });

  it('returns the original list for an empty query', () => {
    expect(filterConversationsByQuery(list, '', OPTS)).toBe(list);
    expect(filterConversationsByQuery(list, '  ', OPTS)).toBe(list);
  });

  it('returns an empty array when nothing matches, not the whole list', () => {
    expect(filterConversationsByQuery(list, 'nobody', OPTS)).toEqual([]);
  });

  it('preserves the incoming order', () => {
    expect(filterConversationsByQuery(list, 'a', OPTS).map(c => c.id))
      .toEqual(list.filter(c => filterConversationsByQuery([c], 'a', OPTS).length).map(c => c.id));
  });

  it('only ever sees the list it is given, so tab scoping is inherent', () => {
    // The component passes the ACTIVE tab's rows. A request thread simply
    // isn't in the array when the Inbox is showing.
    const inboxOnly = [dave];
    expect(filterConversationsByQuery(inboxOnly, 'anna', OPTS)).toEqual([]);
  });

  it('returns an empty array for non-array input', () => {
    expect(filterConversationsByQuery(undefined, 'x', OPTS)).toEqual([]);
    expect(filterConversationsByQuery(null, 'x', OPTS)).toEqual([]);
  });
});
