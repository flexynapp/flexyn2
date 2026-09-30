/**
 * Tables every signed-in user can read are selected with explicit columns
 * that leave out the email of whoever owns the row.
 *
 * `select('*')` on these handed out another user's address with every row:
 * league standings (user_email), sticker reactions (user_email), marketplace
 * listings and bundles (seller_email), public regimens (created_by and
 * original_author_email). Nothing rendered any of them. Listing columns is
 * also what lets the database revoke those columns later without breaking
 * the app.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const read = (p) => readFileSync(p, 'utf8');
const constant = (src, name) => {
  const m = src.match(new RegExp(`const ${name} = '([^']+)'`));
  expect(m, `${name} is defined`).toBeTruthy();
  return m[1].split(',').map((c) => c.trim());
};

const CASES = [
  ['src/lib/data/leagues.js', 'MEMBER_COLUMNS', 'league_members', ['user_email']],
  ['src/lib/data/stickerReactions.js', 'REACTION_COLUMNS', 'post_sticker_reactions', ['user_email']],
  ['src/lib/data/marketplace.js', 'LISTING_COLUMNS', 'marketplace_listings', ['seller_email']],
  ['src/lib/data/marketplace.js', 'BUNDLE_COLUMNS', 'marketplace_bundles', ['seller_email']],
  ['src/lib/data/regimens.js', 'PUBLIC_COLUMNS', 'regimens', ['created_by', 'original_author_email']],
];

describe.each(CASES)('%s %s', (file, name, table, banned) => {
  const src = read(file);

  it('names no email column', () => {
    const cols = constant(src, name);
    for (const b of banned) expect(cols).not.toContain(b);
    expect(cols).toContain('id');
  });

  it(`does not select * from ${table} in this module`, () => {
    const star = new RegExp(`from\\('${table}'\\)\\s*\\.select\\('\\*`);
    expect(src).not.toMatch(star);
  });
});

it('the crew regimen copy reads only what it copies', () => {
  const src = read('src/lib/data/crews.js');
  expect(src).not.toMatch(/from\('regimens'\)\s*\.select\('\*'\)/);
  expect(src).toMatch(/user\.id !== source\.user_id/);
});

// These tables are moving to column-by-column SELECT grants that leave out
// the email, after which a '*' or a bare .select() anywhere in the app is a
// 42501 at runtime, not just a leak. Scan every statement that starts at
// .from('<table>') up to the end of that statement.
describe('tables moving to column-level SELECT grants', () => {
  const GRANTED = [
    'league_members', 'league_season_stats', 'monthly_league_members',
    'marketplace_listings', 'marketplace_bundles', 'post_sticker_reactions',
  ];
  const files = execSync("git ls-files 'src/*.js' 'src/*.jsx'", { encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.includes('__tests__'));

  it.each(GRANTED)('%s is never read with * or a bare select()', (table) => {
    const offenders = [];
    for (const f of files) {
      const src = read(f);
      let i = src.indexOf(`from('${table}')`);
      while (i !== -1) {
        const end = src.indexOf(';', i);
        const chain = src.slice(i, end === -1 ? undefined : end);
        if (/\.select\(\s*(['"`]\*|\))/.test(chain)) offenders.push(f);
        i = src.indexOf(`from('${table}')`, i + 1);
      }
    }
    expect(offenders).toEqual([]);
  });
});

it('the sticker upsert does not send user_email (the database fills it)', () => {
  const src = read('src/lib/data/stickerReactions.js');
  const upsert = src.slice(src.indexOf('.upsert('), src.indexOf("onConflict: 'post_id,user_id'"));
  expect(upsert).not.toMatch(/user_email\s*:/);
});
