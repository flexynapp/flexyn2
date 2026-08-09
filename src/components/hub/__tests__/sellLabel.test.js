// src/components/hub/__tests__/sellLabel.test.js
//
// The bag's sticker sell button said "Sell extra" regardless of how many
// copies you owned, so a user holding exactly one Diamond was offered the
// chance to sell it as a spare. "extra" is a claim that a copy survives the
// sale; it may only be made when one does.

import { describe, it, expect } from 'vitest';
import { sellLabelFor } from '../UserBag';

describe('sellLabelFor — "extra" only when a copy survives', () => {
  it('says plain Sell for the only copy', () => {
    expect(sellLabelFor(1)).toBe('Sell');
  });

  it('says Sell extra once a duplicate exists', () => {
    expect(sellLabelFor(2)).toBe('Sell extra');
    expect(sellLabelFor(7)).toBe('Sell extra');
  });

  // Guards the boundary the bug lived on: a group of one is the ONLY case
  // that must not read "extra", and it is also the most common case.
  it('flips exactly at 2, not at 1 or 3', () => {
    expect(sellLabelFor(1)).not.toContain('extra');
    expect(sellLabelFor(2)).toContain('extra');
    expect(sellLabelFor(3)).toContain('extra');
  });

  // A group is never empty — the card only renders for groups with rows —
  // but a 0 must not claim an extra either if that ever changes.
  it('does not claim an extra for an empty group', () => {
    expect(sellLabelFor(0)).toBe('Sell');
  });
});
