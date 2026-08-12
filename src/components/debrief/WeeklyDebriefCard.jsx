// src/components/debrief/WeeklyDebriefCard.jsx
//
// One week, in full — the body of a Weekly Review.
//
// Drawn from the Penpot page "Weekly Reviews — dashboard", board A. Board D
// on that page is the element ledger: every number here names the table it
// comes from, and the four defects this replaces.
//
// WHAT CHANGED FROM THE OLD DEBRIEF CARD
// --------------------------------------
// The old card reported lifting only — volume, top lift, a 3-stat row and
// eight binary muscle-group chips — and two of those numbers were wrong at
// the source (see migration 328's head). Flexyn logs cardio, steps, food,
// sleep, mood, body weight, quests, trophies, coins, crews, duels, leagues
// and gym check-ins, and none of it reached the user's week. It does now.
//
// Two rules govern the whole file, both from CLAUDE.md:
//
//   • A SECTION WITH NO DATA IS NOT RENDERED. It never renders as zeros.
//     A 0 reads as a failure the user did not commit — "0 kcal" at someone
//     who simply doesn't track food is the app calling them lazy. Every
//     section below is behind a `has*` gate.
//
//   • Spacing has two registers and one seam. 24px (`space-y-6`) between
//     sections; a single 32px break (`pt-8`) between Progression and
//     Conditioning, separating what you DID from everything around it.
//     Nothing uses the banned 12–20px middle.
//
// Reads BOTH payload shapes: v2's sectioned objects when `schema_version`
// is 2, and the flat v1 keys otherwise, so a row generated before migration
// 328 still renders rather than blanking.

import React from 'react';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import {
  Flame, Trophy, Dumbbell, Star, TrendingUp, TrendingDown, Minus,
  Utensils, Moon, Users, Swords, Target,
} from 'lucide-react';

// ── Formatting ────────────────────────────────────────────────────────────

const n0 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)))
  ? null : Math.round(Number(v)).toLocaleString('en-US');

const n1 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)))
  ? null : Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Metres → the viewer's distance unit. The old comment here said "the app is
 *  lbs/miles throughout", which stopped being true once Settings grew unit
 *  pickers — it was an assumption, not a rule, and it outlived the thing it
 *  described. */
const toDistance = (m, unit) => (unit === 'km' ? num(m) / 1000 : num(m) / 1609.344);

/** Percentage change, or null when there is no baseline to compare against —
 *  a "+100%" against a week of zero is noise, not information. */
const pctChange = (now, before) =>
  num(before) > 0 ? Math.round(((num(now) - num(before)) / num(before)) * 100) : null;

