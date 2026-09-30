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
// One statement: from .from('<t>') to its ';', or to the next query when
// several sit in one Promise.all separated by commas.
const statement = (src, i) => {
  const ends = [src.indexOf(';', i), src.indexOf('supabase', i + 1), src.indexOf('.from(', i + 1)]
    .filter((n) => n !== -1);
  return src.slice(i, ends.length ? Math.min(...ends) : undefined);
};
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
  ['src/lib/data/gymBusinesses.js', 'FEED_POST_COLUMNS', 'gym_feed_posts', ['author_email']],
  ['src/lib/data/gymBusinesses.js', 'FEED_COMMENT_COLUMNS', 'gym_feed_comments', ['author_email']],
  ['src/lib/data/hubFollows.js', 'FOLLOW_COLUMNS', 'hub_follows', ['follower_email', 'followee_email', 'created_by']],
  ['src/lib/data/hubPosts.js', 'POST_COLUMNS', 'hub_posts', ['author_email', 'collaborator_emails', 'created_by']],
  ['src/lib/data/hubComments.js', 'COMMENT_COLUMNS', 'hub_comments', ['author_email', 'created_by']],
  ['src/lib/data/hubCommentLikes.js', 'LIKE_COLUMNS', 'hub_comment_likes', ['created_by']],
  ['src/lib/data/stories.js', 'STORY_COLUMNS', 'stories', ['user_email']],
  ['src/lib/data/statusNotes.js', 'NOTE_COLUMNS', 'status_notes', ['user_email']],
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
    'hub_live_sessions', 'poll_votes', 'status_note_likes', 'story_likes',
    'story_highlights', 'regimen_reviews',
    'regimens', 'user_trophies', 'gym_members',
    'gym_feed_posts', 'gym_feed_comments',
    'hub_follows', 'hub_posts', 'hub_comments', 'hub_comment_likes',
    'stories', 'status_notes',
  ];
  const files = execSync("git ls-files 'src/*.js' 'src/*.jsx'", { encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.includes('__tests__'));

  it.each(GRANTED)('%s is never read with * or a bare select()', (table) => {
    const offenders = [];
    for (const f of files) {
      const src = read(f);
      let i = src.indexOf(`from('${table}')`);
      while (i !== -1) {
        const chain = statement(src, i);
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

// Likes and reviews are upserts. Postgres needs SELECT on every column an
// ON CONFLICT DO UPDATE sets, so once the email is unreadable an upsert that
// still sends it is refused. The database fills these from the profile.
it.each([
  ['src/lib/data/statusNotes.js', 'status_note_likes', 'liker_email'],
  ['src/lib/data/stories.js', 'story_likes', 'liker_email'],
  ['src/lib/data/regimenReviews.js', 'regimen_reviews', 'reviewer_email'],
])('%s never sends or reads %s.%s', (file, table, col) => {
  const src = read(file);
  let i = src.indexOf(`from('${table}')`);
  expect(i).toBeGreaterThan(-1);
  while (i !== -1) {
    expect(statement(src, i)).not.toContain(col);
    i = src.indexOf(`from('${table}')`, i + 1);
  }
});

// regimens is read through ownedRows, which the scan above cannot see.
it('the regimens module reads its own rows with named columns', () => {
  const src = read('src/lib/data/regimens.js');
  expect(src).toMatch(/ownedRows\('regimens', \{ columns: OWN_COLUMNS \}\)/);
  const own = src.match(/OWN_COLUMNS = `\$\{PUBLIC_COLUMNS\}, ([^`]+)`/);
  expect(own).toBeTruthy();
  for (const b of ['created_by', 'original_author_email']) expect(own[1]).not.toContain(b);
});

it('the data export names columns for every column-granted table', () => {
  const src = read('src/lib/data/dataExport.js');
  for (const table of ['regimens', 'user_trophies', 'gym_members', 'marketplace_listings']) {
    const line = src.split('\n').find((l) => l.includes(`table: '${table}'`));
    expect(line, table).toMatch(/select:/);
    expect(line, table).toMatch(/via: 'id'/);
  }
});

it('trophies are looked up by user id, never by email', () => {
  const src = read('src/lib/data/trophies.js');
  expect(src).not.toMatch(/user_email/);
  expect(read('src/lib/leaderboardStats.js')).not.toMatch(/listEarned\([^)]*,\s*true\)/);
});

it('the gym feed tells your own posts apart by id, not email', () => {
  const src = read('src/components/gyms/GymFeedTab.jsx');
  expect(src).not.toMatch(/author_email/);
});

it('no app code reads a follow, post, comment or story email', () => {
  const files = execSync("git ls-files 'src/*.js' 'src/*.jsx'", { encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.includes('__tests__'));
  const offenders = [];
  for (const f of files) {
    const src = read(f);
    if (/\.(follower_email|followee_email|collaborator_emails)\b/.test(src)) offenders.push(f);
    if (/(post|comment|original|story|note)\??\.(author_email|user_email)\b/.test(src)) offenders.push(f);
  }
  expect(offenders).toEqual([]);
});
