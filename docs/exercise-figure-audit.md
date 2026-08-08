# Exercise figure audit — protocol

Draft, 2026-08-07. For the posable figure in `src/components/exercise/ExerciseFigure.jsx`,
its geometry in `src/lib/exerciseFigureGeometry.js`, and the 39 poses in
`src/lib/data/exercisePoses.js`.

## The question this audit answers

Not "are the numbers legal" — `scripts/pose-check.mjs` already answers that, and as of
`a304a21` it answers **39 exercises, 117 frames, 0 failures.** The question here is the one
a checker cannot ask:

> **Can somebody who has never done this movement look at the three panels and perform it
> correctly, without reading anything?**

That is a higher bar than "this looks like a person," which is itself higher than "the joint
angles are in range." Each of the three commits in this feature was found by moving up one
rung, and every rung found defects the rung below had passed. This audit is the next rung.

It earned its keep before it was finished, twice, and both times the same way — Kegan looked at
a rendered card and said something was wrong:

- **Nine frames drew knees that bent backwards**, across five exercises (G.2).
- **The barbell on a bench was drawn across the lifter's waist**, and **54 frames** authored a
  hand position the arm could not reach, which `reach()` silently clamped (G.3).

Every one of those passed all seven existing checks. Both are fixed and both are now gated —
but the lesson is the ordering: *the numbers were legal in all 63 cases.* Section B is not a
formality you run at the end.

**The gate.** Any exercise that fails Section B, C, E or G is not shippable as a
demonstration. If the count of failures is large enough that fixing them one at a time is
losing — the same test the `handAt` rewrite applied to hand placement — the answer is not 39
hand-fixes, it is more fidelity. Section K is that decision.

---

## Section 0 — Preconditions

**0.1 — Is it reachable?** `grep -rn "posesFor\|ExerciseDiagram\|ExerciseFigure" src/` excluding
the two files that define it.

