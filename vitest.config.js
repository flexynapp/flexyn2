import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    // Expose describe/it/expect/vi globally (required by @testing-library/jest-dom)
    globals: true,
    // jsdom gives us a browser-like environment (window, document, localStorage)
    environment: 'jsdom',
    // Run this file before every test suite
    setupFiles: ['./src/test/setup.js'],
    // Don't pick up tests from sibling git worktrees that share the repo
    // root. The default exclude already covers node_modules and dist; we
    // also exclude `.claude/**` because the harness sometimes leaves test
    // copies in that path with a stale React install that crashes with
    // "Cannot read properties of null (reading 'useMemo')" when picked
    // up alongside the main suite.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    // Resolve @/ aliases the same way the app does
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Coverage via V8 (no Babel needed)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/components/**'],
      exclude: [
        'src/lib/i18n*.js',        // translation strings — not logic
        'src/lib/data/**',         // data layer — needs Supabase mock (future)
        'src/components/ui/**',    // shadcn primitives — not our code
      ],
    },
    // Vitest defaults to 5s per test, and on this machine that is a source of
    // FALSE reds rather than a safety net. Several sessions routinely run dev
    // servers and full suites concurrently, and a loaded run stretches from
    // ~137s to ~369s — at which point tests that normally take milliseconds
    // land at 3.7s, 5.3s, 6.1s and start tripping the limit. Observed across
    // muscleGroupHeatmapA11y, signInExistingAccount and GymEquipmentEditor in
    // one such run: three unrelated files, no assertion disagreeing with the
    // code, purely the clock.
    //
    // 15s absorbs those with headroom while still catching a genuinely hung
    // test. Note this is deliberately NOT a fix for a slow test — if
    // something here ever needs more than a second or two of real work, that
    // is worth understanding rather than accommodating. Raising this only
    // stops a busy machine from being reported as a broken build.
    //
    // hookTimeout is left at its 10s default, which was never the one
    // tripping. If beforeEach/afterEach start timing out under the same load,
    // raise that too rather than assuming this covers it.
    testTimeout: 15000,

    // Show a diff when expect() assertions fail
    reporters: ['verbose'],
    // Group test files by folder in output
    sequence: { shuffle: false },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
