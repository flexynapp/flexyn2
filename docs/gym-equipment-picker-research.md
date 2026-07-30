# Gym Equipment Picker — Research (2026-07-30)

User request: inside an active workout, put a dropdown next to the exercise
title (for gym/machine exercises) that lets the lifter pick the *specific*
machine their gym has, and show an image of that exact machine.

This document is the evidence base. The execution plan lives in
[`gym-equipment-picker-prompt.md`](./gym-equipment-picker-prompt.md).

---

## 1. Prior art: what public fitness repos actually do

**Headline finding: no public dataset models equipment below the category
level.** Every open exercise DB stops at "machine" / "cable" / "barbell".
There is nothing to fork for brand + model, and no open corpus of machine
photographs. This feature has to be built, and the data has to be sourced.

| Source | License | Equipment model | Machine photos? |
|---|---|---|---|
| [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db) | Unlicense (true public domain) | Flat 13-value enum on 873 exercises | No — images are people demonstrating |
| [wger](https://github.com/wger-project/wger) | AGPL-3.0 | 12 rows in `/api/v2/equipment/` | No |
| [sergei-argutin/exercise-dataset](https://github.com/sergei-argutin/exercise-dataset) | Commercial use *with attribution* | Category-level | 512px WebP, exercise not machine |
| [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) | Media rights from "Gym Visual" — **licensed, not free to relicense** | Category-level | Animation GIFs |
| [GymGuide-ML](https://github.com/GymGuide/GymGuide-ML) / [Roboflow "All Gym Equipment"](https://universe.roboflow.com/fitfuel/all-gym-equipment) | CV training sets | 23 classes / 1,947 images, machine **type** only | Training images, not product art |

Verified enum from `free-exercise-db/dist/exercises.json` (873 exercises):

```
barbell 170 · dumbbell 123 · other 122 · body only 111 · cable 81 · (null) 77
machine 67 · kettlebells 53 · bands 20 · medicine ball 17 · exercise ball 12
foam roll 11 · e-z curl bar 9
```

Verified from `https://wger.de/api/v2/equipment/` — all 12 rows:
Barbell, SZ-Bar, Dumbbell, Gym mat, Swiss Ball, Pull-up bar,
none (bodyweight exercise), Bench, Incline bench, Kettlebell,
Resistance band, Cable machine.

### Shipped apps, not repos

- **[Hevy](https://www.hevyapp.com/equipment/)** — closest shipped analogue.
  You can create a custom exercise with name/type/equipment/muscles **and
  attach your own picture**. Note the shape: user-generated, per-user, not a
  curated brand catalog. Hevy did not try to license manufacturer art either.
- **[GymLens](https://apps.apple.com/py/app/gymlens/id6744256958)** — camera
  first: photograph the machine, AI identifies it, generates a routine. Solves
  identification, not selection-from-a-known-floor.
- **GymStreak / Fitbod** — model *available equipment* as a category filter to
  shape generated plans. Still category-level.

**Takeaway:** the category-level rung is solved and commoditized. The
brand/model rung is genuinely unbuilt, which is why users are asking. The only
proven mechanism for machine-accurate imagery is **user-submitted photos**.

---

## 2. Brand landscape

### Consolidation

Life Fitness Holdings owns **Life Fitness, Hammer Strength, Cybex, SCIFIT, and
ICG**. Cybex is effectively retired as a sold brand but Cybex machines are
still on thousands of floors, so the catalog needs it as a legacy entry.

### Brand → product line → representative models

| Brand | Lines | Notes |
|---|---|---|
| **Life Fitness** | Insignia Series, Axiom Series, Optima Series | Selectorized. Insignia is the flagship (e.g. *Insignia Series Arc Leg Press*) |
| **Hammer Strength** | Select (selectorized), MTS / Motion Technology Select, **Plate-Loaded** | Plate-loaded is the recognizable one: Super Squat Press, Pendulum-X Squat, Super Fly, Glute Drive, Hack Squat, Iso-Lateral Chest Press, Hip Abductor, Belt Squat |
| **Technogym** | Selection / Selection Pro, Pure Strength, Artis, Skill line | Dominant in EU + premium clubs |
| **Precor** | Resolute, Vitality, Discovery (plate-loaded + selectorized) | Premium US clubs |
| **Cybex** | Eagle, VR3, Prestige | Legacy floors, brand absorbed |
| **Matrix Fitness** | Ultra, Versa, Aura, Magnum | Growing share; newer budget-chain fitouts |
| **Nautilus** | Inspiration, Impact | |
| **Free-weight side** | Rogue, Eleiko, Sorinex, Texas | Racks, bars, platforms |
| **Boutique / enthusiast** | Atlantis, Arsenal Strength, Prime Fitness, Panatta, Gym80, Watson | High signal for serious lifters; often the *reason* someone picks a gym |

### Chain → brand (directional — public sources are thin, treat as a seed hint, not truth)

- **Planet Fitness** — Life Fitness, Hammer Strength, Precor, Cybex; newer
  clubs increasingly Matrix.
- **Gold's Gym** — Life Fitness / Hammer Strength.
- **Equinox** — Precor, with Technogym.
- **Life Time** — Precor, Hammer Strength, Technogym, Octane; Woodway manual
  treadmills.
- **LA Fitness / 24 Hour / Anytime / Crunch** — *not reliably documented in
  public sources.* Do not seed guesses. Let members fill these in.

---

## 3. The blocking constraint: imagery

"Show an image of that exact machine" means manufacturer product photography.
That art is copyrighted, the brand names are trademarked, and Flexyn ships to
the **iOS and Android stores** — scraping lifefitness.com / technogym.com
product shots into the bundle is a real takedown and review-rejection risk.

Using brand and model names as **text** in a dropdown is nominative fair use —
factually identifying the machine in front of you. That is fine. The exposure
is in the **photos and logos**, not the words.

Three image sources, in the order they should be used:

1. **User / gym-owner submitted photos** — the only source that actually
   delivers "that exact machine," and it is legally clean because the
   photographer owns the shot. Flexyn already has every piece of this
   pipeline: `db.integrations.Core.UploadFile` → public `uploads` bucket
   (`src/api/db.js:898`), `compressImage(maxWidth 800, quality 0.85)`, and
   `AvatarUploader.jsx` as the working UX template.
2. **[Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Weight_training)**
   CC-BY-SA machine photos (Category:Leg press machines, lat pulldown, etc.) —
   good enough as a generic **per-type** fallback. Requires attribution;
   `ATTRIBUTIONS.md` already exists for exactly this pattern (Twemoji CC-BY).
3. **Drawn silhouettes / icons per machine type** — always available, zero
   legal risk. This is the ship-day default so the feature is never blocked on
   having a photo.

---

## 4. Where this lands in Flexyn (verified against the tree)

- **`src/lib/exerciseEquipment.js`** (60 lines) — name-regex classifier
  returning 9 categories. Its only consumer is
  `src/components/regimens/ExerciseAutocomplete.jsx`. This is the taxonomy
  anchor: the new catalog's `machine_type` should key off the same vocabulary
  so the filter pills and the picker agree.
- **`src/components/workout/ExerciseLogger.jsx`** — the target surface. Two
  title render paths, both need handling:
  - `:217` collapsed/complete summary
  - `:241` active card `<h4>` + muscle `Badge` row ← the dropdown goes here
- **`src/components/MobileSelect.jsx`** — drop-in Select that becomes a bottom
  Drawer under 768px, `items={[{value,label}]}`. Correct control given Flexyn
  is mobile-only.
- **`workout_logs.exercises` is `jsonb`** (`001_initial_schema.sql:90`) — a
  per-exercise machine selection persists **with no migration**.
- **`gym_businesses` / `gym_members`** (mig 135) already exist with
  `owner_id`, `flexyn_code`, `member_count`; `gym_checkins` at mig 149. A
  gym-scoped equipment catalog attaches cleanly to `gym_id`.
- **`src/lib/gymAmenities.js`** — the controlled-vocabulary pattern
  (`slug → { label, emoji }`, unknown slugs render with a fallback) to copy
  verbatim for the brand and machine-type vocab.
- **Next free migration number: 268** (263–267 are taken).
- **i18n**: `tFallback('key', 'English fallback')`, 15 languages, English
  fallbacks inline, never machine-translated.

---

## Sources

- [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db)
- [wger-project/wger](https://github.com/wger-project/wger)
- [sergei-argutin/exercise-dataset](https://github.com/sergei-argutin/exercise-dataset)
- [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)
- [GymGuide/GymGuide-ML](https://github.com/GymGuide/GymGuide-ML)
- [Roboflow — All Gym Equipment](https://universe.roboflow.com/fitfuel/all-gym-equipment)
- [Hevy — Equipment](https://www.hevyapp.com/equipment/)
- [GymLens on the App Store](https://apps.apple.com/py/app/gymlens/id6744256958)
- [GymStreak](https://www.gymstreak.com/)
- [Life Fitness — Strength Training catalog](https://www.lifefitness.com/en-us/catalog/strength-training)
- [Life Fitness (Wikipedia)](https://en.wikipedia.org/wiki/Life_Fitness)
- [Precor](https://www.precor.com/en-US)
- [Life Fitness vs Precor vs Matrix vs Technogym](https://www.fitkituk.com/blog/life-fitness-vs-precor-vs-matrix-vs-technogym-a-detailed-comparison-of-commercial-gym-equipment/)
- [Planet Fitness equipment list](https://pfguides.com/planet-fitness-equipment-list/)
- [Wikimedia Commons — Weight training](https://commons.wikimedia.org/wiki/Weight_training)
- [Wikimedia Commons — Leg press machines](https://commons.wikimedia.org/wiki/Category:Leg_press_machines)
