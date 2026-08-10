// src/lib/__tests__/migrationCatalog.test.js
//
// Pins the migration catalog in docs/migrations-runbook.md to the files in
// supabase/migrations/, in both directions.
//
// The catalog is hand-maintained and nothing regenerates it, so it drifts
// silently: adding a migration is a code change, adding its catalog row is an
// act of memory. It had reached 54 rows against 363 files — every migration
// since 2026-05 was missing, including all three storage-GC fixes and every
// pipeline whose config lives outside supabase/migrations/. A table that
// claims to enumerate the migrations while omitting 85% of them is worse than
// no table, because it is consulted and believed.
//
// Both directions matter, for different reasons:
//   • A file with no row is the drift above — the catalog quietly shrinks
//     relative to reality.
//   • A row with no file is a rename or deletion that left the doc behind,
//     which sends a reader looking for something that does not exist.
//
// This is a DOC test, not a schema test. It says nothing about whether a
// migration is correct, applied, or even valid SQL — only that the catalog
// knows it exists. Everything about actually applying migrations is in the
// runbook itself.
//
// Two matching bugs to keep in mind if you edit the extraction below; both
// produced false results when this catalog was first rebuilt:
//
//   1. Filenames are NOT all lowercase. `183_user_profiles_lockdown_STAGED.sql`
//      exists, and a case-sensitive [a-z0-9_] pattern silently drops it —
//      reporting a missing row for a row that is present.
//   2. Purposes contain escaped pipes (`\|`) because migration headers quote
//      SQL unions and enum lists. Splitting a row on `|` to count columns
//      therefore over-counts. This test does not parse columns at all — it
//      pulls backticked filenames — which sidesteps that entirely.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const RUNBOOK = resolve(REPO, 'docs/migrations-runbook.md');
const MIGRATIONS = resolve(REPO, 'supabase/migrations');

// A numbered migration. Leading-underscore files (`_deploy_pending.sql`,
// `_audit_schema_drift.sql`) are deliberately excluded — they are paste
// bundles and scratch queries, not migrations, and the leading underscore is
// what keeps them out of auto-runners.
const MIGRATION_FILE = /^\d{3}_.*\.sql$/i;

function migrationFiles() {
  return readdirSync(MIGRATIONS).filter((f) => MIGRATION_FILE.test(f)).sort();
}

// The catalog runs from its heading to the next horizontal rule. Scoping to
// the section rather than the whole document matters: the runbook mentions
// individual migration filenames in prose elsewhere (the follow-up checklist,
// the config table), and those must not count as catalog coverage.
function catalogFiles() {
  const doc = readFileSync(RUNBOOK, 'utf8');
  const start = doc.indexOf('## Migration catalog');
  expect(start, 'runbook has no "## Migration catalog" heading').toBeGreaterThan(-1);

  const after = doc.slice(start);
  const endRel = after.indexOf('\n---');
  const section = endRel === -1 ? after : after.slice(0, endRel);

  const found = section.match(/`\d{3}_[^`]*\.sql`/gi) || [];
  return found.map((s) => s.replaceAll('`', '')).sort();
}

describe('migration catalog', () => {
  it('lists every migration file', () => {
    const catalogued = new Set(catalogFiles());
    const missing = migrationFiles().filter((f) => !catalogued.has(f));

    expect(
      missing,
      `${missing.length} migration(s) have no row in the catalog in ` +
        'docs/migrations-runbook.md. Add one per file: ' +
        '| NNN | `file.sql` | one-line purpose from its header comment | — |',
    ).toEqual([]);
  });

  it('lists no migration that does not exist', () => {
    const onDisk = new Set(migrationFiles());
    const ghosts = catalogFiles().filter((f) => !onDisk.has(f));

    expect(
      ghosts,
      `${ghosts.length} catalog row(s) name a file that is not in ` +
        'supabase/migrations/. A migration was renamed or deleted and the ' +
        'runbook was left behind.',
    ).toEqual([]);
  });

  it('has one row per migration, not several', () => {
    const seen = new Map();
    for (const f of catalogFiles()) seen.set(f, (seen.get(f) ?? 0) + 1);
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([f]) => f);

    expect(
      duplicated,
      'the catalog lists these files more than once. Duplicated migration ' +
        'NUMBERS are expected here (054_duels.sql and ' +
        '054_bio_profanity_check.sql both exist and both need a row); ' +
        'duplicated FILENAMES are not.',
    ).toEqual([]);
  });
});
