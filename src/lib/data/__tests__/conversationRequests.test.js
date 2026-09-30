// Tests for src/lib/data/conversationRequests.js — partitions
// conversations into the main inbox vs. the new Message Requests
// folder (migration 113) + wraps the accept_conversation RPC.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy = vi.fn();

// Chainable select mock — acceptPendingRequestsFrom looks the pair's
// conversation up by participant_key through safeSelect.
const _sel = {
  lastTable: null,
  lastColumns: null,
  lastEq: null,
  nextData: [],
  nextError: null,
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => rpcSpy(...args),
    from: (table) => {
      _sel.lastTable = table;
      const chain = {
        select: (cols) => { _sel.lastColumns = cols; return chain; },
        eq: (col, val) => { _sel.lastEq = { col, val }; return chain; },
        limit: () => Promise.resolve({ data: _sel.nextData, error: _sel.nextError }),
      };
      return chain;
    },
  },
}));

const {
  acceptConversation,
  purgeMessageRequest,
  unsendMessageRequest,
  isOutgoingPendingRequest,
  acceptPendingRequestsFrom,
  partitionConversations,
  isPendingRequestSendBlocked,
} = await import('../conversationRequests');

beforeEach(() => {
  rpcSpy.mockReset();
  _sel.lastTable = null;
  _sel.lastColumns = null;
  _sel.lastEq = null;
  _sel.nextData = [];
  _sel.nextError = null;
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
        participant_ids: ['id-me', 'id-friend'],
        accepted_emails: [],
      }],
      me,
      ['id-friend'],
      'id-me',
    );
    expect(inbox).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it('does not count following yourself as following the other side', () => {
    const { requests } = partitionConversations(
      [{
        id: 'c1',
        participant_emails: [me, 'stranger@x.com'],
        participant_ids: ['id-me', 'id-stranger'],
        accepted_emails: [],
      }],
      me,
      ['id-me'],
      'id-me',
    );
    expect(requests).toHaveLength(1);
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

  it('is case-insensitive on my own email', () => {
    const { inbox } = partitionConversations(
      [{
        id: 'c1',
        participant_emails: ['ME@example.com', 'stranger@x.com'],
        accepted_emails: ['Me@Example.com'],
      }],
      me,
      [],
    );
    expect(inbox).toHaveLength(1);
  });

  it('accepts a Set of followed ids as well as an array', () => {
    const { inbox } = partitionConversations(
      [{
        id: 'c1',
        participant_emails: [me, 'friend@x.com'],
        participant_ids: ['id-me', 'id-friend'],
        accepted_emails: [],
      }],
      me,
      new Set(['id-friend']),
      'id-me',
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

  it('routes a self-DM / orphaned conversation to inbox, never Requests', () => {
    const { inbox, requests } = partitionConversations(
      [{ id: 'c1', participant_emails: [me], accepted_emails: [] }],
      me,
      []
    );
    expect(inbox).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });
});

describe('purgeMessageRequest', () => {
  it('throws when convId is missing', async () => {
    await expect(purgeMessageRequest(null)).rejects.toThrow(/convId/);
  });

  it('calls the purge_message_request RPC and reports the delete', async () => {
    rpcSpy.mockResolvedValueOnce({ data: true, error: null });
    const purged = await purgeMessageRequest('c1');
    expect(purged).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith('purge_message_request', { p_conv_id: 'c1' });
  });

  it('returns false when the row was already gone (double-tap)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: false, error: null });
    expect(await purgeMessageRequest('c1')).toBe(false);
  });

  it('propagates the server refusal to purge an accepted conversation', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'conversation_already_accepted' },
    });
    await expect(purgeMessageRequest('c1'))
      .rejects.toMatchObject({ message: 'conversation_already_accepted' });
  });

  it('propagates a non-participant refusal', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'not_a_participant' },
    });
    await expect(purgeMessageRequest('c1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('unsendMessageRequest', () => {
  it('throws when convId is missing', async () => {
    await expect(unsendMessageRequest(null)).rejects.toThrow(/convId/);
  });

  it('calls the unsend_message_request RPC and reports the delete', async () => {
    rpcSpy.mockResolvedValueOnce({ data: true, error: null });
    const done = await unsendMessageRequest('c1');
    expect(done).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith('unsend_message_request', { p_conv_id: 'c1' });
  });

  it('is a distinct RPC from the recipient-side purge', async () => {
    // purge writes a request block, unsend must not — they can never be
    // the same call.
    rpcSpy.mockResolvedValueOnce({ data: true, error: null });
    await unsendMessageRequest('c1');
    expect(rpcSpy).not.toHaveBeenCalledWith('purge_message_request', expect.anything());
  });

  it('returns false when the row was already gone', async () => {
    rpcSpy.mockResolvedValueOnce({ data: false, error: null });
    expect(await unsendMessageRequest('c1')).toBe(false);
  });

  it('propagates the server refusal on an accepted conversation', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'conversation_already_accepted' },
    });
    await expect(unsendMessageRequest('c1'))
      .rejects.toMatchObject({ message: 'conversation_already_accepted' });
  });
});

