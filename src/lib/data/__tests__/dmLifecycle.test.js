// Tests for src/lib/data/dmLifecycle.js — wrappers around the
// migration 114 RPCs (delete_my_message / schedule_my_message /
// cancel_my_scheduled_message) plus the listMyScheduled read.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy = vi.fn();
const fromSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => rpcSpy(...args),
    from: (...args) => fromSpy(...args),
  },
}));

const {
  deleteMyMessage,
  scheduleMyMessage,
  cancelMyScheduledMessage,
  listMyScheduled,
} = await import('../dmLifecycle');

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
});

describe('deleteMyMessage', () => {
  it('throws when messageId is missing', async () => {
    await expect(deleteMyMessage(null)).rejects.toThrow();
  });

  it('calls delete_my_message with the id', async () => {
    rpcSpy.mockResolvedValueOnce({ error: null });
    await deleteMyMessage('m1');
    expect(rpcSpy).toHaveBeenCalledWith('delete_my_message', { p_message_id: 'm1' });
  });

  it('propagates RPC errors', async () => {
    rpcSpy.mockResolvedValueOnce({ error: { code: '42501', message: 'unauthenticated' } });
    await expect(deleteMyMessage('m1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('scheduleMyMessage', () => {
  it('throws when required fields are missing', async () => {
    await expect(scheduleMyMessage({ content: 'hi', sendAt: new Date() })).rejects.toThrow();
    await expect(scheduleMyMessage({ conversationId: 'c1', sendAt: new Date() })).rejects.toThrow();
    await expect(scheduleMyMessage({ conversationId: 'c1', content: 'hi' })).rejects.toThrow();
  });

  it('serializes a Date sendAt to ISO before sending', async () => {
    rpcSpy.mockResolvedValueOnce({ data: 'new-id', error: null });
    const when = new Date('2030-01-01T12:00:00Z');
    const id = await scheduleMyMessage({
      conversationId: 'c1', recipientEmail: 'b@x.com', content: 'hi', sendAt: when,
    });
    expect(id).toBe('new-id');
    expect(rpcSpy).toHaveBeenCalledWith('schedule_my_message', {
      p_conversation_id: 'c1',
      p_recipient_email: 'b@x.com',
      p_content:         'hi',
      p_send_at:         when.toISOString(),
    });
  });

  it('passes a string sendAt through unchanged', async () => {
    rpcSpy.mockResolvedValueOnce({ data: 'id', error: null });
    await scheduleMyMessage({
      conversationId: 'c1', recipientEmail: null, content: 'hi',
      sendAt: '2030-01-01T12:00:00Z',
    });
    expect(rpcSpy.mock.calls[0][1].p_send_at).toBe('2030-01-01T12:00:00Z');
    expect(rpcSpy.mock.calls[0][1].p_recipient_email).toBeNull();
  });

  it('throws on RPC error (send_at_in_past, etc.)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'send_at_in_past' } });
    await expect(scheduleMyMessage({
      conversationId: 'c1', content: 'hi', sendAt: '2020-01-01',
    })).rejects.toMatchObject({ code: '22023' });
  });
});

describe('cancelMyScheduledMessage', () => {
  it('throws when messageId is missing', async () => {
    await expect(cancelMyScheduledMessage(null)).rejects.toThrow();
  });

  it('calls cancel_my_scheduled_message with the id', async () => {
    rpcSpy.mockResolvedValueOnce({ error: null });
    await cancelMyScheduledMessage('m1');
    expect(rpcSpy).toHaveBeenCalledWith('cancel_my_scheduled_message', { p_message_id: 'm1' });
  });
});

describe('listMyScheduled', () => {
  it('returns [] for null userId', async () => {
    expect(await listMyScheduled(null)).toEqual([]);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('filters by user_id + scheduled status, sorted ascending by send time', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'm1' }], error: null });
    const eq2 = vi.fn().mockReturnValue({ order });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    fromSpy.mockReturnValue({ select });

    const rows = await listMyScheduled('u1');
    expect(fromSpy).toHaveBeenCalledWith('hub_messages');
    expect(eq1).toHaveBeenCalledWith('user_id', 'u1');
    expect(eq2).toHaveBeenCalledWith('status', 'scheduled');
    expect(order).toHaveBeenCalledWith('scheduled_at', { ascending: true });
    expect(rows).toHaveLength(1);
  });

  it('returns [] on supabase error', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { code: 'X' } });
    fromSpy.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ order }) }) }) });
    expect(await listMyScheduled('u1')).toEqual([]);
  });
});
