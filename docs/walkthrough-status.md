# Walkthrough findings — status

All 82 findings from the 2026-08-05 run-through. Updated after four fix batches.

| Bucket | Count |
|---|--:|
| ✅ Fixed | 17 |
| ✅ Confirmed already working | 3 |
| 📷 Blocked on a screenshot | 13 |
| 🟡 Blocked on your decision | 9 |
| 🔁 Blocked on reproduction | 3 |
| ⬜ Open — buildable, not yet done | 36 |
| 📋 Separate project | 1 |
| | **82** |

Four of the fixes (#48, #63, and both #53 pairs) fell out as side effects of
fixing something else — the underlying cause was shared.

---

## ✅ Fixed (17)

| # | Finding | What it actually was |
|---|---|---|
| 41 | Hot tab dead-ended the feed | The New\|Hot toggle rendered only in the populated branch, below the empty-state early return — so filtering to empty unmounted the control needed to get back. Refresh was the only escape. |
| 42 | Discovery listed every user | `PeopleYouMayKnow` enumerated the whole user table on **two** paths. The algorithm was correct all along; the fallback defeated it. |
| 44 | Strangers ranked above friends' stories | `FollowSuggestionRail` rendered above `StoriesRow`, contradicting the "stories stay on top" rule written in that same file. |
| 45 | Hub tab looked disabled | Glyph coloured, ring left neutral — colouring the ring is what made two tabs read as selected. |
| 48 | "Add a note" was covered | Same cause as #44. |
| 53 | Progress tiles indistinguishable | Three of four hero stats were `text-primary`. Two more duplicate pairs found on the same page. |
| 54 | Weekly Summary was dark on a light page | Hardcoded `linear-gradient(#0f0f14 → #141824)` + `text-white`. Raw hex, no tokens. |
| 55 | Log Meal did nothing | The form latched an in-flight ref, then `addEntry` early-returned without starting the mutation — so the flag never cleared and **every later tap was swallowed, permanently**. |
| 61 | "Midday momentum, Sean." | Renders `{greeting}, {Name}.` so each string must work as direct address. Three of five were noun phrases. |
| 62 | DMs scrolled sideways on desktop | `overflow-y-auto` with nothing on x — per CSS spec that makes x `auto` too. |
| 63 | Pinned messages unreachable | The #62 scrollbar was sitting on top of the affordance. |
| 64 | Ugly DM scrollbars | Same fix as #62. |
| 67 | Notifications wouldn't swipe away | The panel had **no drag handler at all** — the swipe fell through and scrolled the page behind it. |
| 69 | Swipe right to exit notifications | Same fix as #67. |
| 70 | My Gyms + My Journal both open | Journal is a global overlay that never closed on route change. |
| 72 | "PR" label clipped | `text-micro` line-height 1.25 + `truncate` (`overflow:hidden`) shaved the tops off capitals. |
| 81 | Where does check-in data go? | It **is** tracked and read back — and the question exposed that `step_logs` and `journal_entries` were missing from the GDPR data export. Both added. |

## ✅ Confirmed already working (3)

- **#29** Daily chest — opened, claimed, correctly disappeared.
- **#31** Nutrition & Recovery section.
- **#77** My Injuries — logged/cleared.

---

## 📷 Blocked on a screenshot (13)

**The carousel — your top ticket, 8 findings (#4–7, #9–11, #13).** #10 says the
progress was undone, which makes your **old reference shots the spec**. Without
them I'd redesign from scratch and likely rebuild the thing you already
rejected. The orange box in #6 is a precise cut-off point I can't infer.

| # | Finding | Why blocked |
|---|---|---|
| 1 | AI Coach hallucinated design | Can't tell which element you mean |
| 2 | Bench cut off in Smart Log | I can self-capture this one — it's on the public onboarding path |
| 59 | Nutrition colours stripped | **Investigated:** `MacroNutrientBox` uses **8 raw Tailwind hues**, the opposite of "all orange". Real finding, wrong surface — need to know which screen reads orange |
| 60 | Nutrition carousel all orange | Same as #59 |
| 71 | Signature Trophy Case "ruined" | Recently changed (7px tier label → 2px stripe). "Ruined" could mean that, or layout collapse, or missing trophies — three different fixes |
| 78 | Duels broke | Your dictation cut off mid-sentence |
| 79 | Challenge broke | Same |
| 52 | Workout red→yellow gradient | I'll `git log` for it first — only send an old shot if history comes up empty |

## 🟡 Blocked on your decision (9)

| # | Finding | The decision |
|---|---|---|
| 80 | Disable pinch-zoom | **I won't do this globally** — WCAG 1.4.4 failure + documented App Review flag, and the app renders ~818 strings at 9–11px. Tell me which surfaces suffer accidental pinch and I'll suppress it there with `touch-action` |
| 19, 32–36 | The theme cluster (6) | **You set `THEMES_ENABLED = false` yourself** on 2026-08-04 (`42d7fb1`). Your phone showing a space theme means it's on a pre-Aug-4 build. **Send your build hash** — Settings → footer → tap the build label |
| 30 | Daily chest as a modal | Or is the inline card fine now that it dismisses correctly? |
| 38, 40 | My Bag emoji vs icons | Capsules only, or everything? |

## 🔁 Blocked on reproduction (3)

| # | Finding | Note |
|---|---|---|
| 56 | Custom bottle doesn't save | `guardSubmit` self-clears on a 400ms timeout so it can't latch like #55 did; persistence effects read correctly |
| 57 | Tapping bottle adds no water | Best hypothesis: the **daily water cap**, whose toast rendered nothing until this batch. **Retest now** — you may just see the cap message |
| 68 | Screen went white | A crash I can't reproduce. Removing the #67 gesture conflict may or may not have been the cause |

---

## ⬜ Open — buildable, just not done yet (36)

**Dashboard layout (14):** #14 Bronze League "Br…" · #15 make it horizontal
*(needs Q1)* · #16 Daily Quests cut off · #17 quest progress bar · #18 gold CTA ·
#20 streak to top-right · #21 readiness placement · #22 tap-out readiness ·
#23 faint tile colours · #24 button audit · #25 reorder by usefulness ·
#26 faded background icons · #27 Workouts tile too big · #28 relocate Friends
this week

**Hub (6):** #43 delete REV accounts *(needs SQL)* · #46 dead space under tabs ·
#47 swipeable Global/Following/Crews · #49 desktop story swipe ·
#50 marketplace animation · #51 feature-of-week example image

**Messages (2):** #65 preload + swipe Messages↔Crews · #66 pin favourites

**Profile (4):** #73 banner drag distance · #74 change the banner ·
#75 reorder profile menu · #76 debrief vault too dense

**My Bag (2):** #37 capsule icons · #39 frame shape variants

**Other (3):** #3 blurry 47 · #8 remove carousel grid · #12 per-card colours ·
#58 meal autofill

## 📋 Separate project (1)

**#82 — the vibe-code audit.** Catalogue every "vibe-coded" tell, then audit
Flexyn against each. This is its own piece of work, not a fix.

---

## Suggested order

1. **Send the build hash.** Five seconds, closes 6 findings.
2. **Retest the water bottle.** Toasts render now — it may explain itself.
3. **Carousel reference shots.** Unblocks your #1 ticket and 7 others.
4. **One sentence each on Duels and Challenge.**
5. Then the dashboard-layout block (14 findings) — that's one focused session
   and it's most of what's left.
