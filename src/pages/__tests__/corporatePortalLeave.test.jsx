// Leaving an organization as its admin.
//
// The server rule is the trigger enforce_last_admin_leave on
// organization_members: an admin may not leave while they are the ONLY admin
// AND someone else is still a member. A sole admin who is also the sole
// member may leave.
//
// The client guard used to block every sole admin, including one alone in
// the org, and told them to "promote another member first, or delete the
// organization in Settings". Neither control exists. These tests pin the
// guard to the server's rule and the copy to what the app can actually do.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: { error: (...a) => toastError(...a), success: (...a) => toastSuccess(...a) } }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@x.com' } }) }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));

// The guard reads every member's role for the org.
let memberRows = [];
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => Promise.resolve({ data: memberRows, error: null }),
      };
      return chain;
    },
  },
}));

const leaveOrganization = vi.fn();
vi.mock('@/lib/data/organizations', () => ({
  listMyOrganizations: () => Promise.resolve([
    { id: 'org1', name: 'Acme', join_code: 'ABCDEFGH', role: 'admin' },
  ]),
  createOrganization: vi.fn(),
  joinOrganizationByCode: vi.fn(),
  leaveOrganization: (...a) => leaveOrganization(...a),
  listChallenges: () => Promise.resolve([]),
  createChallenge: vi.fn(),
  deleteChallenge: vi.fn(),
  getOrgAnalytics: () => Promise.resolve(null),
  getMemberCount: () => Promise.resolve(memberRows.length),
}));

const { default: CorporatePortal } = await import('../CorporatePortal');

async function clickLeave() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><CorporatePortal /></MemoryRouter>
    </QueryClientProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: /^leave$/i }));
}

let confirmSpy;
beforeEach(() => {
  toastError.mockReset();
  toastSuccess.mockReset();
  leaveOrganization.mockReset();
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => confirmSpy.mockRestore());

describe('CorporatePortal leave, as admin', () => {
  it('blocks the only admin while others are members, without pointing at controls that do not exist', async () => {
    memberRows = [{ role: 'admin' }, { role: 'member' }];
    await clickLeave();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const msg = toastError.mock.calls[0][0];
    expect(msg).toMatch(/only admin of Acme/);
    expect(msg).not.toMatch(/Settings/);
    expect(msg).not.toMatch(/Promote another member first/);
    expect(leaveOrganization).not.toHaveBeenCalled();
  });

  it('lets a sole admin who is also the only member leave, as the server does', async () => {
    memberRows = [{ role: 'admin' }];
    leaveOrganization.mockResolvedValue({ ok: true });
    await clickLeave();
    await waitFor(() => expect(leaveOrganization).toHaveBeenCalledWith('org1', 'me'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('lets an admin leave when another admin remains', async () => {
    memberRows = [{ role: 'admin' }, { role: 'admin' }, { role: 'member' }];
    leaveOrganization.mockResolvedValue({ ok: true });
    await clickLeave();
    await waitFor(() => expect(leaveOrganization).toHaveBeenCalled());
  });

  it('names the rule when the server trigger refuses the leave', async () => {
    // The guard saw two admins (say, a stale read); the trigger still refused.
    memberRows = [{ role: 'admin' }, { role: 'admin' }];
    leaveOrganization.mockResolvedValue({ ok: false, error: 'last_admin_cannot_leave' });
    await clickLeave();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/only admin of Acme/);
  });
});
