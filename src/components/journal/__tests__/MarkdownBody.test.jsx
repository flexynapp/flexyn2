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
