/**
 * Global test setup — runs before every test file.
 *
 * 1. Extends expect() with @testing-library/jest-dom matchers
 *    (toBeInTheDocument, toHaveTextContent, toBeDisabled, etc.)
 * 2. Stubs browser APIs that jsdom doesn't implement
 * 3. Silences known-noisy console output during tests
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';

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

// ResizeObserver is used by several charts/rulers — stub it
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// IntersectionObserver is used by lazy-load patterns
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

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
