# Profile UI — what premium apps do, and what ours does instead

Research pass over the profile screens of three open-source apps that are
widely praised for feeling premium, read as **source**, not screenshots.
Compared against `src/components/hub/HubProfile.jsx`.

Read on 2026-07-27. All three are actively maintained.

| App | Repo | Files read |
|---|---|---|
| **Bluesky** | `bluesky-social/social-app` | `src/screens/Profile/Header/{Shell,ProfileHeaderStandard,Metrics,GrowableBanner,GrowableAvatar,DisplayName,Handle}.tsx`, `KnownFollowers.tsx` |
| **Ice Cubes** (Mastodon, SwiftUI) | `Dimillian/IceCubesApp` | `Packages/Account/Sources/Account/Detail/AccountDetailHeaderView.swift`, `Components/{AccountInfoView,AccountStatsView,AccountAvatarView}.swift` |
| **Voyager** (Lemmy, React + Ionic) | `aeharding/voyager` | `src/features/user/{Profile.tsx,Scores.tsx,Scores.module.css}` |

Voyager is the closest technical analogue to us — React, web tech,
shipped to the App Store as a mobile app. Bluesky and Ice Cubes are the
design references.

---

## The measured contrast

I counted these rather than eyeballing them.

| | Bluesky | Ice Cubes | Voyager | **Flexyn** |
|---|---|---|---|---|
| Distinct type sizes in the profile header | 1 (`text_md`) + name | 2 (`scaledHeadline` / `scaledFootnote`) | 2 (`1.3rem` / `0.8rem`) | **10** (7, 9, 10, 11, 12, 14, 16, 18, 20, 36 px) |
| Bordered containers | 0 inside the header | 0 | 0 | **21** |
| Stacked full-width sections | 1 header + tabs | 1 header + tabs | 1 header + a nav list | **10** (`mb-4` siblings) |
| Header file size | 306 + 432 lines, 5 helpers | 100 lines, 4 subviews | 169 lines | **2,340 lines, one file** |
| Cover/banner image | 150 pt | 200 pt | — | **none** |
| Avatar size | 94 pt | ~100 pt | — | **64 px** |
| Body organisation | sticky tab pager | tab pager (6 tabs) | nav rows → routes | **one infinite scroll** |
| Counts formatted | `formatCount` → `1.2K` | `.notation(.compactName)` | `formatNumber` | **raw integers** |
| Primary action position | top of header | top-right, baseline-aligned with name | — | **~750 px down the page** |

That last row is the single worst one and I'll come back to it.

---

## Three things they all do that we don't

### 1. The header is one object. Ours is a stack of boxes.

Bluesky's entire header is a banner, then **one** padded block, then one
absolutely-positioned avatar punched over the seam:

```tsx
// Shell.tsx:154-224 — banner is a fixed 150pt frame
<View style={[a.relative, {height: 150}]}>
  <GrowableBanner …><UserBanner … /></GrowableBanner>
</View>
{children}

// Shell.tsx:251 — avatar floats over the boundary, no card, no section
<GrowableAvatar style={[a.absolute, {top: 104, left: 10}]}>
  <View style={[t.atoms.bg, a.rounded_full, {
    width: 94, height: 94,
    borderWidth: live.isActive ? 3 : 2,
    borderColor: live.isActive ? t.palette.negative_500
                               : t.atoms.bg.backgroundColor,  // ← punch-out
  }]}>
```

The avatar's ring is **the page background colour**, not a border colour.
That's the trick that makes it read as cut out of the banner rather than
placed on top of it. Ice Cubes does the same thing with
`.offset(y: -40)` on the whole info block
(`AccountDetailHeaderView.swift:82`).

Everything inside Bluesky's header — name, handle, metrics, bio, known
followers — lives in a single `[a.px_lg, a.pt_md, a.pb_sm]` container
with `a.gap_md` between groups
(`ProfileHeaderStandard.tsx:111-176`). **Zero internal borders.**
Separation is whitespace and type weight.

Ours is the opposite: 21 rounded-bordered containers, each with its own
`bg-secondary/…` fill, stacked with `mb-4`. Level block, Earned Trophies
card, Trophy Case card, three stat tiles, Edit/Themes/QR row, highlights
rail, lift stats card, badge showcase card, completion meter, referral
card — ten boxed regions before you reach the posts. Each one is
individually reasonable; together they read as a settings screen.

