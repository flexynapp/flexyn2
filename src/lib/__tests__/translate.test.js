import { describe, it, expect } from 'vitest';
import { isLikelyAlreadyInLanguage, clearTranslationCache, translateText } from '../translate';

describe('isLikelyAlreadyInLanguage', () => {
  it('returns false for empty input', () => {
    expect(isLikelyAlreadyInLanguage('', 'en')).toBe(false);
    expect(isLikelyAlreadyInLanguage(null, 'en')).toBe(false);
  });

  it('detects Japanese script for ja target', () => {
    expect(isLikelyAlreadyInLanguage('こんにちは', 'ja')).toBe(true);
    expect(isLikelyAlreadyInLanguage('カタカナ', 'ja')).toBe(true);
  });

  it('does NOT claim pure-kanji text is Japanese', () => {
    // Changed deliberately — this used to assert true, and that
    // assertion encoded the bug it was meant to protect.
    //
    // Kanji are the same Unicode block Chinese uses, so treating
    // kanji-without-kana as Japanese meant every Chinese post looked
    // Japanese, and a Japanese reader lost the Translate button on all
    // of them. Requiring kana is what tells the two apart.
    //
    // The trade is real but heavily one-sided: a pure-kanji Japanese
    // string (a compound noun or title, essentially never a whole post —
    // natural prose carries particles like は/を/の) now shows a
    // redundant Translate button. That's a shrug. The old behavior made
    // Chinese posts unreadable to Japanese users, which is not.
    expect(isLikelyAlreadyInLanguage('日本語', 'ja')).toBe(false);
    // ...and the same string must not be claimed as Chinese-only either
    // when kana are present elsewhere in the text.
    expect(isLikelyAlreadyInLanguage('日本語のポスト', 'ja')).toBe(true);
    expect(isLikelyAlreadyInLanguage('日本語のポスト', 'zh')).toBe(false);
  });

  it('detects Chinese (CJK) for zh target', () => {
    expect(isLikelyAlreadyInLanguage('你好世界', 'zh')).toBe(true);
  });

  it('detects Korean Hangul for ko target', () => {
    expect(isLikelyAlreadyInLanguage('안녕하세요', 'ko')).toBe(true);
  });

  it('detects Arabic script for ar target', () => {
    expect(isLikelyAlreadyInLanguage('مرحبا', 'ar')).toBe(true);
  });

  it('detects Devanagari for hi target', () => {
    expect(isLikelyAlreadyInLanguage('नमस्ते', 'hi')).toBe(true);
  });

  it('detects Cyrillic for ru target', () => {
    expect(isLikelyAlreadyInLanguage('Привет', 'ru')).toBe(true);
  });

  it('returns false when text is plain Latin and target is non-Latin', () => {
    expect(isLikelyAlreadyInLanguage('Hello world', 'ja')).toBe(false);
    expect(isLikelyAlreadyInLanguage('Hello world', 'zh')).toBe(false);
  });

  it('returns false (conservative) for Latin scripts — caller should still offer translate', () => {
    // Can't reliably distinguish English from Spanish/French/etc on character class alone
    expect(isLikelyAlreadyInLanguage('Hello world', 'en')).toBe(false);
    expect(isLikelyAlreadyInLanguage('Hola mundo', 'es')).toBe(false);
  });
});

describe('translateText — input validation', () => {
  it('returns null for missing inputs', async () => {
    expect(await translateText('', 'es')).toBeNull();
    expect(await translateText(null, 'es')).toBeNull();
    expect(await translateText('hi', '')).toBeNull();
  });

  it('returns the original text when source equals target (no engine call)', async () => {
    const result = await translateText('Hello', 'en', 'en');
    expect(result).toEqual({ translatedText: 'Hello', sourceLang: 'en', engine: 'noop' });
  });

  it('returns null for whitespace-only text', async () => {
    expect(await translateText('   \n\t  ', 'es')).toBeNull();
  });
});

describe('clearTranslationCache', () => {
  it('is exposed and callable without throwing', () => {
    // Pure cache clear — never throws
    expect(() => clearTranslationCache()).not.toThrow();
  });
});
