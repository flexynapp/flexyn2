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
const I18N = readFileSync('src/lib/i18n-onboarding.js', 'utf8');

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
    expect(I18N).not.toContain("'onboarding.reveal.ready'");
  });

  it('has no "● READY" badge', () => {
    // Same claim as the eyebrow, twelve lines lower, in emerald — the flow
    // spends four hues and this was a fifth, for a fact already on screen.
    const step = revealStep();
    expect(step).not.toContain('readyBadge');
    expect(step).not.toContain('text-emerald-500');
    expect(I18N).not.toContain("'onboarding.reveal.readyBadge'");
  });

  it('reduces planMeta to where the plan went', () => {
    // Three unrelated facts in 12px: the day count (already in the heading),
    // "tap a section to explore" (describing a chevron the user can see), and
    // the one thing in the entire flow that says where the plan was saved.
    const planMeta = I18N.match(/'onboarding\.reveal\.planMeta':\s*'([^']*)'/);
    expect(planMeta).not.toBeNull();
    expect(planMeta[1]).not.toContain('days/week');
    expect(planMeta[1]).not.toContain('{days}');
    expect(planMeta[1]).toContain('Workout');
    // The {days} param went with it — a param the string no longer names.
    expect(revealStep()).not.toContain('{ days: daysCount || ');
  });

  it('makes the earned sentence the heading, not the greeting', () => {
    const step = revealStep();
    // The summary is the h1 and it rides the fluid scale rather than a fixed
    // px value, so it shrinks on a 667pt screen instead of overflowing it.
    const h1 = step.slice(step.indexOf('<motion.h1'), step.indexOf('</motion.h1>'));
    expect(h1).toContain("fontSize: 'var(--fluid-heading)'");
    expect(h1).toContain('onboarding.reveal.summary');
    // And nothing on the step is pinned to the old 38px hero size.
    expect(step).not.toContain('text-[38px]');
  });

  it('opens on the summary — no greeting line above it', () => {
    // "Welcome in, {name}." told the user their own name. Demoted to a 15px
    // muted line it was too small to be worth the row it cost, so the payoff
    // starts at the top of the page instead.
    const step = revealStep();
    expect(step).not.toContain('reveal.welcome');
    expect(step).not.toContain('reveal.defaultName');
    expect(I18N).not.toContain("'onboarding.reveal.welcome'");
    expect(I18N).not.toContain("'onboarding.reveal.defaultName'");
    // The heading is the first thing under the logo/coach bar.
    expect(step.indexOf('<motion.h1')).toBeLessThan(step.indexOf('<StarterPlanView'));
    expect(step.indexOf('<motion.h1')).toBeGreaterThan(step.indexOf('<RevealCoachButton'));
  });

  it('has no "YOUR STARTER PLAN" eyebrow over the plan name', () => {
    // The plan's own name sits one line below it, larger, and reads "Your
    // Starter Plan — Build Strength". A label directly above the thing it
    // labels, in the same words, is not a label.
    const step = revealStep();
    expect(step).not.toContain('reveal.starterPlan');
    expect(I18N).not.toContain("'onboarding.reveal.starterPlan'");
    // planName is still the fallback for a regimen that arrives unnamed.
    expect(step).toContain('onboarding.reveal.planName');
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
    expect(step).toContain('<StarterPlanView');
  });
});
