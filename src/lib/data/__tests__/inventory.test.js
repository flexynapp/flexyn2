// Guards the SHAPE of the inventory data layer, not just its behaviour.
//
// `user_inventory` carries exactly two policies for `authenticated` —
// SELECT and DELETE, both scoped to `user_id = auth.uid()`. There is no
// INSERT policy and no UPDATE policy, by design: creating or mutating an
// inventory row is what an economy exploit looks like, so both go through
// SECURITY DEFINER RPCs instead.
//
// This module used to export `addItem` (a bare .insert) and `setListed`
// (a bare .update). Both could only ever return 42501, and `setListed` was
// on the success path of listing and cancelling — so a listing that had
// actually worked threw, landed in the caller's catch, and told the user it
// had failed. Nothing caught it: the functions were never unit-tested, and
// the failure needed a real authenticated session to reproduce, which no
// test in the suite had.
//
// So the assertion here is deliberately about the module's exported surface.
// A bare .insert/.update on this table is unreachable in production; a test
// that mocks Supabase and asserts it "works" would pass while shipping the
// exact bug this replaces.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));

import * as inventory from '../inventory';

describe('inventory data layer — exported surface', () => {
  it('exposes only the operations RLS actually permits', () => {
    expect(Object.keys(inventory).sort()).toEqual([
      'countByType',   // SELECT
      'listItems',     // SELECT
      'removeItem',    // DELETE
      'sellItem',      // sell_inventory_item RPC (server prices and credits)
    ]);
  });

  // Named individually so a re-add fails with a message that says WHY,
  // rather than a diff of two arrays.
  it('does NOT export addItem — grants go through open_capsule_atomic (mig 255)', () => {
    expect(inventory.addItem).toBeUndefined();
  });

  it('does NOT export setListed — is_listed is owned by the marketplace RPCs (migs 025/078)', () => {
    expect(inventory.setListed).toBeUndefined();
  });
});
