// The extractor behind `npm run schema:columns`.
//
// Its whole value is precision. The first, ad-hoc version of this sweep
// produced 16 findings against production and 15 of them were its own fault —
// a 94% false-positive rate, which is the rate at which a checker gets muted.
// Both causes are pinned below, because both looked completely plausible in
// the output and only fell over when each hit was read against the source.
//
// It is allowed to miss things: a dynamic column name or a `select('*')` read
// is out of reach for any static pass. It is not allowed to invent them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractPairs, chainAfter, stripComments } from '../../../scripts/schema-columns.mjs';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schemacols-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
const pairsOf = () => extractPairs(dir).map((p) => `${p.table}.${p.column}`);

describe('schema-columns extractor', () => {
  it('takes columns from an explicit select list and from filters', () => {
    write('a.js', `
      const { data } = await supabase
        .from('nutrition_logs')
        .select('calories, protein, carbs')
        .eq('created_by', email)
        .order('date', { ascending: false });
    `);
    expect(pairsOf().sort()).toEqual([
      'nutrition_logs.calories', 'nutrition_logs.carbs',
      'nutrition_logs.created_by', 'nutrition_logs.date', 'nutrition_logs.protein',
    ]);
  });

  it('TRAP 1: a storage bucket is not a table', () => {
    // `supabase.storage.from('uploads')` names a BUCKET. Counting it reported
    // `uploads.id` as a missing column on a table that does not exist.
    write('a.js', `
      await supabase.storage.from('uploads').upload(path, file);
      const { data } = supabase.storage.from('uploads').getPublicUrl(path);
    `);
    expect(pairsOf()).toEqual([]);
  });

  it('TRAP 2: a chain stops at its own statement, not N characters later', () => {
    // This is the exact shape that reported `duels.username`: a `.from('duels')`
    // select, then a SEPARATE selectProfiles call underneath whose columns a
    // fixed-size window swallowed and attributed to duels.
    write('a.js', `
      const { data } = await supabase
        .from('duels')
        .select('id, status')
        .eq('challenger_id', me);

      const { data: profiles } = await selectProfiles((from) => from
        .select('id, username, avatar_url')
        .in('id', ids));
    `);
    const pairs = pairsOf();
    expect(pairs).toContain('duels.id');
    expect(pairs).toContain('duels.status');
    expect(pairs).not.toContain('duels.username');
    expect(pairs).not.toContain('duels.avatar_url');
    // ...and they land where they belong.
    expect(pairs).toContain('public_profiles.username');
  });

  it('attributes selectProfiles to the public_profiles view', () => {
    // The call shape that shipped `public_profiles.email` after mig 220
    // dropped the column.
    write('a.js', `
      const { data } = await selectProfiles((from) => from
        .select('id, email')
        .eq('id', targetId));
    `);
    expect(pairsOf().sort()).toEqual(['public_profiles.email', 'public_profiles.id']);
  });

  it('reads table specs written as data', () => {
    // dataExport.js feeds `.from(spec.table).eq(spec.column, ...)` from a
    // list like this. Five of its entries named a table or column that did
    // not exist and the literal-only pass could not see any of them.
    write('a.js', `
      const EXPORT_TABLES = [
        { name: 'injuries', table: 'injury_logs', column: 'user_id', via: 'id' },
        { name: 'x',        table: 'achievements', column: 'created_by', via: 'email' },
      ];
    `);
    expect(pairsOf().sort()).toEqual(['achievements.created_by', 'injury_logs.user_id']);
  });

  it('ignores select("*") and relationship embeds', () => {
    // `*` names nothing checkable, and `user:public_profiles(...)` is a
    // relationship — neither is a column on this table.
    write('a.js', `
      await supabase.from('league_members').select('*').eq('league_id', id);
      await supabase.from('league_members').select(\`
        *,
        user:public_profiles ( username, avatar_url )
      \`).eq('league_id', id);
    `);
    expect(pairsOf()).toEqual(['league_members.league_id']);
  });

  it('does not read columns out of comments', () => {
    write('a.js', `
      // .from('ghost_table').select('nope')
      /* .eq('also_nope', 1) */
      await supabase.from('real_table').select('id');
    `);
    expect(pairsOf()).toEqual(['real_table.id']);
  });

  it('keeps a quoted "//" out of the comment stripper', () => {
    const src = stripComments(`const u = 'https://x.test/a'; // trailing`);
    expect(src).toContain("'https://x.test/a'");
    expect(src).not.toContain('trailing');
  });

  it('chainAfter stops at a closing brace, not just a semicolon', () => {
    // Inside a callback the statement often ends with `)` or `}` rather than
    // `;`, and overrunning there is the same bug as trap 2.
    const src = `from('a').select('x')} , other.select('y')`;
    expect(chainAfter(src, 'from(\'a\')'.length)).not.toContain('y');
  });

  it('deduplicates and records every file a pair came from', () => {
    write('a.js', `await supabase.from('t').select('c');`);
    write('b.js', `await supabase.from('t').eq('c', 1);`);
    const pairs = extractPairs(dir);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].files).toHaveLength(2);
  });
});
