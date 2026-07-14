import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Toggle the bundle visualizer with ANALYZE=true. Adds rollup-plugin-
// visualizer to the build so you can inspect chunk composition at
// dist/bundle-stats.html. Off by default to keep production builds
// fast and to avoid shipping a 1MB analysis HTML file.
//
//   ANALYZE=true npm run build   (or the `analyze` npm script)
const SHOULD_ANALYZE = process.env.ANALYZE === 'true';

// Build metadata: the short git SHA + build timestamp injected as
// __BUILD_HASH__ / __BUILD_DATE__ globals (consumed by src/lib/buildInfo.js).
// Lets the running app self-identify which commit it was built from,
// surfaced in Settings → About. Critical when diagnosing "the deploy
// looks stale" situations — a user can read the hash off their phone in
// 5 seconds. Falls back to 'dev' when git isn't available (CI from a ZIP,
// downloaded source, etc).
function readBuildInfo() {
  let hash = 'dev';
  try { hash = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* keep 'dev' */ }
  return { hash, date: new Date().toISOString() };
}
const BUILD_INFO = readBuildInfo();

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  define: {
    __BUILD_HASH__: JSON.stringify(BUILD_INFO.hash),
    __BUILD_DATE__: JSON.stringify(BUILD_INFO.date),
  },
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
          // Self-hosted PWA icons. The SVG covers most install
          // scenarios; PNG variants take over on Android (which
          // currently can't render SVG manifest icons reliably) and
          // iOS Safari pinned/install. Place the PNGs in /public/
          // before shipping a production build — see docs/icons-todo.md
          // for the file list and recommended source.
          { src: '/favicon.svg',  sizes: 'any',     type: 'image/svg+xml' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // NOTE: with `strategies: 'injectManifest'`, the `workbox` field is
      // not used — caching strategies and lifecycle hooks live inside our
      // own SW file at src/lib/push-sw.js. The plugin injects the
      // precache manifest into that file at build time.
    }),
    // Bundle visualizer — only runs when ANALYZE=true. Writes a treemap
    // to dist/bundle-stats.html showing per-chunk source weight so you
    // can find unexpected weight (e.g. a "small" feature that drags in
    // a huge library transitively).
    ...(SHOULD_ANALYZE
      ? [
          visualizer({
            filename: 'dist/bundle-stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            open: false,
          }),
        ]
      : []),
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
      // BUILD GUARD — fail the build instead of silently shipping when
      // Rollup detects a class of warning we've documented as a real
      // production-crash risk. The top-level `logLevel: 'error'` above
      // suppresses Vite's stdout output of these warnings to keep
      // build logs clean; without this onwarn hook those warnings
      // would land in production unread.
      //
      // History: on 2026-05-23 a `inventory.listMine` reference that
      // didn't exist as a named export shipped to prod because Vite's
      // MISSING_EXPORT warning was silenced. The error surfaced as a
      // minified TDZ at runtime that took hours to triage. Never again.
      //
      // The list below should ONLY contain warning codes that:
      //   1. Correspond to a real production-crash defect class
      //   2. Have NO legitimate uses currently in the codebase
      // Adding a code here flips it from "tolerated warning" to
      // "build failure" — be careful.
      onwarn(warning, defaultHandler) {
        const blockingCodes = new Set([
          // X is not exported by Y — namespace-import dotted access
          // (e.g. `inv.foo`) where `foo` is not on the module's
          // exports object. Resolves to `undefined` at runtime →
          // TypeError on call, or TDZ in some Rollup configs.
          'MISSING_EXPORT',
          // Direct import { foo } from 'mod' where 'foo' isn't exported.
          // Same defect class as MISSING_EXPORT for default imports.
          'UNRESOLVED_IMPORT',
          // Plugin produced an error (e.g. invalid syntax slipped
          // past lint) — should never be a warning, surface as error.
          'PLUGIN_ERROR',
        ]);
        if (blockingCodes.has(warning.code)) {
          throw new Error(
            `[vite-build-guard] Rollup ${warning.code} treated as error.\n` +
            `${warning.message}\n` +
            `If you believe this is a false positive, see vite.config.js onwarn for context.`
          );
        }
        defaultHandler(warning);
      },
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

          // ── Libraries we DELIBERATELY lazy-load via dynamic import ─
          //
          // Returning `undefined` lets Vite/Rollup place these modules
          // in the lazy chunk that imports them, rather than yanking
          // them into the always-loaded vendor-misc bucket below.
          //
          //   maplibre-gl              → RouteMap chunk (cardio details
          //                              + activity feed map renders).
          //                              Was leaflet + react-leaflet before
          //                              the vector-tile migration.
          //   @zxing/browser           → barcode-scan handler in
          //                              Nutrition.jsx (dynamic import())
          //   canvas-confetti          → LevelUpOverlay's effect
          //                              (dynamic import())
          //
          // Without these explicit `undefined` returns, the vendor-misc
          // catch-all below pulls them into the entry bundle even
          // though only one feature ever touches them. ~250 KB saved
          // off vendor-misc.
          if (id.includes('maplibre-gl')) return undefined;
          if (id.includes('@zxing'))  return undefined;
          if (id.includes('canvas-confetti')) return undefined;
          // qrcode (~25 KB) is dynamic-imported by GymSignageCard only.
          // Same rationale as the libs above — keep it lazy.
          if (id.includes('node_modules/qrcode')) return undefined;
          // html2canvas (~200 KB) is dynamically-imported from
          // DebriefVault only. Without this explicit `undefined`, the
          // vendor-misc catch-all pulls it into the entry bundle,
          // defeating the dynamic-import. With it, the library lands in
          // a lazy chunk that only loads when the user clicks "Share"
          // inside the Debrief Vault modal.
          if (id.includes('html2canvas')) return undefined;

          // jspdf (~250 KB) is dynamic-imported by gymSignageKit.js ONLY (the
          // gym-signage PDF export — a rare admin action). Without this
          // explicit `undefined` the vendor-misc catch-all below pulls it into
          // the always-loaded entry bundle, defeating the dynamic import — the
          // exact bug fixed for html2canvas/maplibre above, missed for jspdf.
          // With it, jspdf lands in a lazy chunk loaded only when a user
          // actually generates signage. ~250 KB off every cold start.
          if (id.includes('node_modules/jspdf')) return undefined;

          // Pose-detection / TF.js — already lazy-loaded by analyzeForm, but
          // pin to its own chunks so it definitely doesn't bleed into entry.
          if (id.includes('@tensorflow-models/pose-detection')) return 'vendor-pose';
          if (id.includes('@tensorflow/tfjs')) return 'vendor-tfjs';

          // Supabase — large, used across the app.
          if (id.includes('@supabase')) return 'vendor-supabase';

          // ⚠ DO NOT split @radix-ui into its own chunk.
          //
          // Radix's runtime imports several non-`@radix-ui/*` peer packages
          // (`react-remove-scroll`, `aria-hidden`, `@floating-ui/*`, etc.)
          // and those land in `vendor-misc`. When Vite/Rollup splits Radix
          // out, the chunks form a circular import graph that ES modules
          // evaluate in an order Radix can't tolerate — you get
          // `ReferenceError: can't access lexical declaration 'dt' before
          // initialization` thrown at top-level of vendor-radix on every
          // page load.
          //
          // The minified `dt` is a Radix internal helper that's read by
          // another chunk that finished loading first. The TDZ trap is
          // the standard symptom of an unresolvable cross-chunk cycle.
          //
          // The robust fix: let Radix ride along with its peers in
          // vendor-misc so the cycle stays intra-chunk (which IS allowed).
          // Cache-wise we lose ~75 KB of dedicated-chunk benefit;
          // correctness-wise we gain a working app.
          // if (id.includes('@radix-ui')) return 'vendor-radix';  // ← intentional

          // Framer Motion — animation library used everywhere.
          if (id.includes('framer-motion')) return 'vendor-motion';

          // Tanstack Query — react-query for caching.
          if (id.includes('@tanstack')) return 'vendor-query';

          // Recharts — only used by Dashboard widgets and the Progress
          // page (both code-split route chunks). Pulling it into its own
          // vendor chunk means recharts doesn't load until the user
          // navigates to one of those pages. Shared across both so the
          // chunk caches and is reused.
          if (id.includes('recharts')) return 'vendor-charts';

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