### 2. Metrics are text. Ours are tiles.

All three render counts as inline text, and get hierarchy from **weight
and colour only** — never from a container.

Bluesky (`Metrics.tsx:31-61`) — one row, one font size for both number
and label:

```tsx
<View style={[a.flex_row, a.gap_sm, a.align_center]}>
  <InlineLinkText to={makeProfileLink(profile, 'followers')} …>
    <Text style={[a.font_semi_bold, a.text_md]}>{followers} </Text>
    <Text style={[t.atoms.text_contrast_medium, a.text_md]}>{pluralizedFollowers}</Text>
  </InlineLinkText>
  …
```

Voyager (`Scores.module.css`) — no border, no background, `opacity` for
the label:

```css
.container { display: flex; justify-content: space-evenly; gap: 12px; margin: 24px 24px; }
.score {
  font-size: min(1.3rem, 52px); font-weight: 600; text-align: center;
  aside { font-size: min(0.8rem, 32px); margin-top: 0.35rem; opacity: 0.5; font-weight: 500; }
}
```

Ours (`HubProfile.jsx:2295-2340`):

```jsx
<button className="bg-secondary/40 border border-border/60 rounded-lg p-2 text-center …">
  <Icon className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
  <p className="font-heading font-bold text-base">{display}</p>
  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
</button>
```

Three problems in five lines: a fill *and* a border *and* a radius doing
the work whitespace should do; a decorative icon above every number
(none of the three references puts an icon in a metric); and a 10 px
uppercase tracked label, which is a dashboard-widget idiom, not a
profile idiom.

There's also a runtime cost we get nothing for. `Stat` and
`AnimatedStatButton` each run a `setInterval` at 16 ms to count up from
zero on every mount — three concurrent timers per profile view, firing
~112 renders over 600 ms. None of the three references animates counts.
Bluesky spends that budget on `formatCount(i18n, …)` instead, so a user
with 2,300 followers reads `2.3K` rather than `2300`.

### 3. One primary action, one overflow menu.

Bluesky's `HeaderStandardButtons` (`ProfileHeaderStandard.tsx:207-432`)
renders at most **three** controls plus a `…` menu:

- viewing yourself → `Edit Profile` (secondary) + a round share icon + `<ProfileMenu>`
- viewing someone → `[Subscribe] [Message] [Follow]` (only Follow is `color="primary"`) + `<ProfileMenu>`

Note the label logic — it's three states, not two:

```tsx
{profile.viewer?.following ? <Trans>Following</Trans>
  : profile.viewer?.followedBy ? <Trans>Follow back</Trans>
  : <Trans>Follow</Trans>}
```

`Follow back` is a small thing that makes the app feel like it's paying
attention. We render a plain `Follow` in that case, and we have the data
to do better — `isMutualFollow` is already computed at
`HubProfile.jsx:1725`, and the one-directional case is one more check.

Everything else — block, mute, report, share, add-to-list, copy link —
is inside `ProfileMenu`. That's what keeps the header calm regardless of
how many capabilities the app grows.

Ours has, on someone else's profile: `Friends` pill, `Follow`,
`Message`, `Swords` (duel), `Coins` (gift) — four live controls in one
row, two of them icon-only with no label. And on your own profile a
separate `Edit` / `Themes` / `QR` row somewhere else entirely.

**And the whole row sits at line ~1720 of the render, after the level
bar, both trophy sections, the stat tiles, the highlights rail, the lift
stats and the badge showcase.** On a phone that is roughly 700–800 px
below the top of the card. The single most important action on a
stranger's profile requires a scroll to reach. Bluesky puts it in the
first 150 pt, above the display name
(`ProfileHeaderStandard.tsx:117-136`).

---

## Two more differences worth naming

**Motion should be attached to the finger, not to mount.** Bluesky's
banner scales and blurs against scroll position
(`GrowableBanner.tsx:98-117`):

```tsx
const animatedStyle = useAnimatedStyle(() => ({
  transform: [{ scale: interpolate(scrollY.get(), [-150, 0], [2, 1], {extrapolateRight: Extrapolation.CLAMP}) }],
}))
const animatedBlurViewProps = useAnimatedProps(() => ({
  intensity: interpolate(scrollY.get(), [-300, -65, -15], [50, 40, 0], Extrapolation.CLAMP),
}))
```

