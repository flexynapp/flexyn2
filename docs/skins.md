# Skins

A skin is a whole-app look layered on the design tokens: colours that shift,
plus ornaments placed in fixed slots around the app. The Halloween look
(Sept 25 to Nov 1) is the first. This file is how to add the next one.

## The two halves

| Half | Where | What |
|---|---|---|
| Data | `src/lib/skins.js`, one entry in `SKINS` | `id`, `window` (local dates, inclusive; may cross New Year), `copy` as `[key, English]` pairs |
| Parts | `src/components/skins/<id>/` | `index.jsx` exporting any slots below, plus `<id>.css` |

Then register the parts in `src/components/skins/parts.js`: one import, one
line. Nothing else in the app changes. The app never names a skin; it renders
slots.

## Slots

| Slot | Where it renders | Rules |
|---|---|---|
| `Backdrop` | fixed, behind the page (`-z-10`) | Shows only through gaps between cards, under short pages and in desktop gutters. Low opacity so bare-background text keeps contrast. |
| `Overlay` | fixed, above content, below header/dialogs/toasts (`z-[35]`) | Corners and brief flyovers only. Never parks over content. |
| `NavEdge` | inside the bottom nav, on its top edge | Slides with the nav. |
| `LogoMark` | beside the header logo | About 20px. |
| `Icon` | switch rows (Settings, You) and the offer card | Takes `className`; must work at `w-4 h-4`. |
| `EmptyAccent` | corner of every `EmptyState` icon | About 26px. Decorative. |

Every slot: `pointer-events: none`, `aria-hidden`, transform/opacity
animation only, and motion dropped under `prefers-reduced-motion`.

## Colour rules

A skin's CSS goes under `html[data-skin="<id>"]` (and `html.dark[...]`). It
may move the **neutral** ramp: background, card, popover, secondary, muted,
border, input, sidebar. It may **not** redefine `--primary`, `--success`,
`--info` or `--destructive`; each carries a meaning under the four-hue rule
in `index.css`. Keep `muted-foreground` at 4.5:1 on `secondary` in both
modes. No purple (reserved for rarity) and no Sparkles icon (reserved for
the AI Coach).

## What the user sees

- Once per device per window, a card offers the skin (`SkinPrompt`). Either
  answer is final for that window.
- A switch (`SkinToggle`) sits at the top of the You tab and in Settings ›
  Display while the window is open.
- The choice is `localStorage` key `flexyn.skin.<id>.<year the window
  opened>`, so next year asks again.

## Copy

Add `skin.<id>.name`, `.hint`, `.offerTitle`, `.offerBody` to `en.json`,
`es.json` and `fr.json` in the same change. The "Not now" / "Turn it on"
buttons are shared (`skin.offer.*`).

## Checking one

Render at 375×667 and 430×932, light and dark, with the skin on. Check that
the backdrop shows between cards and nothing covers a control at rest.
`src/components/__tests__/HalloweenSkin.test.jsx` holds the slot-contract
tests. A new skin should pass the same checks.

## Not yet on this

The level-up and capsule themes (`THEMES` in `ThemeContext.jsx`,
`lootThemes.js`, `ThemeAnimationLayer.jsx`) predate this and are switched
off (`THEMES_ENABLED`). They repaint `--primary`, which a skin may not do.
Rebuilding them as skins with `window: null` and an unlock rule is the
intended next step.
