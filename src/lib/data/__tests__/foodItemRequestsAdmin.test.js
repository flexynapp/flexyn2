// The admin half of the food-request queue (migration 343).
//
// Approving is the only action anywhere in the moderation UI that PUBLISHES:
// it writes a `food_items` row that every future scan of that barcode
// returns. So the call shape matters more here than for the other queues —
// a wrong RPC name or a swallowed error means either nothing reaches the
// catalogue, or an admin believes something did when it did not.
//
// Same mocked-rpc shape as admin.test.js next door.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: (...args) => rpcSpy(...args) },
}));

const { listFoodItemRequests, approveFoodItemRequest, rejectFoodItemRequest } =
  await import('../admin');

beforeEach(() => { rpcSpy.mockReset(); });

describe('listFoodItemRequests', () => {
  it('defaults to the pending queue', async () => {
    rpcSpy.mockResolvedValueOnce({ data: [], error: null });
    await listFoodItemRequests();
    expect(rpcSpy).toHaveBeenCalledWith('list_food_item_requests_for_admin', {
      p_status: 'pending',
      p_limit:  50,
    });
  });

  it('passes through status and limit', async () => {
    rpcSpy.mockResolvedValueOnce({ data: [], error: null });
    await listFoodItemRequests({ status: 'approved', limit: 10 });
    expect(rpcSpy).toHaveBeenCalledWith('list_food_item_requests_for_admin', {
      p_status: 'approved',
      p_limit:  10,
    });
  });

  it('returns the rows, including the jsonb payload the reviewer reads', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: [{ id: 'q1', name: 'Protein Bar', nutrition: { calories: 210, protein: 20 } }],
      error: null,
    });
    const rows = await listFoodItemRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0].nutrition.calories).toBe(210);
  });

  it('degrades to an empty queue on a pre-migration host', async () => {
    // 42883 undefined_function / 42P01 undefined_table — the RPC or table is
    // not there yet. An admin opening the tab should see "none", not a crash.
    for (const code of ['42883', '42P01']) {
      rpcSpy.mockResolvedValueOnce({ data: null, error: { code } });
      await expect(listFoodItemRequests()).resolves.toEqual([]);
    }
  });

  it('still throws on a REAL error, so a permission problem is visible', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'admin_only' } });
    await expect(listFoodItemRequests()).rejects.toMatchObject({ code: '42501' });
  });
});

describe('approveFoodItemRequest', () => {
  it('calls the RPC with the request id and returns the new catalogue row id', async () => {
    rpcSpy.mockResolvedValueOnce({ data: 'new-food-item-uuid', error: null });
    const id = await approveFoodItemRequest('req-1');
    expect(rpcSpy).toHaveBeenCalledWith('approve_food_item_request', { p_request_id: 'req-1' });
    expect(id).toBe('new-food-item-uuid');
  });

  it('propagates 22023 so the caller can say "already handled"', async () => {
    // The RPC refuses a second approval rather than creating a duplicate
    // catalogue row. The page maps this to a quiet message, not a retry —
    // but it has to reach the page to do that.
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'already reviewed' } });
    await expect(approveFoodItemRequest('req-1')).rejects.toMatchObject({ code: '22023' });
  });

  it('propagates the admin gate rather than resolving quietly', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'admin_only' } });
    await expect(approveFoodItemRequest('req-1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('rejectFoodItemRequest', () => {
  it('calls the RPC with the request id', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: null });
    await rejectFoodItemRequest('req-2');
    expect(rpcSpy).toHaveBeenCalledWith('reject_food_item_request', { p_request_id: 'req-2' });
  });

  it('throws on error', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await expect(rejectFoodItemRequest('req-2')).rejects.toMatchObject({ code: '42501' });
  });

  it('never reaches the approve RPC — rejecting must not publish', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: null });
    await rejectFoodItemRequest('req-2');
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy.mock.calls[0][0]).not.toBe('approve_food_item_request');
  });
});