Overscroll makes the banner grow and blur. It's continuous, reversible,
and driven by the user. Ours animates on *mount* — the header card fades
up from `y: 12, scale: 0.98`, the level block waits `delay: 0.1`, the
button row waits `delay: 0.18`. Every visit replays a 300 ms staged
entrance. Entrance choreography reads as premium exactly once, then
reads as latency. `HubProfile.jsx` has no `scrollY`, no `sticky`, no
scroll-linked anything.

**Long screens get tabs, not more scroll.** Ice Cubes has six
(`Detail/Tabs/`: Statuses, Replies, Media, Boosts, Favorites,
Bookmarks). Bluesky has a sticky pager (`Profile/Sections/`). Voyager
takes the cheapest version of the same idea — the profile body is just a
list of navigation rows that push real routes
(`Profile.tsx:79-142`): Posts, Comments, Saved, Upvoted, Downvoted,
Hidden. That's ~15 lines of markup and it solves the same problem, which
matters for us because it's the pattern we could adopt without building
a pager.

---

## What I'd change, in order

Ordered by payoff per unit of risk. Nothing here needs a migration.

**1. Collapse the header into one block, add a banner.**
Remove the internal borders and fills from the level bar, trophies,
trophy case and stat row so they're groups separated by whitespace
inside a single card. Add a 120–150 px cover image (we already have
storage + `AvatarUploader` upload plumbing), move the avatar to 88–96 px
overlapping the seam, and ring it with `hsl(var(--background))` rather
than a border colour. This is the change that does most of the work.

**2. Move the action row directly under the identity block.**
Follow / Message / `…` above the fold, styled as Bluesky does it —
exactly one `primary`. Demote Duel and Gift into an overflow menu
(they're strong features, but they aren't the reason anyone opens a
profile). Add the `Follow back` state.

**3. Re-cut the metrics as text.** Kill the tiles, the icons, the
uppercase micro-labels and the three `setInterval`s. One row, one type
size, weight + `text-muted-foreground` for hierarchy. Add compact
formatting — `src/lib/intl.js` already exports `formatNumber`, so this
is a call-site change, and it also fixes the fact that we currently
print `2300` where every reference app prints `2.3K`.

**4. Cap the type scale at four sizes.** We use ten in one component,
including 7 px, 9 px, 10 px and 11 px. 7 px is below the legibility
floor on a phone and it's carrying the trophy tier labels. Pick
`text-xs / text-sm / text-base / text-xl`, delete the rest. The
sub-components have the same disease — `ProfileBadgeShowcase` uses 9 px
and 10 px, `ProfileCompletionMeter` uses 10 px and 11 px.

**5. Put the lower half behind tabs.** Lift stats, badges, trophies,
highlights and posts are five destinations pretending to be one page.
Voyager's nav-row pattern is the cheap version; a sticky segmented
control is the better one. Either way the profile stops being a 10-card
scroll.

**6. Swap mount animations for scroll-linked motion.** Drop the
staggered `delay` entrances. If we want one piece of signature motion,
put it on the new banner: scale on overscroll, exactly as Bluesky does.

**7. Split the file.** 2,340 lines currently mixes the header, a QR
modal, a flag picker, a trophy picker, a followers modal and three
easter-egg arcade games. Ice Cubes' equivalent is 100 lines because
every region is a named subview. Extracting `ProfileHeader`,
`ProfileMetrics` and `ProfileActions` makes items 1–3 reviewable
instead of terrifying.

---

## What we should *not* copy

Our gamification is the product, not decoration. Bluesky has no level
bar because Bluesky isn't a fitness app, and stripping ours to look like
a Mastodon client would be cargo-culting. The finding isn't "have less
stuff" — it's that **they render more information than we do inside far
less chrome**. Bluesky's header carries name, handle, verification,
live status, moderation labels, three metrics, a rich-text bio with
links and tags, and known-followers social proof, in one bordered-box
count of zero.

The level bar, trophies and lift stats should stay. They should stop
each being a card.

## Sources

- [bluesky-social/social-app](https://github.com/bluesky-social/social-app)
- [Dimillian/IceCubesApp](https://github.com/Dimillian/IceCubesApp)
- [aeharding/voyager](https://github.com/aeharding/voyager)
