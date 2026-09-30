// The daily quest crash (2026-09-30): on a stale installed PWA the lazy
// QuestsSheet chunk no longer existed, and the guard's vite:preloadError
// handler called preventDefault(). Vite's contract is that a prevented
// preload error makes import() RESOLVE with undefined, so React.lazy read
// `undefined.default` and the Today page crashed with
// "undefined is not an object (evaluating 'X._result.default')".
//
// `viteImport` below reproduces Vite's handlePreloadError exactly, so these
// tests exercise the real contract rather than a paraphrase of it.
import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import {
  installStaleDeployGuard,
  isChunkLoadError,
  reloadOnce,
  __resetReloadPendingForTests,
} from '@/lib/staleDeployGuard';

// Copy of Vite 6's preload helper failure path.
function viteImport(err) {
  return Promise.resolve().then(() => {
    const e = new Event('vite:preloadError', { cancelable: true });
    e.payload = err;
    window.dispatchEvent(e);
    if (!e.defaultPrevented) throw err;
    // Prevented: the import resolves with nothing.
  });
}

const chunkError = () =>
  new TypeError('Failed to fetch dynamically imported module: https://x/assets/QuestsSheet-abc.js');

let reload;
beforeEach(() => {
  sessionStorage.clear();
  __resetReloadPendingForTests();
  reload = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
  installStaleDeployGuard();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('staleDeployGuard', () => {
  it('never prevents vite:preloadError, so the import rejects instead of resolving undefined', async () => {
    const err = chunkError();
    await expect(viteImport(err)).rejects.toBe(err);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('recognises the chunk errors each browser throws, and nothing else', () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true);
    expect(isChunkLoadError(new TypeError("undefined is not an object (evaluating 'D._result.default')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('reloads at most once a minute, and reports a reload already under way', () => {
    expect(reloadOnce()).toBe(true);
    expect(reloadOnce()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    __resetReloadPendingForTests();
    expect(reloadOnce()).toBe(false); // inside the one-minute window
  });

  it('does not reload while offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(reloadOnce()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('a lazy section whose chunk is gone', () => {
  // A fresh lazy per mount: React.lazy caches its outcome for good.
  const mount = () => {
    const Sheet = React.lazy(() => viteImport(chunkError()));
    return render(
      <MemoryRouter>
        <ErrorBoundary label="DailyQuestsCard">
          <Suspense fallback={null}>
            <Sheet />
          </Suspense>
        </ErrorBoundary>
      </MemoryRouter>
    );
  };

  it('reloads the page and shows no crash card', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { mount(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(reload).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the fallback when a reload was already spent, never the _result.default crash', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorage.setItem('flexyn.chunkReloadAttemptedAt', String(Date.now()));
    await act(async () => { mount(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(reload).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const logged = errors.mock.calls.flat().map(String).join('\n');
    expect(logged).not.toMatch(/_result/);
    expect(logged).toMatch(/dynamically imported module/);
  });
});
