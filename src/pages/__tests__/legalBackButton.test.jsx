// The back arrow on /terms and /privacy, exercised through the real DOM.
//
// The decision itself is covered in legalBackTarget.test.js; what this file
// proves is that the header control is wired to it — the previous version
// rendered a `<Link to="/">`, which never left the legal route table (see the
// comment on resolveLegalBackTarget) and so never returned the reader to the
// sign-in screen they opened the document from.
//
// Only the history-step branch is asserted here. The other branch calls
// `window.location.assign`, which jsdom neither implements nor lets you spy
// on cleanly; legalBackTarget.test.js covers when that branch is chosen.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { TermsOfService, PrivacyPolicy } from '../Legal';

function stubReferrer(value) {
  Object.defineProperty(document, 'referrer', { value, configurable: true });
}

describe('legal page back button', () => {
  let backSpy;

  beforeEach(() => {
    // Give the document something to go back to, the way arriving from the
    // sign-in screen's plain <a> link would.
    window.history.pushState({}, '', '/terms');
    stubReferrer(`${window.location.origin}/`);
    backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  });

  afterEach(() => {
    backSpy.mockRestore();
    stubReferrer('');
  });

  it('takes a real history step back off the Terms page', async () => {
    render(<MemoryRouter><TermsOfService /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('takes a real history step back off the Privacy page', async () => {
    render(<MemoryRouter><PrivacyPolicy /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('is a button, not a link to "/"', () => {
    // A client-side <Link> here re-matches inside the legal route table and
    // renders the Privacy Policy at every path. Anchors in the footer are
    // fine — they point at routes this table actually has.
    render(<MemoryRouter><TermsOfService /></MemoryRouter>);
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back.tagName).toBe('BUTTON');
    expect(back.getAttribute('href')).toBeNull();
  });
});
