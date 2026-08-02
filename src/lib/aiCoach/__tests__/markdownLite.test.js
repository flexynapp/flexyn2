import { describe, it, expect } from 'vitest';
import { parseBoldSegments } from '../markdownLite';
import { SUGGESTED_PROMPTS } from '../coach';

describe('parseBoldSegments', () => {
  it('returns a single plain segment for text with no markers', () => {
    expect(parseBoldSegments('just words')).toEqual([{ text: 'just words', bold: false }]);
  });

  it('splits a bold run out of its surrounding text', () => {
    expect(parseBoldSegments('a **bold** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'bold', bold: true },
      { text: ' c', bold: false },
    ]);
  });

  it('handles a reply that opens with the bold headline', () => {
    // The shape responders.js actually emits.
    expect(parseBoldSegments("**You've trained 4 times.**\nNice work.")).toEqual([
      { text: "You've trained 4 times.", bold: true },
      { text: '\nNice work.', bold: false },
    ]);
  });

  it('handles several runs in one message', () => {
    const segs = parseBoldSegments('**one** mid **two**');
    expect(segs.filter(s => s.bold).map(s => s.text)).toEqual(['one', 'two']);
  });

  it('leaves an unclosed marker as literal text', () => {
    // A truncated LLM reply must not bold everything after the dangling pair.
    expect(parseBoldSegments('start **unclosed here')).toEqual([
      { text: 'start **unclosed here', bold: false },
    ]);
  });

  it('does not let a bold run swallow later lines', () => {
    const segs = parseBoldSegments('**open\nnext line** after');
    expect(segs.every(s => !s.bold)).toBe(true);
  });

  it('leaves arithmetic and separators alone', () => {
    expect(parseBoldSegments('2 * 3 ** 4')).toEqual([{ text: '2 * 3 ** 4', bold: false }]);
    expect(parseBoldSegments('****')).toEqual([{ text: '****', bold: false }]);
  });

  it('handles empty and non-string input', () => {
    expect(parseBoldSegments('')).toEqual([]);
    expect(parseBoldSegments(null)).toEqual([]);
    expect(parseBoldSegments(undefined)).toEqual([]);
  });

  it('loses no characters — re-marking the bold runs rebuilds the input exactly', () => {
    const samples = [
      'plain',
      '**lead** then rest',
      'trailing **bold**',
      '**a** b **c** d',
      'no markers at all, just a longer sentence.',
      '**unclosed',
      "**What it's worth**\n• Crew war: ~328 pts\n\n**The bigger lever**\nTrain daily.",
    ];
    for (const s of samples) {
      const rebuilt = parseBoldSegments(s)
        .map(x => (x.bold ? `**${x.text}**` : x.text))
        .join('');
      expect(rebuilt).toBe(s);
    }
  });

  it('renders the static suggested prompts unchanged (they carry no markup)', () => {
    for (const p of SUGGESTED_PROMPTS) {
      expect(parseBoldSegments(p.text)).toEqual([{ text: p.text, bold: false }]);
    }
  });
});
