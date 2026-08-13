// The reveal step had its hierarchy inverted. The 38px word-animated hero
// said "Welcome in, {name}." — ceremony, and the one thing on the screen the
// user already knew. The sentence under it, in text-sm text-muted-foreground,
// was the only earned data on the page: every value in it came from something
// the user answered across eleven steps. The payoff was rendered as the
// faintest type on the page and the greeting got the whole top of it.
//
// It also carried two badges asserting the same thing twelve lines apart —
// "Plan ready · 100%" (a hardcoded percentage with no progress behind it) and
// "● READY" in a fifth hue that exists nowhere else in the flow. The plan is
// visibly present; neither badge was information.
//
// Measured at 375×667 / 393×852 / 430×932 (one iframe per device, slack as
// clientHeight − last child's bottom, NOT scrollHeight): the swap returned
// 71.8px / 13.5px / 4.9px of vertical room, because the heading now rides
// --fluid-heading (24→30px) instead of a fixed 38px.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync('src/pages/Onboarding.jsx', 'utf8');
// Assert against the PARSED English catalog, not raw source text. The old
// form grepped i18n-onboarding.js for `'key': 'value'` and so was coupled to
// that file's quote style; a key lookup says what these tests actually mean.
const EN = JSON.parse(readFileSync('src/locales/en.json', 'utf8'));
const hasKey = (k) => Object.prototype.hasOwnProperty.call(EN, k);
const keysUnder = (p) => Object.keys(EN).filter((k) => k.startsWith(p));
const CSS = readFileSync('src/index.css', 'utf8');

