// Tests for src/lib/data/tradeHistory.js — the pure pairing function
// that reconstructs trade history from raw hub_messages markers.
// listMyTrades is the IO wrapper; we test it via the pairing logic.

import { describe, it, expect } from 'vitest';
import { pairOffersWithResponses } from '../tradeHistory';

function offerMsg({ id, offerId, from, to, myItem, theirItem, at }) {
  const payload = {
    type: 'trade_offer',
    offerId,
    status: 'pending',
    fromEmail: from,
    toEmail: to,
    myItem,
    theirItem,
  };
  return {
    id,
    sender_email: from,
    body: `[TRADE_OFFER_V1]${JSON.stringify(payload)}\nHi, want to trade?`,
    created_at: at,
  };
}

function responseMsg({ id, offerId, status, sender, at }) {
  return {
    id,
    sender_email: sender,
    body: `[TRADE_RESPONSE_V1]${offerId}:${status}\nack`,
    created_at: at,
  };
}

const item = (name, emoji) => ({ name, emoji, itemId: name.toLowerCase() });

describe('pairOffersWithResponses', () => {
  it('returns [] for empty / null input', () => {
    expect(pairOffersWithResponses(null, 'me@x.com')).toEqual([]);
    expect(pairOffersWithResponses([], 'me@x.com')).toEqual([]);
  });

  it('pairs an offer with its response by offerId', () => {
    const msgs = [
      offerMsg({
        id: 'm1', offerId: 'o1', from: 'me@x.com', to: 'they@x.com',
        myItem: item('Fire', '🔥'), theirItem: item('Star', '⭐'),
        at: '2025-05-01T10:00:00Z',
      }),
      responseMsg({ id: 'm2', offerId: 'o1', status: 'accepted', sender: 'they@x.com', at: '2025-05-01T10:30:00Z' }),
    ];
    const out = pairOffersWithResponses(msgs, 'me@x.com');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      offerId:    'o1',
      status:     'accepted',
      iAmSender:  true,
      fromEmail:  'me@x.com',
      toEmail:    'they@x.com',
    });
    expect(out[0].respondedAt).toBe('2025-05-01T10:30:00Z');
  });

  it('marks unresponded offers as pending', () => {
    const out = pairOffersWithResponses([
      offerMsg({ id: 'm1', offerId: 'o1', from: 'me@x.com', to: 'they@x.com', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
    ], 'me@x.com');
    expect(out[0].status).toBe('pending');
    expect(out[0].respondedAt).toBeNull();
  });

  it('respects the latest response when there are multiple', () => {
    const msgs = [
      offerMsg({ id: 'm1', offerId: 'o1', from: 'me@x.com', to: 'they@x.com', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
      responseMsg({ id: 'm2', offerId: 'o1', status: 'declined', sender: 'they@x.com', at: '2025-05-01T10:30:00Z' }),
      responseMsg({ id: 'm3', offerId: 'o1', status: 'accepted', sender: 'they@x.com', at: '2025-05-01T11:00:00Z' }),
    ];
    expect(pairOffersWithResponses(msgs, 'me@x.com')[0].status).toBe('accepted');
  });

  it('detects iAmSender case-insensitively', () => {
    const out = pairOffersWithResponses([
      offerMsg({ id: 'm1', offerId: 'o1', from: 'ME@X.com', to: 'they@x.com', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
    ], 'me@x.com');
    expect(out[0].iAmSender).toBe(true);
  });

  it('flips iAmSender for offers the viewer received', () => {
    const out = pairOffersWithResponses([
      offerMsg({ id: 'm1', offerId: 'o1', from: 'they@x.com', to: 'me@x.com', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
    ], 'me@x.com');
    expect(out[0].iAmSender).toBe(false);
  });

  it('ignores malformed marker bodies', () => {
    expect(pairOffersWithResponses([
      { id: 'm1', body: '[TRADE_OFFER_V1]not-json', created_at: '2025-05-01' },
      { id: 'm2', body: '[TRADE_RESPONSE_V1]missing-colon', created_at: '2025-05-01' },
      { id: 'm3', body: '[TRADE_RESPONSE_V1]o1:bogus_status', created_at: '2025-05-01' },
    ], 'me@x.com')).toEqual([]);
  });

  it('sorts entries newest-first by sentAt', () => {
    const msgs = [
      offerMsg({ id: 'm1', offerId: 'a', from: 'me@x.com', to: 'they@x.com', myItem: item('a'), theirItem: item('b'), at: '2025-05-01T10:00:00Z' }),
      offerMsg({ id: 'm2', offerId: 'b', from: 'me@x.com', to: 'they@x.com', myItem: item('a'), theirItem: item('b'), at: '2025-05-03T10:00:00Z' }),
      offerMsg({ id: 'm3', offerId: 'c', from: 'me@x.com', to: 'they@x.com', myItem: item('a'), theirItem: item('b'), at: '2025-05-02T10:00:00Z' }),
    ];
    const ids = pairOffersWithResponses(msgs, 'me@x.com').map(t => t.offerId);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('skips non-trade messages', () => {
    expect(pairOffersWithResponses([
      { id: 'm1', body: 'just a regular hello',     created_at: '2025-05-01' },
      { id: 'm2', body: '[POLL_V1]{"q":"why?"}',     created_at: '2025-05-01' },
    ], 'me@x.com')).toEqual([]);
  });
});
