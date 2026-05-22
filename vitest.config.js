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
