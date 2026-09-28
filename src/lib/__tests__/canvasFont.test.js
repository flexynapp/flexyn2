import { describe, it, expect, afterEach, vi } from 'vitest';
import { canvasFont, canvasFontsReady } from '@/lib/canvasFont';

afterEach(() => {
  document.documentElement.style.removeProperty('--font-heading');
  vi.useRealTimers();
});

describe('canvasFont', () => {
  it('draws in the page token, so a card moves with the brand font', () => {
    document.documentElement.style.setProperty('--font-heading', "'Sofia Sans', sans-serif");
    expect(canvasFont('bold 24px')).toBe("bold 24px 'Sofia Sans', sans-serif");
  });

  it('falls back to the system stack when the token is unset', () => {
    expect(canvasFont('24px')).toBe('24px system-ui, -apple-system, sans-serif');
  });
});

describe('canvasFontsReady', () => {
  it('resolves when the font never loads, so a card is never held up', async () => {
    vi.useFakeTimers();
    const load = vi.fn(() => new Promise(() => {}));
    Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
    const done = vi.fn();
    canvasFontsReady(1500).then(done);
    await vi.advanceTimersByTimeAsync(1500);
    expect(done).toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
    delete document.fonts;
  });

  it('resolves even when loading rejects', async () => {
    Object.defineProperty(document, 'fonts', { value: { load: () => Promise.reject(new Error('x')) }, configurable: true });
    await expect(canvasFontsReady(50)).resolves.toBeUndefined();
    delete document.fonts;
  });
});
