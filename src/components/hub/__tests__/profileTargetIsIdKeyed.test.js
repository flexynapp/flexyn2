/**
 * A real athlete rendered as Bronze / Lv 1 / 0 followers / no bio.
 *
 * HubProfile is id-first. `targetId` comes from the nav payload, and when it
 * is null the profile lookup and BOTH follow queries are disabled — so the
 * page renders its placeholder header rather than failing. Three surfaces
 * were minting payloads with no id in them:
 *
 *   - Hub's post-search result, which passed `{ email: post.author_email }`
 *   - CrewMemberDirectory and CrewMessageItem, which passed `{ email: … }`
 *     against a view that has had no email column since migration 220
 *
 * The crew pair is asserted in crews/__tests__/crewProfileNav.test.js, beside
 * the prop-chain checks that stayed green through the whole outage. This file
 * covers the Hub site and the staleness bug that made even a CORRECT payload
 * render wrong for sixty seconds.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const HUB     = read('src/pages/Hub.jsx');
const PROFILE = read('src/components/hub/HubProfile.jsx');

describe('Hub post search opens the author, not a placeholder', () => {
  it('keys the target on user_id', () => {
    const handler = HUB.match(/onSelectPost=\{\(post\) => \{[\s\S]*?\n {8}\}\}/);
    expect(handler, 'the onSelectPost handler moved').toBeTruthy();
    expect(handler[0], 'an {email} target leaves targetId null').toContain('id: post.user_id');
  });

  it('does not gate the navigation on author_email', () => {
    // The old guard was `if (post?.author_email)`. Both columns are populated
    // on every row, so the guard was never the visible failure — but keying
    // the GUARD on email while keying the PAYLOAD on id would navigate for a
    // row that has no id to navigate with.
    const handler = HUB.match(/onSelectPost=\{\(post\) => \{[\s\S]*?\n {8}\}\}/)[0];
    expect(handler).toContain('if (post?.user_id)');
  });
});

describe('a seeded profile header does not suppress the real read', () => {
  it('marks initialData as already stale', () => {
    // react-query stamps initialData with the current time unless told
    // otherwise, so the 60s staleTime counted a nav payload — username and
    // avatar, never total_xp or bio — as a complete, fresh profile. `0` keeps
    // the instant paint and lets the fetch run.
    const q = PROFILE.match(/initialData: isSelf \? null[\s\S]{0,900}?\}\);/);
    expect(q, 'the targetProfile query moved').toBeTruthy();
    expect(q[0], 'without this a friend reads Level 1 / 0 XP for a minute').toMatch(/initialDataUpdatedAt: 0/);
  });

  it('still seeds, so there is no placeholder flash', () => {
    // The lazy "fix" is deleting initialData outright. That trades a wrong
    // header for an empty one, which is not an improvement.
    expect(PROFILE).toMatch(/initialData: isSelf \? null : \(targetUser\?\.username \? targetUser : undefined\)/);
  });
});