describe('isOutgoingPendingRequest', () => {
  const me = 'me@example.com';
  const them = 'them@example.com';

  it('is true for my own request the recipient has not acted on', () => {
    expect(isOutgoingPendingRequest(
      { participant_emails: [me, them], accepted_emails: [me] }, me
    )).toBe(true);
  });

  it('is false once the recipient accepted', () => {
    expect(isOutgoingPendingRequest(
      { participant_emails: [me, them], accepted_emails: [me, them] }, me
    )).toBe(false);
  });

  it('is false for an INBOUND request I have not accepted', () => {
    // They sent it, so only they are accepted. This is a Requests-tab
    // row — Delete territory, not Unsend.
    expect(isOutgoingPendingRequest(
      { participant_emails: [me, them], accepted_emails: [them] }, me
    )).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isOutgoingPendingRequest(
      { participant_emails: ['ME@Example.com', 'Them@Example.com'], accepted_emails: ['me@EXAMPLE.com'] },
      me
    )).toBe(true);
  });

  it('is false for groups, non-pairs, non-participants and missing input', () => {
    expect(isOutgoingPendingRequest(
      { is_group: true, participant_emails: [me, them, 'c@x.com'], accepted_emails: [me] }, me
    )).toBe(false);
    expect(isOutgoingPendingRequest(
      { participant_emails: [me], accepted_emails: [me] }, me
    )).toBe(false);
    expect(isOutgoingPendingRequest(
      { participant_emails: ['a@x.com', them], accepted_emails: ['a@x.com'] }, me
    )).toBe(false);
    expect(isOutgoingPendingRequest(null, me)).toBe(false);
    expect(isOutgoingPendingRequest({ participant_emails: [me, them] }, null)).toBe(false);
  });
});

describe('acceptPendingRequestsFrom', () => {
  const follower = 'me@example.com';
  const followee = 'them@example.com';

  it('accepts the pending 1:1 thread, looked up by the sorted pair key', async () => {
    _sel.nextData = [{ id: 'c1', accepted_emails: [followee] }];
    rpcSpy.mockResolvedValueOnce({ error: null });

    const flipped = await acceptPendingRequestsFrom(follower, followee);

    expect(flipped).toBe(true);
    expect(_sel.lastTable).toBe('hub_conversations');
    expect(_sel.lastEq).toEqual({
      col: 'participant_key',
      val: 'me@example.com|them@example.com',
    });
    expect(rpcSpy).toHaveBeenCalledWith('accept_conversation', { p_conv_id: 'c1' });
  });

  it('builds the same key regardless of argument order or case', async () => {
    _sel.nextData = [];
    await acceptPendingRequestsFrom('THEM@example.com', 'Me@Example.com');
    expect(_sel.lastEq).toEqual({
      col: 'participant_key',
      val: 'me@example.com|them@example.com',
    });
  });

  it('is a no-op when the follower already accepted the thread', async () => {
    _sel.nextData = [{ id: 'c1', accepted_emails: [followee, 'ME@example.com'] }];
    const flipped = await acceptPendingRequestsFrom(follower, followee);
    expect(flipped).toBe(false);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when the pair has no conversation', async () => {
    _sel.nextData = [];
    expect(await acceptPendingRequestsFrom(follower, followee)).toBe(false);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('is a no-op for a self-follow or missing emails', async () => {
    expect(await acceptPendingRequestsFrom(follower, follower)).toBe(false);
    expect(await acceptPendingRequestsFrom(null, followee)).toBe(false);
    expect(await acceptPendingRequestsFrom(follower, null)).toBe(false);
    expect(_sel.lastTable).toBeNull();
  });
});

describe('isPendingRequestSendBlocked', () => {
  const me = 'me@example.com';
  const them = 'them@example.com';
  const pending = { participant_emails: [me, them], accepted_emails: [me] };

  it('allows the first message into a pending request', () => {
    expect(isPendingRequestSendBlocked(pending, me, 0)).toBe(false);
  });

  it('blocks the second message into a pending request', () => {
    expect(isPendingRequestSendBlocked(pending, me, 1)).toBe(true);
    expect(isPendingRequestSendBlocked(pending, me, 7)).toBe(true);
  });

  it('never blocks once the recipient has accepted', () => {
    const accepted = { participant_emails: [me, them], accepted_emails: [me, them] };
    expect(isPendingRequestSendBlocked(accepted, me, 25)).toBe(false);
  });

  it('never blocks the RECIPIENT of a pending request from replying', () => {
    // `them` sent the request, so only `them` is in accepted_emails.
    // From `me`'s side every other participant has accepted → not gated.
    const inbound = { participant_emails: [me, them], accepted_emails: [them] };
    expect(isPendingRequestSendBlocked(inbound, me, 3)).toBe(false);
  });

  it('exempts group conversations', () => {
    const group = {
      is_group: true,
      participant_emails: [me, them, 'c@x.com'],
      accepted_emails: [me],
    };
    expect(isPendingRequestSendBlocked(group, me, 9)).toBe(false);
  });

  it('exempts conversations without exactly two participants', () => {
    const odd = { participant_emails: [me], accepted_emails: [] };
    expect(isPendingRequestSendBlocked(odd, me, 9)).toBe(false);
  });

  it('is case-insensitive on participant + accepted emails', () => {
    const mixed = {
      participant_emails: ['ME@Example.com', 'Them@Example.com'],
      accepted_emails: ['Me@example.COM'],
    };
    expect(isPendingRequestSendBlocked(mixed, me, 1)).toBe(true);
  });

  it('returns false for missing inputs', () => {
    expect(isPendingRequestSendBlocked(null, me, 5)).toBe(false);
    expect(isPendingRequestSendBlocked(pending, null, 5)).toBe(false);
  });

  // The cap counts MESSAGE ROWS, never media. A request's single allowed
  // message may carry an image / video / sticker / GIF / voice memo, and
  // an image message uses up that one slot exactly like a text message.
  it('lets the first message carry media', () => {
    expect(isPendingRequestSendBlocked(pending, me, 0)).toBe(false);
  });

  it('counts an image message as the one allowed message', () => {
    // The caller derives myMessageCount from the thread; whether that
    // one row was text or an attachment is irrelevant to the rule.
    expect(isPendingRequestSendBlocked(pending, me, 1)).toBe(true);
  });
});
