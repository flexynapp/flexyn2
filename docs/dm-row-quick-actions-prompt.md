# DM row quick actions on mobile — design spec

Written 2026-08-09, from the Messages audit. Companion to
`docs/ui-craft-prompt.md` (the composition rules this obeys).

**Status: SHIPPED 2026-08-09, without the Penpot pass** — Kegan chose to
implement straight from this spec, so there are no boards behind it. The
board list below is kept as the record of what the surface is made of, not
as work outstanding. What landed:
`src/components/hub/RowActionSheet.jsx` (sheet + arm-confirm),
`LongPressRow` inside `HubMessages.jsx` (trigger),
`TOOLTIP.DM_ROW_LONG_PRESS` (the hint), and reduced-motion support added to
`ui/BottomSheet.jsx`. Behaviour is covered by
`src/components/hub/__tests__/rowActionSheet.test.jsx`.

## The problem

Pin, Mute, Archive, Unarchive and Leave Crew all live in a three-dot menu
declared `hidden lg:flex` in `src/components/hub/HubMessages.jsx`. Flexyn
ships to iOS and Android only. **On every device a real user holds, none
of those five actions can be reached.**

Two things follow that are easy to miss:

- The "Archived" filter chip renders only when `archivedConvs.length > 0`,
  and nothing on a phone can put a conversation there — so the chip has
  never appeared for any user, and `src/lib/conversationArchive.js` is
  dead code on the shipping target.
