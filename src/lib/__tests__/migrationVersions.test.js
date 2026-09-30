/**
 * Every file in supabase/migrations carries its own version.
 *
 * The Supabase integration records a migration by the timestamp in its file
 * name. Two files with one timestamp means production applies whichever it
 * sees first, records the version, and treats the other as already applied,
 * so it never runs and nothing reports it. That happened on 2026-09-30 when
 * two PRs picked 20260930160000 in the same minute, and the email lock in one
 * of them silently did not reach production. It had happened once before, on
 * 2026-09-27 (fixed by #104).
 */
import { it, expect } from 'vitest';
import { readdirSync } from 'node:fs';

it('no two migrations share a version', () => {
  const files = readdirSync('supabase/migrations').filter((f) => /^\d+_.*\.sql$/.test(f));
  const byVersion = new Map();
  for (const f of files) {
    const v = f.split('_')[0];
    byVersion.set(v, [...(byVersion.get(v) || []), f]);
  }
  const dupes = [...byVersion.values()].filter((list) => list.length > 1);
  expect(dupes).toEqual([]);
  expect(files.length).toBeGreaterThan(3);
});
