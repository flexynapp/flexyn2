#!/usr/bin/env node
// scripts/schema-columns.mjs
//
// Every (table, column) pair the client actually sends to PostgREST, so they
// can be checked against the schema that is really deployed.
//
// WHY THIS EXISTS
//
// A column the client names but the database does not have fails in one of two
// ways, and only one of them is visible:
//
//   • named in an explicit `.select()` or in a FILTER → PostgREST 400s the
//     WHOLE request. `public_profiles.email` and `nutrition_logs.protein_g`
//     both did this, and they at least reached the logs.
//   • named in `select('*')` output and then read off the row → 200, the
//     property is `undefined`, nothing throws and nothing logs. This is the
//     one that hides: `HubComposer` keyed a Map on `u.email` from a view that
//     had dropped it, so no follower was ever notified of a post.
//
// The class is not rare and it is not loud. `hub_reactions.reaction` (the real
// column is `reaction_type`) meant the Likes view on your own profile rendered
// empty from the day it shipped — 47 like rows across 7 users, invisible to
// all of them — and its unit test PINNED the wrong column, because a mocked
// supabase chain can only see the filter's shape, never whether the column is
// real. No test that mocks the client can catch this. Only the schema can.
//
// WHY IT PRINTS SQL INSTEAD OF CHECKING FOR YOU
//
// The honest source of truth is production, and this repo has no offline copy
// of it worth trusting. Migrations are pasted by hand here, so a migration-
// derived column map is a SUPERSET of reality — migration 006 declares
// `nutrition_logs.protein_g` and has never been applied, which is exactly the
// column that broke. A committed snapshot would answer confidently and be
// wrong, which is worse than asking.
//
// So the script owns the hard half — extracting the pairs correctly — and
// hands you a query to paste. Run it in the Supabase SQL editor; anything it
// returns is a column the client references and the database does not have.
//
//   node scripts/schema-columns.mjs            # summary + the SQL to paste
//   node scripts/schema-columns.mjs --sql      # just the SQL
//   node scripts/schema-columns.mjs --json     # the pairs, as JSON
//   node scripts/schema-columns.mjs --check f  # diff against {table:[cols]} JSON
//
// EXTRACTOR TRAPS, both of which produced false positives on the first run
// (16 raw hits, 15 of them this script's own fault):
//
//   1. `supabase.storage.from('uploads')` is a BUCKET, not a table. Counting
//      it reports every storage call as a missing table.
//   2. A fixed-size lookahead window runs past the end of the statement and
//      attributes the NEXT query's columns to this table — which is how
//      `duels.username` and `crew_members.avatar_url` were reported, when
//      both belong to the `selectProfiles(...)` call sitting underneath.
//      The window has to stop at the statement, not at a character count.
//
// Both are covered by tests. A checker with a 94% false-positive rate gets
// muted, and a muted checker is worse than none — the same argument
// _glossary.json makes about do-not-translate exemptions.

import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), 'src');

// Filters that name a column as their first argument. `.not()` is included:
// `.not('username', 'is', null)` names a column exactly like `.eq` does.
const FILTER_CALL =
  /\.(?:eq|neq|gt|gte|lt|lte|like|ilike|in|is|not|order|contains|containedBy|overlaps|rangeGt|rangeLt)\(\s*'([a-z_][a-z0-9_]*)'/g;

/** Strip comments and JSX text, quote-aware, so prose cannot look like code. */
export function stripComments(src) {
  let out = '';
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += src[i + 1] ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * The chain that belongs to ONE `.from(...)`: from the match to the end of its
 * statement. Trap 2 — a fixed window overruns into the next query and steals
 * its columns, so this ends at the first `;` outside any bracket or string, or
 * at the next `.from(` / `selectProfiles(`, whichever comes first.
 */
export function chainAfter(src, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return src.slice(start, i);   // fell out of the call
      depth--;
    } else if (c === ';' && depth === 0) return src.slice(start, i);
    else if (depth === 0 && src.startsWith('.from(', i)) return src.slice(start, i);
    else if (depth === 0 && src.startsWith('selectProfiles(', i)) return src.slice(start, i);
  }
  return src.slice(start);
}

/** True when this `.from(` belongs to the storage client, not PostgREST. */
function isStorageCall(src, fromIndex) {
  // Trap 1. Look back over whitespace/newlines for a `.storage` accessor.
  const before = src.slice(Math.max(0, fromIndex - 60), fromIndex);
  return /\.storage\s*$/.test(before);
}

