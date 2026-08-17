// TransText exists so a sentence with a styled middle stays ONE message. These
// check the two things that makes it worth having: the placeholder can move
// (which is the whole point — word order is what differs between languages),
// and the node substituted into it survives as a node rather than being
// stringified into "[object Object]".
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TransText from '../TransText';

const mockT = vi.fn();
// Forwards whatever arity it is called with, rather than declaring two
// parameters and quietly dropping the rest. That matters here more than
// anywhere: the last test in this file asserts every call has exactly two
// arguments, and a mock that fixes its own arity makes that assertion
// unfalsifiable — with `(k, en) => mockT(k, en)` you can change TransText to
// call `tFallback(k, en, values)` and the whole file still passes.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (...args) => mockT(...args) }),
}));

describe('TransText', () => {
  it('substitutes a React node into the sentence, keeping its markup', () => {
    mockT.mockImplementation((_k, en) => en);
    render(<TransText k="x" en="Day {value}" values={{ value: <b>14</b> }} />);
    expect(screen.getByText('14').tagName).toBe('B');
    expect(document.body.textContent).toBe('Day 14');
  });

  it('honours the TRANSLATED word order, not the English one', () => {
    // The reason this component exists. A Spanish catalog can put the value
    // first; a fragment-per-key approach could not express that at all.
    mockT.mockImplementation(() => '{value} día');
    render(<TransText k="x" en="Day {value}" values={{ value: <b>14</b> }} />);
    expect(document.body.textContent).toBe('14 día');
  });

  it('handles several placeholders, and repeats of one', () => {
    mockT.mockImplementation((_k, en) => en);
    render(<TransText k="x" en="{a} of {b} ({a})" values={{ a: '3', b: '5' }} />);
    expect(document.body.textContent).toBe('3 of 5 (3)');
  });

  it('renders an unknown placeholder as its own token rather than dropping it', () => {
    // A silent gap reads as deliberate wording; a visible {missing} reads as the
    // call-site bug it is.
    mockT.mockImplementation((_k, en) => en);
    render(<TransText k="x" en="Hi {missing}" values={{}} />);
    expect(document.body.textContent).toBe('Hi {missing}');
  });

  it('passes the key and the English template through to tFallback untouched', () => {
    // The catalog stores the TEMPLATE. If this ever passed a rendered sentence,
    // en.json would drift from what the call site asks for.
    mockT.mockImplementation((_k, en) => en);
    render(<TransText k="cycleTracker.day" en="Day {value}" values={{ value: '1' }} />);
    expect(mockT).toHaveBeenCalledWith('cycleTracker.day', 'Day {value}');
  });

  it('never asks tFallback to interpolate — that would stringify the nodes', () => {
    mockT.mockImplementation((_k, en) => en);
    render(<TransText k="x" en="Day {value}" values={{ value: <b>14</b> }} />);
    expect(mockT.mock.calls.every((c) => c.length === 2)).toBe(true);
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('renders a plain string with no placeholders unchanged', () => {
    mockT.mockImplementation((_k, en) => en);
    render(<TransText k="x" en="Just words" />);
    expect(document.body.textContent).toBe('Just words');
  });
});
