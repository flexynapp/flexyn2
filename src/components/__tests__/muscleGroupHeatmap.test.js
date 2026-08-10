import { describe, it, expect } from 'vitest';
import { buildMuscles } from '@/components/progress/MuscleGroupHeatmap';
import { EXERCISE_LIBRARY } from '@/components/regimens/ExerciseAutocomplete';

/* The Body page's heat map reads workout_logs.exercises, and THREE
   different writers fill that field with three different vocabularies:

     ExerciseAutocomplete (the exercise library)  'Chest'  'Legs'
     aiCoach/workoutGenerator (every Coach session) 'chest'  'legs'  'arms'
     aiCoach/planBuilder                            'Quads'

   Only the first was recognised, and an unrecognised name was dropped
   rather than raised — so a Coach-generated session logged perfectly,
   earned its XP, and then contributed nothing at all to this map. These
   tests pin the normalisation, because the failure mode is silence: with
   it broken every assertion about rendering still passes and the map
   simply reports the user did not train. */

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const log = (exercises, daysAgo = 1) => ({ date: day(daysAgo), exercises });
const ex = (name, groups, sets = [{ weight: 100, reps: 10 }]) => ({
  name, muscle_groups: groups, sets,
});

describe('buildMuscles — muscle-group vocabulary', () => {
  it('credits the capitalised names the exercise library writes', () => {
    const m = buildMuscles([log([ex('Bench Press', ['Chest', 'Triceps'])])], 30);
    expect(m.chest.sets).toBe(1);
    expect(m.triceps.sets).toBe(1);
    expect(m.quads.sets).toBe(0);
  });

  it('credits the LOWERCASE names the AI Coach generator writes', () => {
    const m = buildMuscles([log([ex('Back Squat', ['legs'])])], 30);
    expect(m.quads.sets).toBe(1);
    expect(m.hamstrings.sets).toBe(1);
    expect(m.calves.sets).toBe(1);
    expect(m.chest.sets).toBe(0);
  });

  it("maps the Coach's 'arms' onto both arm muscles", () => {
    const m = buildMuscles([log([ex('Barbell Curl', ['arms'])])], 30);
    expect(m.biceps.sets).toBe(1);
    expect(m.triceps.sets).toBe(1);
    expect(m.forearms.sets).toBe(0);
  });

  it("maps planBuilder's fine names onto their coarse group", () => {
    const m = buildMuscles([log([ex('Leg Press', ['Quads'])])], 30);
    expect(m.quads.sets).toBe(1);
  });

  it("spreads 'Full Body' across every group — clean and snatch train everything", () => {
    const m = buildMuscles([log([ex('Clean and Jerk', ['Full Body'])])], 30);
    expect(m.chest.sets).toBe(1);
    expect(m.glutes.sets).toBe(1);
    expect(m.calves.sets).toBe(1);
  });

  it('ignores a name it does not recognise rather than throwing', () => {
    const m = buildMuscles([log([ex('Treadmill', ['Cardio'])])], 30);
    expect(Object.values(m).every((x) => x.sets === 0)).toBe(true);
  });

  /* Dedicated grip work credits forearms, not the back. Every exercise in
     the library's "Forearms & Grip" section was tagged 'Back', so three
     sets of wrist curls used to mark the lats and lower back as trained
     and leave the forearms cold. */
  it('credits forearms for dedicated grip work, and not the back', () => {
    const wristCurl = EXERCISE_LIBRARY.find((e) => e.name === 'Barbell Wrist Curl');
    const m = buildMuscles([log([ex(wristCurl.name, wristCurl.muscles)])], 30);
    expect(m.forearms.sets).toBe(1);
    expect(m.lats.sets).toBe(0);
    expect(m.lowerback.sets).toBe(0);
  });

  /* No region may depend on Olympic lifting to exist.
     The naive form of this test — log the whole library, assert nothing is
     cold — PASSES against the bug it was written for, which is why it is
     written this way instead. 'Full Body' spreads across all nine coarse
     groups, so the 21 cleans and snatches lit the forearms all by
     themselves and hid the fact that no grip exercise did. Excluding them
     is what exposes a region the library cannot otherwise fill: for anyone
     who does not clean or snatch, that region is dead. */
  it('fills every muscle on the figure without relying on the Olympic lifts', () => {
    const noOlympic = EXERCISE_LIBRARY
      .filter((e) => !e.muscles.includes('Full Body'))
      .map((e) => ex(e.name, e.muscles));
    const m = buildMuscles([log(noOlympic)], 30);
    const cold = Object.keys(m).filter((k) => m[k].sets === 0);
    expect(cold, 'drawn on the figure, but only a clean or snatch can light it').toEqual([]);
  });
});

describe('buildMuscles — double counting and fallbacks', () => {
  it('does not credit one exercise twice when two names collapse to one group', () => {
    const both = buildMuscles([log([ex('Squat', ['Legs', 'Quads'])])], 30);
    const one = buildMuscles([log([ex('Squat', ['Legs'])])], 30);
    expect(both.quads.sets).toBe(one.quads.sets);
    expect(both.quads.vol).toBe(one.quads.vol);
  });

  it('falls back to the legacy muscle_group when muscle_groups is an EMPTY array', () => {
    // `[]` is truthy, so an `||` fallback never fires — several writers
    // emit exactly this shape and the whole exercise used to vanish.
    const m = buildMuscles([log([{
      name: 'Bench Press', muscle_groups: [], muscle_group: 'Chest',
      sets: [{ weight: 135, reps: 5 }],
    }])], 30);
    expect(m.chest.sets).toBe(1);
    expect(m.chest.vol).toBe(675);
  });

  it('drops sets with neither weight nor reps', () => {
    const m = buildMuscles([log([ex('Plank', ['Core'], [{ weight: 0, reps: 0 }])])], 30);
    expect(m.abs.sets).toBe(0);
  });
});

describe('buildMuscles — recovery vs the selected window', () => {
  it('reads an untrained muscle as fully recovered, not as zero', () => {
    const m = buildMuscles([], 30);
    expect(m.chest.recovery).toBe(100);
    expect(m.chest.last).toBeNull();
  });

  it('measures recovery all-time even when the log is outside the window', () => {
    // Recovery is a "right now" fact: a chest session 10 days ago still
    // means the chest is rested, whichever range tab is showing. Volume
    // and sets, by contrast, only count inside the window.
    const m = buildMuscles([log([ex('Bench Press', ['Chest'])], 10)], 7);
    expect(m.chest.last).toBe(10);
    expect(m.chest.recovery).toBe(100);
    expect(m.chest.sets).toBe(0);
  });

  it('reads a just-trained large muscle as needing rest', () => {
    const m = buildMuscles([log([ex('Back Squat', ['Legs'])], 0)], 30);
    expect(m.quads.recovery).toBe(0);
  });
});