/** Columns named inside one chain: explicit select lists plus every filter. */
function columnsIn(chain) {
  const cols = new Set();
  for (const m of chain.matchAll(/\.select\(\s*(['"`])([^'"`]*)\1/g)) {
    const body = m[2];
    // `*` tells us nothing, and an embed — `user:public_profiles(...)` — is a
    // relationship, not a column list on this table.
    if (body.includes('*') || body.includes('(')) continue;
    for (const raw of body.split(',')) {
      const col = raw.trim();
      if (/^[a-z_][a-z0-9_]*$/.test(col)) cols.add(col);
    }
  }
  FILTER_CALL.lastIndex = 0;
  for (const m of chain.matchAll(FILTER_CALL)) cols.add(m[1]);
  return cols;
}

/** Walk src/, returning a sorted list of `{ table, column, files }`. */
export function extractPairs(root = SRC) {
  const pairs = new Map();          // "table.column" -> Set(file)
  const add = (table, column, file) => {
    const key = `${table}.${column}`;
    if (!pairs.has(key)) pairs.set(key, new Set());
    pairs.get(key).add(file);
  };

  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p);
        continue;
      }
      if (!/\.jsx?$/.test(e.name)) continue;
      const src = stripComments(fs.readFileSync(p, 'utf8'));
      const rel = path.relative(process.cwd(), p);

      for (const m of src.matchAll(/\.from\(\s*'([a-z_][a-z0-9_]*)'\s*\)/g)) {
        if (isStorageCall(src, m.index)) continue;
        const chain = chainAfter(src, m.index + m[0].length);
        for (const col of columnsIn(chain)) add(m[1], col, rel);
      }

      // selectProfiles((from) => from.select(...)) reads the public_profiles
      // VIEW. Attributed explicitly because this is the exact call shape that
      // shipped `public_profiles.email` — a column mig 220 had dropped.
      for (const m of src.matchAll(/selectProfiles\(/g)) {
        const chain = chainAfter(src, m.index + m[0].length);
        for (const col of columnsIn(chain)) add('public_profiles', col, rel);
      }
    }
  };
  walk(root);

  return [...pairs.entries()]
    .map(([key, files]) => {
      const dot = key.indexOf('.');
      return { table: key.slice(0, dot), column: key.slice(dot + 1), files: [...files].sort() };
    })
    .sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
}

/** The paste-into-the-SQL-editor check. Returns only columns that are absent. */
export function buildSql(pairs) {
  const tokens = pairs.map((p) => `${p.table}.${p.column}`).join(',');
  return `-- ${pairs.length} (table, column) pairs the client sends.
-- Anything this returns is referenced by the app and absent from the database.
-- Read-only.
WITH want AS (
  SELECT split_part(tc, '.', 1) AS t, split_part(tc, '.', 2) AS c
  FROM unnest(string_to_array('${tokens}', ',')) AS tc
)
SELECT w.t AS table_name,
       w.c AS column_name,
       EXISTS (SELECT 1 FROM information_schema.tables it
                WHERE it.table_schema = 'public' AND it.table_name = w.t) AS table_exists
FROM want w
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns ic
   WHERE ic.table_schema = 'public' AND ic.table_name = w.t AND ic.column_name = w.c
)
ORDER BY table_exists DESC, w.t, w.c;`;
}

// ── CLI ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const argv = process.argv.slice(2);
  const pairs = extractPairs();

  if (argv.includes('--json')) {
    console.log(JSON.stringify(pairs, null, 2));
  } else if (argv.includes('--sql')) {
    console.log(buildSql(pairs));
  } else if (argv.includes('--check')) {
    const file = argv[argv.indexOf('--check') + 1];
    const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    const missing = pairs.filter((p) => {
      const cols = schema[p.table];
      return Array.isArray(cols) && !cols.includes(p.column);
    });
    const unknownTables = [...new Set(pairs.filter((p) => !schema[p.table]).map((p) => p.table))];
    for (const m of missing) console.log(`  ${m.table}.${m.column}\n      ${m.files.join('\n      ')}`);
    if (unknownTables.length) {
      console.log(`\n  ${unknownTables.length} table(s) absent from the schema file — refresh it, or they are new:`);
      for (const t of unknownTables) console.log(`      ${t}`);
    }
    console.log(`\n${missing.length} column(s) referenced by the client and missing from the schema.`);
    process.exitCode = missing.length ? 1 : 0;
  } else {
    const tables = new Set(pairs.map((p) => p.table));
    console.log(`${pairs.length} (table, column) pairs across ${tables.size} tables.\n`);
    console.log(buildSql(pairs));
    console.log(`
Paste that into the Supabase SQL editor. An empty result means the client
references nothing the database lacks. Anything it returns is a live defect:
a 400 if the column is named in a select or a filter, and a silent undefined
if it is read off a select('*') row.`);
  }
}
