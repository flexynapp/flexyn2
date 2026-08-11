/**
 * The three-way Translate affordance, and the Latin-script language vote
 * behind it.
 *
 * Why this exists: `isLikelyAlreadyInLanguage` used to `return false` for
 * every Latin-script target, on the correct reasoning that you cannot tell
 * English from Spanish without a language-ID model. The consequence was that
 * an English reader got a Translate button on every English comment, and
 * pressing it made the button disappear — English→English returns the input
 * unchanged, which the caller treats as a failed translation.
 *
 * The replacement is a function-word vote with an explicit "not sure" state,
 * so the three outcomes are:
 *
 *   'same'      → confidently the viewer's language   → hide the button
 *   'unsure'    → too short / too close to call       → show it faded
 *   'different' → confidently another language        → show it normally
 *
 * The asymmetry is deliberate and is the thing to preserve: hiding the button
 * from someone who cannot read the comment is a much worse failure than
 * showing a dim button to someone who does not need it. So every ambiguous
 * case must land on 'unsure', never on 'same'.
 */
import { describe, it, expect } from 'vitest';
import { guessLatinLanguage, translationHint, isLikelyAlreadyInLanguage } from '@/lib/translate';

// Sentences long enough to carry real function words, which is the only
// condition under which the vote is allowed to be confident.
const SENTENCES = {
  en: 'I went to the gym and it was the best session that I have had in a while',
  es: 'Hoy fui al gimnasio y la sesión de piernas fue muy buena porque no me dolía',
  fr: 'Je suis allé à la salle et la séance de jambes était très bien pour moi',
  de: 'Ich war heute im Fitnessstudio und das Beintraining ist sehr gut für mich gewesen',
  pt: 'Eu fui para a academia hoje e o treino de pernas foi muito bom para mim',
  it: 'Sono andato in palestra e la sessione di gambe è stata molto buona per me',
  nl: 'Ik ben naar de sportschool geweest en het was een van de beste trainingen',
  pl: 'Byłem dzisiaj na siłowni i to nie jest tak bardzo ciężkie jak się wydaje',
  tr: 'Bugün spor salonuna gittim ve bu antrenman benim için çok daha iyi oldu',
};

describe('guessLatinLanguage', () => {
  it('identifies each Latin-script language from its own function words', () => {
    for (const [lang, text] of Object.entries(SENTENCES)) {
      const guess = guessLatinLanguage(text);
      expect(guess.lang, `${lang} misidentified as ${guess.lang}`).toBe(lang);
      expect(guess.confident, `${lang} was not confident`).toBe(true);
    }
  });

  it('refuses to guess on fewer than three words', () => {
    for (const text of ['Ola', 'nice', 'squat PR', '']) {
      expect(guessLatinLanguage(text).confident).toBe(false);
    }
  });

  it('refuses to guess when no function word matches', () => {
    // Proper nouns and gym jargon carry no language signal at all.
    const guess = guessLatinLanguage('Bench Squat Deadlift Overhead Press');
    expect(guess.lang).toBe(null);
    expect(guess.confident).toBe(false);
  });

  it('refuses to guess when two languages tie', () => {
    // 'de' and 'la' are function words in several of these at once, so a
    // string made only of shared tokens must not resolve to a winner.
    expect(guessLatinLanguage('de la de la').confident).toBe(false);
  });
});

describe('translationHint', () => {
  it('hides the button when the comment is confidently the viewer language', () => {
    expect(translationHint(SENTENCES.en, 'en')).toBe('same');
    expect(translationHint(SENTENCES.es, 'es')).toBe('same');
    expect(translationHint(SENTENCES.de, 'de')).toBe('same');
  });

  it('offers the button when the comment is confidently another language', () => {
    expect(translationHint(SENTENCES.es, 'en')).toBe('different');
    expect(translationHint(SENTENCES.en, 'es')).toBe('different');
    expect(translationHint(SENTENCES.fr, 'de')).toBe('different');
  });

  it('offers it for a non-Latin script regardless of vote', () => {
    expect(translationHint('今天练腿，深蹲一百公斤', 'en')).toBe('different');
    expect(translationHint('Сегодня день ног. Присед сто килограммов', 'en')).toBe('different');
    expect(translationHint('تمرين الأرجل اليوم، ضغط الأرجل مئة كيلو', 'en')).toBe('different');
  });

  it('hides it for a non-Latin reader on their own script', () => {
    expect(translationHint('今天练腿，深蹲一百公斤，感觉很好', 'zh')).toBe('same');
    expect(translationHint('Сегодня день ног. Присед сто килограммов', 'ru')).toBe('same');
  });

  it("falls to 'unsure', never 'same', when it cannot tell", () => {
    // This is the safety property. Anything ambiguous keeps the button.
    for (const text of ['Ola', 'nice one', 'PR!!', 'Squat 100kg', 'ok']) {
      expect(translationHint(text, 'en'), `"${text}" was over-claimed`).not.toBe('same');
    }
  });

  it('treats missing input as unsure rather than throwing', () => {
    expect(translationHint('', 'en')).toBe('unsure');
    expect(translationHint(null, 'en')).toBe('unsure');
    expect(translationHint('hello', null)).toBe('unsure');
  });
});

describe('isLikelyAlreadyInLanguage still guards the old cases', () => {
  it('does not hide a Spanish post from an English reader', () => {
    expect(isLikelyAlreadyInLanguage(SENTENCES.es, 'en')).toBe(false);
  });

  it('does not hide an English post from a Spanish reader', () => {
    expect(isLikelyAlreadyInLanguage(SENTENCES.en, 'es')).toBe(false);
  });
});
