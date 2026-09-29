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
