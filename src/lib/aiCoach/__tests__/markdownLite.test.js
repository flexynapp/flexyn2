import { describe, it, expect } from 'vitest';
import { parseBoldSegments, cleanCoachText, parseCoachBlocks } from '../markdownLite';
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

// Real replies from the live coach-chat function, 2026-09-29.
describe('cleanCoachText', () => {
  it('turns a clause dash into two sentences', () => {
    expect(cleanCoachText("You've got solid pressing strength — let's use it."))
      .toBe("You've got solid pressing strength. Let's use it.");
  });

  it('turns a dash before a conjunction into a comma', () => {
    expect(cleanCoachText('Vous progressez—mais lentement.')).toBe('Vous progressez, mais lentement.');
  });

  it('turns two dashes around an aside into two commas', () => {
    expect(cleanCoachText('Add 5 lb next session — so 190×5 — and hold it.'))
      .toBe('Add 5 lb next session, so 190×5, and hold it.');
  });

  it('keeps the dash in a number range', () => {
    expect(cleanCoachText('Eat 2,700–2,800 calories at 160–180 g protein.'))
      .toBe('Eat 2,700–2,800 calories at 160–180 g protein.');
  });

  it('capitalises bullets and converts markdown list markers', () => {
    expect(cleanCoachText('• first\n- second\n* third')).toBe('• First\n• Second\n• Third');
  });

  it('drops single-asterisk italics but keeps bold', () => {
    expect(cleanCoachText('**Head.** The key is *small and consistent*.'))
      .toBe('**Head.** The key is small and consistent.');
  });

  it('turns a markdown heading into the bold headline', () => {
    expect(cleanCoachText('## Train today\nLightly.')).toBe('**Train today**\nLightly.');
  });

  it('leaves arithmetic alone', () => {
    expect(cleanCoachText('2 * 3 is 6')).toBe('2 * 3 is 6');
  });
});

describe('parseCoachBlocks', () => {
  it('groups a headline, a list and a closing line', () => {
    const text = '**Train, but dial it back.**\n\n• One\n• Two\n\nWhere is it sore?';
    expect(parseCoachBlocks(text)).toEqual([
      { type: 'p', text: '**Train, but dial it back.**' },
      { type: 'list', items: ['One', 'Two'] },
      { type: 'p', text: 'Where is it sore?' },
    ]);
  });

  it('splits a paragraph that runs straight into bullets', () => {
    expect(parseCoachBlocks('Intro\n• A\n• B')).toEqual([
      { type: 'p', text: 'Intro' },
      { type: 'list', items: ['A', 'B'] },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCoachBlocks('')).toEqual([]);
  });
});
