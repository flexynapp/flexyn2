import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Bumped from default 500 KB. The main bundle is still over the threshold
    // even after page-level + vendor splits, but every chunk that crosses 500
    // is well-isolated (its own vendor bundle, code-split route, or the model
    // file that only loads on Form Coach open). Noise > signal otherwise.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Manual vendor chunking. Splits the heaviest dependencies into their
        // own files so:
        //   1. The main entry chunk shrinks dramatically (faster first paint).
        //   2. Vendor chunks change less often than app code, so the browser
        //      cache stays valid across deploys (return visits load only the
        //      changed app code, not the unchanged libraries).
        //   3. Modern browsers fetch chunks in parallel — splitting widens
        //      the network pipe.
        //
        // Order matters: more specific patterns first, generic last.
        manualChunks: (id) => {
          // i18n is ~1 MB raw / ~250 KB gzip of translation tables. Isolating
          // it into its own chunk:
          //   1. Shrinks the entry chunk dramatically (parses faster).
          //   2. Caches across deploys — translation strings rarely change
          //      compared to app code, so return visits skip re-downloading.
          //   3. The chunk can be HTTP/2-pushed or prefetched independently
          //      of the rest of the app.
          if (id.includes('/src/lib/i18n')) return 'i18n';

          if (!id.includes('node_modules')) return undefined;

          // Pose-detection / TF.js — already lazy-loaded by analyzeForm, but
          // pin to its own chunks so it definitely doesn't bleed into entry.
          if (id.includes('@tensorflow-models/pose-detection')) return 'vendor-pose';
          if (id.includes('@tensorflow/tfjs')) return 'vendor-tfjs';

          // Supabase — large, used across the app.
          if (id.includes('@supabase')) return 'vendor-supabase';

          // Radix UI primitives — many small modules that together are sizable.
          if (id.includes('@radix-ui')) return 'vendor-radix';

          // Framer Motion — animation library used everywhere.
          if (id.includes('framer-motion')) return 'vendor-motion';

          // Tanstack Query — react-query for caching.
          if (id.includes('@tanstack')) return 'vendor-query';

          // Lucide icons — many small SVG components.
          if (id.includes('lucide-react')) return 'vendor-icons';

          // date-fns — date utility, used in many places.
          if (id.includes('date-fns')) return 'vendor-dates';

          // Sentry — error reporting.
          if (id.includes('@sentry')) return 'vendor-sentry';

          // Core React stays in entry chunk (small, needed immediately).
          // Everything else in node_modules falls into one shared vendor chunk.
          return 'vendor-misc';
        },
      },
    },
  },
});