# Icons & Favicon — TODO

The app currently ships with a self-hosted SVG favicon
(`public/favicon.svg`) which works fine on desktop and most Android
browsers. To complete the production polish, drop the following PNG
files into `public/` before shipping:

| File | Size | Used for |
|---|---|---|
| `public/favicon.ico` | 32×32 (or multi-res .ico) | Safari pinned tab fallback, legacy IE |
| `public/apple-touch-icon.png` | 180×180 | iOS "Add to Home Screen" install icon |
| `public/icon-192.png` | 192×192 | Android PWA install (manifest) |
| `public/icon-512.png` | 512×512 | Android PWA splash + adaptive icon (manifest, `purpose: any` and `purpose: maskable`) |

## How to generate them

If you have a single 1024×1024 source PNG (or SVG) of the Flexyn logo,
the easiest pipeline:

1. **Favicon.io** — https://favicon.io/ — upload the source, download
   the bundle, copy `favicon.ico` into `public/`.
2. **Real Favicon Generator** — https://realfavicongenerator.net/ —
   the most thorough option; also generates apple-touch-icon and the
   PWA icons at the right sizes.
3. **PWA Asset Generator** (CLI) — `npx pwa-asset-generator
   source.png public/` produces every variant in one shot.

The current `public/favicon.svg` is a placeholder orange "F" gradient.
Replace it with your real brand SVG when ready — same filename works,
no code changes needed.

## What happens if you skip this

- Desktop Chrome/Firefox/Edge/Safari → `favicon.svg` renders fine.
- iOS Safari install → falls back to a screenshot for the home-screen
  icon. Visible but ugly.
- Android Chrome install → manifest expects `/icon-192.png` and
  `/icon-512.png`. If missing, the install prompt still appears but
  shows a broken-image generic icon.

So: ship-blocking for iOS PWA install polish, not ship-blocking for
the web app itself.

## Reference: existing logo

The previous deploy referenced a Base44-hosted image
(`https://media.base44.com/images/public/69dfb5d1674e81512478f6f7/a7dcfb0be_transparent-logo.png`).
If you still own that asset, downloading it gives you the source PNG
to feed any of the generators above. Otherwise, the orange "F" SVG
is a clean starting point you can iterate on.
