// src/components/journal/__tests__/MarkdownBody.test.jsx
//
// The journal's read-only renderer understood exactly what the toolbar
// emits — bold and bullets — so anything a person TYPED came back at
// them with its syntax still attached: "# Deload week" rendered the hash,
// "1. Squats" kept the "1.". A keyboard is not the toolbar.
//
// Rendered rather than unit-called, because the defect is what the reader
// SEES. A literal "#" in the output is the entire bug and only the
// rendered text shows it.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownBody from '../MarkdownBody';

const body = (text) => render(<MarkdownBody text={text} placeholder="empty" />);

describe('MarkdownBody — what a keyboard produces, not just the toolbar', () => {
  it('renders a heading without its hashes', () => {
    const { container } = body('# Deload week');
    expect(screen.getByText('Deload week')).toBeTruthy();
    expect(container.textContent).not.toContain('#');
  });

  it('renders every heading level at one weight — the title above already owns the ramp', () => {
    const { container } = body('# One\n## Two\n### Three');
    ['One', 'Two', 'Three'].forEach(t => expect(screen.getByText(t)).toBeTruthy());
    expect(container.textContent).not.toContain('#');
    const sizes = new Set([...container.querySelectorAll('p')]
      .filter(p => ['One', 'Two', 'Three'].includes(p.textContent))
      .map(p => p.className));
    expect(sizes.size).toBe(1);
  });

  it('renders an ordered list, with the numbers as markers rather than text', () => {
    const { container } = body('1. Squats\n2. Bench');
    expect(container.querySelector('ol')).toBeTruthy();
    expect(screen.getByText('Squats')).toBeTruthy();
    expect(container.textContent).not.toContain('1.');
  });

  it('accepts "1)" as well as "1." — both are things people type', () => {
    const { container } = body('1) Squats');
    expect(container.querySelector('ol')).toBeTruthy();
    expect(screen.getByText('Squats')).toBeTruthy();
  });

  it('keeps bullets and numbers in separate lists rather than merging them', () => {
    const { container } = body('- a\n- b\n1. c\n2. d');
    expect(container.querySelectorAll('ul')).toHaveLength(1);
    expect(container.querySelectorAll('ol')).toHaveLength(1);
    expect(container.querySelectorAll('li')).toHaveLength(4);
  });

  it('still renders bold, which is what the toolbar emits', () => {
    const { container } = body('Hit a **PR** today');
    expect(container.querySelector('strong')?.textContent).toBe('PR');
  });

  it('leaves a bare hash alone — "#3 was the hard set" is not a heading', () => {
    // A hash needs a space after it to be a heading. Without this, set
    // numbering and bodyweight notes would silently become headings.
    const { container } = body('#3 was the hard set');
    expect(container.textContent).toContain('#3 was the hard set');
    expect(container.querySelector('ol')).toBeNull();
  });

  it('does not turn a weight into a list — "185 lb" is not "1."', () => {
    const { container } = body('185 lb felt light');
    expect(container.querySelector('ol')).toBeNull();
    expect(container.textContent).toContain('185 lb felt light');
  });

  it('shows the placeholder for empty or whitespace-only text', () => {
    body('   ');
    expect(screen.getByText('empty')).toBeTruthy();
  });
});

/**
 * Photos now live INSIDE the body, at the point the user put them, rather
 * than in a grid pinned under the whole entry. That only works if the reader
 * renders the token — otherwise the entry reads back as raw
 * `![photo](https://…)` markup, which is a worse failure than the bottom-grid
 * it replaced.
 */
describe('MarkdownBody — inline images', () => {
  const URL = 'https://x.supabase.co/storage/v1/object/public/uploads/u/journal/a.jpg';

  it('renders an image token as an <img>, not as text', () => {
    const { container } = body(`![squat rack](${URL})`);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(URL);
    expect(img?.getAttribute('alt')).toBe('squat rack');
    expect(container.textContent).not.toContain('![');
  });

  it('keeps the image where it was written, between the lines around it', () => {
    const { container } = body(`before\n![p](${URL})\nafter`);
    const text = container.textContent;
    expect(text).toContain('before');
    expect(text).toContain('after');
    expect(container.querySelectorAll('img')).toHaveLength(1);
    // The paragraph carrying the image must sit BETWEEN the two text
    // paragraphs — the whole point is that position is preserved.
    const kids = [...container.firstChild.childNodes];
    const idxBefore = kids.findIndex(n => n.textContent === 'before');
    const idxImg = kids.findIndex(n => n.querySelector?.('img'));
    const idxAfter = kids.findIndex(n => n.textContent === 'after');
    expect(idxBefore).toBeLessThan(idxImg);
    expect(idxImg).toBeLessThan(idxAfter);
  });

  it('renders several images in the order they were inserted', () => {
    const { container } = body(`![one](${URL}?1)\n![two](${URL}?2)`);
    const srcs = [...container.querySelectorAll('img')].map(i => i.getAttribute('src'));
    expect(srcs).toEqual([`${URL}?1`, `${URL}?2`]);
  });

  it('renders an image inside a bullet', () => {
    const { container } = body(`- set 3 ![form check](${URL})`);
    expect(container.querySelector('li img')).toBeTruthy();
  });

  it('still bolds text on a line that also carries an image', () => {
    // Images are split out FIRST; if bold ran first it would tear a token
    // whose alt text contains asterisks.
    const { container } = body(`**PR** today ![p](${URL})`);
    expect(container.querySelector('strong')?.textContent).toBe('PR');
    expect(container.querySelector('img')).toBeTruthy();
  });

  it('leaves a lone exclamation mark alone', () => {
    const { container } = body('felt great! [not a link]');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('felt great!');
  });

  it('does not treat a plain markdown link as an image', () => {
    const { container } = body(`[the log](${URL})`);
    expect(container.querySelector('img')).toBeNull();
  });
});
