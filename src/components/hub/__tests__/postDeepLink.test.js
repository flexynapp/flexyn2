/**
 * A shared post link has to identify the POST, not just its author.
 *
 * The share sheet built `/hub?profile=<user_id>` and nothing else, so opening
 * a shared link dropped you on the author's profile with no indication which
 * post was meant. On an account with any volume, the thing being discussed
 * could be twenty rows down — the link technically worked and was useless,
 * which is why nobody filed it as broken until Sean tried to use one.
 *
 * `post=` is now carried alongside, and Hub hands it to HubProfile, which
 * opens the Posts tab, scrolls to the row and rings it.
 *
 * This tests the URL contract because that is the half that can silently
 * regress: the scroll behaviour is visible the moment you use it, whereas a
 * dropped query param looks exactly like a working link.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHARE = readFileSync(
  resolve(process.cwd(), 'src/components/hub/ShareSheetModal.jsx'), 'utf8');
const HUB = readFileSync(resolve(process.cwd(), 'src/pages/Hub.jsx'), 'utf8');
const PROFILE = readFileSync(
  resolve(process.cwd(), 'src/components/hub/HubProfile.jsx'), 'utf8');

describe('the share link carries the post id', () => {
  it('appends post= to the profile url', () => {
    expect(SHARE).toMatch(/post=\$\{encodeURIComponent\(post\.id\)\}/);
  });

  it('still encodes the author so the link works on a legacy reader', () => {
    expect(SHARE).toMatch(/profile=\$\{encodeURIComponent\(post\.user_id\)\}/);
  });

  it('omits post= when the post has no id rather than emitting undefined', () => {
    // `?post=undefined` would send the profile hunting for a row that cannot
    // exist, and the highlight effect would never settle.
    expect(SHARE).toMatch(/post\.id \?/);
  });
});

describe('Hub consumes the param', () => {
  it('reads post= from the url', () => {
    expect(HUB).toMatch(/get\('post'\)/);
  });

  it('strips it after use so a back-nav does not re-highlight', () => {
    expect(HUB).toMatch(/params\.delete\('post'\)/);
  });

  it('hands it to HubProfile', () => {
    expect(HUB).toMatch(/highlightPostId=\{highlightPostId\}/);
  });
});

describe('HubProfile lands on the post', () => {
  it('switches to the Posts section before trying to scroll', () => {
    expect(PROFILE).toMatch(/setSection\('posts'\)/);
  });

  it('scrolls the row into view', () => {
    expect(PROFILE).toMatch(/scrollIntoView/);
  });

  it('rings it with a sanctioned hue, not an invented one', () => {
    // The palette has exactly four state hues. `ring-warning` would emit NO
    // css at all — Tailwind reads source text, so an undefined token is a
    // silent no-op and the outline would simply never appear.
    expect(PROFILE).toMatch(/ring-primary/);
    expect(PROFILE).not.toMatch(/ring-warning|ring-yellow|ring-amber/);
  });

  it('clears the highlight so it does not become part of how the post looks', () => {
    expect(PROFILE).toMatch(/setLandedPostId\(null\)/);
  });

  it('guards per post id, so a second shared link still scrolls', () => {
    // A boolean "already handled" flag would make the first link work and
    // every later one silently do nothing while the profile stays mounted.
    expect(PROFILE).toMatch(/highlightHandledRef\.current === highlightPostId/);
  });
});