> **~~FAIL. Zero consumers.~~ FIXED 2026-08-07.** It was 100% built and 0% delivered — nothing
> in the app rendered any of the 117 frames, which is also why nothing downstream (theming at
> real size, i18n, a11y, card layout) had ever been exercised.
>
> `ExerciseFormPanel` now hosts it on two surfaces:
>
> - **`ExerciseLogger`** (Workout), under the exercise name and above the sets — the moment
>   someone is deciding how to move, and the only surface open while they are under the bar.
> - **`StarterPlanView`** (the Coach plan's read view), where an unfamiliar lift is still
>   something you can do something about.
>
> **Collapsed by default**, mirroring `EvidencePanel`'s disclosure shape. An expanded triptych
> costs ~120px of a 390px screen and most people know what a Barbell Row is; the tap is also
> the clearest signal we get that the picture is wanted. The figure is `React.lazy`, so the
> geometry only downloads for someone who opens it.
>
> **Not wired**: the plan card's *edit* view, whose own comment requires everything to stay
> visible and one tap away, and `formcoach/ExercisePicker`. Neither is a natural home for a
> disclosure.

**0.2 — Does the audit look at the shipping renderer?** The contact sheet
(`scripts/pose-sheet.mjs`) imports the same geometry the component does, so it is faithful for
*shape*. It is **not** faithful for size, theme, or surrounding card chrome — it renders 180px
panels on a fixed dark background, and the app renders roughly 100–110px panels in a
three-column grid inside `bg-secondary/40`, in both themes. Sections H and I must be run on the
real component in the real card, not on the sheet.

---

## Section A — Coverage

**Method.** Set-difference every exercise name the app can put in front of a user against
`Object.keys(POSES)`.

| Source | Names | Drawn | Status |
|---|---|---|---|
| `aiCoach/workoutGenerator.js` `CATALOG` | 39 | 39 | **PASS — 100%** |
| `lib/programTemplates.js` | 39 | 17 | **FAIL — 22 undrawn** |
| `lib/exerciseTranslations.js` | 59 | 7 | **FAIL** |

**Partly addressed 2026-08-07.** `posesFor()` was an exact `POSES[name]` lookup that returned
`null` on any miss. It is now case- and whitespace-insensitive and resolves a deliberately tiny
alias list — `Walking Lunge` → `Lunge`, `Bicep Curl` → `Dumbbell Curl`.

**What was deliberately NOT aliased matters more than what was.** `Squat`, `Deadlift`,
`Chin-up`, `Incline Bench Press` and `Power Clean` are all tempting one-liners and all wrong: a
back squat is not a bodyweight squat, a conventional deadlift is not a Romanian one, and a
chin-up differs from a pull-up in exactly the grip this figure cannot draw (Section C). The
failure modes are not symmetric — showing nothing is a visibly empty result the user can act on;
showing the wrong movement teaches them the wrong movement, which is the single thing this
feature exists to prevent. Those five need drawings, not aliases.

The generated-workout path is completely covered, which is the path the feature was built for.
Everything else is not. What remains undrawn in `programTemplates.js` is genuine missing art,
not naming: `Deadlift`, `Sumo Deadlift`, `Power Clean`, `Chin-up`, `Incline Bench Press`,
`Close-Grip Bench Press`. **`Deadlift` is the one to draw first** — it is the most-injured lift
in the catalog and the one where a picture earns the most.

**Pass bar.** Every name reachable from a template, the picker, the autocomplete or a generated
session either resolves to a pose or resolves to a deliberate, designed empty state. A silent
`null` is a fail — the card must not render a hole.

**Automate it.** A test that walks every exercise-name source and asserts `posesFor(name)` is
non-null, with an explicit allowlist for the ones we have consciously not drawn.

---

## Section B — Identifiability (blind naming)

**Method.** Show a person the three panels with **the exercise name and all captions removed**.
Ask: "What is this?" Then: "Show me how you'd do it." Score:

- **2** — names it, or names a movement in the same family, and performs it correctly.
- **1** — cannot name it, but performs it correctly once told the name.
- **0** — performs it wrong, or the picture actively suggests a different movement.

Run **8–10 people**, mixed training experience, at the real card size on a phone, not on a
desktop contact sheet. Half should be beginners — the population this feature exists for.

**Pass bar.** Mean ≥ 1.5 across the catalog, **and zero exercises scoring 0**, because a 0 is
not "unclear," it is the app teaching the wrong movement.

**Predicted 0s from the pre-audit visual pass** (these are the ones to test first, and it is
worth confirming they fail rather than assuming it):

- **Lateral Raise** — see Section D. The side view shows the arm rising in front of the body.
  It reads as a Front Raise. This is a picture of a different exercise.
- ~~**Lat Pulldown**~~ — was a Pull-up as drawn: no seat, knees tucked, and a bar that could not
  descend. Fixed (Sections E and G.3); re-test rather than assume.
- **Back Squat / Front Squat** — the bar renders as a long horizontal beam projecting forward
  from the hands at chest height. Neither reads as a bar on the back or in a front rack.
- ~~**Leg Press**~~ — was a figure on the floor pushing a horizontal bar, with a knee that bent
  backwards. Now on a `sled` with a reclined pad and a rail. Re-test rather than assume.
- **Dead Bug** — at card size the limbs-up supine position resolves to an abstract shape.

---

## Section C — Discriminability

**Method.** Two exercises must not resolve to the same picture. Automatable: solve frame 2 of
every pose, compare joint-for-joint against every other pose, flag any pair whose maximum
per-joint distance is under ~6 units (about two-thirds of a head radius).

**Measured — 7 colliding pairs:**

| Max joint delta | Pair | Verdict |
|---|---|---|
| **0.0** | Barbell Curl ≡ Dumbbell Curl | Prop differs. Acceptable. |
| **0.0** | Romanian Deadlift ≡ Dumbbell Romanian Deadlift | Prop differs. Acceptable. |
| **0.3** | Incline Dumbbell Press ≡ Dumbbell Fly | **FAIL — same prop, same pose, different exercise.** |
| **2.0** | Barbell Row ≡ Dumbbell Row | Prop differs. Acceptable. |
| **2.0** | Dumbbell Curl ≡ Hammer Curl | **FAIL — same prop, same pose.** |
| **2.0** | Barbell Curl ≡ Hammer Curl | Prop differs, but see below. |
| **2.8** | Front Squat ≡ Goblet Squat | Prop differs. Acceptable. |

Two hard failures, and they fail for different reasons:

- **Hammer Curl vs Dumbbell Curl** differ *only* in grip rotation. The figure has no hands and
  no wrists, so the one distinguishing feature is undrawable. Right now the app would show the
  same picture for two exercises and caption one of them "Neutral grip" — a caption describing
  something the drawing does not contain.
- **Incline Dumbbell Press vs Dumbbell Fly** differ in elbow path and, for the incline press,
  in the bench angle. Neither is drawn: `benchHold` renders no bench at all, so "incline" has
  no incline, and both are a supine figure pressing bells upward.

**Pass bar.** Every pair either differs visibly in the *figure*, or differs in a prop that a
user can name from the drawing. "Differs only by a caption" is a fail.

---

## Section D — Plane and projection

**Method.** For each exercise, ask whether the movement's principal plane is visible in the
camera the pose is drawn from. `exercisePoses.js` mandates a single camera: *"The figure faces
RIGHT in every side-view pose."*

That rule is right for consistency and wrong for a specific class of movement. A strictly
lateral camera can show the **sagittal** plane and nothing else. Movements whose defining
motion is **frontal** (side-to-side) or **transverse** (rotational) project onto that camera as
almost no motion at all, or — worse — as motion that reads as a different exercise.

**Affected:**

| Exercise | Plane | What the side view shows |
|---|---|---|
| Lateral Raise | frontal | Arm rising forward → reads as a Front Raise |
| Cable Crossover | transverse | Arms toward each other across the chest → mostly invisible |
| Face Pull | transverse | Partially visible; the external rotation is not |
| Russian Twist | transverse | Rotation is entirely invisible; the three frames differ only in arm angle |

**This is a limitation of the projection, not of the poses**, and no amount of angle-tuning
fixes it — the same class as the dead-hang head ambiguity already recorded in `a304a21`. The
fix is a per-pose camera. See Section K.

A second, separate projection defect affects **17 exercises**: every `barbell` (8) and
`dumbbells` (9) prop is drawn **front-on** — a long horizontal bar with a plate at each end —
against a **lateral** figure. In a true side view a barbell is a disc. The result is a picture
that mixes two cameras, and it is why the squat bar reads as a beam held out in front rather
than as a bar racked on the back.

---

## Section E — Apparatus truth

**Method.** For every exercise, list the equipment a person must have, and check it is drawn.
`00dea9b` set this standard explicitly: *"every bar-dependent movement now shows the bar, so
'you need a pull-up bar for this' is visible in the picture."* Apply the same standard to
benches, seats, racks and sleds.

**~~FAIL — 9 exercises~~ FIXED 2026-08-07.**

The blocker was structural, not artistic: a pose had **one** prop slot, and a `held` implement
suppressed any fixed one, so "barbell in the hands" and "bench under the back" could not both be
true. Poses now carry a second field, `support`, drawn behind everything else.

**Supports derive from JOINTS, never from coordinates** — the same rule `00dea9b` established for
props after fixed bar positions missed the hands by 10–36 units. A bench is *"the line from the
head to the hip, pushed to the far side of the torso"*; a seat is *"the line from the hip to the
knee, pushed away from the torso"*. Stated that way they follow the pose, which is what let the
incline bench tilt: **`inclineHold` tilts the LIFTER**, and the pad follows, rather than a second
number being tuned to match a first.

| Exercise | Support | Was |
|---|---|---|
| Bench Press, Dumbbell Fly, Skull Crusher | `bench-flat` | mid-air |
| Incline Dumbbell Press | `bench-incl` | mid-air, and no incline |
| Dumbbell Shoulder Press, Leg Extension | `seat-back` | seat and back pad both absent |
| Lat Pulldown | `seat-thigh` | no seat, no thigh pad |
| Seated Cable Row | `seat-plate` | no seat, no foot plate |
| Leg Press | `sled` | a person on the floor pushing a stick |

Gated by `SUPPORT` in `pose-check.mjs`, and **verified by deleting `bench-flat` and watching it
fail 9 frames** — a check nobody has seen fail is a check nobody knows works.

One clause in that check is worth keeping: it fired on all four squats before the torso term was
added, and that was the check being wrong rather than the art. **The bottom of a squat IS
geometrically a person sitting on an invisible chair** — thigh horizontal, hip well clear of the
floor. What separates them is that a squatter leans forward over their feet (146–160°) while
someone on a bench sits up (172–184°). Same family as the head-clearance calibration in `a304a21`.

**Original finding, for the record — 9 exercises were performed on a surface that was not drawn:**

| Exercise | Prop drawn | Missing |
|---|---|---|
| Bench Press | barbell | the bench |
| Incline Dumbbell Press | dumbbells | the bench, and its incline |
| Dumbbell Fly | dumbbells | the bench |
| Skull Crusher | barbell | the bench |
| Dumbbell Shoulder Press | dumbbells | the seat and back pad |
| Seated Cable Row | cable-stack | the seat and foot plate |
| Lat Pulldown | bar-high | the seat and thigh pad |
| Leg Press | machine | the sled, seat and rails |
| Russian Twist / Dead Bug | none | floor only — acceptable |

`benchHold` and `seatHold` both position the figure *as if* on a bench or seat, and then the
`held` props (barbell, dumbbells) suppress any fixed prop, so the figure floats. `PROPS` already
carries `bench-flat` — it has **zero users**. This is the cheapest fix in the audit: a pose
needs to be able to name *two* props, one held and one fixed.

**Pass bar.** Everything the body's weight rests on is drawn. A figure supported by nothing
reads as falling, not as lying.

---

## Section F — Motion legibility

**Method.** The triptych exists because a movement is a path. Measure how much actually moves.

**F.1 — Frame 1 vs frame 3.** `rep3(a, b)` returns `[a, b, a]`, so:

> **37 of 39 exercises render frame 3 pixel-identical to frame 1.** The set is 117 panels
> carrying **78 unique drawings.** A third of the display area repeats a picture the user is
> already looking at, under a caption that describes an *action* ("Drive up", "Press back up")
> rather than the position shown.

This is defensible — start and end of a rep genuinely are the same position — but it must be a
decision, not a side effect. Either the third panel earns its space (an arrow, a tempo cue, a
different caption treatment, a common-error frame) or the layout should be two panels, and the
freed width should go to making the two that matter bigger. At a ~110px panel on a 375px
phone, bigger is worth a lot.

**F.2 — Amplitude.** Maximum joint travel between frame 1 and frame 2, in viewBox units
(the figure is ~150 units tall; the viewBox is 200):

> **21 of 39 exercises move less than 25 units.** The worst:

| Travel | Hand travel | Exercise | Note |
|---|---|---|---|
| **0** | 0 | Plank | frames 1 and 2 are identical — only 2 unique frames total |
| **4.0** | 2.4 | Pike Push-up | |
| **4.7** | **3.3** | **Lat Pulldown** | **the bar never comes down** — the defining motion is absent |
| 8.0 | 0 | Inverted Row | |
| 11.0 | 11.0 | Calf Raise | a heel raise at ~5% of figure height |
| 12.9 | 7.2 | Skull Crusher | |
| 14.7 | 14.7 | Bench Press | |

Lat Pulldown is the clear defect: its two frames differ by a 8° torso lean, and the bar is a
fixed prop anchored to frame 1, so it cannot descend. The picture shows a person hanging from
a high bar leaning back slightly. Plank is a deliberate hold and its flat frames 1–2 are
arguably right, but combined with F.1 it means Plank ships **two** distinct drawings across
three panels, one of which is labelled "wrong" (see Section G).

**Pass bar.** Every exercise shows ≥ 20 units of travel on the joint that defines the movement,
**or** carries an explicit exemption naming why (isometric hold, fixed-grip movement where the
body travels instead of the hand).

---

## Section G — Coaching correctness

**G.1 — Is the depicted form good form?** Each pose needs a second pair of eyes that knows
lifting, checking the *middle* frame in particular — `exercisePoses.js` states that the middle
frame is "the position people get wrong," so a middle frame that is itself wrong teaches the
error. Specific things to put in front of a coach:

- **Goblet Squat / Front Squat** middle frames fold the torso to 160°. A front-loaded squat is
  defined by a near-vertical torso; as drawn these read closer to a good-morning.
- **Back Squat** middle frame at torso 150° is plausible for a low-bar squat and aggressive for
  a high-bar one — but the bar is drawn in front of the body, so the picture cannot be a low-bar
  squat.
- **Romanian Deadlift** at 144° torso with the bar at mid-shin — check the shin angle and
  whether the back reads as flat.
- **Inverted Row** — the fold check in `pose-check.mjs` was written specifically because this
  one folded in half. Confirm the *fixed* version reads as chest-to-bar and not as a figure
  draped over the bar.

**G.2 — Do the joints bend the way joints bend? FIXED 2026-08-07 — 9 frames.**

This was found by Kegan looking at a rendered Leg Press card, not by any check, and it is the
sharpest example in the audit of why Section B exists: the knee was folding **backwards**, and
once you see it you cannot see anything else.

A knee is a true hinge. Unlike the elbow it has no shoulder rotation to hide behind, so a knee
bending the wrong way is wrong in every projection — this is *not* the sagittal-plane ambiguity
of Section D. It is also cheap to compute: the figure always faces `+x`, so flexion always
rotates the shin toward `-x`, a decreasing angle in this convention. Signed angles survive
rotation, so one rule covers upright, prone, supine and hanging poses alike.

| Exercise | Frames | Was |
|---|---|---|
| Leg Press | 1, 3 | knee dipped **below** the hip-to-foot line, both legs at +78° |
| Cable Crunch | all 3 | kneeling with the shins running **forward**, both feet through the floor, +100° |
| Hanging Leg Raise | 2 | shins pointing **up** from the knees, +86° — drew as a closed rectangle |
| Lunge | 2 | back leg's shin ran forward, +76° |
| Pull-up | 1, 2, 3 | far leg bent forward to splay the legs for depth, +24–28° |

Fixed by mirroring each knee across the hip→foot line, which holds the hip and the **foot**
exactly where they were — so floor contact, prop contact and every other composition decision
survive untouched, and only the joint moves to the side a knee can reach. Lunge and Cable Crunch
needed re-authoring rather than a mirror, because their *feet* were in the wrong place too. Now
`KNEE` in `pose-check.mjs`; 117 frames, 0 failures.

**Elbows are a separate question and were deliberately left alone.** The same sweep flags 22
elbow frames — Pull-up, Inverted Row, Tricep Dips, Front Squat, Goblet Squat, Incline Dumbbell
Press, Bench Press, Cable Crunch and Leg Curl. Unlike the knee, the shoulder can internally
rotate, so an elbow apex pointing "the wrong way" in a strict 2D side view is often a real arm
seen in projection — the front-rack and flared-elbow-bench cases especially. Mass-fixing those
would be exactly the mistake `a304a21` records under the head-clearance threshold: distorting
the picture to quiet the checker. **These need a coach's eye, one at a time**, and until then
`KNEE` deliberately does not have an elbow twin.

**G.3 — Does the source describe what actually renders? FIXED 2026-08-07 — two bugs, 54 frames.**

Found the same way: Kegan looked at the Bench Press card and said the arm was wrong. It was,
twice over, and neither fault was visible in the source.

**`benchHold` carried `propAt: 'hip'`**, so `anchorFor` returned the hip and the barbell was
drawn **across the lifter's waist** while both arms reached up holding nothing. `seatHold`,
eleven lines below it, carries a comment recording this exact lesson — *"No propAt: the cable or
bar must reach the HAND, and anchoring it at the hip ran the cable to the lifter's waist."* The
note was written on the wrong helper, so the mistake was made twice. Dumbbells hid it: `propMarkup`
draws those from the solved hands and ignores the anchor entirely, so only the two **barbell**
movements on a bench showed it.

**`reach()` silently clamps an unreachable target.** The arm is 21 + 19 = 40 units; Bench Press
asked for a bar **60 units** from the shoulder. No error — the hand simply goes somewhere else,
and every held prop follows it there. **54 frames across 22 exercises** were authoring a hand
position that never rendered:

| Off by | Exercise | Consequence |
|---|---|---|
| 38 | Lat Pulldown | bar drawn at chest height, not overhead |
| 22 | Romanian Deadlift, Dumbbell RDL | "bar to mid-shin" drawn at the knee |
| 20 | Bench Press | — |
| 18 | Incline Dumbbell Press, Skull Crusher | — |
| 17 | Dumbbell Shoulder Press | — |
| 6–16 | 15 others | small, but the number in the file was still fiction |

Every out-of-reach target is now inside reach, and `REACH` in `pose-check.mjs` fails the build on
a new one. Most were rewritten to the point the arm was already reaching, so **no picture
changed** — the source simply stopped claiming something untrue. Three were genuine defects worth
fixing rather than recording:

- **Push-up's hands could never touch the floor.** The shoulder sat 46 units above it. The body
  now sits where a 40-unit arm can meet the ground.
- **The Lat Pulldown bar could not come down**, because `bar-high` is a *fixed* prop shared with
  Pull-up and Hanging Leg Raise, anchored to frame one. Added **`bar-pulldown`** — same drawing,
  `held: true` — so the bar travels with the hands. That closes the 3.3-unit amplitude in
  Section F: the movement is now visible.
- **Incline Dumbbell Press and Dumbbell Fly** were the same picture (Section C). The press bends
  the elbow; the fly keeps the arm long and sweeps it. They now differ at frame 1 — and since
  Section E the press is also drawn on an incline, so they differ in the apparatus too.

**One correction to Section C's spec.** It compared frame 2 only, which is too narrow — Incline
Press and Fly legitimately finish in nearly the same place, and it is frame 1 that distinguishes
them. `DISTINCT` should compare **all three frames** and fail only when every one matches. Under
that rule one genuine collision remains: **Hammer Curl ≡ Dumbbell Curl**, same prop, 2.0 units
apart, differing only in a grip the figure has no hands to show. That is K.3, not a pose bug.

**G.4 — Is anything drawn wrong marked as wrong?** **FAIL.**

`Plank` frame 3 is captioned "Hips sagging (wrong)" and is drawn in exactly the same stroke,
colour and weight as the two correct frames. Nothing in the picture says *don't do this.* In a
triptych where the third panel is otherwise "the end of the rep," a user scanning captions is
being shown a sagging plank as the final position.

**Pass bar.** A deliberately-wrong frame is visually marked as wrong — `destructive` hue plus a
✗ glyph — and the marking is part of the figure component, not the caption. If we are not
prepared to build that treatment, the correct move is to delete the wrong-form frame rather
than ship an unmarked one. Note that adding a hue here interacts with the four-hue rule in
CLAUDE.md — `destructive` is already one of the four, so this is a use, not an extension.

---

## Section H — Rendering at real size

**Method.** Render `ExerciseDiagram` inside the actual card, at the actual grid width, on the
real device range. Per CLAUDE.md, verify at **667px height as well as 932** and kill the
iframe scrollbar before measuring width.

At `grid-cols-3 gap-2` inside a page with `px-4`, a 375px iPhone SE gives roughly **107px per
panel** — a 200-unit viewBox scaled to ~0.53. Everything below needs measuring at that scale,
not on the 180px contact sheet:

- **H.1** Stroke weights. Torso is 11 units → ~5.9px. The far-side limbs are 6 units at 0.42
  opacity → ~3.2px at 42% — check that against the app's hairline conventions and against
  contrast in **light** theme, where a 42% grey on `bg-secondary/40` is much weaker than the
  42% white on `#141419` the contact sheet shows.
- **H.2** The floor line is `stroke-dasharray="4 6"` at opacity 0.28 → a 2.1px dash at 28%.
  Likely to disappear entirely in light theme. It is load-bearing: it is what makes a push-up
  read as horizontal rather than as a person falling over.
- **H.3** Props render at `opacity="0.55"`, with the bar-high uprights at a further `0.5`
  (0.275 effective) and bench legs at `0.4` (0.22 effective). Check they survive.
- **H.4** The near-arm/torso occlusion clearance is 7 units → **3.7px** at card size. The
  standing poses splay arms 14° off the torso, which passes the checker and, at 107px, may
  still merge into one blob. Re-derive `LIMB_CLEARANCE` from the rendered size, not the viewBox.
- **H.5** Captions use `text-micro` — confirm against the 11px floor.

**Pass bar.** Every stroke is distinguishable in both themes at 375px width. Section B's blind
test is run at this size, not larger.

---

## Section I — Accessibility and i18n

**I.1 — Screen readers got nothing. FIXED 2026-08-07.** `ExerciseFigure` set both `role="img"`
and `aria-hidden="true"` — a contradiction: the element announced itself as an image and then
removed itself from the tree. `role` is gone; `aria-hidden` stays, and the `<figcaption>` beside
each panel is the accessible text, which is the honest arrangement because a stick figure has no
description the drawing can give that the caption does not give better.

The disclosure that hosts it carries `aria-expanded` and an aria-label naming the **exercise**
(`How to do Barbell Row`) rather than a bare "How to" — on the Workout page every card has one
of these, so an unnamed control hands a screen-reader user a column of identical buttons. Both
are asserted in `src/components/__tests__/exerciseFormPanel.test.jsx`.

**I.2 — Captions are English in all 15 languages. OPEN — now the largest gap.**
`ExerciseDiagram`'s doc comment says *"Labels arrive already translated"*; they never did. The
cues live in `exercisePoses.js` as hardcoded English (`'Hips below knees'`, `'Chest to floor'`).

The wiring routes every cue through `tFallback('exerciseCues.<slug>.<i>', englishCue)`, so the
call site is now correct and a translator only has to add the keys — but **no key exists yet, so
all 15 languages render English today.** Per CLAUDE.md that is the sanctioned interim state
(English-only beats machine-translated prose, and there is a `TODO(i18n)` at the call site), but
it is the sanctioned interim state, not done. 117 cues across 39 exercises need a native pass.

**I.3 — The exercise names themselves are untranslated. FAIL, pre-existing.**
**32 of the 39 drawn exercises have no entry in `EXERCISE_TRANSLATIONS`** — including Back
Squat, Romanian Deadlift, Pull-up, Lat Pulldown, Dips and Lunge. Separately, that file's header
claims *"424 exercises across 15 languages"* and the object holds **59**. Worth fixing the
comment either way; a stale count invites someone to trust a coverage claim that is 7× off.

**I.4 — RTL.** The figure faces right by rule. In Arabic the surrounding layout mirrors and the
figure does not. Decide deliberately: mirroring is arguably *more* correct for reading order,
and arguably wrong because a barbell does not change sides. Whichever — record the decision.

**I.5 — Reduced motion.** No animation today. If the triptych ever animates, gate on
`prefers-reduced-motion`.

---

## Section J — Regression gates to add to `pose-check.mjs`

`a304a21`'s thesis — *"a lesson that lives only in my head gets relearned; a lesson in
pose-check.mjs does not"* — applies to everything above that can be computed. Proposed
additions, each one a defect this audit actually found:

| Check | Rule | Currently failing |
|---|---|---|
| `KNEE` | A knee flexes posteriorly — never more than +6° of hyperextension | ~~9~~ **shipped** |
| `REACH` | A `handAt` must be inside the arm's 40 units, or it is silently clamped | ~~54~~ **shipped** |
| `SUPPORT` | A lifter lying or seated off the floor must name a `support` | ~~9~~ **shipped** |
| `DISTINCT` | No two exercises match on **all three** frames unless their props differ | 1 |
| `AMPLITUDE` | ≥ 20 units of travel between frames 1 and 2, or a named exemption | 21 |
| `COVERAGE` | Every name in every exercise source resolves through `posesFor()` | 24 |
| `PLANE` | A pose tagged frontal/transverse must not use the side camera | 4 |
| `MARKED` | A frame whose label contains "(wrong)" must set the error treatment | 1 |
| `CAPTION` | Every label resolves to an i18n key, not a literal | 117 |

Note the shape of that table: **every one of these is a check that would have failed on
already-shipped, already-passing work** — the same pattern as the 53 problems the occlusion and
head checks found on their first run.

---

## Section K — The fidelity decision

This is the "bump up the quality a tad" question, and the audit above is what answers it.

**What the stick figure demonstrably does well.** Consistency by construction; 35 KB for 117
frames against 1.2–1.8 MB of images; free theming; no licensing question; a pose is 12
authorable numbers. None of that should be given up. The three commits behind it also produced
real machinery — inverse kinematics for contact, derived props, a numeric gate — that a
higher-fidelity figure would inherit rather than replace.

**What it structurally cannot do, at any level of angle-tuning.** Three things, and they are
the three that produce Section B's predicted zeros:

1. **One camera cannot show every plane.** (Section D — 4 exercises)
2. **No hands means no grip, and no grip means some exercises are the same picture.**
   (Section C — Hammer vs Dumbbell Curl)
3. **Props in a different projection from the body read as a different object.**
   (Section D — 17 exercises)

None of those is a pose bug. Each is a property of the representation.

**Recommendation — a targeted fidelity increase, in this order.** These are ranked by
demonstration-quality gained per unit of work, and the first three are cheap:

1. **Draw the support.** Wire `bench-flat`, add a seat and a sled; let a pose name a fixed prop
   *and* a held one. Fixes 9 exercises and is the single largest legibility win available.
   *(Section E)*
2. **Give the pose a camera.** `view: 'side' | 'front'`, with a front-view solver — the same
   forward kinematics with the shoulder/hip pairs separated horizontally instead of overlapped.
   Fixes the 4 undrawable-plane exercises and is what lets a barbell be a disc in side view and
   a bar in front view. *(Sections D)*
3. **Add hands and feet.** A short stroke at each wrist, angled by a `grip` field
   (`pronated` / `neutral` / `supinated`). Separates Hammer from Dumbbell Curl, and gives every
   gripping exercise a visible point of contact instead of a line ending in mid-air.
   *(Section C)*
4. **Then re-run Section B.** If the blind-naming mean clears 1.5 with no zeros, stop — the
   stick figure was sufficient and we now know it rather than assume it.
5. **Only if it does not:** move the body from strokes to a **filled silhouette** — same
   skeleton, same poses, same 12 numbers, but limbs rendered as tapered closed paths with
   rounded joins. This is the largest readability jump available without giving up any of the
   properties in the first paragraph: it fixes the near-limb/torso occlusion problem
   structurally (a filled limb over a filled torso reads as depth rather than as a merged
   blob), it survives being scaled to 107px far better than 6px strokes at 42% opacity, and it
   is roughly one function in the geometry module rather than a new asset pipeline.

**What not to do.** Licensed illustration or video sets give up the bundle argument, the
theming, and the consistency, and reintroduce the licensing question `ATTRIBUTIONS.md` exists
to keep closed. Do not reach for them before step 5 has been tried and measured.

---

## Execution order

1. **Wire it in** (Section 0.1) — without this the rest measures a contact sheet.
2. Run **A, C, E, F, I, J** — all automatable, all already partly measured above.
3. Do the three cheap fidelity fixes (K.1–K.3), since each one closes findings from step 2.
4. Run **H** on device at 375×667 and 430×932, both themes.
5. Run **B** and **G.1** with humans, at real card size, once the picture is worth testing.
6. Decide K.5 on B's numbers.

## Appendix — how the seed findings were produced

`node scripts/pose-check.mjs` (0 failures), `node scripts/pose-sheet.mjs`, then all 117 frames
rasterised and inspected individually, plus a geometry-diff pass for Sections C and F. The
numbers in Sections A, C, F and I.3 are measured, not estimated. The judgements in Sections B,
D and G.1 are one reader's, and Section B in particular is the one that must be run with people
who are not the author — a picture is never unclear to whoever drew it.
