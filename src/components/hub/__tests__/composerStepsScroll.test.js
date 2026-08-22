/**
 * The Post button fell off the bottom of a 667pt screen, and nothing could
 * bring it back.
 *
 * The composer sheet is `flex flex-col max-h-[90vh]` over three children:
 * header (shrink-0), the step body (flex-1), footer with the Post button
 * (shrink-0). Only `renderPicker` carried `overflow-y-auto`. All five compose
 * steps were `flex-1 flex flex-col` with none — and a column flex item's
 * automatic minimum size is its content height, so a step taller than 90vh
 * could not shrink. With no `overflow-hidden` on the sheet, the body and the
 * footer BELOW it rendered outside the sheet box, past the bottom of the
 * viewport. Body scroll is locked while the composer is open, so nothing
 * scrolled them back into reach.
 *
 * Measured for the video step with a clip selected: header ~57 + content ~588
 * + footer ~61 = ~706px against 90vh = 600px on a 667pt device. On an iPhone
 * SE or 8, a video post could not be sent at all.
 *
 * jsdom does no layout, so the overflow cannot be observed by rendering — the
 * step heights that produce the bug do not exist there. This asserts the
 * arrangement instead, on every step at once, because the failure mode is a
 * sixth step being added later by copying one of the five.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REL = 'src/components/hub/HubComposer.jsx';
const src = readFileSync(resolve(process.cwd(), REL), 'utf8');

/** The wrapper <div> className for each `const renderX = () => (` step. */
function stepWrappers(text) {
  const out = {};
  const re = /const (render\w+) = \(\) => \(\s*\n\s*<div className="([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) out[m[1]] = m[2];
  return out;
}

// Every function that can be rendered into the sheet's flex-1 slot.
const BODY_STEPS = [
  'renderPicker',
  'renderMealCompose',
  'renderStatusCompose',
  'renderPollCompose',
  'renderCompose',
  'renderVideoCompose',
];

describe('the composer sheet', () => {
  it('still constrains itself to 90vh with a fixed header and footer', () => {
    // If this stops being true the arrangement below is no longer the fix and
    // this file should be re-read rather than left green.
    expect(src).toMatch(/flex flex-col bg-card border border-border max-h-\[90vh\]/);
    expect(src).toMatch(/border-t border-border px-4 py-3 flex items-center justify-end gap-2 shrink-0/);
  });

  it('has every body step accounted for here', () => {
    // Keeps the per-step assertion honest: a step that exists but is not in
    // BODY_STEPS would be unchecked, which is exactly how five of six came to
    // be missing the overflow in the first place.
    const found = stepWrappers(src);
    for (const name of BODY_STEPS) {
      expect(found[name], `${name} is gone or changed shape — re-check the list`).toBeTruthy();
    }
  });

  it('lets every body step scroll itself', () => {
    const found = stepWrappers(src);
    const offenders = BODY_STEPS.filter((n) => !/overflow-y-auto/.test(found[n] || ''));
    expect(
      offenders,
      'a flex-1 step with no overflow cannot shrink below its content, and pushes the Post button off-screen',
    ).toEqual([]);
  });

  it('zeroes the automatic minimum size explicitly on the compose steps', () => {
    // `overflow-y-auto` alone is what actually zeroes it, per the flexbox
    // spec. `min-h-0` says so out loud, so that changing the overflow later
    // cannot quietly reintroduce the bug.
    const found = stepWrappers(src);
    const compose = BODY_STEPS.filter((n) => n !== 'renderPicker');
    const offenders = compose.filter((n) => !/min-h-0/.test(found[n] || ''));
    expect(offenders).toEqual([]);
  });
});
