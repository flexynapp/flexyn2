/**
 * Global test setup — runs before every test file.
 *
 * 1. Extends expect() with @testing-library/jest-dom matchers
 *    (toBeInTheDocument, toHaveTextContent, toBeDisabled, etc.)
 * 2. Raises Testing Library's own async timeout — see below, it is NOT the
 *    same knob as vitest's testTimeout
 * 3. Stubs browser APIs that jsdom doesn't implement
 * 4. Silences known-noisy console output during tests
 */

import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import { vi } from 'vitest';

// ── Testing Library's async timeout ────────────────────────────────────────
// `findBy*` and `waitFor` have their OWN timeout, and vitest's `testTimeout`
// does not govern it. vitest.config.js raised testTimeout to 15s precisely
// because a loaded machine turns fast tests into false reds — but that could
// never help here, because RTL gives up at its own 1000ms default first and
// throws a TestingLibraryElementError long before the test times out.
//
// That is what made CrewTopBoard look flaky on 2026-08-16: "Unable to find an
// element with the text: Alpha" inside a multi-file run, passing in isolation
// and passing on a re-run. Nothing was wrong with the component or the
// assertion — the react-query resolve plus render simply landed past one
// second while twenty vitest workers competed for the CPU. Confirmed by
// setting this to 1, which reproduces that exact message deterministically.
//
// The failure is misleading in both directions: it reads as a missing element,
// which is a real bug, and it vanishes when you re-run the file alone, which
// reads as pure noise. It is neither.
//
// 5s absorbs a saturated machine while staying well under the 15s
// testTimeout, so a query that genuinely never resolves still fails as an RTL
// error — naming the element, with a DOM dump — rather than as a bare vitest
// timeout with nothing to read. This is NOT licence for a slow test: if
// something needs seconds of real work, understand it rather than
// accommodate it.
configure({ asyncUtilTimeout: 5000 });

// ── Supabase env stubs ─────────────────────────────────────────────────────
// The Supabase client throws at import time if VITE_SUPABASE_URL or
// VITE_SUPABASE_ANON_KEY are missing. Fresh containers / CI runners that
// don't have a local .env would otherwise fail every test file that
// transitively imports `@/api/supabaseClient`. The values are stubs — no
// network calls happen in tests (data fns use vi.mock chains).
if (!import.meta.env.VITE_SUPABASE_URL) {
  import.meta.env.VITE_SUPABASE_URL = 'https://stub.supabase.co';
}
if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
  import.meta.env.VITE_SUPABASE_ANON_KEY = 'stub-anon-key';
}

// ── Browser API stubs ──────────────────────────────────────────────────────

// navigator.vibrate is used in drag handlers — stub so tests don't throw
Object.defineProperty(navigator, 'vibrate', {
  value: vi.fn(),
  writable: true,
});

// matchMedia is referenced by ThemeContext — stub with a basic implementation
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ResizeObserver is used by several charts/rulers — and by Floating UI,
// which backs every Radix popper (dropdown menus, popovers, tooltips).
//
// These are real classes, not `vi.fn().mockImplementation(() => ({...}))`.
// A mock function invoked with `new` returns the mock's own instance, not
// the object the implementation returns, so Floating UI's `new
// ResizeObserver(cb)` blew up with "is not a constructor". Charts got away
// with it because they only ever checked the global existed.
class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

global.ResizeObserver = MockObserver;

// IntersectionObserver is used by lazy-load patterns
global.IntersectionObserver = MockObserver;

// Floating UI measures the trigger to place the popper. jsdom returns all
// zeros from getBoundingClientRect, which is fine — position ends up 0,0 and
// the menu still renders and is queryable, which is what assertions need.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// localStorage / sessionStorage — Node 22+ ships an experimental *native*
// `localStorage` global that is `undefined` unless the process is started with
// `--localstorage-file`. Under the jsdom test environment that native global
// shadows jsdom's working implementation, so `localStorage.clear()` throws
// "Cannot read properties of undefined" on newer Node (seen on Node 26).
// Install a deterministic in-memory Storage when the existing one is missing
// or broken — a no-op on older Node where jsdom's localStorage already works.
function createMemoryStorage() {
  const store = new Map();
  return {
    get length() { return store.size; },
    key(i) { return Array.from(store.keys())[i] ?? null; },
    getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
    setItem(k, v) { store.set(String(k), String(v)); },
    removeItem(k) { store.delete(String(k)); },
    clear() { store.clear(); },
  };
}
for (const target of [globalThis, typeof window !== 'undefined' ? window : null]) {
  if (!target) continue;
  for (const name of ['localStorage', 'sessionStorage']) {
    if (!target[name] || typeof target[name].clear !== 'function') {
      Object.defineProperty(target, name, {
        value: createMemoryStorage(),
        writable: true,
        configurable: true,
      });
    }
  }
}

// ── Console noise reduction ────────────────────────────────────────────────
// ErrorBoundary calls console.error on caught errors — this is expected in
// those tests, so we silence it to keep output readable.
const originalError = console.error.bind(console);
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    // Allow through errors that aren't React's own boundary logging
    if (
      typeof args[0] === 'string' &&
      args[0].includes('[ErrorBoundary]')
    ) return;
    originalError(...args);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