/** Minutes → "1h 52m" / "48m". */
function hm(mins) {
  const t = Math.round(num(mins));
  if (t <= 0) return null;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Primitives ────────────────────────────────────────────────────────────

function Section({ title, meta, children, seam = false }) {
  return (
    <section className={seam ? 'pt-8' : undefined}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="font-heading font-bold text-[15px] text-foreground">{title}</h3>
        {meta && <span className="text-micro text-muted-foreground text-end">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/** A row of one to three figures, hairline-separated.
 *
 *  Takes `items` already filtered to the ones that HAVE data — a stat with
 *  nothing behind it is dropped rather than rendered as an em dash. Half the
 *  columns this reads are NULL on every row in production (workout duration
 *  0/3, sleep soreness 0/7, sleep quality 1/7), so a fixed three-up grid
 *  meant a permanent row of dashes.
 *
 *  Flex rather than `grid-cols-{n}`: the count comes from data, and Tailwind
 *  scans source TEXT, so an interpolated column count emits no CSS at all
 *  (CLAUDE.md). Basis is even because each item is `flex-1`. */
function StatRow({ items }) {
  const shown = items.filter(it => it && it.value !== null && it.value !== undefined);
  if (shown.length === 0) return null;
  return (
    <div className="flex">
      {shown.map((it, i) => (
        <div key={it.label} className={`flex-1 min-w-0 ${i > 0 ? 'ps-3 border-s border-border' : ''}`}>
          <p className="font-heading font-bold text-[15px] text-foreground tabular-nums">{it.value}</p>
          <p className="text-micro text-muted-foreground truncate">{it.label}</p>
        </div>
      ))}
    </div>
  );
}

function Bar({ pct, tone = 'primary', className = '' }) {
  const w = Math.max(0, Math.min(100, num(pct)));
  const fill = tone === 'muted' ? 'bg-muted-foreground/60' : 'bg-primary';
  return (
    <div className={`h-1.5 rounded-full bg-secondary overflow-hidden ${className}`}>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function Delta({ pct, suffix = 'vs last week' }) {
  if (pct === null || pct === undefined) return null;
  const v = Number(pct);
  if (!Number.isFinite(v)) return null;
  if (v === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-micro font-semibold text-muted-foreground border border-border rounded-full px-2 py-0.5">
        <Minus className="w-3 h-3" /> level with last week
      </span>
    );
  }
  const up = v > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-micro font-semibold rounded-full px-2 py-0.5 border ${
      up ? 'text-success border-success/50' : 'text-muted-foreground border-border'
    }`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? '+' : ''}{v}% {suffix}
    </span>
  );
}

/** Label · hairline · value. The default row for read-only data — a card
 *  per fact would be a card in a card (CLAUDE.md). */
function FactRow({ icon: Icon, label, detail, value, last = false }) {
  return (
    <div className={`flex items-center gap-2 py-2.5 ${last ? '' : 'border-b border-border'}`}>
      {Icon && <Icon className="w-4 h-4 text-primary shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground truncate">{label}</p>
        {detail && <p className="text-micro text-muted-foreground truncate">{detail}</p>}
      </div>
      {value && (
        <span className="font-heading font-bold text-[15px] text-foreground tabular-nums shrink-0">{value}</span>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export default function WeeklyDebriefCard({ debrief, forExport = false, exportRef }) {
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();
  if (!debrief) return null;

  const d  = debrief.data || {};
  // v2 sections, with the flat v1 keys as the fallback so old rows render.
  const tr = d.training     || {};
  const co = d.conditioning || {};
  const fu = d.fuel         || {};
  const re = d.recovery     || {};
  const ga = d.game         || {};
  const pe = d.people       || {};

  const weekLabel = debrief.week_label || `Week ${debrief.week_number}, ${debrief.year}`;

  // ── Training
  const sessions   = tr.sessions     ?? d.workouts_count ?? 0;
  const daysTrained= tr.days_trained ?? null;
  const dayFlags   = Array.isArray(tr.day_flags) && tr.day_flags.length === 7 ? tr.day_flags : null;
  const streak     = tr.streak       ?? d.workout_streak ?? 0;
  const volume     = tr.volume_lbs   ?? d.volume_lbs     ?? 0;
  const changePct  = tr.change_pct   ?? d.volume_change_pct ?? null;
  const baseline   = tr.baseline_lbs ?? null;
  const loadRatio  = tr.load_ratio   ?? null;
  const sets       = tr.sets ?? null;
  const reps       = tr.reps ?? null;
  const duration   = tr.duration_min ?? null;
  const muscleSets = tr.muscle_sets && typeof tr.muscle_sets === 'object' ? tr.muscle_sets : null;
  const prCount    = tr.pr_count ?? null;
  const topLift    = tr.top_lift || {
    name: d.top_lift_name, weight: d.top_lift_weight,
    reps: d.top_lift_reps, is_pr: d.top_lift_is_pr,
  };

  const hasTraining = sessions > 0 || num(volume) > 0;

  // ── Conditioning
  const cardioN    = num(co.sessions);
  const steps      = num(co.steps);
  const hasCond    = cardioN > 0 || steps > 0;
  // Seven daily totals, Monday-first. Absent on a v1 payload, so the chart is
  // behind a null check rather than assumed.
  const dailySteps = Array.isArray(co.daily_steps) && co.daily_steps.length === 7
    ? co.daily_steps : null;
  const maxDay     = dailySteps ? Math.max(...dailySteps.map(num)) : 0;

  // ── Fuel
  const fuelDays   = fu.days_logged ?? d.macro_days_tracked ?? 0;
  const hasFuel    = num(fuelDays) > 0;
  // Energy from the macros we actually have, used both to size the stacked
  // bar and to decide whether it is worth drawing at all.
  const macroKcal  = num(fu.avg_protein) * 4 + num(fu.avg_carbs) * 4 + num(fu.avg_fat) * 9;

  // ── Recovery
  const sleepNights= num(re.sleep_nights);
  const moodDays   = num(re.mood_days);
  const weightEnd  = re.weight_end;
  const hasRecovery= sleepNights > 0 || moodDays > 0 || weightEnd != null;

  // ── Game — XP always exists, so this section always renders.
  const xp         = ga.xp_earned ?? d.xp_earned ?? 0;
  const levelStart = ga.level_start ?? d.level_start ?? null;
  const levelEnd   = ga.level_end   ?? d.level_end   ?? null;
  const levelUp    = levelStart != null && levelEnd != null && levelEnd > levelStart;

  // ── People
  // Gated on the league EXISTING, not on `rank` — same trap as the row below,
  // one level up. league_members.rank is NULL until the league RESOLVES, so a
  // user competing all week in Bronze with no crew and no duels would have had
  // the entire section hidden from them for the only week it described.
  const hasPeople  = !!pe.crew_name || num(pe.duels_played) > 0
                     || !!pe.league_tier || pe.league_xp != null
                     || pe.league_rank != null || num(pe.gym_days) > 0;

  const insight    = d.ai_insight || '';

  // Muscle groups, heaviest first — the list IS the balance read.
  const muscleRows = muscleSets
    ? Object.entries(muscleSets)
        .map(([k, v]) => [k, num(v)])
        .sort((a, b) => b[1] - a[1])
    : [];
  const maxSets = muscleRows.length ? muscleRows[0][1] : 0;

  const dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <div
      ref={exportRef}
      className={`w-full rounded-2xl overflow-hidden bg-card border border-border ${forExport ? 'max-w-sm mx-auto' : ''}`}
    >
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between gap-2 px-4 pt-4">
        <div>
          <p className="font-heading font-black text-lg text-foreground">{weekLabel}</p>
          {d.week_start && d.week_end && (
            <p className="text-micro text-muted-foreground">{d.week_start} → {d.week_end}</p>
          )}
        </div>
        <span className="text-micro font-bold uppercase tracking-widest text-primary">Flexyn</span>
      </div>

      {/* ── HERO — the one dominant element, and the only thing that bleeds
             past the 16px inset. It answers the first question a review has
             to answer, which is not "how much" but "did you show up". ── */}
      <div className="mt-4 px-4 py-4 bg-secondary/40 border-y border-border">
        <p className="text-micro font-bold uppercase tracking-widest text-muted-foreground">
          {sessions > 0 ? 'You showed up' : 'You rested'}
        </p>
        <div className="flex items-end justify-between gap-3 mt-1">
          <div className="flex items-end gap-2">
            <span className={`font-heading font-black text-5xl leading-none tabular-nums ${
              sessions > 0 ? 'text-foreground' : 'text-muted-foreground'
            }`}>
              {daysTrained ?? sessions}
            </span>
            <span className="text-[13px] text-muted-foreground mb-1">
              {daysTrained != null ? 'of 7 days' : `session${sessions === 1 ? '' : 's'}`}
            </span>
          </div>
          {streak > 0 && (
            <div className="text-end">
              <span className="inline-flex items-center gap-1">
                <Flame className="w-4 h-4 text-primary" />
                <span className="font-heading font-bold text-xl tabular-nums text-foreground">{streak}</span>
              </span>
              <p className="text-micro text-muted-foreground">day streak</p>
            </div>
          )}
        </div>

        {dayFlags && (
          <div className="grid grid-cols-7 gap-1.5 mt-4">
            {dayFlags.map((on, i) => (
              <div key={i}>
                <div className={`h-1.5 rounded-full ${on ? 'bg-primary' : 'bg-secondary'}`} />
                <p className={`text-micro text-center mt-1 ${on ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {dayLetters[i]}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-6 space-y-6">

        {/* LOAD */}
        {hasTraining && (
          <Section title="Load" meta={baseline ? 'vs your 4-week normal' : null}>
            <div className="flex items-end gap-2">
              <span className="font-heading font-black text-3xl leading-none tabular-nums text-foreground">
                {n0(fromLbs(volume, weightUnit))}
              </span>
              {/* Converted per viewer. CLAUDE.md's "the weekly review is
                  deliberately preference-blind" rule is about
                  include_bar_in_volume — a preference that changes the NUMBER,
                  and so must not differ from the gym and crew boards sitting
                  one tap away. A unit is not that: it is the same quantity
                  written differently, and it converts identically everywhere,
                  so nothing can disagree. Rendering "lbs" at someone who set
                  kilograms is simply wrong. */}
              <span className="text-[13px] text-muted-foreground mb-0.5">
                {weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lbs'} moved
              </span>
            </div>
            <div className="mt-2"><Delta pct={changePct} /></div>

            {/* The acute:chronic shape, stated and NOT prescribed from. The
                injury-threshold literature did not survive its RCT, so this
                is context for the lifter, never a warning from the app. */}
            {loadRatio != null && baseline > 0 && (
              <div className="mt-2">
                <Bar pct={(num(volume) / (num(baseline) * 2)) * 100} />
                <p className="text-micro text-muted-foreground mt-1">
                  {n1(loadRatio)}× your four-week normal ({n0(baseline)} lbs)
                </p>
              </div>
            )}

            {(sets || reps || duration) && (
              <div className="mt-2 pt-2 border-t border-border">
                {/* `duration` is workout_logs.duration_min, which is NULL on
                    100% of production rows and has no other source for a
                    lifting session — so it drops out rather than sitting
                    there as a permanent em dash. */}
                <StatRow items={[
                  { value: n0(sets), label: 'sets' },
                  { value: n0(reps), label: 'reps' },
                  { value: hm(duration), label: 'under load' },
                ]} />
              </div>
            )}
          </Section>
        )}

        {/* BALANCE — weekly sets per muscle group is the number that governs
            hypertrophy and the one a lifter can act on. The old card showed
            eight binary chips, which said trained/not and nothing else. */}
        {muscleRows.length > 0 && (
          <Section title="Balance" meta="sets per muscle group">
            <div className="space-y-2">
              {muscleRows.map(([group, count]) => {
                const light = count <= Math.max(2, maxSets * 0.3);
                return (
                  <div key={group} className="flex items-center gap-2">
                    <span className="text-xs text-foreground w-20 shrink-0 truncate">{group}</span>
                    <Bar pct={maxSets ? (count / maxSets) * 100 : 0} tone={light ? 'muted' : 'primary'} className="flex-1" />
                    <span className="font-heading font-bold text-[13px] tabular-nums text-foreground w-7 text-end">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* PROGRESSION */}
        {topLift?.name && (
          <Section title="Progression" meta="heaviest set · records">
            <div className="flex items-center justify-between gap-2 rounded-xl bg-secondary/40 border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-heading font-bold text-[15px] text-foreground truncate">{topLift.name}</p>
                <p className="text-xs text-muted-foreground">
                  {n0(topLift.weight)} lbs × {topLift.reps} reps
                </p>
              </div>
              {topLift.is_pr && (
                <span className="shrink-0 inline-flex items-center gap-1 text-micro font-bold uppercase tracking-wider text-primary border border-primary/50 rounded-full px-2 py-0.5">
                  <Trophy className="w-3 h-3" /> New PR
                </span>
              )}
            </div>
            {prCount > 0 && (
              <p className="text-micro text-muted-foreground mt-2">
                {prCount} personal record{prCount === 1 ? '' : 's'} this week.
              </p>
            )}
          </Section>
        )}

        {/* ── The one 32px seam on this screen: what you DID, above;
               everything that surrounds it, below. ── */}

        {/* CONDITIONING */}
        {hasCond && (
          <Section title="Conditioning" meta="cardio · steps" seam>
            {cardioN > 0 && (
              <StatRow items={[
                { value: n0(cardioN), label: `session${cardioN === 1 ? '' : 's'}` },
                { value: num(co.distance_m) > 0 ? `${n1(toDistance(co.distance_m, distanceUnit))} ${distanceUnit}` : null, label: 'distance' },
                { value: hm(co.duration_min), label: 'moving' },
              ]} />
            )}
            {steps > 0 && (
              <div className={cardioN > 0 ? 'mt-2 pt-2 border-t border-border' : undefined}>
                {/* The AVERAGE leads, not the total — the move Apple Health makes
                    on this exact screen, and the right one: a total is only
                    comparable against a week of identical length and identical
                    logging, an average is comparable against anything. Divided
                    by days LOGGED rather than by seven, for the same reason the
                    fuel section is: steps here are typed in by hand, so a day
                    with no row means "not recorded", not "did not move". */}
                <div className="flex items-end gap-2">
                  <span className="font-heading font-bold text-[15px] tabular-nums text-foreground">
                    {n0(num(steps) / Math.max(1, num(co.steps_days)))}
                  </span>
                  <span className="text-micro text-muted-foreground mb-px">steps / day</span>
                  {num(co.prev_steps) > 0 && (
                    <span className="ms-auto"><Delta pct={pctChange(steps, co.prev_steps)} /></span>
                  )}
                </div>

                {/* Seven daily bars, replacing a progress bar that measured how
                    many DAYS WERE LOGGED — it looked like progress toward a step
                    goal and was nothing of the kind. Heights are relative to the
                    week's own best day; a day with no data is a flat track, which
                    is visibly different from a day with few steps. */}
                {dailySteps && (
                  <div className="grid grid-cols-7 gap-1.5 mt-3">
                    {dailySteps.map((v, i) => {
                      const h = maxDay > 0 ? Math.max(2, (num(v) / maxDay) * 28) : 2;
                      return (
                        <div key={i}>
                          <div className="h-7 flex items-end">
                            <div
                              className={`w-full rounded-sm ${num(v) > 0 ? 'bg-primary' : 'bg-secondary'}`}
                              style={{ height: `${h}px` }}
                            />
                          </div>
                          <p className={`text-micro text-center mt-1 ${num(v) > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {dayLetters[i]}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="text-micro text-muted-foreground mt-2">
                  {n0(steps)} total · {n0(co.steps_days)} day{num(co.steps_days) === 1 ? '' : 's'} logged
                </p>
              </div>
            )}
          </Section>
        )}

        {/* FUEL — averaged per DAY LOGGED, not per seven. Dividing a 3-day
            week by 7 makes honest logging look like undereating. */}
        {hasFuel && (
          <Section title="Fuel" meta={`per day logged · ${n0(fuelDays)} of 7`} seam={!hasCond}>
            {num(fu.avg_calories) > 0 ? (
              <>
                <div className="flex items-end gap-2">
                  <span className="font-heading font-black text-3xl leading-none tabular-nums text-foreground">
                    {n0(fu.avg_calories)}
                  </span>
                  <span className="text-[13px] text-muted-foreground mb-0.5">kcal / day</span>
                </div>
                {/* Macros use the chart ramp, not the state hues — they need
                    mutual distinguishability, not state meaning (CLAUDE.md).
                    The whole block is behind a macro total, because macros are
                    optional on the food form: protein is set on 6 of 120
                    production rows. Without the gate, a week of calorie-only
                    logging drew an empty bar over three "0 g" labels, which
                    reads as a rendering failure rather than as "you logged
                    calories and not macros". */}
                {macroKcal > 0 ? (
                  <>
                    <div className="flex h-2 rounded-full overflow-hidden mt-3">
                      {[
                        ['bg-chart-1', num(fu.avg_protein) * 4],
                        ['bg-chart-2', num(fu.avg_carbs) * 4],
                        ['bg-chart-3', num(fu.avg_fat) * 9],
                      ].map(([cls, kcal], i) => (
                        <div key={i} className={cls} style={{ width: `${(kcal / macroKcal) * 100}%` }} />
                      ))}
                    </div>
                    <div className="grid grid-cols-3 mt-2">
                      {[
                        ['Protein', fu.avg_protein, 'bg-chart-1'],
                        ['Carbs',   fu.avg_carbs,   'bg-chart-2'],
                        ['Fat',     fu.avg_fat,     'bg-chart-3'],
                      ].map(([label, val, dot]) => (
                        <div key={label}>
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${dot}`} />
                            <span className="text-micro text-muted-foreground">{label}</span>
                          </span>
                          <p className="font-heading font-bold text-[13px] tabular-nums text-foreground">
                            {n0(val)} g
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-micro text-muted-foreground mt-2">
                    Calories logged without macros this week.
                  </p>
                )}
              </>
            ) : (
              <FactRow icon={Utensils} label={`Logged ${n0(fuelDays)} of 7 days`}
                       detail="No calorie totals on those entries" last />
            )}
          </Section>
        )}

        {/* RECOVERY */}
        {hasRecovery && (
          <Section title="Recovery" meta="sleep · mood · body" seam={!hasCond && !hasFuel}>
            {/* quality is set on 1 of 7 production rows and soreness on 0 of
                7 — both are optional fields on the sleep form, so they drop
                out individually rather than dashing out the whole row. */}
            {sleepNights > 0 && (
              <StatRow items={[
                { value: re.sleep_hours != null ? `${n1(re.sleep_hours)}h` : null, label: 'avg sleep' },
                { value: re.sleep_quality != null ? n1(re.sleep_quality) : null, label: 'sleep quality' },
                { value: re.soreness != null ? n1(re.soreness) : null, label: 'soreness' },
              ]} />
            )}
            <div className={sleepNights > 0 ? 'mt-2 pt-2 border-t border-border' : undefined}>
              {moodDays > 0 && (
                <FactRow icon={Moon} label="Mood" detail={`logged ${n0(moodDays)} day${moodDays === 1 ? '' : 's'}`}
                         value={`${n1(re.mood_avg)} / 5`} last={weightEnd == null} />
              )}
              {weightEnd != null && (
                <FactRow
                  icon={Target}
                  label="Body weight"
                  detail={re.weight_change != null && num(re.weight_change) !== 0
                    ? `${num(re.weight_change) > 0 ? '+' : ''}${n1(re.weight_change)} lbs this week`
                    : 'no change this week'}
                  value={`${n1(weightEnd)} lbs`}
                  last
                />
              )}
            </div>
          </Section>
        )}

        {/* THE GAME — XP comes from xp_grant_log, the authoritative ledger.
            The old card printed a number the client invented. */}
        <Section title="The game" meta="earned this week" seam={!hasCond && !hasFuel && !hasRecovery}>
          <div className="flex items-end gap-2">
            <span className="font-heading font-black text-3xl leading-none tabular-nums text-foreground">
              {n0(xp)}
            </span>
            <span className="text-[13px] text-muted-foreground mb-0.5">XP</span>
            {levelUp && (
              <span className="mb-0.5 ms-auto inline-flex items-center gap-1 text-micro font-bold text-primary">
                <Star className="w-3 h-3" /> Level {levelEnd}
              </span>
            )}
          </div>
          {levelEnd != null && !levelUp && (
            <p className="text-micro text-muted-foreground mt-1">Level {levelEnd}</p>
          )}
          {(num(ga.quests_done) > 0 || num(ga.coins) > 0 || num(ga.trophy_count) > 0) && (
            <div className="mt-2 pt-2 border-t border-border">
              <StatRow items={[
                { value: num(ga.quests_done)  > 0 ? n0(ga.quests_done)  : null, label: 'quests done' },
                { value: num(ga.coins)        > 0 ? n0(ga.coins)        : null, label: 'coins' },
                { value: num(ga.trophy_count) > 0 ? n0(ga.trophy_count) : null,
                  label: `troph${num(ga.trophy_count) === 1 ? 'y' : 'ies'}` },
              ]} />
            </div>
          )}
        </Section>

        {/* YOUR PEOPLE */}
        {hasPeople && (
          <Section title="Your people" meta="crew · duels · league">
            <div>
              {pe.crew_name && (
                <FactRow icon={Users} label={pe.crew_name}
                         detail={num(pe.crew_messages) > 0 ? `${n0(pe.crew_messages)} messages from you` : 'your crew'} />
              )}
              {num(pe.duels_played) > 0 && (
                <FactRow icon={Swords} label="Duels"
                         detail={`won ${n0(pe.duels_won)} of ${n0(pe.duels_played)}`}
                         value={`${num(pe.duels_won)}–${num(pe.duels_played) - num(pe.duels_won)}`} />
              )}
              {/* Gated on the league EXISTING, not on `rank`. league_members.rank
                  is NULL on all 42 production rows because it is only written
                  when the league resolves at week end — so gating on it hid the
                  league from every user for the entire week they were competing
                  in it, which is the only week it matters. Rank renders when
                  there is one; before that the weekly XP is the live number. */}
              {(pe.league_tier || pe.league_xp != null || pe.league_rank != null) && (
                <FactRow icon={Trophy}
                         label={pe.league_tier ? `${pe.league_tier} league` : 'League'}
                         detail={num(pe.league_days) > 0
                           ? `${n0(pe.league_days)} active days · ${n0(pe.league_xp)} weekly XP`
                           : `${n0(pe.league_xp)} weekly XP`}
                         value={pe.league_rank != null ? `#${pe.league_rank}` : null} />
              )}
              {num(pe.gym_days) > 0 && (
                <FactRow icon={Dumbbell} label="Gym check-ins"
                         detail="days you scanned in at your gym"
                         value={n0(pe.gym_days)} last />
              )}
            </div>
          </Section>
        )}

        {/* THE READ — without a sentence that names something specific from
            the week, everything above is a scoreboard rather than a review. */}
        {insight && (
          <div className="rounded-xl bg-secondary/40 border border-border px-3 py-3">
            <p className="text-micro font-bold uppercase tracking-widest text-primary mb-1">The read</p>
            <p className="text-[13px] text-foreground leading-relaxed">{insight}</p>
          </div>
        )}
      </div>
    </div>
  );
}
