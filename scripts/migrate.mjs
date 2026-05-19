#!/usr/bin/env node
// scripts/migrate.mjs
//
// Runs a SQL string (or file) directly against the Supabase project.
// Uses the service role key stored in .env.migrations (git-ignored).
//
// Usage (called internally by Claude — no manual steps needed):
//   node scripts/migrate.mjs "ALTER TABLE ..."
//   node scripts/migrate.mjs --file supabase/migrations/045_story_media.sql

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, '..');

// ── Load credentials ──────────────────────────────────────────────────────────
const envPath = resolve(root, '.env.migrations');
let ref, serviceKey;
try {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const env   = Object.fromEntries(
    lines
      .filter(l => l.includes('='))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
  ref        = env.SUPABASE_PROJECT_REF;
  serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
} catch {
  console.error('ERROR: .env.migrations not found. Cannot run migration.');
  process.exit(1);
}

if (!ref || !serviceKey) {
  console.error('ERROR: SUPABASE_PROJECT_REF or SUPABASE_SERVICE_ROLE_KEY missing in .env.migrations');
  process.exit(1);
}

// ── Resolve SQL ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let sql;
if (args[0] === '--file' && args[1]) {
  sql = readFileSync(resolve(root, args[1]), 'utf8');
} else if (args[0]) {
  sql = args[0];
} else {
  console.error('Usage: node scripts/migrate.mjs "SQL" | --file path/to/file.sql');
  process.exit(1);
}

// Strip SQL comments so they don't confuse the parser
sql = sql.replace(/--[^\n]*/g, '').trim();
if (!sql) { console.log('Nothing to run (SQL was empty after stripping comments).'); process.exit(0); }

// ── Execute via Supabase Management API ──────────────────────────────────────
const url = `https://api.supabase.com/v1/projects/${ref}/database/query`;

console.log(`Running migration on project ${ref}…`);

const res = await fetch(url, {
  method:  'POST',
  headers: {
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type':  'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = text; }

if (!res.ok) {
  // Fallback: try the direct REST SQL endpoint (pg-meta style)
  const url2 = `https://${ref}.supabase.co/rest/v1/rpc/exec_sql`;
  const res2  = await fetch(url2, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ sql }),
  });
  if (!res2.ok) {
    console.error(`Migration failed (${res.status}):`, body);
    console.error('Fallback also failed:', await res2.text());
    process.exit(1);
  }
  console.log('Migration applied successfully (via fallback).');
  process.exit(0);
}

console.log('Migration applied successfully.');
if (body && typeof body === 'object' && !Array.isArray(body)) {
  console.log(JSON.stringify(body, null, 2));
}
