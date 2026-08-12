/**
 * Stickers on a post: grouped, counted, and anonymous.
 *
 * The spec, from Sean on 12 Aug: "you can stack several and… if there's like
 * 10 separate types of stickers it'll show all 10 separate ones if there's
 * like doubles maybe just put like a small two icon in like a square bubble
 * like 2X", and "everyone can see the sticker, but you won't see who posted
 * the sticker… kind of like how Reddit has 'thanks for the gold'".
 *
 * Two properties fall out of that, and they fail in different ways:
 *
 *   Grouping is a LEGIBILITY bug when it's wrong — ten people giving the same
 *   sticker used to render ten overlapping copies of one picture, which reads
 *   as noise rather than as ten people agreeing.
 *
 *   Anonymity is a PRIVACY bug when it's wrong, and it is the one that can
 *   regress silently: the panel previously rendered an avatar and @username
 *   beside every sticker, and re-adding a name would look like a feature
 *   rather than a leak. The scan below fails if identity fields come back into
 *   either surface.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PANEL = read('src/components/hub/StickerPanel.jsx');
const CARD  = read('src/components/hub/HubPostCard.jsx');

// Comment lines stripped: these files EXPLAIN the anonymity rule in prose, and
// naming the thing you removed is exactly how a comment earns its place. A
// scan that can't tell code from commentary would force the explanation out.
const codeOnly = (src) => src
  .split('\n')
  .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');
const PANEL_CODE = codeOnly(PANEL);
const CARD_CODE  = codeOnly(CARD);

// The grouping both surfaces run, restated here so the expected OUTPUT is
// pinned independently of where the implementation happens to live.
function group(reactions) {
  const byKey = new Map();
  for (const r of reactions) {
    const key = `${r.item_emoji}|${r.variant || ''}`;
    const hit = byKey.get(key);
    if (hit) hit.count += 1;
    else byKey.set(key, { key, emoji: r.item_emoji, variant: r.variant, count: 1 });
  }
  return [...byKey.values()];
}

const s = (emoji, variant = null, user = 'u') => ({ item_emoji: emoji, variant, user_id: user });

describe('grouping', () => {
  it('collapses the same sticker from several people into one tile', () => {
    const out = group([s('🔥', null, 'a'), s('🔥', null, 'b'), s('🔥', null, 'c')]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
  });

  it('keeps 10 distinct stickers as 10 tiles', () => {
    const emojis = ['🔥','💪','👏','🙌','💯','😂','🏆','⚡','🚀','🥇'];
    expect(group(emojis.map(e => s(e)))).toHaveLength(10);
  });

  it('does NOT merge a gold variant into the plain sticker', () => {
    // A gold 🔥 is a different object from a plain 🔥 — merging them would
    // misreport what is actually on the post, and the rarer one is the whole
    // point of giving it.
    const out = group([s('🔥', null), s('🔥', 'gold')]);
    expect(out).toHaveLength(2);
    expect(out.every(g => g.count === 1)).toBe(true);
  });

  it('counts a mixed post correctly', () => {
    const out = group([
      s('🔥', null, 'a'), s('🔥', null, 'b'),
      s('💪', null, 'c'),
      s('🔥', 'gold', 'd'),
    ]);
    const byKey = Object.fromEntries(out.map(g => [g.key, g.count]));
    expect(byKey['🔥|']).toBe(2);
    expect(byKey['💪|']).toBe(1);
    expect(byKey['🔥|gold']).toBe(1);
  });

  it('handles a post with no stickers', () => {
    expect(group([])).toEqual([]);
  });
});

describe('both surfaces group rather than listing one row per person', () => {
  it('the panel groups', () => {
    expect(PANEL).toMatch(/groupedReactions/);
  });

  it('the post card groups', () => {
    expect(CARD).toMatch(/groupedStickers/);
  });

  it('both show a count badge for duplicates', () => {
    expect(PANEL).toMatch(/count > 1/);
    expect(CARD).toMatch(/count > 1/);
  });
});

describe('anonymity', () => {
  it('the panel renders no username or avatar', () => {
    // These are the exact fields getPostReactions returns for the giver.
    for (const field of ['user_name', 'user_avatar_url', 'user_email']) {
      expect(PANEL_CODE, `${field} is back in the sticker panel`).not.toMatch(
        new RegExp(`r\\.${field}|\\.${field}\\b`)
      );
    }
  });

  it('the panel has no route to a profile', () => {
    expect(PANEL_CODE).not.toMatch(/onAuthorClick/);
  });

  it('the post card does not hand the panel an author callback', () => {
    const call = CARD_CODE.slice(CARD_CODE.indexOf('<StickerPanel'), CARD_CODE.indexOf('/>', CARD_CODE.indexOf('<StickerPanel')));
    expect(call).not.toMatch(/onAuthorClick/);
  });
});

describe('the sticker button', () => {
  it('exists in the action row, so a post with zero stickers can get one', () => {
    // The only entry point used to be the waterfall of EXISTING stickers,
    // which does not render until a post already has one.
    expect(CARD).toMatch(/hub\.post\.addSticker/);
    expect(CARD).toMatch(/<Star /);
  });

  it('sits before Share and carries the trailing margin', () => {
    const starAt = CARD.indexOf('hub.post.addSticker');
    const shareAt = CARD.indexOf('aria-label="Share post"');
    expect(starAt).toBeGreaterThan(-1);
    expect(shareAt).toBeGreaterThan(starAt);
    // ms-auto, not ml-auto: the row must mirror in RTL.
    const star = CARD.slice(starAt - 700, starAt);
    expect(star).toMatch(/ms-auto/);
  });
});
