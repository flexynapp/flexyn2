// Pseudolocalization is a VERIFICATION tool, so its own guarantees have to
// hold: placeholders survive, every letter is marked, and the delimiters are
// unambiguous. If any of these slip, a pseudo run reports a false all-clear.
import { describe, it, expect } from 'vitest';
import { pseudoize } from '../i18n';

describe('pseudoize', () => {
  it('wraps the string so its boundaries are visible', () => {
    expect(pseudoize('Save')).toMatch(/^⟦.*⟧$/);
  });

  it('accents every ASCII letter — an unmangled letter means an untranslated string', () => {
    const out = pseudoize('Save');
    expect(out).not.toMatch(/[A-Za-z]/);
  });

  it('leaves {placeholders} intact so interpolation still works', () => {
    const out = pseudoize('Hi {name}, you have {count} left');
    expect(out).toContain('{name}');
    expect(out).toContain('{count}');
  });

  it('does not accent letters INSIDE a placeholder', () => {
    expect(pseudoize('{userName}')).toContain('{userName}');
  });

  it('expands length so a too-narrow control fails visibly', () => {
    const out = pseudoize('Notifications');
    expect(out.length).toBeGreaterThan('Notifications'.length * 1.3);
  });

  it('passes non-strings and empties through untouched', () => {
    expect(pseudoize('')).toBe('');
    expect(pseudoize(null)).toBe(null);
    expect(pseudoize(42)).toBe(42);
  });

  it('preserves digits and punctuation — only letters carry the marking', () => {
    const out = pseudoize('3 sets × 12 reps!');
    expect(out).toContain('3');
    expect(out).toContain('12');
    expect(out).toContain('×');
    expect(out).toContain('!');
  });
});
