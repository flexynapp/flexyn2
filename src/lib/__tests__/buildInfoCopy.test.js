// copyDiagnostics() — the clipboard branch that has bitten this app before.
//
// The failure worth guarding is NOT "copy throws". It's the silent one: with
// `navigator.clipboard?.writeText(...)`, a missing API resolves to
// Promise<undefined>, the caller reports success, and the user pastes stale
// clipboard content into a bug report. Nobody finds out until a report arrives
// describing the wrong build — which is the exact class of confusion this
// whole build-stamp exists to end.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { copyDiagnostics, diagnosticString } from '../buildInfo';

const original = globalThis.navigator;

/** Swap in a navigator whose clipboard behaves however the test needs. */
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    value, configurable: true, writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: original, configurable: true, writable: true,
  });
  vi.restoreAllMocks();
});

describe('copyDiagnostics', () => {
  it('reports ok and writes the full diagnostic block', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText }, userAgent: 'test-ua', onLine: true });

    await expect(copyDiagnostics()).resolves.toBe('ok');
    expect(writeText).toHaveBeenCalledTimes(1);
    // The hash is the point of the exercise — assert it actually travels.
    expect(writeText.mock.calls[0][0]).toContain('build: ');
    expect(writeText.mock.calls[0][0]).toBe(diagnosticString());
  });

  it('reports unavailable rather than a false success when the API is absent', async () => {
    // Insecure-context HTTP and older browsers land here. Optional chaining
    // would resolve undefined and read as success at the call site.
    setNavigator({ userAgent: 'test-ua', onLine: true });
    await expect(copyDiagnostics()).resolves.toBe('unavailable');
  });

  it('reports unavailable when clipboard exists but writeText does not', async () => {
    setNavigator({ clipboard: {}, userAgent: 'test-ua', onLine: true });
    await expect(copyDiagnostics()).resolves.toBe('unavailable');
  });

  it('reports blocked when the browser refuses the write', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    setNavigator({ clipboard: { writeText }, userAgent: 'test-ua', onLine: true });
    await expect(copyDiagnostics()).resolves.toBe('blocked');
  });

  it('never throws — a diagnostic helper must not take down the surface it sits on', async () => {
    setNavigator(undefined);
    await expect(copyDiagnostics()).resolves.toBe('unavailable');
  });
});
