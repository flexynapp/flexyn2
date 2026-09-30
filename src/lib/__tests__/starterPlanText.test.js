// The starter plan's words are rendered from structure at display time. Every
// assertion here runs through a translator that IGNORES the English fallback
// and interpolates its own template, because the usual `(key, en) => en` stub
// returns the pre-interpolated English and passes whether or not the vars
// reached the translation (CLAUDE.md, i18n discipline).
import { describe, it, expect } from 'vitest';
import {
  cardioSessionName, cardioSessionDetail, cardioSessionSummary,
  starterPlanName, starterPlanDescription, isStarterPlanName,
} from '@/lib/starterPlanText';

const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
// A fake "translation": the key plus its vars, never the English.
const XX = {
  'starterPlan.run.easy': 'XX:facil',
  'starterPlan.run.interval': 'XX:series',
  'starterPlan.run.distance': 'XX:{distance}|{unit}',
  'starterPlan.run.distancePace': 'XX:{distance}|{unit}|{pace}',
  'starterPlan.run.minutesPace': 'XX:{minutes}min|{pace}|{unit}',
  'starterPlan.run.repsTime': 'XX:{reps}x{rep}|{time}',
  'starterPlan.run.reps': 'XX:{reps}x{rep}',
  'starterPlan.cue.easy': 'XX:charla',
  'starterPlan.cue.tempo': 'XX:duro',
  'starterPlan.cue.recovery': 'XX:recup',
  'starterPlan.cue.hardRecovery': 'XX:durorecup',
  'starterPlan.name': 'XX:plan|{goal}',
  'starterPlan.goal.strength': 'XX:fuerza',
  'workout.starter.level.consistent': 'XX:constante',
  'workout.starter.daysPerWeek': 'XX:{n}/sem',
  'starterPlan.desc.minutes': 'XX:{n}m',
  'starterPlan.desc.auto': 'XX:auto',
};
const tf = (key, _english, vars) => (key in XX ? fill(XX[key], vars) : `MISSING:${key}`);

const easy = { kind: 'cardio', session: 'easy', sessionParams: { unit: 'km', distance: 4.5, pace: '5:47' },
  displayName: 'Easy Run', detail: '4.5 km @ 5:47/km · conversational pace' };

describe('cardio session text', () => {
  it('names a run from its session id', () => {
    expect(cardioSessionName(easy, tf)).toBe('XX:facil');
  });

  it('passes every var into the translation', () => {
    expect(cardioSessionDetail(easy, tf, 'en')).toBe('XX:4.5|km|5:47 · XX:charla');
    expect(cardioSessionSummary(easy, tf, 'en')).toBe('XX:4.5|km|5:47');
  });

  it('formats the distance for the language', () => {
    expect(cardioSessionSummary(easy, tf, 'es')).toBe('XX:4,5|km|5:47');
  });

  it('drops the pace when the plan had no 5K time', () => {
    const ex = { ...easy, sessionParams: { unit: 'mi', distance: 3, pace: null } };
    expect(cardioSessionSummary(ex, tf)).toBe('XX:3|mi');
  });

  it('renders tempo and interval runs', () => {
    const tempo = { session: 'tempo', sessionParams: { unit: 'km', minutes: 15, pace: '5:16' } };
    expect(cardioSessionDetail(tempo, tf)).toBe('XX:15min|5:16|km · XX:duro');
    const reps = { session: 'interval', sessionParams: { unit: 'km', reps: 6, repMeters: 400, repTime: '2:00' } };
    expect(cardioSessionDetail(reps, tf)).toBe('XX:6x400 m|2:00 · XX:recup');
    const mile = { session: 'interval', sessionParams: { unit: 'mi', reps: 4, repMeters: 1609, repTime: null } };
    expect(cardioSessionDetail(mile, tf)).toBe('XX:4x1 mi · XX:durorecup');
    const metricMile = { session: 'interval', sessionParams: { unit: 'km', reps: 4, repMeters: 1609, repTime: null } };
    expect(cardioSessionDetail(metricMile, tf, 'fr')).toBe('XX:4x1,6 km · XX:durorecup');
  });

  it('falls back to the stored English on a row made before the structure existed', () => {
    const old = { kind: 'cardio', displayName: 'Easy Run', detail: '2.5 mi @ 8:05/mi · conversational pace' };
    expect(cardioSessionName(old, tf)).toBe('Easy Run');
    expect(cardioSessionDetail(old, tf)).toBe('2.5 mi @ 8:05/mi · conversational pace');
    expect(cardioSessionSummary(old, tf)).toBe('2.5 mi @ 8:05/mi');
  });

  it('works with no translator at all, in English', () => {
    expect(cardioSessionDetail(easy)).toBe('4.5 km @ 5:47/km · conversational pace');
  });
});

describe('starter plan name and description', () => {
  it('translates the name without touching the stored prefix', () => {
    expect(isStarterPlanName('Your Starter Plan: Build Strength')).toBe(true);
    expect(starterPlanName('Your Starter Plan: Build Strength', tf)).toBe('XX:plan|XX:fuerza');
  });

  it('leaves any other regimen name alone', () => {
    expect(starterPlanName('Push Day', tf)).toBe('Push Day');
  });

  it('translates the description piece by piece, passing unknown pieces through', () => {
    expect(starterPlanDescription('consistent · 3×/week · 45 min · my note · auto-generated from onboarding', tf))
      .toBe('XX:constante · XX:3/sem · XX:45m · my note · XX:auto');
  });
});
