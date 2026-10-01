// Tests for src/lib/data/tradeHistory.js — the pure pairing function
// that reconstructs trade history from raw hub_messages markers.
// listMyTrades is the IO wrapper; one test pins the columns it reads.
//
// Identity is the user id: the offer message's user_id (or the payload's
// fromId) is compared to the viewer's id. The email columns on
// hub_messages are not readable by clients.

import { describe, it, expect, vi } from 'vitest';

const _sel = { table: null, columns: null, data: [] };
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      _sel.table = table;
      const chain = {
        select: (cols) => { _sel.columns = cols; return chain; },
        order: () => chain,
        limit: () => Promise.resolve({ data: _sel.data, error: null }),
      };
      return chain;
    },
  },
}));

const { pairOffersWithResponses, listMyTrades } = await import('../tradeHistory');

function offerMsg({ id, offerId, from, to, myItem, theirItem, at, withUserId = true }) {
  const payload = {
    type: 'trade_offer',
    offerId,
    status: 'pending',
    fromId: from,
    toId: to,
    myItem,
    theirItem,
  };
  return {
    id,
    ...(withUserId ? { user_id: from } : {}),
    body: `[TRADE_OFFER_V1]${JSON.stringify(payload)}\nHi, want to trade?`,
    created_at: at,
  };
}

function responseMsg({ id, offerId, status, sender, at }) {
  return {
    id,
    user_id: sender,
    body: `[TRADE_RESPONSE_V1]${offerId}:${status}\nack`,
    created_at: at,
  };
}

const item = (name, emoji) => ({ name, emoji, itemId: name.toLowerCase() });

describe('pairOffersWithResponses', () => {
  it('returns [] for empty / null input', () => {
    expect(pairOffersWithResponses(null, 'id-me')).toEqual([]);
    expect(pairOffersWithResponses([], 'id-me')).toEqual([]);
  });

  it('pairs an offer with its response by offerId', () => {
    const msgs = [
      offerMsg({
        id: 'm1', offerId: 'o1', from: 'id-me', to: 'id-they',
        myItem: item('Fire', '🔥'), theirItem: item('Star', '⭐'),
        at: '2025-05-01T10:00:00Z',
      }),
      responseMsg({ id: 'm2', offerId: 'o1', status: 'accepted', sender: 'id-they', at: '2025-05-01T10:30:00Z' }),
    ];
    const out = pairOffersWithResponses(msgs, 'id-me');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      offerId:    'o1',
      status:     'accepted',
      iAmSender:  true,
    });
    expect(out[0].respondedAt).toBe('2025-05-01T10:30:00Z');
  });

  it('marks unresponded offers as pending', () => {
    const out = pairOffersWithResponses([
      offerMsg({ id: 'm1', offerId: 'o1', from: 'id-me', to: 'id-they', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
    ], 'id-me');
    expect(out[0].status).toBe('pending');
    expect(out[0].respondedAt).toBeNull();
  });

  it('respects the latest response when there are multiple', () => {
    const msgs = [
      offerMsg({ id: 'm1', offerId: 'o1', from: 'id-me', to: 'id-they', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
      responseMsg({ id: 'm2', offerId: 'o1', status: 'declined', sender: 'id-they', at: '2025-05-01T10:30:00Z' }),
      responseMsg({ id: 'm3', offerId: 'o1', status: 'accepted', sender: 'id-they', at: '2025-05-01T11:00:00Z' }),
    ];
    expect(pairOffersWithResponses(msgs, 'id-me')[0].status).toBe('accepted');
  });

  it('detects iAmSender from the offer message user_id', () => {
    const out = pairOffersWithResponses([
      offerMsg({ id: 'm1', offerId: 'o1', from: 'id-me', to: 'id-they', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
    ], 'id-me');
    expect(out[0].iAmSender).toBe(true);
  });

  it('falls back to payload.fromId when the row has no user_id', () => {
    const out = pairOffersWithResponses([
      offerMsg({ id: 'm1', offerId: 'o1', from: 'id-me', to: 'id-they', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z', withUserId: false }),
    ], 'id-me');
    expect(out[0].iAmSender).toBe(true);
  });

  it('never treats a sender email as the viewer', () => {
    const out = pairOffersWithResponses([
      { id: 'm1', sender_email: 'me@x.com', body: '[TRADE_OFFER_V1]{"type":"trade_offer","offerId":"o1","fromEmail":"me@x.com"}', created_at: '2025-05-01' },
    ], 'me@x.com');
    expect(out[0].iAmSender).toBe(false);
  });

  it('flips iAmSender for offers the viewer received', () => {
    const out = pairOffersWithResponses([
      offerMsg({ id: 'm1', offerId: 'o1', from: 'id-they', to: 'id-me', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
    ], 'id-me');
    expect(out[0].iAmSender).toBe(false);
  });

  it('ignores malformed marker bodies', () => {
    expect(pairOffersWithResponses([
      { id: 'm1', body: '[TRADE_OFFER_V1]not-json', created_at: '2025-05-01' },
      { id: 'm2', body: '[TRADE_RESPONSE_V1]missing-colon', created_at: '2025-05-01' },
      { id: 'm3', body: '[TRADE_RESPONSE_V1]o1:bogus_status', created_at: '2025-05-01' },
    ], 'id-me')).toEqual([]);
  });

  it('sorts entries newest-first by sentAt', () => {
    const msgs = [
      offerMsg({ id: 'm1', offerId: 'a', from: 'id-me', to: 'id-they', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
      offerMsg({ id: 'm2', offerId: 'b', from: 'id-me', to: 'id-they', myItem: item('a'), theirItem: item('b'), at: '2025-05-03T10:00:00Z' }),
      offerMsg({ id: 'm3', offerId: 'c', from: 'id-me', to: 'id-they', myItem: item('a'), theirItem: item('b'), at: '2025-05-02T10:00:00Z' }),
    ];
    const ids = pairOffersWithResponses(msgs, 'id-me').map(t => t.offerId);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('skips non-trade messages', () => {
    expect(pairOffersWithResponses([
      { id: 'm1', body: 'just a regular hello',     created_at: '2025-05-01' },
      { id: 'm2', body: '[POLL_V1]{"q":"why?"}',     created_at: '2025-05-01' },
    ], 'id-me')).toEqual([]);
  });
});

describe('listMyTrades', () => {
  it('reads named id-keyed columns from hub_messages, never emails', async () => {
    _sel.data = [
      offerMsg({ id: 'm1', offerId: 'o1', from: 'id-me', to: 'id-they', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
    ];
    const out = await listMyTrades('id-me');
    expect(_sel.table).toBe('hub_messages');
    const cols = String(_sel.columns);
    for (const c of ['id', 'conversation_id', 'user_id', 'body', 'content', 'created_at']) {
      expect(cols).toContain(c);
    }
    expect(cols).not.toMatch(/email|\*/);
    expect(out[0]).toMatchObject({ offerId: 'o1', iAmSender: true });
  });

  it('returns [] without a query when the id is missing', async () => {
    _sel.table = null;
    expect(await listMyTrades(null)).toEqual([]);
    expect(_sel.table).toBeNull();
  });
});
