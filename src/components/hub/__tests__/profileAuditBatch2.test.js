/**
 * Second batch of the 2026-09-30 profile audit. Source guards for the
 * behaviour a unit test can't reach without mounting the whole page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const profile = read('src/components/hub/HubProfile.jsx');
const card = read('src/components/hub/HubPostCard.jsx');
const rail = read('src/components/hub/StoryHighlightsRail.jsx');

describe('profile audit, batch 2', () => {
  it('shows a blocked state with Unblock', () => {
    expect(profile).toMatch(/data-testid="profile-blocked-notice"/);
    expect(profile).toMatch(/unblockUserFull\(targetId\)/);
    expect(profile).toMatch(/isBlocked=\{isBlockedTarget\}/);
  });

  it('lets hide trophy case hide only the case, not the earned trophies row', () => {
    expect(profile).toMatch(/\(isSelf \|\| trophyVisible \|\| earnedTrophies\.length > 0\) && \(/);
  });

  it('counts posts on the server', () => {
    expect(profile).toMatch(/hubPosts\.countForProfile\(/);
  });

  it('renders post titles without caps or emoji', () => {
    const block = card.slice(card.indexOf('author.equippedTitleId &&'), card.indexOf('<span>{timeLabel}</span>'));
    expect(block).not.toMatch(/uppercase/);
    expect(block).not.toMatch(/title\.emoji/);
    expect(block).toMatch(/rarity-ink/);
  });

  it('deletes highlights with a long press, not right click only, and never window.confirm', () => {
    expect(rail).toMatch(/useLongPress\(/);
    expect(rail).not.toMatch(/\bconfirm\(/);
  });
});
