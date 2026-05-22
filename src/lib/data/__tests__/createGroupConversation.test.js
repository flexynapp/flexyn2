// Tests for createGroupConversation in src/lib/data/hubMessages.js —
// the wrapper around mig 116's create_group_conversation RPC. Verifies
// input validation, RPC call shape, and error propagation.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => rpcSpy(...args),
    // hubMessages.js imports `supabase` and indirectly pulls in
    // api/db.js which calls supabase.auth.onAuthStateChange at
    // module-load. Stub it so the import succeeds.
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: async () => ({ data: { user: null } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

const { createGroupConversation } = await import('../hubMessages');

beforeEach(() => {
  rpcSpy.mockReset();
});

describe('createGroupConversation', () => {
  it('throws when fewer than 2 participants are supplied', async () => {
    await expect(createGroupConversation([])).rejects.toThrow(/group_min/);
    await expect(createGroupConversation(['a@x.com'])).rejects.toThrow(/group_min/);
    await expect(createGroupConversation(null)).rejects.toThrow(/group_min/);
  });

  it('calls the RPC with the email array + null title by default', async () => {
    rpcSpy.mockResolvedValueOnce({ data: 'new-conv-id', error: null });
    const id = await createGroupConversation(['a@x.com', 'b@x.com']);
    expect(id).toBe('new-conv-id');
    expect(rpcSpy).toHaveBeenCalledWith('create_group_conversation', {
      p_emails: ['a@x.com', 'b@x.com'],
      p_title:  null,
    });
  });

  it('passes a non-null title through', async () => {
    rpcSpy.mockResolvedValueOnce({ data: 'id', error: null });
    await createGroupConversation(['a@x.com', 'b@x.com'], 'Squad goals');
    expect(rpcSpy.mock.calls[0][1].p_title).toBe('Squad goals');
  });

  it('propagates server-side validation errors (too few / too many)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'too_many_participants' } });
    await expect(createGroupConversation(['a@x.com', 'b@x.com']))
      .rejects.toMatchObject({ code: '22023' });
  });

  it('propagates auth failures (42501)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'unauthenticated' } });
    await expect(createGroupConversation(['a@x.com', 'b@x.com']))
      .rejects.toMatchObject({ code: '42501' });
  });
});
