/**
 * The Squad feed had to learn that a crew post is not a follow post.
 *
 * Two separate places dropped them, and fixing only one leaves the feature
 * half-working:
 *
 *   The WINDOW is keyed on `author_email` (following + self), so a crew post
 *   only arrived if you already followed whoever wrote it. Most of a crew does
 *   not follow most of the crew.
 *
 *   The REALTIME handler returned early on any privacy that is not 'public' or
 *   'followers', and then again on Squad for any author you do not follow. So
 *   the "N new posts" pill never counted a crew post either.
 *
 * The migration is the other half and is checked by the SQL itself; this is
 * the client contract. A source scan because the assertions are about wiring
 * across a 900-line component — rendering the feed would need the whole
 * realtime, follow, mute, block and crew stack stood up to observe one branch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const FEED = read('src/components/hub/HubFeed.jsx');
const DATA = read('src/lib/data/hubPosts.js');
const MIG  = read('supabase/migrations_archive/379_crew_posts_reach_the_crew.sql');

describe('the Squad window includes crew posts', () => {
  it('fetches them, scoped to Squad and to having a crew', () => {
    expect(FEED).toMatch(/hubPosts\.fetchCrewWindow\(myCrewIds\)/);
    expect(FEED).toMatch(/enabled: feedTab === 'squad' && myCrewIds\.length > 0/);
  });

  it('merges them into the list the filter reads, deduped', () => {
    // A crew post whose author you DO follow arrives down both paths.
    expect(FEED).toMatch(/const withCrewPosts = useMemo/);
    expect(FEED).toMatch(/const seen = new Set\(allPosts\.map\(p => p\.id\)\)/);
    expect(FEED).toMatch(/let result = withCrewPosts\.filter/);
  });

  it('still hides a crew post addressed to a crew I am not in', () => {
    // The viewer-side guard predates this and must survive it — RLS is the
    // real boundary, but the client should not render what it should not.
    expect(FEED).toMatch(/return p\.crew_id && crewSet\.has\(p\.crew_id\)/);
  });
});

describe('realtime counts crew posts', () => {
  it('recognises one addressed to my crew', () => {
    expect(FEED).toMatch(/const isMyCrewPost = row\.privacy === 'crew' && !!row\.crew_id && f\.crewIds\.has\(row\.crew_id\)/);
  });

  it('lets it past the privacy gate and the Squad follow gate', () => {
    expect(FEED).toMatch(/row\.privacy !== 'followers' && !isMyCrewPost\) return;/);
    expect(FEED).toMatch(/!f\.followingLc\.has\(authorLc\) && !isMyCrewPost\) return;/);
  });

  it('keeps the scheduled-post embargo in front of it', () => {
    // Ordering matters: a scheduled crew post must not light the pill.
    const gate = FEED.indexOf('const isMyCrewPost');
    const embargo = FEED.indexOf('row.publish_at && new Date(row.publish_at)');
    expect(gate).toBeGreaterThan(-1);
    expect(embargo).toBeGreaterThan(gate);
  });

  it('seeds crewIds on the filter ref so the handler cannot read undefined', () => {
    // The handler reads the ref at fire time, which can be before the first
    // sync effect runs.
    expect(FEED).toMatch(/crewIds: new Set\(\),/);
    expect(FEED).toMatch(/crewIds:\s+new Set\(myCrewIds\),/);
    expect(FEED).toMatch(/\}, \[feedTab, following, mutedEmails, blockedEmails, myCrewIds\]\);/);
  });
});

describe('the client half matches the migration', () => {
  it('relies on RLS for the boundary, not on the client filter', () => {
    // fetchCrewWindow passes crew ids straight through. That is only safe
    // because the policy admits a crew row only when is_crew_member holds.
    expect(DATA).toMatch(/export const fetchCrewWindow/);
    expect(MIG).toMatch(/privacy = 'crew'::text/);
    expect(MIG).toMatch(/public\.is_crew_member\(crew_id\)/);
  });

  it('the migration keeps the embargo and blocking on the crew branch', () => {
    // The crew disjunct must sit INSIDE the group guarded by publish_at and
    // viewer_is_blocked_by, not beside it.
    const embargo = MIG.indexOf('publish_at IS NULL OR publish_at <= now()');
    const blocked = MIG.indexOf('NOT public.viewer_is_blocked_by(author_email)');
    const crew    = MIG.indexOf("privacy = 'crew'::text");
    expect(embargo).toBeGreaterThan(-1);
    expect(blocked).toBeGreaterThan(embargo);
    expect(crew).toBeGreaterThan(blocked);
  });

  it('guards the write side on both INSERT and a crew_id UPDATE', () => {
    expect(MIG).toMatch(/BEFORE INSERT OR UPDATE OF crew_id ON public\.hub_posts/);
    expect(MIG).toMatch(/RAISE EXCEPTION 'not_a_member_of_that_crew'/);
  });

  it('reloads the PostgREST schema cache, or the column stays invisible', () => {
    // Without this the client keeps hitting PGRST204 and stripping crew_id,
    // which is the exact failure the migration exists to end.
    expect(MIG).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });
});
