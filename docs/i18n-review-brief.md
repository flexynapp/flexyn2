# Native review brief — equipment picker (ja / ko / zh / ar)

**For the reviewer:** you need ~10 minutes and no technical knowledge.
Open [`i18n-review-ja-ko-zh-ar.csv`](./i18n-review-ja-ko-zh-ar.csv) in any
spreadsheet, read your language's column, and put a better wording in
`reviewer_correction` wherever it reads wrong. Leave the rest blank.
You never need to touch code.

**Status:** these 37 strings were machine-translated (LLM) on 2026-07-30 and
have **not** been seen by a native speaker. Terminology was checked against
industry sources and against Flexyn's existing translations, but that catches
consistency, not naturalness.

---

## What the feature is

Inside a workout, next to each exercise, there's a dropdown to record the
**specific** machine you're on — your gym's Hammer Strength row rather than
just "a row", or your own adjustable dumbbells at home. Gyms can also list
what's on their floor so members' dropdowns lead with real machines.

So the vocabulary spans **machines, free weights, and home equipment** — not
just machines. That's why the umbrella word matters.

## Rules that apply to every language

1. **Brand and model names are never translated.** "Hammer Strength",
   "Bowflex SelectTech 552", "Cybex Eagle" come from a separate catalogue.
   If you see one inside a string, leave it in Latin script.
2. **`{gym}` is a placeholder** holding the gym's real name. Keep it exactly
   as `{gym}` and put it wherever your language wants it. Don't translate it,
   don't split it into a preposition plus a name.
3. **Length matters.** These are buttons, chips and section headings on a
   phone. Shorter is better; a translation 2× the English length will clip.

## The four things most likely to be wrong

Check these first — they're where a literal translation loses the meaning.

| Key | Why it's tricky |
|---|---|
| `gymEquip.byGym` vs `gymEquip.confirmed` | **Two different trust badges.** "Listed by the gym" = the gym's own owner added it, so it's authoritative. "Confirmed" = the owner vouched for something a *member* submitted. If your language collapses these into one word, users lose a distinction the UI depends on. |
| `gymEquip.added` / `emptyMine` / `emptyOther` | English "the floor" means the gym's equipment area. It's idiomatic and translates badly, so these were rendered as "the gym". Does that read naturally, or is there a better word for the equipment area? |
| `implement.clear` | The **verb** — clear/reset a selection. Not the adjective "clear" (transparent, obvious). |
| `implement.save` vs `gymEquip.save` | Deliberately different: one is "Save", the other is "Add". They're different buttons in different places. They should *not* end up the same word. |

## Per-language questions

**日本語** — Is 器具 the right umbrella when the list includes dumbbells and
barbells as well as machines, or would マシン read better despite that? Exercise
names are katakana (レッグプレス) — correct? Is the plain/polite register
consistent with the rest of the app?

**한국어** — 기구 vs 머신 for the umbrella term, given the list spans free
weights too? Is 헬스장 right for "gym" here (it's what the rest of the app
uses)? Do the 하십시오/해요 endings match the app's tone?

**中文** — 器械 was chosen over 器材 since 器械区 is the machine area of a gym,
but the list includes dumbbells and bars. Right call? Simplified only — no
Traditional variants needed. Is 腿举机 the natural way to say "leg press" in
the example placeholder?

**العربية** — Is جهاز / أجهزة right for gym equipment generally, or should it
be معدات when the list includes free weights? The app's existing strings use
both نادي and صالة for "gym" about equally — which should this feature use?
Note the app renders RTL, so the strings themselves need no directional marks.

## Where to actually get this reviewed

Claude produced these translations and cannot review them — it's the same
system that wrote them. Options, roughly cheapest first:

- **Ask users.** Flexyn has speakers of these languages among its users. 37
  short strings is a small favour and gets you a real lifter's vocabulary,
  which is better than a generic translator's.
- **A localisation platform** — Crowdin, Lokalise and Phrase all have free
  or cheap tiers for open/small projects and connect native reviewers.
- **A per-word service** — Gengo or similar. ~250 words across 4 languages is
  a very small job.
- **A fitness-native speaker over a generic translator**, if you have the
  choice. Gym terminology is a dialect; a professional translator who doesn't
  lift will produce something technically correct that no one at a gym says.

## Applying corrections

Hand the filled-in CSV back and the corrections go into
`src/lib/i18n-equipment.js`. When a language is done, remove it from the
exported `REVIEW_PENDING` array in that file — that's the record of what's
still machine-only. `src/lib/__tests__/i18nEquipment.test.js` will catch a
dropped key, a lost `{gym}`, or the two trust badges collapsing.
