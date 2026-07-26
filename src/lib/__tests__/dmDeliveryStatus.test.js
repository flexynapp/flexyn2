// Tests for src/lib/dmDeliveryStatus.js — the grey-check / green-check /
// green-eye derivation for the conversation list.
//
// The whole point of these is that a tick never lies: each state maps to
// a column the database actually sets, and anything ambiguous renders
// nothing at all.

import { describe, it, expect } from 'vitest';
import { deriveDeliveryStatus } from '../dmDeliveryStatus';

const me = 'me@example.com';
const them = 'them@example.com';

const mine = (extra = {}) => ({
  id: 'm1',
  sender_email: me,
  body: 'hi',
  ...extra,
});

describe('deriveDeliveryStatus', () => {
  it('returns sent for my message with no delivery or read stamp', () => {
    expect(deriveDeliveryStatus(mine(), me)).toBe('sent');
  });

  it('returns delivered once the recipient client downloaded it', () => {
    expect(deriveDeliveryStatus(
      mine({ delivered_at: '2026-07-26T10:00:00Z' }), me
    )).toBe('delivered');
  });

  it('returns read once the recipient opened the thread', () => {
    expect(deriveDeliveryStatus(
      mine({ delivered_at: '2026-07-26T10:00:00Z', read_at: '2026-07-26T10:05:00Z' }), me
    )).toBe('read');
  });

  it('prefers read over delivered even if delivered_at is missing', () => {
    // A message read on a pre-237 host has read_at but no delivered_at.
    // Read is strictly stronger, so it wins rather than falling back.
    expect(deriveDeliveryStatus(mine({ read_at: '2026-07-26T10:05:00Z' }), me)).toBe('read');
  });

  // You never show read state for a message you RECEIVED.
  it('returns null when the last message is theirs', () => {
    expect(deriveDeliveryStatus(
      { id: 'm1', sender_email: them, read_at: '2026-07-26T10:00:00Z' }, me
    )).toBeNull();
  });

  it('is case-insensitive on the sender email', () => {
    expect(deriveDeliveryStatus({ id: 'm1', sender_email: 'ME@Example.COM' }, me)).toBe('sent');
  });

  it('falls back to created_by when sender_email is absent', () => {
    expect(deriveDeliveryStatus({ id: 'm1', created_by: me }, me)).toBe('sent');
  });

  // An optimistic row has not been confirmed by the server, so even
  // 'sent' would be a guess.
  it('returns null for an optimistic row', () => {
    expect(deriveDeliveryStatus(mine({ _optimistic: true }), me)).toBeNull();
    expect(deriveDeliveryStatus(mine({ id: 'temp-abc123' }), me)).toBeNull();
  });

  // delivered_at / read_at are single timestamps; in a group they would
  // mean "somebody", which is not a claim worth rendering.
  it('returns null for group threads', () => {
    expect(deriveDeliveryStatus(mine({ read_at: 'x' }), me, { isGroup: true })).toBeNull();
  });

  // Reciprocity (mig 238). Turning receipts off must also stop the
  // viewer SEEING read state — otherwise it's a one-way mirror.
  describe('with the viewer’s read receipts disabled', () => {
    const off = { readReceiptsEnabled: false };

    it('withholds the read state and falls back to delivered', () => {
      expect(deriveDeliveryStatus(
        mine({ delivered_at: '2026-07-26T10:00:00Z', read_at: '2026-07-26T10:05:00Z' }),
        me,
        off,
      )).toBe('delivered');
    });

    it('still reports delivered when only delivered_at is set', () => {
      expect(deriveDeliveryStatus(
        mine({ delivered_at: '2026-07-26T10:00:00Z' }), me, off
      )).toBe('delivered');
    });

    // read implies delivered, so a read message on a pre-237 row (no
    // delivered_at) must not be downgraded all the way to a grey check.
    it('does not downgrade a read-but-not-stamped message to sent', () => {
      expect(deriveDeliveryStatus(mine({ read_at: '2026-07-26T10:05:00Z' }), me, off))
        .toBe('delivered');
    });

    it('leaves plain sent alone', () => {
      expect(deriveDeliveryStatus(mine(), me, off)).toBe('sent');
    });
  });

  // Opt-OUT: anything other than an explicit false behaves as before.
  it('treats an omitted setting as enabled', () => {
    expect(deriveDeliveryStatus(mine({ read_at: 'x' }), me)).toBe('read');
    expect(deriveDeliveryStatus(mine({ read_at: 'x' }), me, {})).toBe('read');
    expect(deriveDeliveryStatus(mine({ read_at: 'x' }), me, { readReceiptsEnabled: true }))
      .toBe('read');
  });

  it('returns null for missing message or viewer', () => {
    expect(deriveDeliveryStatus(null, me)).toBeNull();
    expect(deriveDeliveryStatus(mine(), null)).toBeNull();
    expect(deriveDeliveryStatus({ id: 'm1' }, me)).toBeNull(); // no sender at all
  });
});
