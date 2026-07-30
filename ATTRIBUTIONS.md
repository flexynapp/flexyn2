# Third-party attributions

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
