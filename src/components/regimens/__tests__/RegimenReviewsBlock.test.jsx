// src/components/regimens/__tests__/RegimenReviewsBlock.test.jsx
//
// The FIRST component test for any regimen component. Before this file
// there was no src/components/regimens/__tests__/ directory at all and
// nothing in src/components/__tests__/ matched — roughly 2,900 untested
// lines across the five largest files on the surface.
//
// Why this component first, out of eight candidates: it is the client
// half of the only live integrity defect the 2026-08-12 audit found.
//
// `trg_enforce_review_adoption` had never blocked a non-owner since it
// shipped in migration 118 — it queried `parent_regimen_id` / `parent_id`,
// neither of which exists on public.regimens, and its own
// `EXCEPTION WHEN undefined_column THEN RETURN NEW` swallowed the error
// and allowed the insert. Proven by execution against production: a guest
// account inserted a 5-star review on a regimen it neither owned nor
// cloned. Migration 346 points the guard at `original_template_id`, which
// exists and which every clone path already writes.
//
// The consequence for THIS file is what the tests below pin. The client
// already maps 42501 → 'needs_adoption' and already renders an amber
// hint for it, and that branch has executed ZERO times in production —
// not because it is wrong, but because the server never produced the
// error it handles. Migration 346 makes it reachable for the first time.
// A branch about to go from never-run to routinely-run should have a test
// before it ships, not after.
//
// NOT characterization tests. Every assertion here describes intended
// behaviour; if one fails, fix the code.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock at the supabase layer, not by reassigning the data module's
// exports — ESM exports are immutable bindings and `regimenReviews.submit
// = …` fails the dep scan outright. A stub keyed by table name also
// proves which table the component's data layer actually reads.
const upsertMock = vi.fn();
const selectRows = { regimen_reviews: [] };

vi.mock('@/api/supabaseClient', () => {
  const chain = (table) => {
    // One thenable that resolves at ANY depth — different callers bottom
    // out at different methods (.limit(), .single(), .maybeSingle()).
    const result = { data: selectRows[table] ?? [], error: null };
    const node = {
      select: () => node,
      eq: () => node,
      in: () => node,
      order: () => node,
      limit: () => node,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      upsert: (...args) => upsertMock(table, ...args),
      then: (res, rej) => Promise.resolve(result).then(res, rej),
    };
    return node;
  };
  return { supabase: { from: (table) => chain(table) } };
});

// vi.mock is hoisted above every top-level statement, so a factory that
// dereferences a plain const at EVALUATION time throws "Cannot access
// before initialization". vi.hoisted is the escape hatch. (The supabase
// factory above gets away with a plain const only because it touches it
// lazily, inside chain(), which runs at call time.)
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: toastMock }));

import RegimenReviewsBlock from '../RegimenReviewsBlock';

const USER = { id: 'u-1', email: 'stranger@example.com' };
const REGIMEN_ID = 'r-1';

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RegimenReviewsBlock regimenId={REGIMEN_ID} user={USER} />
    </QueryClientProvider>,
  );
}

// Wait for the query to settle before asserting on anything derived from
// it. The empty-state copy renders outside the isLoading branch, so an
// early read finds it while the fixture is still resolving and the
// assertion proves nothing.
async function mountSettled() {
  const view = mount();
  await screen.findByText(/no reviews yet/i);
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectRows.regimen_reviews = [];
  upsertMock.mockResolvedValue({ error: null });
});

describe('RegimenReviewsBlock', () => {
  it('renders the empty state production is actually in — 0 reviews, not a zero', async () => {
    await mountSettled();
    // regimen_reviews holds 0 rows in production. The block must say so
    // in words rather than drawing "0.0 ★ · 0", per the rule that a
    // section with no data must not render as zeros.
    expect(screen.getByText(/no reviews yet — be the first/i)).toBeInTheDocument();
    expect(screen.queryByText(/^0\.0/)).not.toBeInTheDocument();
  });

  it('surfaces the adoption refusal instead of a generic failure', async () => {
    // What migration 346 makes reachable for the first time: the trigger
    // raises 42501 review_requires_adoption for a non-adopter.
    upsertMock.mockResolvedValue({
      error: { code: '42501', message: 'review_requires_adoption' },
    });
    await mountSettled();

    // Radix-free here, but userEvent regardless — fireEvent.click misses
    // pointerdown-driven controls elsewhere on this surface.
    await userEvent.click(screen.getByRole('button', { name: /rate 4 stars/i }));
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }));

    await waitFor(() => {
      expect(screen.getByText(/adopt the regimen first/i)).toBeInTheDocument();
    });
    // A refusal the user can act on must NOT also fire the generic
    // "could not submit" toast — that reads as a broken app rather than
    // as a rule.
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('maps the trigger error by NAME, not only by SQLSTATE', async () => {
    // 42501 is also plain insufficient_privilege, so the data layer
    // matches on the message too. If a future migration renames the
    // exception this test is what notices.
    upsertMock.mockResolvedValue({
      error: { code: 'P0001', message: 'review_requires_adoption' },
    });
    await mountSettled();
    await userEvent.click(screen.getByRole('button', { name: /rate 5 stars/i }));
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }));
    await waitFor(() => {
      expect(screen.getByText(/adopt the regimen first/i)).toBeInTheDocument();
    });
  });

  it('does not show the adoption hint on a review that succeeds', async () => {
    await mountSettled();
    await userEvent.click(screen.getByRole('button', { name: /rate 5 stars/i }));
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(screen.queryByText(/adopt the regimen first/i)).not.toBeInTheDocument();
    // Assert on the WRITE, not the message: it must reach regimen_reviews.
    expect(upsertMock).toHaveBeenCalledWith(
      'regimen_reviews',
      expect.objectContaining({ regimen_id: REGIMEN_ID, reviewer_id: USER.id, rating: 5 }),
      expect.objectContaining({ onConflict: 'regimen_id,reviewer_id' }),
    );
  });

  it('clears a previous refusal when the user changes their rating', async () => {
    upsertMock.mockResolvedValue({
      error: { code: '42501', message: 'review_requires_adoption' },
    });
    await mountSettled();
    await userEvent.click(screen.getByRole('button', { name: /rate 3 stars/i }));
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }));
    await waitFor(() => expect(screen.getByText(/adopt the regimen first/i)).toBeInTheDocument());

    // The hint is about adoption, not about the rating — leaving it up
    // while the user fiddles with stars would read as "4 stars is
    // invalid".
    await userEvent.click(screen.getByRole('button', { name: /rate 4 stars/i }));
    expect(screen.queryByText(/adopt the regimen first/i)).not.toBeInTheDocument();
  });

  it('offers no submit control until a rating is chosen', async () => {
    await mountSettled();
    expect(screen.queryByRole('button', { name: /submit review/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /rate 1 star/i }));
    expect(screen.getByRole('button', { name: /submit review/i })).toBeInTheDocument();
  });
});
