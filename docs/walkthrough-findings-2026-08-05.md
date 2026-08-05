# Live walkthrough findings — Kegan, 2026-08-05

Captured from a full run-through of the app on **desktop + iPhone (installed
PWA)**. Nothing here has been changed yet — this is the specification pass.

**Voice-to-text corrections applied:** "cruise" → **Crews**, "log mule" → **log
meal**, "Bronx League" → **Bronze League**, "Flexon"/"Flexin" → **Flexyn**,
"mind week" → **"Mid-week"** (unconfirmed — flagged below).

**⚠️ No screenshots reached me.** Items marked 📷 depend on an image that was
referenced but did not come through. See §13 for the list I need.

Priority key: **P0** blocks/ruins a flow · **P1** visible damage or regression ·
**P2** polish · **P3** idea / open question

---

## 1. Onboarding & first load

| # | Finding | Where | Pri |
|---|---|---|---|
| 1 | AI Coach renders a hallucinated, meaningless "design" on first load 📷 | Onboarding, first screen, desktop | **P1** |
| 2 | Part of the bench is cut off 📷 | Smart Log | **P1** |
| 3 | The "47" in Streaks is blurry / low quality — number rendering is not ideal | Smart Log, Streaks | P2 |

## 2. Dashboard carousel — **highest-priority ticket**

Called out three separate times as the top fix.

| # | Finding | Where | Pri |
|---|---|---|---|
| 4 | Carousel is far too large | Dashboard, front page | **P0** |
| 5 | **Cards change size as you scroll between them.** Must be one uniform size | Dashboard carousel, desktop **and** iPhone | **P0** |
| 6 | Max size = the "Feature of the week" / stories tab. The orange box in the screenshot marks exactly where the bar should cut off 📷 | Dashboard carousel | **P0** |
| 7 | Bottom third is dead space — cut it. **Zero** dead space anywhere | Dashboard carousel | **P0** |
| 8 | Remove the transparent grid in the background — "absolutely ridiculous" | Dashboard carousel | **P0** |
| 9 | Size change reproduces on iPhone when moving between "Feature of the week" and "This week" | Dashboard carousel, iPhone | **P0** |
| 10 | **This is a regression** — it used to look right and the progress was undone. Reference photos exist 📷 | Dashboard carousel | **P0** |
| 11 | Add faded colour to the carousel | Dashboard carousel | P1 |
| 12 | Each card needs its **own** colour. Currently "All time" + "Your level" share one, and "Train smarter" + "Stay in it" share another | Dashboard carousel | P1 |
| 13 | Proposal: darker background, white text, white icons | Dashboard carousel | P2 |

## 3. Dashboard layout & density

| # | Finding | Where | Pri |
|---|---|---|---|
| 14 | **Bronze League label is cut off — renders as "Br…"**, which is useless | Dashboard, iPhone | **P0** |
| 15 | Bronze League should be **horizontal**, sitting underneath the "Start workout" / "Mid-week" row *(verify: "mind week" in dictation)* | Dashboard | P1 |
| 16 | Daily Quests text also cut off | Dashboard | **P1** |
| 17 | Daily Quests needs a progress bar, colour-coordinated to the quest type | Dashboard | P2 |
| 18 | "Today — get back to it" button should be **yellow/gold, shiny, enticing** | Dashboard | P1 |
| 19 | **Dark-mode / night-view toggle is completely gone from the front page** | Dashboard | **P1** |
| 20 | 2-day streak should move to the **top-right, immediately left of "Customize home"** — nonintrusive | Dashboard | P1 |
| 21 | Readiness score should sit **to the left of the "Today — get back to it" button** | Dashboard | P1 |
| 22 | Readiness score should be a light popup you can **tap out of** — not require hitting ✕ | Dashboard | P2 |
| 23 | Every dashboard tile (Daily Quests, Bronze League, …) needs a **very faint** colour scheme | Dashboard | P2 |
| 24 | Audit which buttons earn their place on the home page — **move**, don't delete, the rest | Dashboard | P2 |
| 25 | Re-order dashboard buttons by actual usefulness | Dashboard | P2 |
| 26 | Cards with dead space need **large faded background icons** | Dashboard tiles | P2 |
| 27 | "Workouts" tile is far too big; needs an icon + real metrics (volume lifted etc.) | Dashboard | P1 |
| 28 | "Friends this week" is a good feature — consider relocating it | Dashboard | P3 |
| 29 | ✅ **Works as intended** — Free Daily Chest opened, claimed, and correctly disappeared from the home page | Dashboard | — |
| 30 | Daily chest could become a once-a-day popup that dismisses permanently for the day | Dashboard | P3 |
| 31 | ✅ Nutrition & Recovery section is good as-is | Dashboard | — |

