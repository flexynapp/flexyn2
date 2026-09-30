import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isVerified, isPoop, hasSnakeEgg, hasBirdEgg, hasSweatEgg } from '@/lib/verifiedUsers';

// The easter eggs follow the account, never the handle. A handle can be
// changed every 30 days, so matching one handed the crown or the poop bio
// to whoever claimed it next.
describe('easter eggs are keyed on account ids', () => {
  it('ignores usernames entirely', () => {
    for (const handle of ['kegan', 'sean', 'keganbergeron', 'jackson', 'jamesjpavlik', 'calason44', 'jaxf']) {
      expect(isVerified(handle)).toBe(false);
      expect(isPoop(handle)).toBe(false);
      expect(hasSnakeEgg(handle) || hasBirdEgg(handle) || hasSweatEgg(handle)).toBe(false);
    }
  });

  it('matches the accounts they were made for', () => {
    expect(isVerified('39d05494-23f1-4678-9c94-33aa95d8f041')).toBe(true);
    expect(hasSnakeEgg('ead69f89-3a1e-4bf2-9d3e-444648e01f98')).toBe(true);
    expect(isVerified(null)).toBe(false);
  });

  it('no caller passes a username', () => {
    const files = [
      'src/components/ProfileAvatar.jsx', 'src/components/ThemeSelector.jsx',
      'src/components/crews/CrewMessageItem.jsx', 'src/components/hub/HubPostCard.jsx',
      'src/components/hub/HubCommentsInline.jsx', 'src/components/stories/StoriesRow.jsx',
      'src/components/hub/HubProfile.jsx',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(src, f).not.toMatch(/isVerified\([^)]*(username|handle)/);
      expect(src, f).not.toMatch(/isPoop\([^)]*(username|handle)/);
    }
  });
});
