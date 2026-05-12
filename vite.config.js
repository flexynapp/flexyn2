import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [
    react(),
    // PWA — generates manifest.webmanifest, registers a service worker,
    // pre-caches the static shell, and unlocks the "Install App" prompt
    // on Chrome/Edge/Safari. The Workbox config keeps the runtime cache
    // small (just the shell + entry chunks); we let supabase + image
    // requests pass through to network.
    //
    // After this ships, the app will:
    //   • Be installable on Android and iOS Safari (home-screen icon).
    //   • Load the previously-cached shell instantly on subsequent visits.
    //   • Continue to fetch fresh translations / vendor chunks per session
    //     because they have content-hash filenames.
    VitePWA({
      registerType: 'autoUpdate',
      // injectManifest mode lets us provide our own service worker file
      // (src/lib/push-sw.js) so we can hook into the `push` and
      // `notificationclick` events — the auto-generated GenerateSW
      // strategy doesn't expose those hooks. The vite-plugin-pwa
      // build step still injects the precache manifest into our file.
      strategies: 'injectManifest',
      srcDir: 'src/lib',
      filename: 'push-sw.js',
      injectManifest: {
        // i18n chunks + tfjs/pose chunks are huge — exclude from precache
        // so the SW build doesn't choke on the 5 MB default cap.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globIgnores: [
          '**/vendor-tfjs-*.js',
          '**/vendor-pose-*.js',
          '**/graph_model-*.js',
          '**/pose-detection.esm-*.js',
        ],
      },
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'Flexyn',
        short_name: 'Flexyn',
        description: 'Your personal fitness companion — workouts, nutrition, and progress.',
        theme_color: '#f97316',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          // Until we host our own PWA icons we reference the existing
          // logo on the Base44 CDN — matches what `LOGO_URL` resolves to
          // throughout the rest of the app. Replace with local files
          // (public/pwa-192x192.png + 512x512.png) when assets move.
          {
            src: 'https://media.base44.com/images/public/69dfb5d1674e81512478f6f7/a7dcfb0be_transparent-logo.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'https://media.base44.com/images/public/69dfb5d1674e81512478f6f7/a7dcfb0be_transparent-logo.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'https://media.base44.com/images/public/69dfb5d1674e81512478f6f7/a7dcfb0be_transparent-logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // NOTE: with `strategies: 'injectManifest'`, the `workbox` field is
      // not used — caching strategies and lifecycle hooks live inside our
      // own SW file at src/lib/push-sw.js. The plugin injects the
      // precache manifest into that file at build time.
    }),
  ],
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
          // Per-language i18n aggregates (src/lib/i18n-langs/*.js) MUST stay
          // as separate chunks so each language is its own dynamic-import
          // target. Return undefined here so Vite's default code-splitting
          // (driven by import.meta.glob in i18n.js) handles them.
          if (id.includes('/src/lib/i18n-langs/')) return undefined;
          // The i18n.js root module is tiny now (~2 KB of loader logic);
          // let it fall into the entry chunk.

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