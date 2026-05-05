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
