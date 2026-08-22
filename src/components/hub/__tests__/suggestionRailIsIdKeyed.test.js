/**
 * The suggested-follows rail put eight real email addresses on the wire per
 * Hub load, for identification the user id already did.
 *
 * `get_suggested_followees` declares `email` in its RETURNS TABLE, and this
 * rail was the only reason it had to: the dedupe key, the Follow button state
 * and the argument to `hubFollows.follow()` all read it. Anyone with devtools
 * open — or reading the response cache — saw them, rotating as the
 * suggestions did.
 *
 * Migrations 218/220 closed exactly this for the sibling rail. PeopleYouMayKnow
 * returns `user_id` only and its own comment states the rule: a suggestion
 * card cannot leak an address. This rail was never brought along.
 *
 * The client moves first on purpose. Keying on `user_id` works against the
 * CURRENT function as well as the one migration 380 installs — an extra column
 * in the result is ignored — so there is no window where the rail is broken,
 * whichever order deploy and paste happen in. That ordering is the reason
 * these assertions are about the CLIENT and not about the SQL.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = read('src/components/hub/FollowSuggestionRail.jsx');
const MIG  = read('supabase/migrations/380_suggested_followees_drops_email.sql');
const code = (t) => t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('FollowSuggestionRail identifies by id', () => {
  it('dedupes against the id list, not the address list', () => {
    expect(RAIL).toMatch(/queryKey: \['hubFollowingIds', user\?\.id\]/);
    expect(RAIL).toMatch(/listFollowingIds\(user\.id\)/);
    expect(RAIL).toMatch(/!followingSet\.has\(String\(s\.user_id\)\)/);
  });

  it('follows by id', () => {
    expect(RAIL).toMatch(/hubFollows\.follow\(user\.id, followeeId\)/);
  });

  it('reads no email off a suggestion row', () => {
    // The whole point: nothing in this file may consume the column the
    // migration is about to remove, or the rail breaks when it lands.
    expect(code(RAIL), 'a suggestion row must not be read for its address')
      .not.toMatch(/\b[su]\.email\b/);
  });

  it('refreshes the id list it now reads after following someone', () => {
    // It previously invalidated only the email-keyed list, which this rail no
    // longer uses — the button would have gone stale against its own cache.
    expect(RAIL).toMatch(/invalidateQueries\(\{ queryKey: \['hubFollowingIds', user\.id\] \}\)/);
  });
});

describe('migration 380', () => {
  it('drops email and keeps user_id', () => {
    const returns = MIG.slice(MIG.indexOf('RETURNS TABLE('), MIG.indexOf('LANGUAGE plpgsql'));
    expect(returns).toContain('user_id');
    expect(returns, 'the column is the finding').not.toContain('email');
  });

  it('restores the grants a DROP takes with it', () => {
    // Changing RETURNS TABLE needs DROP + CREATE, and the grants go with the
    // function. This is the 203/218 lesson.
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.get_suggested_followees\(integer\) FROM PUBLIC/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_suggested_followees\(integer\) TO authenticated/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_suggested_followees\(integer\) TO service_role/);
  });

  it('keeps the hide_from_search predicate 377 added', () => {
    // Restating a body is how a previous fix gets silently reverted.
    expect(MIG).toMatch(/hide_from_search IS NOT TRUE/);
  });

  it('still filters on the address internally', () => {
    // Dropping the OUTPUT column must not drop the join and the
    // already-followed filter, both of which key on email because
    // hub_follows does.
    expect(MIG).toMatch(/email NOT IN \(SELECT followed_email FROM already_followed\)/);
    expect(MIG).toMatch(/LEFT JOIN follower_counts ON counted_email = cand_email/);
  });

  it('verifies with a positive control, so a query matching nothing fails', () => {
    // The first draft filtered on parameter_mode='TABLE', which matches
    // nothing — the email check read 0 and passed while the column was still
    // there. `user_id_returned` is what exposed it.
    expect(MIG).toMatch(/parameter_mode = 'OUT'/);
    expect(MIG).toMatch(/AS user_id_returned/);
  });
});
