/**
 * Nothing in the Hub feed could be scrolled sideways.
 *
 * The tab-swipe panel is a `motion.div` with `drag="x"`. framer-motion
 * responds to that by writing `touch-action: pan-y` onto the element — see
 * `render/html/use-props.mjs`, where it is assigned AFTER the caller's `style`
 * prop has been merged in, so it cannot be overridden from the call site.
 *
 * touch-action is resolved by intersecting the value down the whole ancestor
 * chain, so `pan-y` on the panel disallowed horizontal panning for everything
 * inside it. The Hub feed is mostly horizontal rails: People You May Know,
 * Live Activity, Follow Suggestions, Recently Viewed, Story Highlights, the
 * badge showcase. On a mobile-only app, a touch pan is the ONLY way to scroll
 * any of them, so all six were inert.
 *
 * The fix leans on a fact worth stating: framer never calls preventDefault
 * anywhere in its gesture code. touch-action is its only mechanism for
 * suppressing native scroll, and `dragListener={false}` skips the block that
 * sets it (framer guards on `props.dragListener !== false`). Starting the drag
 * by hand therefore returns native scrolling AND keeps the swipe.
 *
 * jsdom does no layout and has no touch, so the gesture itself is not
 * observable in a test. What IS checkable is the arrangement that produces it,
 * plus the two upstream facts it depends on — and those are asserted against
 * framer's installed source rather than trusted, so a version bump that
 * changes either one fails here instead of silently re-breaking the rails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const HUB = read('src/pages/Hub.jsx');
const FRAMER_PROPS = read('node_modules/framer-motion/dist/es/render/html/use-props.mjs');

describe('the Hub swipe panel', () => {
  it('does not let framer attach its own drag listener', () => {
    expect(HUB, 'without this framer writes touch-action onto the panel').toMatch(/dragListener=\{false\}/);
  });

  it('starts the drag itself, so the swipe still works', () => {
    // dragListener={false} alone would disable the gesture entirely.
    expect(HUB).toMatch(/dragControls=\{dragControls\}/);
    expect(HUB).toMatch(/onPointerDown=\{\(e\) => \{ if \(swipeEnabled\) dragControls\.start\(e\); \}\}/);
    expect(HUB).toMatch(/useDragControls/);
  });

  it('still drags on x, so this is a fix and not a removal', () => {
    expect(HUB).toMatch(/drag=\{swipeEnabled \? 'x' : false\}/);
    expect(HUB).toMatch(/onDragEnd=\{handleFeedSwipe\}/);
  });
});

describe('the framer behaviour this depends on', () => {
  it('sets touch-action from the drag axis, which is the whole problem', () => {
    // If a future version stops doing this, dragListener={false} is no longer
    // load-bearing and the indirection above should be reconsidered.
    expect(FRAMER_PROPS).toMatch(/style\.touchAction\s*=/);
    expect(FRAMER_PROPS).toMatch(/pan-\$\{props\.drag === "x" \? "y" : "x"\}/);
  });

  it('skips that block when dragListener is false', () => {
    // The exact guard the fix relies on.
    expect(FRAMER_PROPS).toMatch(/if \(props\.drag && props\.dragListener !== false\)/);
  });

  it('assigns touchAction after the caller style, so a style override cannot win', () => {
    // Documents why the obvious fix — style={{ touchAction: 'auto' }} — does
    // not work, so nobody tries it again.
    const styleMerge = FRAMER_PROPS.indexOf('const style = useStyle(props, visualState);');
    const touchWrite = FRAMER_PROPS.indexOf('style.touchAction');
    expect(styleMerge).toBeGreaterThan(-1);
    expect(touchWrite).toBeGreaterThan(styleMerge);
  });

  it('never suppresses native scroll with preventDefault', () => {
    // The reason handing the gesture back to the browser is safe: touch-action
    // is framer's ONLY lever. If preventDefault ever appears in the gesture
    // code, native rail scrolling can break again without touch-action.
    const gestures = [
      'node_modules/framer-motion/dist/es/gestures/drag/VisualElementDragControls.mjs',
      'node_modules/framer-motion/dist/es/gestures/drag/use-drag-controls.mjs',
    ];
    for (const g of gestures) {
      expect(read(g), `${g} now calls preventDefault`).not.toMatch(/preventDefault/);
    }
  });
});
