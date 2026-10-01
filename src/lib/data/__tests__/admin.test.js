// Unit tests for src/lib/data/admin.js — the three moderator RPC
// client wrappers. We mock supabase.rpc to verify the call shape
// (function name, arg keys) and the throw-on-error contract.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => rpcSpy(...args),
  },
}));

const { listReports, resolveReport, deleteReportedContent } = await import('../admin');

beforeEach(() => {
  rpcSpy.mockReset();
});

describe('listReports', () => {
  it('defaults to status=pending and limit=50', async () => {
    rpcSpy.mockResolvedValueOnce({ data: [], error: null });
    await listReports();
    expect(rpcSpy).toHaveBeenCalledWith('list_reports_for_admin', {
      p_status: 'pending',
      p_limit:  50,
      p_kind:   null,
    });
  });

  it('passes through caller-supplied status + limit', async () => {
    rpcSpy.mockResolvedValueOnce({ data: [], error: null });
    await listReports({ status: 'reviewed', limit: 10 });
    expect(rpcSpy).toHaveBeenCalledWith('list_reports_for_admin', {
      p_status: 'reviewed',
      p_limit:  10,
      p_kind:   null,
    });
  });

  it('narrows to player or content reports when asked', async () => {
    rpcSpy.mockResolvedValueOnce({ data: [], error: null });
    await listReports({ kind: 'user' });
    expect(rpcSpy).toHaveBeenCalledWith('list_reports_for_admin', {
      p_status: 'pending',
      p_limit:  50,
      p_kind:   'user',
    });
  });

  it('returns the rows when the RPC succeeds', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: [{ id: 'r1', reason: 'spam' }, { id: 'r2', reason: 'harassment' }],
      error: null,
    });
    const rows = await listReports();
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('r1');
  });

  it('throws when the RPC returns an error (admin_only path)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'admin_only' } });
    await expect(listReports()).rejects.toMatchObject({ code: '42501' });
  });

  it('returns [] when RPC succeeds but data is null', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: null });
    const rows = await listReports();
    expect(rows).toEqual([]);
  });
});

describe('resolveReport', () => {
  it('passes report id + action to the RPC', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: null });
    await resolveReport('r-abc', 'reviewed');
    expect(rpcSpy).toHaveBeenCalledWith('resolve_report', {
      p_report_id: 'r-abc',
      p_action:    'reviewed',
    });
  });

  it('throws on error', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid_action' } });
    await expect(resolveReport('r1', 'bogus')).rejects.toMatchObject({ code: '22023' });
  });
});

describe('deleteReportedContent', () => {
  it('passes the report id to the RPC', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: null });
    await deleteReportedContent('r-xyz');
    expect(rpcSpy).toHaveBeenCalledWith('delete_reported_content', {
      p_report_id: 'r-xyz',
    });
  });

  it('throws on error', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'admin_only' } });
    await expect(deleteReportedContent('r1')).rejects.toMatchObject({ code: '42501' });
  });
});
