// Pure-function tests for TradeOfferCard's parsers / formatters.
// We DON'T render the component here — those parts have UI dependencies
// (sonner, framer-motion, sendMessage). We test only the protocol logic
// that the rest of the trade-response server-persistence flow depends on.

import { describe, it, expect } from 'vitest';
import { parseTradeOffer, parseTradeResponse, formatTradeResponseBody } from '../TradeOfferCard';

describe('parseTradeOffer', () => {
  it('returns null for empty / non-string input', () => {
    expect(parseTradeOffer(null)).toBeNull();
    expect(parseTradeOffer(undefined)).toBeNull();
    expect(parseTradeOffer('')).toBeNull();
    expect(parseTradeOffer(123)).toBeNull();
  });

  it('returns null for bodies without the marker', () => {
    expect(parseTradeOffer('hello world')).toBeNull();
    expect(parseTradeOffer('hi [TRADE_OFFER_V1] inline')).toBeNull(); // must start at index 0
  });

  it('parses a valid offer payload', () => {
    const payload = {
      v: 1,
      type: 'trade_offer',
      offerId: 'abc-123',
      fromEmail: 'a@b.c',
      myItem: { name: 'A' },
      theirItem: { name: 'B' },
    };
    const body = `[TRADE_OFFER_V1]${JSON.stringify(payload)}\nfallback text`;
    expect(parseTradeOffer(body)).toEqual(payload);
  });

  it('rejects payloads with wrong type', () => {
    const body = '[TRADE_OFFER_V1]{"type":"chat","v":1}';
    expect(parseTradeOffer(body)).toBeNull();
  });

  it('handles a body where the marker line has no trailing newline', () => {
    const payload = { type: 'trade_offer', v: 1 };
    expect(parseTradeOffer(`[TRADE_OFFER_V1]${JSON.stringify(payload)}`)).toEqual(payload);
  });

  it('returns null on malformed JSON', () => {
    expect(parseTradeOffer('[TRADE_OFFER_V1]{not json')).toBeNull();
  });
});

describe('parseTradeResponse', () => {
  it('returns null without the marker', () => {
    expect(parseTradeResponse('plain reply')).toBeNull();
    expect(parseTradeResponse('')).toBeNull();
    expect(parseTradeResponse(null)).toBeNull();
  });

  it('parses an accepted response', () => {
    const body = '[TRADE_RESPONSE_V1]abc-123:accepted\nI’d like to do this trade.';
    expect(parseTradeResponse(body)).toEqual({ offerId: 'abc-123', response: 'accepted' });
  });

  it('parses a declined response', () => {
    const body = '[TRADE_RESPONSE_V1]xyz:declined\nNot interested.';
    expect(parseTradeResponse(body)).toEqual({ offerId: 'xyz', response: 'declined' });
  });

  it('rejects unknown response values', () => {
    expect(parseTradeResponse('[TRADE_RESPONSE_V1]abc:pending\n')).toBeNull();
    expect(parseTradeResponse('[TRADE_RESPONSE_V1]abc:\n')).toBeNull();
    expect(parseTradeResponse('[TRADE_RESPONSE_V1]:accepted\n')).toBeNull();
  });

  it('returns null when no colon separator', () => {
    expect(parseTradeResponse('[TRADE_RESPONSE_V1]abc-no-colon')).toBeNull();
  });

  it('handles single-line bodies (no trailing newline)', () => {
    expect(parseTradeResponse('[TRADE_RESPONSE_V1]abc:accepted'))
      .toEqual({ offerId: 'abc', response: 'accepted' });
  });
});

describe('formatTradeResponseBody', () => {
  it('produces a parseable accepted response', () => {
    const body = formatTradeResponseBody('offer-42', true);
    expect(body.startsWith('[TRADE_RESPONSE_V1]offer-42:accepted')).toBe(true);
    expect(parseTradeResponse(body)).toEqual({ offerId: 'offer-42', response: 'accepted' });
  });

  it('produces a parseable declined response', () => {
    const body = formatTradeResponseBody('offer-99', false);
    expect(body.startsWith('[TRADE_RESPONSE_V1]offer-99:declined')).toBe(true);
    expect(parseTradeResponse(body)).toEqual({ offerId: 'offer-99', response: 'declined' });
  });

  it('round-trips arbitrary offerIds without collisions', () => {
    const ids = ['simple', 'with-dashes', 'a1b2c3-d4e5-f6g7', 'UPPER123'];
    for (const id of ids) {
      const accepted = formatTradeResponseBody(id, true);
      const declined = formatTradeResponseBody(id, false);
      expect(parseTradeResponse(accepted).offerId).toBe(id);
      expect(parseTradeResponse(declined).offerId).toBe(id);
    }
  });

  it('includes human-readable fallback text after the marker', () => {
    const body = formatTradeResponseBody('xyz', true);
    const lines = body.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    // Second line should not be the protocol marker.
    expect(lines[1].startsWith('[TRADE_RESPONSE_V1]')).toBe(false);
    expect(lines[1].length).toBeGreaterThan(0);
  });
});
