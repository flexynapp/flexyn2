// The back arrow on /privacy and /terms must leave the page by a real
// history step or a full document load — never a client-side navigation.
// App.jsx selects the legal route table from `window.location.pathname` read
// once at mount and never subscribes to location, so navigating in-app off
// these pages re-matches inside that table and lands on `path="*"` → the
// Privacy Policy. The old `<Link to="/">` did precisely that: from /terms it
// swapped in the other legal document, from /privacy it looked like a dead
// button, and neither ever got the reader back to the sign-in screen.
//
// These assertions guard the decision, not the DOM — jsdom can't be made to
// observe `window.location.assign` cleanly, and the routing reasoning is the
// part that's worth pinning down anyway.

import { describe, it, expect } from 'vitest';
import { resolveLegalBackTarget } from '../Legal';

const ORIGIN = 'https://flexyn.app';

/** The common case: opened from the sign-in screen's plain <a> link. */
const fromSignIn = {
  referrer: `${ORIGIN}/`,
  origin: ORIGIN,
  historyLength: 2,
  locationKey: 'default',
};

describe('resolveLegalBackTarget', () => {
  it('goes back when the reader came from our own origin', () => {
    expect(resolveLegalBackTarget(fromSignIn)).toBe('back');
  });

  it('goes back for a same-origin referrer on a deeper path', () => {
    expect(resolveLegalBackTarget({ ...fromSignIn, referrer: `${ORIGIN}/dashboard` }))
      .toBe('back');
  });

  it('goes home for a reviewer opening the page with no referrer', () => {
    expect(resolveLegalBackTarget({ ...fromSignIn, referrer: '' })).toBe('home');
  });

  it('goes home when the referrer is another site', () => {
    expect(resolveLegalBackTarget({ ...fromSignIn, referrer: 'https://apps.apple.com/x' }))
      .toBe('home');
  });

  it('is not fooled by an origin that merely starts the same', () => {
    expect(resolveLegalBackTarget({ ...fromSignIn, referrer: 'https://flexyn.app.evil.test/' }))
      .toBe('home');
  });

  it('goes home rather than throwing on a malformed referrer', () => {
    expect(resolveLegalBackTarget({ ...fromSignIn, referrer: 'not a url' })).toBe('home');
  });

  it('goes home when there is no history entry behind us', () => {
    // A fresh tab, or an installed PWA launched straight onto /privacy.
    expect(resolveLegalBackTarget({ ...fromSignIn, historyLength: 1 })).toBe('home');
  });

  it('goes back after an in-document navigation, referrer or not', () => {
    // /terms → footer "Privacy Policy" link. react-router only stamps a key
    // once you move off the entry the document loaded on, so a non-default
    // key is proof there's an entry of ours behind us — the referrer still
    // points at whatever linked in, and may be empty or external.
    expect(resolveLegalBackTarget({ ...fromSignIn, referrer: '', locationKey: 'a1b2c3' }))
      .toBe('back');
    expect(resolveLegalBackTarget({
      ...fromSignIn,
      referrer: 'https://apps.apple.com/x',
      locationKey: 'a1b2c3',
    })).toBe('back');
  });

  it('tolerates a missing location key', () => {
    expect(resolveLegalBackTarget({ ...fromSignIn, locationKey: undefined })).toBe('back');
    expect(resolveLegalBackTarget({ ...fromSignIn, referrer: '', locationKey: undefined }))
      .toBe('home');
  });
});
