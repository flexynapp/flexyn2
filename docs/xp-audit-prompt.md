# Prompt — XP & level mechanics audit

Self-contained brief. Paste into a fresh session; assumes no memory of the one
that wrote it.

---

## Task

Audit the **entire XP pipeline** in `~/flexyn2` (Flexyn — React + Vite +
Supabase) end to end: how XP is earned, computed, transported, written,
capped, converted to a level, and paid out in rewards. Verify it's coherent,
server-authoritative where it matters, and paced the way the product intends.

This is a system audit, not a bug fix. Do not start editing. Follow the method
below — the first deliverable is a map, not a diff.

## Why now

The level curve was rebalanced (`src/lib/xpSystem.js`). The old one was
broken: a tier-boundary discontinuity put level 100 at 192,438,890 XP — 659
years at a realistic 800 XP/day. The replacement compounds continuously and
decelerates: base 100, growth 1.110 / 1.085 / 1.050 / 1.040 / 1.030 by band.
See `docs/gamification-ui-research.md` for the derivation.

**The rewards were never re-checked against it.** They still carry magnitudes
tuned for the old curve, and the new one is much cheaper early:

| Single session from 0 XP | XP | Lands at |
|---|---|---|
| Light 20-min beginner | 90 | Level 1 |
| Moderate 45-min | 300 | **Level 3** |
| Hard 60-min | 700 | **Level 6** |
| `MAX_WORKOUT_XP` | 1000 | **Level 8** |
| `DAILY_XP_CAP` in one day | 2500 | **Level 13** |
| Week 1 at 800/day | 5600 | **Level 20** |
| Month 1 at 800/day | 24000 | **Level 36** |

So a first hard workout can move a new user 1 → 8 in a single save, and week
one reaches Gold tier. Whether that's delightful onboarding or a broken
economy is the central question of this audit — **it is a product judgement,
so surface it with numbers and a recommendation rather than unilaterally
retuning.**

The reason it might be broken: `src/lib/capsuleLevelUp.js` grants capsules and
coins **per level crossed**, and is designed to pay out the delta on a
multi-level jump. Seven levels in one save is seven grants. Verify what that
actually costs.

## Method — this is the part that matters

Four stages. Do not skip ahead; each one's output is the next one's input.

### Stage 0 — Map, don't judge

Produce an inventory table before forming any opinion. Every site that
**writes** `total_xp` or derives a level:

```
grep -rn "total_xp" src/ supabase/migrations/ base44/
grep -rn "calculateWorkoutXp\|calculateCardioXp\|XP_REWARDS\|DAILY_XP_CAP" src/
```

For each: file, trigger, who computes the value (client or server), whether the
cap applies, and whether a tampered client could inflate it. Known entry points
to start from — confirm and extend, don't trust this list:

- `src/lib/xpSystem.js` — the formulas, `XP_REWARDS`, `MAX_WORKOUT_XP` (1000),
  `MAX_CARDIO_XP` (600), `DAILY_XP_CAP` (2500)
- `base44/functions/updateUserXpAndAchievements/entry.ts`
- `src/lib/capsuleLevelUp.js` — per-level capsule + coin grants
- `src/lib/data/leagues.js` — weekly XP, promotion/demotion, tier rewards
- `src/lib/xpTier.js` — the ten cosmetic tiers keyed off level
- Migrations 197–207 hardened the **coin** economy; check whether XP got the
  same treatment or was left client-trusted

### Stage 1 — Model offline

Write a throwaway Node script in the scratchpad (not in the repo) that
implements the rules from Stage 0 and simulates. Answer with numbers:

- Level after day 1 / week 1 / month 1 / 6 months at realistic and at
  cap-maxed play
- Total capsules and coins granted along each of those paths
- Which of the ten tiers in `xpTier.js` a real user actually passes through,
  and when
- Where `DAILY_XP_CAP` binds, and whether it's reachable by normal play or
  only by farming

Simulate before reading any more code. Cheap, and it tells you which parts of
the pipeline deserve scrutiny.

### Stage 2 — Compare against how mature projects do it

Read source, not blog posts. Licence gates use: permissive means we can lift,
copyleft is ideas-only.

