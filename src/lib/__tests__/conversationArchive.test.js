// Tests for src/lib/conversationArchive.js — the localStorage-backed
// archive helper for DM conversations. Covers archive / unarchive /
// partitioning + the auto-unarchive-on-new-activity branch.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  archive,
  unarchive,
  isArchived,
  partitionByArchive,
  clearAll,
} from '../conversationArchive';

beforeEach(() => {
  clearAll();
});

describe('archive / unarchive / isArchived', () => {
  it('archives an id and reports it via isArchived', () => {
    expect(isArchived('c1')).toBe(false);
    archive('c1');
    expect(isArchived('c1')).toBe(true);
  });

  it('unarchives an id', () => {
    archive('c1');
    unarchive('c1');
    expect(isArchived('c1')).toBe(false);
  });

  it('no-ops on null/undefined input', () => {
    expect(() => archive(null)).not.toThrow();
    expect(() => unarchive(undefined)).not.toThrow();
    expect(isArchived(null)).toBe(false);
  });

  it('is per-id (archiving one does not affect another)', () => {
    archive('c1');
    archive('c2');
    unarchive('c1');
    expect(isArchived('c1')).toBe(false);
    expect(isArchived('c2')).toBe(true);
  });
});

describe('partitionByArchive', () => {
  it('splits conversations into active + archived', () => {
    archive('c2');
    const { active, archived } = partitionByArchive([
      { id: 'c1', last_message_at: '2025-05-01T00:00:00Z' },
      { id: 'c2', last_message_at: '2025-05-01T00:00:00Z' },
      { id: 'c3', last_message_at: '2025-05-01T00:00:00Z' },
    ]);
    expect(active.map(c => c.id)).toEqual(['c1', 'c3']);
    expect(archived.map(c => c.id)).toEqual(['c2']);
  });

  it('auto-unarchives a conversation when a fresher message lands', () => {
    archive('c1');
    // Last message is AFTER the archive moment (within the same ms
    // resolution is unlikely in practice, but advance the timer once).
    const now = new Date();
    const fresh = new Date(now.getTime() + 60_000).toISOString();
    const { active, archived } = partitionByArchive([
      { id: 'c1', last_message_at: fresh },
    ]);
    expect(active.map(c => c.id)).toEqual(['c1']);
    expect(archived).toEqual([]);
    // And the helper cleared the archive flag so the next read agrees.
    expect(isArchived('c1')).toBe(false);
  });

  it('keeps a conversation archived when the latest message is OLD', () => {
    archive('c1');
    const stale = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { active, archived } = partitionByArchive([
      { id: 'c1', last_message_at: stale },
    ]);
    expect(active).toEqual([]);
    expect(archived.map(c => c.id)).toEqual(['c1']);
  });

  it('returns empty arrays for null input', () => {
    expect(partitionByArchive(null)).toEqual({ active: [], archived: [] });
  });
});
