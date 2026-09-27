# Third-party attributions

## OpenStreetMap — map tiles, gym data, and place search

The Gym Locator is built on OpenStreetMap three separate times, and all
three are covered by the same licence:

| Surface | Service | Code |
|---|---|---|
| Base map tiles | OpenFreeMap (Liberty style), or MapTiler when `VITE_MAPTILER_KEY` is set | `src/pages/GymMap.jsx` |
| Nearby gyms | Overpass API | `src/lib/osmGyms.js` |
| Place search ("go to Chicago") | Nominatim | `src/lib/geocode.js` |

- Data © **OpenStreetMap contributors**, licensed under the **Open Database
  License (ODbL) 1.0** — https://www.openstreetmap.org/copyright

**ODbL requires the credit to appear wherever the data is shown**, not once
in a settings screen. The map canvas carries MapLibre's own
`attributionControl`, which credits the tile source. That control does NOT
cover the other two, so:

- Overpass results are drawn as pins on that same canvas and the map's
  attribution covers them.
- Nominatim results are rendered in the search panel, outside the canvas, so
  they carry their own credit: `PLACES_ATTRIBUTION` in `src/lib/geocode.js`,
  rendered beneath the result list. A test asserts it names OpenStreetMap.
  **Don't remove that line to tidy the panel.**

**Nominatim and Overpass are donated services with usage policies, and both
block abusers by IP** — which for us means the feature dying for every user
at once, not degrading for one. The constraints are documented at the head
of each file and enforced in code (a 1 req/s gate and a result cache for
Nominatim; a mirror race with per-mirror timeouts for Overpass). The one
that is easiest to break by accident: **Nominatim forbids client-side
autocomplete**, so place search fires on an explicit submit only. A debounced
keystroke handler would still be autocomplete.


## Equipment imagery — deliberately none

The equipment picker (`src/lib/equipmentCatalog.js`,
`src/components/workout/ImplementPicker.jsx`) names real manufacturers and
machine models as **text**, which is nominative use — factually identifying
the machine in front of the lifter. That needs no licence and no attribution.

**No manufacturer product photography or brand logos ship with this app, and
none should be added.** Those are copyrighted and trademarked, and Flexyn
ships to the iOS and Android stores where a takedown or a review rejection is
a real outcome. Equipment images come from three places instead, in order:
a photo the user took, an approved photo another user took of the same model,
and a drawn silhouette in `src/components/workout/equipmentSilhouettes.jsx`.

`REFERENCE_IMAGES` in `src/lib/equipmentImage.js` is a slot for
openly-licensed generic photos (Wikimedia Commons CC-BY-SA and similar). It
ships **empty**. If you populate it, each entry needs its own licence page
verified — a Commons category listing is not per-file proof — and a row added
below. `resolveEquipmentImage` skips any entry missing author/licence data
rather than rendering it uncredited, and a test enforces that.

See `docs/gym-equipment-picker-research.md` §3 for the full reasoning.

## Twemoji
Emoji artwork rasterized into Flexyn share images comes from **Twemoji**.

- Copyright © Twitter, Inc and other contributors
- Graphics licensed under **CC-BY 4.0** — https://creativecommons.org/licenses/by/4.0/

Surface this credit in an in-app About / Credits screen before shipping
commercially — CC-BY requires attribution wherever the artwork is distributed.

### Why only some emoji are bundled
Live UI text uses plain Unicode emoji, which render with the **viewer's own OS
font** (Apple Color Emoji on iOS, Noto Color Emoji on Android). That font is
licensed to the device owner and is never redistributed by us, so it needs no
attribution.

Bundled Twemoji artwork is used **only where an emoji is rasterized into an
image we save and share** (canvas share cards). Drawing an emoji with
`ctx.fillText()` on an Apple device would bake Apple's proprietary glyphs into
a PNG we then distribute — that is the case Twemoji replaces.

## Trophy Gamification UI Kit

`src/components/leaderboard/LeaderboardPodium.jsx` is derived from
`leaderboard-podium.tsx` in **trophyso/ui** — https://github.com/trophyso/ui

- Copyright © Trophy Labs, Inc.
- Licensed under the **MIT License** — https://opensource.org/licenses/MIT

Ported TypeScript → JSX and adapted: rank colours remapped off their
`text-rank-1/2/3` design tokens onto our existing gold/slate/orange palette,
the external `i.pravatar.cc` avatar fallback replaced with locally-rendered
initials (no third-party request, works offline in the PWA), and sizing tuned
for a 375px viewport.

MIT permits commercial use and modification provided the copyright notice and
licence text are retained — the notice lives in the file header alongside this
entry. The windowing pattern in `LeaderboardsContent.jsx` (`windowRanked`) is
an independent implementation of the same idea from their
`leaderboard-rankings.tsx`, not a copy.

## Leckerli One (vendored font file)

`public/fonts/LeckerliOne-Regular.ttf` — Leckerli One by Gesine Todt,
distributed by Google Fonts under the **SIL Open Font License 1.1**, which
permits redistribution and embedding, including in a bundled asset.

It is checked in for ONE reason: `public/og-image.png` bakes the Flexyn
wordmark into a raster, and that card cannot be regenerated without the exact
face. Every other surface still loads Archivo, Figtree and Leckerli One from
Google Fonts at runtime (see the stylesheet link in `index.html`) — this file
is not wired into the app's font stack and nothing imports it.

Regenerating the card requires it, so removing the file silently makes the
social card unreproducible rather than breaking a build.

## Onboarding welcome photo

`public/onboarding/hero-front-squat.jpg` — a woman front squatting in a busy
gym, by **Marvin Cors** (@rizlas) on Unsplash:
https://unsplash.com/photos/a-woman-lifting-a-barbell-in-a-gym-qv9IUYVFiM4

Used under the **Unsplash License** (free for commercial use, no attribution
required; credited here anyway). It is a standard Unsplash photo, not an
Unsplash+ one. Cropped to 780x1688 (2x a 390x844 phone) and re-encoded as a
JPEG under 150 KB. It is lifestyle photography of a person training, not
product imagery, so the "no manufacturer photography" rule above does not
apply to it.
