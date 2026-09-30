/**
 * The server pays a daily quest only when its own recount reaches the
 * catalog target (claim_quest_atomic + _quest_def, migration
 * 20260930223000). _quest_def is a copy of QUEST_CATALOG, so a quest added,
 * retargeted or moved to another difficulty here without the same change in
 * a new migration would either be refused at insert ("unknown quest") or paid
 * against the wrong target. The latest migration that defines _quest_def is
 * the one production runs.
 */
import { it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { QUEST_CATALOG } from '@/lib/questCatalog';

function serverCatalog() {
  const files = readdirSync('supabase/migrations')
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .filter((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')
      .includes('FUNCTION public._quest_def('));
  const sql = readFileSync(`supabase/migrations/${files[files.length - 1]}`, 'utf8');
  const rows = {};
  for (const m of sql.matchAll(/\('([a-z0-9_]+)',\s*'([a-z_]+)',\s*(\d+),\s*'([a-z]+)'\)/g)) {
    rows[m[1]] = { action: m[2], target: Number(m[3]), difficulty: m[4] };
  }
  return rows;
}

it('the server quest list matches QUEST_CATALOG', () => {
  const server = serverCatalog();
  const client = {};
  for (const [id, def] of Object.entries(QUEST_CATALOG)) {
    if (def.enabled === false) continue;
    client[id] = { action: def.actionType, target: def.target, difficulty: def.difficulty };
  }
  expect(Object.keys(client).length).toBeGreaterThan(30);
  expect(server).toEqual(client);
});
