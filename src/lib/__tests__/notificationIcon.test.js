import { describe, it, expect } from 'vitest';
import { Bell } from 'lucide-react';
import { iconFor, stripLeadingEmoji } from '@/lib/notificationIcon';
import { KNOWN_TYPES, isFeedType } from '@/lib/notificationCatalog';

describe('iconFor', () => {
  it('gives every type that can reach the feed its own line icon', () => {
    for (const t of KNOWN_TYPES.filter(isFeedType)) expect(iconFor(t), t).not.toBe(Bell);
  });
  it('falls back to the bell for a type it has never seen', () => {
    expect(iconFor('something_new')).toBe(Bell);
    expect(iconFor(undefined)).toBe(Bell);
  });
});

describe('stripLeadingEmoji', () => {
  it.each([
    ['⏳ 3 quests left today', '3 quests left today'],
    ['⬆️ Promoted to Silver!', 'Promoted to Silver!'],
    ['⚔️ Crew war vs Iron Owls', 'Crew war vs Iron Owls'],
    ['🪙 +50 coins · Log a meal', '+50 coins · Log a meal'],
    ['🏋️‍♀️ New PR', 'New PR'],
    ['Dani followed you', 'Dani followed you'],
  ])('%s', (input, out) => expect(stripLeadingEmoji(input)).toBe(out));

  it('keeps an emoji that is the content, later in the title', () => {
    expect(stripLeadingEmoji('sean reacted with 🔥')).toBe('sean reacted with 🔥');
  });
  it('keeps a title that is only emoji rather than emptying it', () => {
    expect(stripLeadingEmoji('🔥')).toBe('🔥');
  });
  it('leaves digits alone, even though they are emoji-capable', () => {
    expect(stripLeadingEmoji('3 quests left')).toBe('3 quests left');
    expect(stripLeadingEmoji('#1 in your gym')).toBe('#1 in your gym');
  });
});