- Archive is not a convenience here. `purge_message_request` deliberately
  refuses to destroy an accepted conversation ("Archive is the affordance
  for those"), so archiving is the **only** way to get an unwanted thread
  out of the inbox. There is currently no way at all.

## The gesture: long-press, not swipe

**Long-press a conversation row → a bottom sheet of that row's actions.**

This is not a new gesture. The bottom nav already long-presses to quick
actions (`useLongPress`, 400 ms, `TabQuickActionMenu`), and it is already
taught by a one-shot hint (`TOOLTIP.LONG_PRESS_TABS`). DM message bubbles
in `HubChat` long-press to a context menu too, at 480 ms. Rows join a
vocabulary the app already has.

Swipe-to-reveal was considered and rejected, for four reasons:

1. **The row already uses its horizontal axis.** A Requests row renders
   Accept / Delete / Block inline, and an outgoing-pending row renders
   Unsend plus its armed confirm pair. A swipe layer underneath a row
   that already has a horizontal action cluster fights it for the same
   pixels and the same tap.
2. **Three actions is one too many for a swipe.** Pin, Mute and Archive
   read cleanly in a list and poorly stacked behind one drag direction.
3. **Leave Crew is destructive** and should not sit one uninterrupted
   drag away.
4. **Swipe direction is RTL-sensitive.** Arabic ships with `dir="rtl"`,
   so "swipe left" is two mirrored designs to draw and maintain. A sheet
   is direction-neutral.

Worth keeping in the back pocket: `useSwipeToDelete` already exists
(REVEAL_PX 60 / COMMIT_PX 140, touch-only) and could later add a swipe
shortcut for **Archive alone** — the one action people repeat. That is a
phase 2 on top of this, not an alternative to it.

## Trigger and dismissal

| | |
|---|---|
| Fires after | **400 ms** — `useLongPress` default, same as the bottom nav. Not HubChat's 480 ms; that one is tuned for a small bubble, this is a full-width row. |
| Move tolerance | **8 px**, so a scroll attempt cancels rather than opening a sheet mid-flick. |
| Haptic on fire | `triggerHaptic('primary')` — `[10]`, the same pulse the nav and the message menu use. |
| The tap that follows | Swallowed via `longPress.consumeClick(e)`. **This is the single most likely bug**: without it the row opens the conversation behind the sheet. |
| Native callout | `useLongPress` preventDefaults the firing pointerdown; the row also needs `select-none-ui` so iOS Safari doesn't offer its own selection UI. |
| Dismiss | Backdrop tap · drag the sheet down (>80 px or ≥300 px/s — `BottomSheet` already does this) · Escape · picking an action. |

Trigger parity on pointer devices: keep the existing `lg` three-dot
button, but have it open **this same sheet**. One action list, two
triggers — a long-press is the wrong idiom for a mouse, and a second
implementation is how the two drift apart.

## Boards to compose

Device frames **375 × 667** (SE) and **393 × 852** (iPhone 15). The SE is
the one that matters — the sheet is content-height and bottom-anchored,
so the question it answers is whether four rows plus the header plus the
home indicator still leave the list readable behind it.

| Board | Contents |
|---|---|
| **A — Row states** | One conversation row in five states: resting · pressed (long-press held, before the sheet) · pinned · muted · pinned + muted. The pressed state is the affordance that tells someone the gesture registered — it is the only feedback in the 400 ms before the sheet. |
| **B — Sheet, DM, default** | Unpinned / unmuted / unarchived thread. Header + three action rows. |
| **C — Sheet, DM, inverted** | Pinned / muted / archived thread — proves every label and icon swaps, and that the sheet is the same height either way. |
| **D — Sheet, Crew, Leave armed** | Pin · Mute · Leave Crew, with Leave in its second-tap confirm state. |
| **E — Teaching hint** | `OneShotTooltip` anchored to the first row, `placement="bottom"`. |
| **F — Element ledger** | The table below, drawn against the real components. |

## Sheet anatomy

Built on `src/components/ui/BottomSheet.jsx` — do not draw a new sheet
chrome. What it already gives you:

- `bg-background`, `rounded-t-2xl`, full-bleed to both edges
- drag handle pill `w-10 h-1 rounded-full bg-muted-foreground/25`, `mb-3`
- backdrop `bg-black/60`, 0.22 s fade
- `paddingBottom: env(safe-area-inset-bottom)`
- spring in: stiffness 340, damping 38
- `max-height: 90dvh` (irrelevant here — this sheet is ~4 rows tall)

**Header row.** Avatar (`w-9 h-9`, matching HubChat's) + `@handle`, or the
crew name with its shield tile. This is load-bearing, not decoration:
after a long-press on a dense list the user must be able to confirm which
row they actually grabbed before they tap Archive.

**Action rows.** Follow `TabQuickActionMenu`'s row exactly:

```
px-4 py-3 · text-sm font-medium · icon w-4 h-4 · border-b border-border last:border-b-0
```

`py-3` + a `text-sm` line = **44 px**, which is the touch target the
Header's `h-11` controls already use. Do not shrink it.

One deviation from the existing components, deliberate: use **`gap-2`**
between icon and label, not their `gap-3`/`gap-2.5`. 12 px is inside the
banned middle spacing register in `docs/ui-craft-prompt.md`; icon-and-label
is one group, so it takes the 8 px intra-group value. The existing menus
predate that rule.

**Elevation.** No shadow. The backdrop is what separates the sheet from
the page — that is the resting/raised rule working as intended, and it is
also why `TabQuickActionMenu`'s `shadow-xl` should not be copied here.

## Actions

### DM row — Inbox and Archived views

| Icon | Label | Inverted label |
|---|---|---|
| `Pin` | Pin conversation | Unpin conversation |
| `BellOff` | Mute | Unmute |
| `Archive` | Archive | `ArchiveRestore` · Unarchive |

### Crew row

| Icon | Label | Inverted label |
|---|---|---|
| `Pin` | Pin chat | Unpin chat |
| `BellOff` | Mute | Unmute |
| `LogOut` | Leave crew | — (destructive, see below) |

### Not offered, on purpose

- **Requests view suppresses the sheet entirely.** Those rows already
  carry Accept / Delete / Block inline, and pinning a message request is
  meaningless. Long-press on a Requests row does nothing.
- **No "Delete conversation."** The server refuses to destroy an accepted
  thread because it would take the other person's copy with it. Archive
  is the exit, and it should not be dressed up as deletion.

## Destructive confirm — Leave Crew

Leaving is irreversible from the user's side and currently fires on a
single tap from the desktop menu. On touch it needs the arm-then-confirm
shape `HubMessages` already uses for Delete request:

1. First tap swaps the row in place into a destructive pair —
   **Confirm leave** (`bg-destructive text-white`) + **Cancel**
   (`bg-secondary`) — with a `text-micro text-muted-foreground` line
   reading what it costs.
2. `triggerHaptic('warning')` (`[28]`) on arm — a different pulse from
   the one that opened the sheet, so the escalation is felt.
3. Disarms after **5 s**, on Cancel, on backdrop tap, or on sheet close.
4. The sheet stays open through the arm so the confirm target does not
   move under the finger.

## Copy and i18n keys

Existing keys to reuse:

```
hub.messages.pinChat      hub.messages.unpinChat
hub.messages.muteChat     hub.messages.unmuteChat
common.cancel
```

New keys — English via `tFallback` at minimum, and **do not
machine-translate** the other 14:

```
hub.messages.archive              "Archive"
hub.messages.unarchive            "Unarchive"
hub.messages.archived             "Conversation archived."
hub.messages.unarchived           "Conversation unarchived."
hub.messages.leaveCrew            "Leave crew"
hub.messages.leaveCrewConfirm     "Confirm leave"
hub.messages.leaveCrewWarning     "You'll need a new invite to rejoin."
hub.messages.tooltip.longPress    "Hold a chat for pin, mute and archive"
hub.messages.sheet.title          "{handle} · options"   (aria-label only)
```

All five of the current strings for these actions are hardcoded English
today, so this is where that gets fixed rather than a separate pass.

## Teaching it

A gesture nothing points at is a gesture only its author knows about.
Register `TOOLTIP.DM_ROW_LONG_PRESS = 'dm-row-long-press'` and mount
`<OneShotTooltip>` against the first conversation row, `placement="bottom"`.

Two constraints from `src/lib/tooltipRegistry.js` that have bitten before:

- **Register and mount in the same change.** Four of five registered IDs
  once had no mount site at all; `src/lib/__tests__/tooltipRegistry.test.js`
  now fails the suite for exactly this, so a half-done entry is a red build.
- **Gate the mount on there being a row to point at.** OneShotTooltip
  fires once on mount and will not re-run when an anchor appears later, so
  mounting it against an empty inbox burns the one shot on nothing — the
  same gate `HubChat` puts on the double-tap hint.

## RTL, motion, a11y

- Logical properties throughout (`ms-`/`me-`/`start-`/`end-`/`text-start`).
  The sheet is full-bleed, so it needs no mirroring. `LogOut`'s arrow
  points end-ward and wants `rtl:scale-x-[-1]`; `Pin`, `BellOff`,
  `Archive` and `ArchiveRestore` are direction-neutral and must not flip.
- `prefersReducedMotion()` exists and `BottomSheet` does not currently
  honour it — under reduce, the sheet should cross-fade in place instead
  of springing, and the row's pressed state should not animate scale.
- `role="menu"` on the action list, `role="menuitem"` per row
  (`TabQuickActionMenu`'s shape). `aria-label` on the sheet naming the
  conversation. Focus moves to the first action on open and returns to
  the originating row on close. Escape closes.
- `BottomSheet`'s backdrop carries `backdrop-blur-sm`, which the
  composition rules list as a tell. Worth dropping there rather than
  reproducing it here — but it is a shared component, so that is a
  separate decision, not this sheet's to make.

## Edge cases the drawing should account for

1. **The list reorders under the sheet.** `hubConversations` refetches
   every 15 s. The sheet must hold the conversation object it opened
   with; an index into the list will point at a different thread by the
   time someone taps Archive.
2. **A muted row renders at `opacity-60`.** The sheet is portaled, so it
   must not inherit that — a muted thread's sheet is full opacity.
3. **Outgoing-pending rows are taller** (they carry the Unsend cluster).
   The sheet is still offered — pin/mute/archive are orthogonal to
   withdrawing a request — so board A should include that taller row.
4. **Archived view** shows the third row as Unarchive, and archiving from
   there is not reachable — the row leaves the view on the action.
5. **Auto-unarchive.** `partitionByArchive` returns a conversation to the
   inbox when a message arrives after it was archived. The sheet does not
   need to say so, but the Archive toast should not promise permanence.

## What this unblocks

Archive becomes reachable → the Archived chip can appear for the first
time → `conversationArchive.js` stops being dead code on the only
platform the app ships to.
