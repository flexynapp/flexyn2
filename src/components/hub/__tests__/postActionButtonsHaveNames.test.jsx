/**
 * A post's Like and Comment buttons had no accessible name.
 *
 * `ActionButton` rendered a bare lucide icon — an <svg> with no title — plus
 * an optional number. It took no label prop and neither call site passed one:
 * no aria-label, no sr-only text, no title. A VoiceOver or TalkBack user
 * swiping a post heard "button" then "button", or on a post with engagement
 * "12, button" and "3, button", with no way to tell which one likes the post
 * and which opens the comments. WCAG 4.1.2 Name, Role, Value, Level A.
 *
 * What makes it a defect rather than an oversight: every other icon button in
 * the same action row already carried an aria-label — save meal, analytics,
 * repost, sticker, share. These two were the exception, and they are the two
 * most-used controls on the surface.
 *
 * The name is sr-only TEXT, not an aria-label, and the third test is the one
 * that pins the difference: aria-label REPLACES an element's content as its
 * accessible name, so labelling the button that way would have taken the
 * count away from exactly the users this fix is for. As content it
 * concatenates, and "Like 12" survives.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThumbsUp, MessageCircle } from 'lucide-react';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});

import { __test__ } from '../HubPostCard';

const { ActionButton } = __test__;

describe('ActionButton', () => {
  it('has an accessible name', () => {
    render(<ActionButton icon={ThumbsUp} label="Like" count={0} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Like/ })).toBeTruthy();
  });

  it('keeps the count in the accessible name', () => {
    // The whole reason this is sr-only text and not an aria-label.
    render(<ActionButton icon={ThumbsUp} label="Like" count={12} onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: /Like/ });
    expect(btn.textContent).toContain('12');
    expect(btn.getAttribute('aria-label'), 'an aria-label here would hide the count').toBeNull();
  });

  it('reports toggle state on the element, not by swapping the label', () => {
    const { rerender } = render(
      <ActionButton icon={ThumbsUp} label="Like" count={1} pressed={false} onClick={() => {}} />
    );
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
    rerender(<ActionButton icon={ThumbsUp} label="Like" count={2} pressed onClick={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    // Name stays stable across the state change — that is the ARIA contract.
    expect(btn.textContent).toContain('Like');
  });

  it('exposes the comment disclosure as expanded, not pressed', () => {
    render(
      <ActionButton icon={MessageCircle} label="Comments" count={3} expanded onClick={() => {}} />
    );
    const btn = screen.getByRole('button', { name: /Comments/ });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-pressed')).toBeNull();
  });

  it('does not render a name-less button when the label is omitted', () => {
    // Guards the regression directly: the old component had no label at all,
    // and this is what that looked like.
    render(<ActionButton icon={ThumbsUp} count={5} onClick={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent.replace(/\d/g, '').trim(), 'no name at all is the bug').toBe('');
  });
});

describe('both call sites pass a label', () => {
  it('the like and comment buttons are named from the catalog', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/components/hub/HubPostCard.jsx'), 'utf8');
    const calls = src.match(/<ActionButton[\s\S]*?\/>/g) || [];
    expect(calls.length, 'the action row must still have both buttons').toBe(2);
    for (const c of calls) {
      expect(c, 'every ActionButton must be named').toMatch(/label=\{tFallback\(/);
    }
    expect(src).toMatch(/label=\{tFallback\('hub\.post\.like', 'Like'\)\}/);
    expect(src).toMatch(/label=\{tFallback\('hub\.post\.comments', 'Comments'\)\}/);
  });

  it('those keys are translated everywhere', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const en = JSON.parse(readFileSync(resolve(process.cwd(), 'src/locales/en.json'), 'utf8'));
    expect(en['hub.post.like']).toBe('Like');
    expect(en['hub.post.comments']).toBe('Comments');
    for (const loc of ['es', 'fr', 'de', 'it', 'nl', 'pl', 'pt']) {
      const cat = JSON.parse(readFileSync(resolve(process.cwd(), `src/locales/${loc}.json`), 'utf8'));
      for (const k of ['hub.post.like', 'hub.post.comments']) {
        expect(cat[k], `${loc} is missing ${k}`).toBeTruthy();
        expect(cat[k], `${loc}:${k} left in English`).not.toBe(en[k]);
      }
    }
  });
});
