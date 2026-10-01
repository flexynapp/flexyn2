/**
 * Reporting a player from a competition row.
 *
 * What these pin:
 *  - the ⋯ never appears on your own row (or for a signed-out viewer);
 *  - tapping it never also opens the row it sits in (league rows open the
 *    profile on tap, so a leak there navigates away from the report);
 *  - the dialog sends the reason, where it was filed and the note, and
 *    confirms in place;
 *  - a reason already reported shows as sent and cannot be picked again;
 *  - the daily cap is explained in the dialog, not swallowed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});

const rpc = vi.fn();
const pendingReasons = vi.fn();
vi.mock('@/api/supabaseClient', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (res, rej) => Promise.resolve(pendingReasons()).then(res, rej),
  };
  return { supabase: { rpc: (...a) => rpc(...a), from: () => chain } };
});
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const { default: PlayerMenu } = await import('../PlayerMenu');
const { default: ReportPlayerSheet } = await import('../ReportPlayerSheet');
const { reportPlayer } = await import('@/lib/data/playerReports');

beforeEach(() => {
  rpc.mockReset();
  pendingReasons.mockReset();
  pendingReasons.mockReturnValue({ data: [], error: null });
});
afterEach(cleanup);

describe('PlayerMenu', () => {
  it('renders nothing on your own row', () => {
    const { container } = render(<PlayerMenu userId="me" currentUserId="me" username="me" context="league" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing without a viewer or a target', () => {
    const a = render(<PlayerMenu userId="u1" currentUserId={null} context="league" />);
    expect(a.container.innerHTML).toBe('');
    const b = render(<PlayerMenu userId={null} currentUserId="me" context="league" />);
    expect(b.container.innerHTML).toBe('');
  });

  it('names the player and does not open the row it sits in', () => {
    const onRow = vi.fn();
    render(
      <div onClick={onRow} onPointerDown={onRow}>
        <PlayerMenu userId="u1" currentUserId="me" username="bigbench" context="league" />
      </div>,
    );
    const btn = screen.getByRole('button', { name: 'More options for @bigbench' });
    fireEvent.pointerDown(btn);
    fireEvent.click(btn);
    expect(onRow).not.toHaveBeenCalled();
  });
});

describe('ReportPlayerSheet', () => {
  const show = (props = {}) => render(
    <ReportPlayerSheet open onClose={() => {}} userId="u1" username="bigbench" context="league" contextId="lg1" {...props} />,
  );

  it('sends reason, context and note, then confirms in place', async () => {
    rpc.mockResolvedValue({ data: { status: 'filed', id: 'r1' }, error: null });
    show();
    expect(screen.getByText('Report @bigbench')).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Send report' });
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Impossible lifts or numbers' }));
    fireEvent.change(screen.getByPlaceholderText('What gave it away? Optional'), { target: { value: ' 600 lb bench at 140 lb ' } });
    fireEvent.click(send);
    await screen.findByText('Report sent');
    expect(rpc).toHaveBeenCalledWith('report_user', {
      p_user_id: 'u1', p_reason: 'cheating', p_context: 'league', p_context_id: 'lg1',
      p_detail: '600 lb bench at 140 lb',
    });
  });

  it('marks a reason already reported as sent', async () => {
    pendingReasons.mockReturnValue({ data: [{ reason: 'fake_activity' }], error: null });
    show();
    const row = screen.getByRole('radio', { name: /Fake workouts or cardio/ });
    await waitFor(() => expect(row.disabled).toBe(true));
    expect(screen.getByText('Sent')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Impossible lifts or numbers' }).disabled).toBe(false);
  });

  it('explains the daily cap in the dialog', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '54000', message: 'report_rate_limited' } });
    show();
    fireEvent.click(screen.getByRole('radio', { name: 'Spam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/lot of reports today/);
    expect(screen.queryByText('Report sent')).toBeNull();
  });
});

describe('reportPlayer', () => {
  it("answers 'already' when the server already has this report", async () => {
    rpc.mockResolvedValue({ data: { status: 'already' }, error: null });
    await expect(reportPlayer({ userId: 'u1', reason: 'cheating' })).resolves.toBe('already');
  });

  it('rethrows any other failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'invalid_target' } });
    await expect(reportPlayer({ userId: 'u1', reason: 'cheating' })).rejects.toMatchObject({ code: '22023' });
  });
});