| Repo | Licence | Read for |
|---|---|---|
| [`heroiclabs/nakama`](https://github.com/heroiclabs/nakama) | Apache-2.0 | `server/core_wallet.go` — server-authoritative currency, the ledger pattern, how a change is validated and recorded rather than trusted |
| [`runelite/runelite`](https://github.com/runelite/runelite) | BSD-2 | `Experience.java` — the canonical curve; note it's a *table*, computed once, never re-derived per call |
| [`HabitRPG/habitica`](https://github.com/HabitRPG/habitica) | **GPL-3.0 — ideas only** | `website/common/script/ops/scoreTask.js` and `statHelpers.js` — a habit app that computes scoring in **shared code run on the server**, with diminishing returns (`diminishingReturns`) to bound any single action |
| [`ppy/osu-web`](https://github.com/ppy/osu-web) | **AGPL-3.0 — ideas only** | Rankings recalculation commands — how a scoring change is *migrated* across existing users rather than applied only going forward |

The specific questions to bring to them:

1. **Where is the number computed?** Habitica's scoring is shared code the
   server executes. Ours computes in the browser — find out what the server
   does with that number and whether it re-derives or trusts it.
2. **How is a single action bounded?** Habitica uses a hyperbolic
   diminishing-returns function, not a hard cap. We use hard caps
   (`MAX_WORKOUT_XP`). Compare the failure modes at the boundary.
3. **How is a rebalance rolled out?** osu-web has explicit recalculation
   commands. We changed the curve with 8 users and no migration — fine now,
   impossible later. What would we need before the next change?

### Stage 3 — Rank and report

One table, ordered by severity, each row: what's wrong, the concrete failure
(inputs → wrong outcome), the evidence, and the fix. Separate **defects**
(provably wrong) from **product calls** (pacing, generosity) — do not fix the
second kind without asking.

Then stop and present. Fix in follow-up commits, one concern each.

## Specific things to verify

Confirm or refute each with evidence; don't assume any are true.

1. **Is `DAILY_XP_CAP` enforced anywhere?** The comment in `xpSystem.js` says
   the server function "should respect this". Verify whether it does. If it
   doesn't, the cap is decorative.
2. **Can a tampered client grant itself arbitrary XP?** Trace the write path to
   the RLS policy. Migration 108 was a real privacy leak from trusting a
   client-supplied value — check XP for the same class of trust.
3. **Are multi-level jumps paid out correctly and affordably?** One save
   crossing 7 levels — what does `grantForLevelUp` hand over, and is the
   idempotency guard sound if the same save is retried?
4. **Do the cardio and strength formulas produce comparable XP for comparable
   effort?** `MAX_CARDIO_XP` is 600 vs `MAX_WORKOUT_XP` 1000. Justify or flag.
5. **Do league weekly-XP and lifetime `total_xp` agree** on what counts as XP?
   Two sources of truth for "XP earned" is a classic drift bug.
6. **Does anything still assume the old curve?** Hardcoded thresholds,
   "XP to next level" copy, tier boundaries, onboarding promises.
7. **Are the ten tiers in `xpTier.js` reachable on the new curve, and is the
   pacing sane?** Ladder share by band was 0.3 / 2.1 / 15 / 29 / 54%.

## Constraints

From `CLAUDE.md` — read it:

- Before writing a migration referencing existing schema, **grep for the real
  column/function name**. The single most common defect in this repo is
  referencing something that doesn't exist.
- SECURITY DEFINER RPCs gate on `auth.uid()` server-side, never on a
  client-supplied identifier.
- Paste-safe SQL: no dotted `alias.column` or record `.id` tokens. Use CTEs
  with `USING()`, bare columns, `#variable_conflict use_column`.
- TDZ: declare every `const` before first use, including in deps arrays.
- Gate before push: `npm run lint` clean, `npm run test`, `npm run build`.
- Push feature branch first, then fast-forward `main`. Never force-push.
- After every push, post the SQL inline in a ```sql block, or say
  "No SQL needed — frontend only". Never point at a file path.

## Verification

- Any claim about production must be checked against the live DB via the
  Supabase MCP (project `ebvqxuwfiptcmlkhflfj`), read-only. As of the last
  audit: 38 users, 8 with any XP, max 559 total. Re-check — it will have moved.
- Any behavioural claim must be exercised, not inferred. The suite is 1986
  passing across 148 files and must stay green.
- Simulation scripts live in the scratchpad, never committed. Their *results*
  go in the report.

## Done means

A written audit — inventory table, simulation results, reference comparison,
severity-ranked findings with defects separated from product calls — plus a
recommendation on early-game pacing backed by numbers. No code changed yet
unless a finding is an outright defect with an obvious, isolated fix; say
explicitly which of those you took.

If the pipeline turns out to be sound, say so plainly and show the evidence.
A clean audit is a valid result; do not manufacture findings to justify it.
