/**
 * A trade offer reaches the seller by user id, never by email.
 *
 * It used to open the DM with listing.seller_email. That column is '' on a
 * guest's listing, so offers to guests were refused outright, and it is
 * another user's address the client should not need. The offer payload is
 * readable by both people in the conversation, so it carries ids too.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { addRecentlyViewed, listRecentlyViewed } from '@/lib/recentlyViewedListings';

const code = readFileSync('src/components/market/TradeOfferDialog.jsx', 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('TradeOfferDialog', () => {
  it('gates and opens the DM on seller_user_id', () => {
    expect(code).toMatch(/if \(!listing\.seller_user_id\)/);
    expect(code).toMatch(/findOrCreateConversation\(user\.email, listing\.seller_user_id\)/);
    expect(code).toMatch(/recipientId: listing\.seller_user_id/);
  });

  it('never reads or sends the seller email', () => {
    expect(code).not.toMatch(/seller_email/);
    expect(code).not.toMatch(/toEmail|fromEmail/);
  });
});

describe('recently viewed listings', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* no storage */ } });

  const listing = { id: 'l1', item_name: 'Cat', seller_user_id: 'seller-uuid', seller_email: 'seller@example.com' };

  it('stores the seller id, not their email', () => {
    addRecentlyViewed('me@example.com', listing, 'me-uuid');
    const [entry] = listRecentlyViewed('me@example.com');
    expect(entry.seller_user_id).toBe('seller-uuid');
    expect(JSON.stringify(entry)).not.toContain('seller@example.com');
  });

  it('skips your own listing by id', () => {
    addRecentlyViewed('me@example.com', { ...listing, seller_user_id: 'me-uuid' }, 'me-uuid');
    expect(listRecentlyViewed('me@example.com')).toEqual([]);
  });
});
