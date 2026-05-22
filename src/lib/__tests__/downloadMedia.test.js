// Tests for src/lib/downloadMedia.js — the shared "save to device"
// helper used by StoryPreviewSheet + StoryViewer. We stub fetch,
// URL.createObjectURL, the click chain, and navigator.userAgent to
// drive each branch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let originalUA;
let originalFetch;
let originalCreateObjectURL;
let originalRevokeObjectURL;

beforeEach(() => {
  originalUA = navigator.userAgent;
  originalFetch = global.fetch;
  originalCreateObjectURL = URL.createObjectURL;
  originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:mock-1');
  URL.revokeObjectURL = vi.fn();
  vi.useFakeTimers();
});

afterEach(() => {
  Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true });
  global.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.useRealTimers();
});

function setUA(ua) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

describe('downloadMedia', () => {
  it('returns { ok: false } when url is empty', async () => {
    const { downloadMedia } = await import('../downloadMedia');
    expect(await downloadMedia(null, 'x.jpg')).toEqual({ ok: false });
    expect(await downloadMedia('',   'x.jpg')).toEqual({ ok: false });
  });

  it('opens a new tab on iOS Safari (the platform-native save path)', async () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { downloadMedia } = await import('../downloadMedia');
    const res = await downloadMedia('https://example.com/x.jpg', 'x.jpg');
    expect(res).toEqual({ ok: true, opened: true });
    expect(openSpy).toHaveBeenCalledWith('https://example.com/x.jpg', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('uses the <a download> blob path on non-iOS browsers', async () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
    global.fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['x']),
    }));
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') {
        const a = origCreateElement('a');
        a.click = clickSpy;
        return a;
      }
      return origCreateElement(tag);
    });
    const { downloadMedia } = await import('../downloadMedia');
    const res = await downloadMedia('https://example.com/x.jpg', 'story.jpg');
    expect(res).toEqual({ ok: true });
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    // revokeObjectURL is scheduled via setTimeout — advance time.
    vi.advanceTimersByTime(2100);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  it('returns { ok: false } when fetch fails', async () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36');
    global.fetch = vi.fn(async () => ({ ok: false, blob: async () => new Blob() }));
    const { downloadMedia } = await import('../downloadMedia');
    const res = await downloadMedia('https://example.com/missing.jpg', 'x.jpg');
    expect(res).toEqual({ ok: false });
  });

  it('returns { ok: false } when fetch throws (offline)', async () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36');
    global.fetch = vi.fn(async () => { throw new Error('network'); });
    const { downloadMedia } = await import('../downloadMedia');
    expect(await downloadMedia('https://x.com/x.jpg', 'x.jpg')).toEqual({ ok: false });
  });
});