## 4. Themes

| # | Finding | Where | Pri |
|---|---|---|---|
| 32 | **Theme does not sync across devices** — space theme on iPhone, absent on desktop | Global | **P1** |
| 33 | **Opening My Bag drops the theme** and forces a Flexyn-logo loading screen | My Bag | **P1** |
| 34 | Add a **"Default"** theme — once a theme is applied there's no way to see the original | Theme picker | P1 |
| 35 | Make theme-switching far more discoverable | Global | P1 |
| 36 | Theme switcher should live in **Settings** *and* **My Bag** | Settings / My Bag | P1 |

## 5. My Bag / inventory

| # | Finding | Where | Pri |
|---|---|---|---|
| 37 | Capsules should use **designed icons, not emojis** | My Bag → Capsules | P2 |
| 38 | Stickers can stay emoji | My Bag → Stickers | P3 |
| 39 | Frames could offer shape variants — thicker edge, square edge (small) | My Bag → Frames | P3 |
| 40 | Open question: keep emoji everywhere in My Bag for now? Undecided | My Bag | P3 |

## 6. Hub — feed, stories, discovery

| # | Finding | Where | Pri |
|---|---|---|---|
| 41 | **"Hot" tab shows "the feed is quiet" with no way back — ruins the feed, requires a page refresh** | Hub → What's new / What's hot | **P0** |
| 42 | **Discovery lists everyone — a privacy breach.** The 3–5-person recommendation algorithm was built and is not being used. It should suggest 3–5, and surface a fresh set on refresh based on who they know. **Find it in the files.** | Hub → Suggested for you | **P0** |
| 43 | **Delete the REV accounts** — bot-created, should not exist | Hub / user list | **P1** |
| 44 | **Friends' stories must come before "people to add"** | Hub, top of feed | **P1** |
| 45 | Hub tab icon is greyed out on mobile — should always be coloured and enticing | Bottom nav, iPhone | **P1** |
| 46 | Large dead space under the tab row — between "Global / Following / Crews" and "Suggested for you" | Hub, iPhone | **P1** |
| 47 | Global / Following / Crews should be **swipeable with no load** | Hub tabs | P1 |
| 48 | "Suggested for you" now covers the "add a note" affordance above the avatar | Hub, top | **P1** |
| 49 | Story swiping left↔right is difficult on desktop | Hub → Stories, desktop | P1 |
| 50 | Marketplace animation is too slow and not enticing | Marketplace | P2 |
| 51 | Feature-of-the-week stories should show an example image — someone flexing | Hub → Feature of the week | P3 |

## 7. Workout

| # | Finding | Where | Pri |
|---|---|---|---|
| 52 | **The red→yellow gradient that was on every workout button is gone.** Regression — find out what happened | Workout, all buttons | **P1** |

## 8. Progress

| # | Finding | Where | Pri |
|---|---|---|---|
| 53 | Streak, Workouts and Level tiles are all effectively the same colour | Progress tab | P1 |
| 54 | Weekly Summary renders dark while nothing else does | Progress → Weekly Summary | P1 |

## 9. Nutrition

| # | Finding | Where | Pri |
|---|---|---|---|
| 55 | **Log Meal does nothing.** Entered calories + protein, pressed Log Meal, no result. Possibly related to having just logged one | Nutrition → Log a meal | **P0** |
| 56 | **Custom water bottle does not save** | Nutrition → Water, iPhone | **P0** |
| 57 | **Tapping the custom bottle does not add the water** | Nutrition → Water, iPhone | **P0** |
| 58 | No autofill when logging a meal | Nutrition → Log a meal | P1 |
| 59 | All colour has been stripped from the Nutrition tab | Nutrition | P1 |
| 60 | Nutrition carousel is entirely orange — useless as a signal | Nutrition carousel | P1 |
| 61 | Copy: "Midday momentum, Sean" is meaningless — needs rewriting | Nutrition / greeting | P2 |

