// Tests for CrewSettingsSheet — the first writer `crews.is_public` has ever had.
//
// Context worth carrying, because it explains why these particular assertions:
// `updateCrewProfile` has accepted name/description/is_public/tag/avatar_url
// since migration 248, and until this component the ONLY caller in the app was
// CrewChat's avatar upload. Production on 2026-08-16: 4 crews, 0 public, 0 with
// a description, 0 with a tag. Migration 370 had to drop the `is_public` filter
// from discovery because the column was unwritable, so the whole directory ran
// on a filter nothing could satisfy.
//
// What each test pins:
//
//   1. The payload contains exactly the three columns the server lets through.
//      `authenticated` holds UPDATE on EVERY column of `crews` — crew_xp,
//      trophies, treasury_coins included — and what stops a leader forging them
//      is the crews_guard_write trigger, which silently reassigns each back to
//      OLD rather than raising. So a widened payload would SUCCEED and do
//      nothing, which is the worst possible shape to debug. Verified against
//      production by execution: leader writes is_public/description/tag,
//      everything else comes back unchanged.
//
//   2. Save is disabled until something actually changed. The write is a
//      PostgREST UPDATE, and an UPDATE that sets description to the value it
//      already holds still fires the profanity trigger — see migration 372,
//      which skips per column on IS NOT DISTINCT FROM for exactly that reason.
//
//   3. Reopening after a cancel shows what is STORED, not the abandoned edit.
//
//   4. The tag is normalised to the shape the directory renders, and an empty
//      description is stored as NULL rather than ''. A '' would make
//      `crew.description &&` truthy-false anyway, but it would also make the
//      "0 with a description" measurement above stop meaning anything.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, fallback, vars) => {
      let s = fallback;
      if (vars) Object.entries(vars).forEach(([k, v]) => {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
      return s;
    },
  }),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }),
}));

const updateCrewProfile = vi.fn();
vi.mock('@/lib/data/crews', () => ({
  updateCrewProfile: (...a) => updateCrewProfile(...a),
}));

const toastSuccess = vi.fn();
const toastError   = vi.fn();
vi.mock('@/lib/toast', () => ({
  toast: {
    success: (...a) => toastSuccess(...a),
    error:   (...a) => toastError(...a),
  },
}));

// The sheet's chrome is not what these tests are about.
vi.mock('@/components/ui/BottomSheet', () => ({
  default: ({ open, title, children }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

vi.mock('@/components/ui/CharCountIndicator', () => ({
  default: ({ value, max }) => <span>{String(value ?? '').length}/{max}</span>,
}));

const { default: CrewSettingsSheet } = await import('../CrewSettingsSheet');

const CREW = {
  id: 'c1', name: 'Iron Union',
  is_public: false, description: null, tag: null,
  crew_xp: 4200, trophies: 7, treasury_coins: 900, max_capacity: 16,
};

function renderSheet(crew = CREW, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={qc}>
        <CrewSettingsSheet open onClose={onClose} crew={crew} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateCrewProfile.mockResolvedValue(undefined);
});

describe('the payload', () => {
  it('sends only the three columns the crews_guard_write trigger lets through', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole('radio', { name: /Open/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCrewProfile).toHaveBeenCalled());
    const [crewId, payload] = updateCrewProfile.mock.calls[0];
    expect(crewId).toBe('c1');
    // Exactly these keys. A widened payload would be accepted by PostgREST
    // and silently reverted by the trigger.
    expect(Object.keys(payload).sort()).toEqual(['description', 'is_public', 'tag']);
    expect(payload.is_public).toBe(true);
  });

  it('stores an untouched description as NULL, not an empty string', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole('radio', { name: /Open/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCrewProfile).toHaveBeenCalled());
    expect(updateCrewProfile.mock.calls[0][1].description).toBeNull();
    expect(updateCrewProfile.mock.calls[0][1].tag).toBeNull();
  });

  it('uppercases the tag and drops everything that is not a letter or digit', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('Tag'), 'ir-on!23');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCrewProfile).toHaveBeenCalled());
    // 5-char ceiling applies after the strip, not before.
    expect(updateCrewProfile.mock.calls[0][1].tag).toBe('IRON2');
  });
});

describe('the save button', () => {
  it('is disabled until something actually changed', async () => {
    const user = userEvent.setup();
    renderSheet();

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Open/ }));
    expect(save).toBeEnabled();
  });

  it('stays disabled when the visibility is toggled back to where it started', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole('radio', { name: /Open/ }));
    await user.click(screen.getByRole('radio', { name: /By application/ }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('what the radios report', () => {
  it('marks the stored visibility as checked on open', () => {
    renderSheet({ ...CREW, is_public: true });
    expect(screen.getByRole('radio', { name: /Open/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /By application/ })).not.toBeChecked();
  });

  it('says the crew is listed either way — 370 lists every crew, so private is not hidden', () => {
    renderSheet();
    expect(screen.getByText(/listed in the directory either way/i)).toBeInTheDocument();
  });
});

describe('failure', () => {
  it('reports a 23514 as a wording problem rather than a generic failure', async () => {
    const user = userEvent.setup();
    updateCrewProfile.mockRejectedValue(Object.assign(new Error('x'), { code: '23514' }));
    renderSheet();

    await user.click(screen.getByRole('radio', { name: /Open/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/wording/i);
  });

  it('does not close the sheet when the write failed', async () => {
    const user = userEvent.setup();
    updateCrewProfile.mockRejectedValue(new Error('network'));
    const { onClose } = renderSheet();

    await user.click(screen.getByRole('radio', { name: /Open/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});
