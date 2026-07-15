import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cdnImageUrl, cdnFallbackSrc } from '../imageCdn';

const RAW =
  'https://abc.supabase.co/storage/v1/object/public/uploads/user-1/1778721496974.jpeg';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cdnImageUrl', () => {
  it('passes URLs through untouched while VITE_IMAGE_CDN is unset (current default)', () => {
    expect(cdnImageUrl(RAW, { width: 320 })).toBe(RAW);
  });

  describe('with VITE_IMAGE_CDN=1', () => {
    beforeEach(() => vi.stubEnv('VITE_IMAGE_CDN', '1'));

    it('rewrites a public object URL to the render endpoint with params', () => {
      expect(cdnImageUrl(RAW, { width: 320, quality: 50 })).toBe(
        'https://abc.supabase.co/storage/v1/render/image/public/uploads/user-1/1778721496974.jpeg?width=320&quality=50'
      );
    });

    it('leaves non-Supabase-storage URLs alone', () => {
      const external = 'https://example.com/pic.jpg';
      expect(cdnImageUrl(external, { width: 320 })).toBe(external);
      expect(cdnImageUrl(null)).toBe(null);
      expect(cdnImageUrl(undefined)).toBe(undefined);
    });

    it('does not double-transform an already-rewritten URL', () => {
      const once = cdnImageUrl(RAW, { width: 320 });
      expect(cdnImageUrl(once, { width: 320 })).toBe(once);
    });
  });
});

describe('cdnFallbackSrc', () => {
  it('swaps a failed transformed src back to the raw URL and reports the swap', () => {
    const el = {
      src: 'https://abc.supabase.co/storage/v1/render/image/public/uploads/x.jpg?width=320',
    };
    expect(cdnFallbackSrc({ currentTarget: el }, RAW)).toBe(true);
    expect(el.src).toBe(RAW);
  });

  it('returns false when the raw URL itself failed (caller handles hide)', () => {
    const el = { src: RAW };
    expect(cdnFallbackSrc({ currentTarget: el }, RAW)).toBe(false);
  });

  it('returns false for missing event/raw url', () => {
    expect(cdnFallbackSrc(null, RAW)).toBe(false);
    expect(cdnFallbackSrc({ currentTarget: { src: 'x' } }, null)).toBe(false);
  });
});
