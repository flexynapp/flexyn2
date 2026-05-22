// Tests for src/lib/data/conversationRequests.js — partitions
// conversations into the main inbox vs. the new Message Requests
// folder (migration 113) + wraps the accept_conversation RPC.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: (...args) => rpcSpy(...args) },
}));

const { acceptConversation, partitionConversations } = await import('../conversationRequests');

beforeEach(() => {
  rpcSpy.mockReset();
});

describe('acceptConversation', () => {
  it('throws when convId is missing', async () => {
    await expect(acceptConversation(null)).rejects.toThrow(/convId/);
  });

  it('calls the accept_conversation RPC with the id', async () => {
    rpcSpy.mockResolvedValueOnce({ error: null });
    await acceptConversation('c1');
    expect(rpcSpy).toHaveBeenCalledWith('accept_conversation', { p_conv_id: 'c1' });
  });

  it('throws when the RPC returns an error', async () => {
    rpcSpy.mockResolvedValueOnce({ error: { code: '42501', message: 'unauthenticated' } });
    await expect(acceptConversation('c1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('partitionConversations', () => {
  const me = 'me@example.com';

  it('routes a conversation with my acceptance to inbox', () => {
    const { inbox, requests } = partitionConversations(
      [{
        id: 'c1',
        participant_emails: [me, 'stranger@x.com'],
        accepted_emails: [me],
      }],
      me,
      []
    );
    expect(inbox).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it('routes a conversation from a follow to inbox even without acceptance', () => {
    const { inbox, requests } = partitionConversations(
      [{
        id: 'c1',
        participant_emails: [me, 'friend@x.com'],
        accepted_emails: [],
      }],
      me,
      ['friend@x.com']
    );
    expect(inbox).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it('routes a conversation from a stranger (no follow, no accept) to requests', () => {
    const { inbox, requests } = partitionConversations(
      [{
        id: 'c1',
        participant_emails: [me, 'stranger@x.com'],
        accepted_emails: [],
      }],
      me,
      []
    );
    expect(inbox).toHaveLength(0);
    expect(requests).toHaveLength(1);
  });

  it('is case-insensitive on email comparison', () => {
    const { inbox } = partitionConversations(
      [{
        id: 'c1',
        participant_emails: ['ME@example.com', 'Friend@x.COM'],
        accepted_emails: [],
      }],
      me,
      ['friend@x.com']
    );
    expect(inbox).toHaveLength(1);
  });

  it('accepts a Set of follow emails as well as an array', () => {
    const { inbox } = partitionConversations(
      [{
        id: 'c1',
        participant_emails: [me, 'friend@x.com'],
        accepted_emails: [],
      }],
      me,
      new Set(['friend@x.com'])
    );
    expect(inbox).toHaveLength(1);
  });

  it('returns the input unchanged when myEmail is missing', () => {
    const list = [{ id: 'c1' }];
    expect(partitionConversations(list, null, [])).toEqual({ inbox: list, requests: [] });
  });

  it('returns empty arrays for null conversations', () => {
    expect(partitionConversations(null, me, [])).toEqual({ inbox: [], requests: [] });
  });
});
