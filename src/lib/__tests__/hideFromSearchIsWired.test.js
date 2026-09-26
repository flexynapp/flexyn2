/**
 * "Hide from search" has to be READ by the surfaces it names.
 *
 * The toggle in Settings → Privacy has written `user_profiles.hide_from_search`
 * since migration 117, and its own comment says the flag "removes the account
 * from user-search + PYMK". Nothing read it. `filterSearchable()` in
 * src/lib/privacy.js was written for exactly this job — its docblock says
 * "Used by: User search / PYMK" — and had ZERO call sites; it appeared only in
 * comments. So the setting was inert on every surface that advertises it, with
 * nothing to tell the user.
 *
 * A unit test cannot prove what the server functions do — that is what the
 * self-verification block in migration 377 is for. What it CAN pin is the half
 * that regressed silently: that the client surfaces still reference the flag at
 * all. A filter deleted during a refactor would take the feature with it again
 * and break no other test, which is exactly how it got here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { filterSearchable } from '@/lib/privacy';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

describe('filterSearchable', () => {
  const viewer = { id: 'me', email: 'Me@Example.com' };
  const rows = [
    { id: 'a', email: 'a@x.com', hide_from_search: false },
    { id: 'b', email: 'b@x.com', hide_from_search: true },
    { id: 'c', email: 'c@x.com' },                          // column absent
    { id: 'me', email: 'me@example.com', hide_from_search: true },
  ];

  it('drops hidden profiles and keeps everyone else', () => {
    const ids = filterSearchable(rows, viewer).map(r => r.id);
    expect(ids).toContain('a');
    expect(ids).not.toContain('b');
  });

  it('treats a missing flag as visible', () => {
    // The column is NOT NULL DEFAULT FALSE, but a partial select that omits it
    // must not make a profile vanish from search.
    expect(filterSearchable(rows, viewer).map(r => r.id)).toContain('c');
  });

  it('always keeps the viewer, so you can still find yourself', () => {
    // Matched case-insensitively on email as well as by id, because the two
    // identity shapes are both in use on this surface.
    expect(filterSearchable(rows, viewer).map(r => r.id)).toContain('me');
    expect(filterSearchable(rows, { email: 'ME@EXAMPLE.COM' }).map(r => r.id)).toContain('me');
  });

  it('survives a non-array without throwing', () => {
    expect(filterSearchable(null, viewer)).toEqual([]);
    expect(filterSearchable(undefined, viewer)).toEqual([]);
  });
});

describe('the surfaces that name the setting actually read it', () => {
  it('user search filters the list it holds', () => {
    const src = read('src/components/hub/HubSearchOverlay.jsx');
    expect(src, 'HubSearchOverlay stopped importing filterSearchable').toContain('filterSearchable');
    expect(src.match(/filterSearchable\s*\(/g)?.length, 'imported but never called').toBeGreaterThan(0);
  });

  it('the follow recommendations exclude hidden profiles in the query', () => {
    // Both halves: recent signups and friend-of-friend. Filtering in the query
    // rather than after the fetch keeps a hidden profile off the wire entirely.
    const src = read('src/lib/data/hubFollows.js');
    expect(src.match(/\.not\('hide_from_search', 'is', true\)/g)?.length).toBe(2);
  });

  it('people you may know excludes them too', () => {
    const src = read('src/components/hub/PeopleYouMayKnow.jsx');
    expect(src).toContain("hide_from_search");
  });

  it('the server functions filter on the column', () => {
    // Migration 377 restates both discovery functions. If a later migration
    // replaces either from an older template — the trap CLAUDE.md opens with —
    // this catches the one that dropped the filter.
    const sql = read('supabase/migrations_archive/377_hide_from_search_is_enforced.sql');
    expect(sql).toContain('get_suggested_followees');
    expect(sql).toContain('get_people_you_may_know');
    expect(sql.match(/hide_from_search IS (NOT )?TRUE/g)?.length).toBe(2);
  });
});