## 10. Messages & Crews

| # | Finding | Where | Pri |
|---|---|---|---|
| 62 | **DMs are horizontally scrollable on desktop and don't show the full width.** Should be locked — no sideways scroll | Messages, desktop | **P0** |
| 63 | **Pinned messages are unreachable** — the affordance exists but is cut off by the scroll bar | Messages → pinned | **P1** |
| 64 | Hideous scroll bars under the DM list on desktop — remove entirely | Messages, desktop | **P1** |
| 65 | Messages ↔ Crews should be preloaded and swipeable with a soft edge | Messages / Crews | P1 |
| 66 | Should be able to **pin favourites** in the conversation list | Messages list | P2 |

## 11. Profile & notifications

| # | Finding | Where | Pri |
|---|---|---|---|
| 67 | **Notifications panel can't be dismissed by swiping** — it just pulls up and up | Notifications, iPhone | **P0** |
| 68 | **Screen went fully white for a long moment** after retrying the swipe | Notifications, iPhone | **P0** |
| 69 | Should be able to **swipe right** to exit notifications; panel should be noninvasive | Notifications | **P1** |
| 70 | **My Gyms and My Journal opened simultaneously** | Profile menu | **P1** |
| 71 | Signature Trophy Case is "ruined" 📷 | Profile | **P1** |
| 72 | "PR" label is cut off under personal album stories (New / PRs) | Profile → Stories | P1 |
| 73 | Background banner requires dragging the screen far down to see | Profile, iPhone | P2 |
| 74 | Can the banner be changed? | Profile | P3 |
| 75 | Re-sort the profile menu (Profile, Settings, Achievements, My Bag, My Gym…) by importance | Profile menu | P2 |
| 76 | Debrief Vault has too much in it | Profile → Debrief Vault | P2 |
| 77 | ✅ My Injuries — logged/cleared works fine | Profile → Injuries | — |

## 12. Duels, global behaviour, data

| # | Finding | Where | Pri |
|---|---|---|---|
| 78 | **Something broke on tapping Duels** — dictation cut off. May be specific to the home-screen-pinned PWA vs Safari | Duels, iPhone PWA | **P0 — needs detail** |
| 79 | **Something broke on tapping "Challenge"** — dictation cut off | Duels → Challenge | **P0 — needs detail** |
| 80 | **Disable pinch-zoom** — the whole screen can be shrunk. Zoom probably shouldn't exist here at all | Global | **P1** |
| 81 | **Where does check-in data go?** Mood ("good"/"on fire"), 9+ hrs sleep, 5,000 steps — is any of it persisted? It should at minimum land in the user's Journal | Dashboard check-ins | **P1 — investigation** |

## 13. Separate work item

| # | Item |
|---|---|
| 82 | **Vibe-code audit.** Produce a list of every "vibe-coded" tell — the visual and structural signatures of AI-generated app UI — then audit Flexyn against it and report where we fall into each one. Explicitly requested as its own deliverable. |

---

## Screenshots I need

Ranked by how much they'd change what I build:

1. **The carousel, desktop + iPhone** — including the orange box marking where the bar should cut off, and the **"what it used to look like" reference shots**. This is the top ticket and #10 says it's a regression, so the old version is the spec.
2. **Duels + Challenge (#78, #79)** — both dictations cut off mid-sentence. I don't know what actually broke.
3. **AI Coach hallucinated design (#1)** — I can't picture what's rendering.
4. **Signature Trophy Case (#71)** — "ruined" needs a visual.
5. **Smart Log cut-off bench (#2)** and the blurry 47 (#3).
6. **Workout red→yellow gradient** — if you have a shot of the old scheme, it's the spec for the regression.

## Open questions

- **#15** — "mind week" from voice-to-text. Is that **Mid-week**, or a different tile?
- **#78 / #79** — what actually happened?
- **#40** — do you want icons across all of My Bag, or capsules only?
- **#30** — should the daily chest become a modal, or is the current inline card fine now that it dismisses correctly?

## Three regressions worth isolating first

These are called out as *"it used to work / used to look right"*, which means
there's a commit that broke each one and finding it is faster than rebuilding:

- **#10** the carousel sizing and styling
- **#52** the workout red→yellow gradient
- **#19** the dashboard dark-mode toggle

Those three should be `git log`-ed before any redesign work starts.
