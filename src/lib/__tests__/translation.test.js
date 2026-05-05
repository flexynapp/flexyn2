import { describe, it, expect } from 'vitest';
import { isLikelyAlreadyInLanguage } from '../translation';

describe('isLikelyAlreadyInLanguage', () => {
  it('returns false for empty input', () => {
    expect(isLikelyAlreadyInLanguage('', 'en')).toBe(false);
    expect(isLikelyAlreadyInLanguage(null, 'en')).toBe(false);
  });

  it('detects Japanese script for ja target', () => {
    expect(isLikelyAlreadyInLanguage('こんにちは', 'ja')).toBe(true);
    expect(isLikelyAlreadyInLanguage('カタカナ', 'ja')).toBe(true);
    expect(isLikelyAlreadyInLanguage('日本語', 'ja')).toBe(true);
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