function revealStep() {
  const start = SOURCE.indexOf('function RevealStep(');
  const end = SOURCE.indexOf('MAIN ONBOARDING ORCHESTRATOR', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe('reveal step', () => {
  it('has no "Plan ready · 100%" eyebrow', () => {
    // A hardcoded percentage is not a measurement. Nothing on this step ever
    // computed it, and it read as the loudest thing on the page.
    expect(revealStep()).not.toContain('reveal.ready');
    expect(hasKey('onboarding.reveal.ready')).toBe(false);
  });

  it('has no "● READY" badge', () => {
    // Same claim as the eyebrow, twelve lines lower, in emerald — the flow
    // spends four hues and this was a fifth, for a fact already on screen.
    const step = revealStep();
    expect(step).not.toContain('readyBadge');
    expect(step).not.toContain('text-emerald-500');
    expect(hasKey('onboarding.reveal.readyBadge')).toBe(false);
  });

  it('reduces planMeta to where the plan went', () => {
    // Three unrelated facts in 12px: the day count (already in the heading),
    // "tap a section to explore" (describing a chevron the user can see), and
    // the one thing in the entire flow that says where the plan was saved.
    const planMeta = EN['onboarding.reveal.planMeta'];
    expect(planMeta).toBeTruthy();
    expect(planMeta).not.toContain('days/week');
    expect(planMeta).not.toContain('{days}');
    expect(planMeta).toContain('Workout');
    // The {days} param went with it — a param the string no longer names.
    expect(revealStep()).not.toContain('{ days: daysCount || ');
  });

  it('makes the earned sentence the heading, not the greeting', () => {
    const step = revealStep();
    // The summary is the h1 and it rides the fluid scale rather than a fixed
    // px value, so it shrinks on a 667pt screen instead of overflowing it.
    const h1 = step.slice(step.indexOf('<motion.h1'), step.indexOf('</motion.h1>'));
    expect(h1).toContain("fontSize: 'var(--fluid-heading-sentence)'");
    expect(h1).toContain('onboarding.reveal.summary');
    // And nothing on the step is pinned to the old 38px hero size.
    expect(step).not.toContain('text-[38px]');
  });

  it('sizes the heading against WIDTH, so it holds three lines', () => {
    // This heading is a sentence, not a question, so its line count is set by
    // the column it wraps in — width — while every other --fluid-* clamps
    // against height. Sized by height it got the axis wrong and showed it:
    // the 393x852 iPhone 15 rendered 29px in a 345px column and took four
    // lines, while the WIDER 430px Pro Max took three at 30px.
    //
    // Ratio measured by sweeping 22→30px against each device's real content
    // width (device − 48px of .safe-page inset): the largest size holding the
    // long case to three lines is 26px at 327, 27px at 345, 30px+ at 382.
    // (100vw − 48px) / 12.9 → 25.4 / 26.8 / 29.6px, three lines on all three.
    expect(CSS).toContain('--fluid-heading-sentence:');
    const decl = CSS.slice(CSS.indexOf('--fluid-heading-sentence:'));
    const value = decl.slice(0, decl.indexOf(';'));
    expect(value).toMatch(/\d(\.\d+)?vw\b/);      // width, not height
    expect(value).not.toMatch(/\d(\.\d+)?vh\b/);
    // Same bounds the vertical scale used: never below the old floor, never
    // above what the design was drawn at.
    expect(value).toContain('24px');
    expect(value).toContain('30px');
    // The shared --fluid-heading stays height-based for the short question
    // headings on every other step; this is an addition, not a replacement.
    expect(CSS).toMatch(/--fluid-heading:\s*clamp\([^;]*vh/);
  });

  it('opens on the summary — no greeting line above it', () => {
    // "Welcome in, {name}." told the user their own name. Demoted to a 15px
    // muted line it was too small to be worth the row it cost, so the payoff
    // starts at the top of the page instead.
    const step = revealStep();
    expect(step).not.toContain('reveal.welcome');
    expect(step).not.toContain('reveal.defaultName');
    expect(hasKey('onboarding.reveal.welcome')).toBe(false);
    expect(hasKey('onboarding.reveal.defaultName')).toBe(false);
    // The heading is the first thing under the logo/coach bar.
    expect(step.indexOf('<motion.h1')).toBeLessThan(step.indexOf('<StarterPlanCoachCard'));
    expect(step.indexOf('<motion.h1')).toBeGreaterThan(step.indexOf('<RevealCoachButton'));
  });

  it('puts no title over the plan sections', () => {
    // Three lines used to stack above the sections: a "YOUR STARTER PLAN"
    // eyebrow, the regimen's own name ("Your Starter Plan — Build Strength"),
    // and the meta line. The first two named the plan the heading directly
    // above them had just described, in the user's own numbers. Only the
    // line saying where it was saved survives.
    const step = revealStep();
    expect(step).not.toContain('reveal.starterPlan');
    expect(step).not.toContain('reveal.planName');
    expect(step).not.toContain('previewRegimen?.name');
    expect(hasKey('onboarding.reveal.starterPlan')).toBe(false);
    expect(hasKey('onboarding.reveal.planName')).toBe(false);
    // planMeta is the block's only line of copy, and it sits directly on the
    // sections rather than under a title.
    const block = step.slice(step.indexOf('previewExercises.length > 0'));
    expect(block.indexOf('reveal.planMeta')).toBeLessThan(block.indexOf('<StarterPlanCoachCard'));
  });

  it('interpolates the summary rather than hardcoding the numbers', () => {
    // Every value here is the user's own answer. fillNodes exists so a
    // translator can move the slots — concatenating JSX would freeze English
    // word order into a sentence eleven other languages have to reorder.
    const step = revealStep();
    expect(step).toContain('fillNodes(');
    for (const slot of ['{weeks}', '{goal}', '{extra}', '{level}', '{days}']) {
      expect(step).toContain(slot);
    }
  });

  it('spends the accent on the answered values, not the prose', () => {
    // The point of the swap: the emphasis lands on what the user chose.
    const step = revealStep();
    const h1 = step.slice(step.indexOf('<motion.h1'), step.indexOf('</motion.h1>'));
    expect([...h1.matchAll(/className="text-primary"/g)].length).toBeGreaterThanOrEqual(4);
    expect(h1).toContain('text-foreground');
  });

  it('keeps the celebration and the exit', () => {
    // First plan, fires once — this is the one screen in onboarding where
    // confetti is earned. The CTA and its saving state stay put.
    const step = revealStep();
    expect(step).toContain('<Confetti');
    expect(step).toContain('onboarding.reveal.cta');
    expect(step).toContain('onboarding.reveal.saving');
    expect(step).toContain('<StarterPlanCoachCard');
  });

  it('hands the plan to the coach wrapper without letting it pick exercises', () => {
    // The reveal presents the plan as the AI Coach's suggestion, but the
    // regimen passed in is still the one buildStarterRegimen produced and
    // onboarding persists. If these ever diverge, the screen is advertising a
    // plan the user does not receive.
    const step = revealStep();
    const card = step.slice(step.indexOf('<StarterPlanCoachCard'), step.indexOf('/>', step.indexOf('<StarterPlanCoachCard')));
    expect(card).toContain('regimen={previewRegimen}');
    // The model's contribution is prose and nothing else.
    expect(card).toContain('coachReply=');
  });

  it('does not name the model on the payoff screen', () => {
    // "Written by Claude Haiku" sat under the coach's prose. Naming the
    // vendor makes the plan read as machine output at the exact moment it is
    // meant to read as something made for this person. (kegan, 2026-08-08)
    const card = readFileSync('src/components/onboarding/StarterPlanCoachCard.jsx', 'utf8');
    // The render body only — the file head deliberately records the removal
    // and the condition any future attribution has to meet.
    const body = card.slice(card.indexOf('export default function'));
    expect(body).not.toContain('Written by');
    expect(card).not.toContain('modelLabel');
    expect(revealStep()).not.toContain('coachModel');
  });
});
