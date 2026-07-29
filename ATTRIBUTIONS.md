# Third-party attributions

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
