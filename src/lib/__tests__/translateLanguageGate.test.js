// Tests for isLikelyAlreadyInLanguage — the gate that decides whether a
// Hub post shows a "Translate" button.
//
// The asymmetry matters and drives every case below: a spurious button
// is a minor annoyance, a MISSING button means the reader simply cannot
// read the post. So the gate must err toward showing.
//
// It previously failed in both of the ways that hurt most:
//   • Japanese and Chinese matched on the shared CJK ideograph block, so
//     they shadowed each other — a Japanese user could not translate a
//     Chinese post, and vice versa.
//   • A single character was enough to hide the button, so a 90%-English
//     post with two kanji in it vanished for ja and zh readers.

import { describe, it, expect } from 'vitest';
import { isLikelyAlreadyInLanguage as alreadyIn } from '../translate';

const CHINESE  = '今天练腿，深蹲一百公斤，感觉很好';
const JAPANESE = '今日は脚の日。スクワット100キロ、調子いい';
const KOREAN   = '오늘은 하체 하는 날. 스쿼트 100킬로 성공';
const ARABIC   = 'تمرين الأرجل اليوم، ضغط الأرجل مئة كيلو';
const HINDI    = 'आज पैरों की कसरत, स्क्वाट सौ किलो';
const RUSSIAN  = 'Сегодня день ног. Присед сто килограммов';
const ENGLISH  = 'Hit a new squat PR today, felt great';

describe('the button stays available across scripts', () => {
  it('a Japanese reader can translate a Chinese post', () => {
    // The original bug: Chinese uses the same ideographs as Japanese
    // kanji, so this returned true and the button disappeared.
    expect(alreadyIn(CHINESE, 'ja')).toBe(false);
  });

  it('a Chinese reader can translate a Japanese post', () => {
    // The mirror bug. Japanese prose nearly always contains kanji.
    expect(alreadyIn(JAPANESE, 'zh')).toBe(false);
  });

  it('a Korean reader can translate Chinese and Japanese posts', () => {
    expect(alreadyIn(CHINESE,  'ko')).toBe(false);
    expect(alreadyIn(JAPANESE, 'ko')).toBe(false);
  });

  it('CJK readers can translate Korean posts', () => {
    expect(alreadyIn(KOREAN, 'ja')).toBe(false);
    expect(alreadyIn(KOREAN, 'zh')).toBe(false);
  });

  it('every non-Latin reader can translate an English post', () => {
    for (const lang of ['ja', 'zh', 'ko', 'ar', 'hi', 'ru']) {
      expect(alreadyIn(ENGLISH, lang), `${lang} lost the button`).toBe(false);
    }
  });

  it('Latin-script readers always keep the button', () => {
    // Can't distinguish English from Spanish without a real LID model,
    // so never claim already-translated.
    for (const lang of ['en', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'pl', 'nl']) {
      for (const text of [ENGLISH, CHINESE, JAPANESE, ARABIC]) {
        expect(alreadyIn(text, lang), `${lang} lost the button`).toBe(false);
      }
    }
  });
});

describe('a stray foreign word does not hide the button', () => {
  it('keeps it on a mostly-English post containing kanji', () => {
    expect(alreadyIn('Great session today 頑張った', 'ja')).toBe(false);
    expect(alreadyIn('Great session today 頑張った', 'zh')).toBe(false);
  });

  it('keeps it on a mostly-English post containing one Cyrillic word', () => {
    expect(alreadyIn('My gym is called Спорт', 'ru')).toBe(false);
  });

  it('keeps it on a mostly-English post containing one Arabic word', () => {
    expect(alreadyIn('Trained at النادي today', 'ar')).toBe(false);
  });
});

describe('genuinely same-language posts still hide it', () => {
  const cases = [
    ['ja', JAPANESE], ['zh', CHINESE], ['ko', KOREAN],
    ['ar', ARABIC],   ['hi', HINDI],   ['ru', RUSSIAN],
  ];
  it.each(cases)('%s post is recognised as already in %s', (lang, text) => {
    expect(alreadyIn(text, lang)).toBe(true);
  });
});

describe('script-neutral noise is ignored', () => {
  it('emoji and punctuation do not dilute the measurement', () => {
    // A short Japanese post padded with emoji is still Japanese.
    expect(alreadyIn('筋トレ最高！！！ 💪💪💪 🔥🔥🔥', 'ja')).toBe(true);
  });

  it('hashtags and mentions do not dilute it either', () => {
    expect(alreadyIn('今天练腿 #健身 #增肌 @friend', 'zh')).toBe(true);
  });

  it('a post of only emoji claims nothing', () => {
    for (const lang of ['ja', 'zh', 'ko', 'ar', 'ru']) {
      expect(alreadyIn('💪🔥🎉', lang)).toBe(false);
    }
  });
});

describe('malformed input', () => {
  it('returns false rather than throwing', () => {
    expect(alreadyIn('', 'ja')).toBe(false);
    expect(alreadyIn(null, 'ja')).toBe(false);
    expect(alreadyIn(undefined, 'ja')).toBe(false);
    expect(alreadyIn(JAPANESE, '')).toBe(false);
    expect(alreadyIn(JAPANESE, null)).toBe(false);
    expect(alreadyIn(JAPANESE, 'not-a-language')).toBe(false);
    expect(alreadyIn('   ', 'ja')).toBe(false);
  });
});
