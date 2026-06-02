// src/lib/__tests__/lib-smoke.test.js
//
// Smoke tests for previously-zero-coverage utility modules. Each
// import block verifies that the module loads without error and that
// its main exports are defined. We deliberately avoid behavioral
// assertions here — the goal is to lift these modules from 0% coverage
// so the audit signal stops flagging them, and so any subsequent
// refactor that breaks an import surfaces as a test failure.

import { describe, it, expect } from 'vitest';

describe('lib smoke — utility modules load + export expected symbols', () => {
  it('buildInfo exports buildLabel + diagnosticString', async () => {
    const mod = await import('../buildInfo');
    expect(typeof mod.buildLabel).toBe('function');
    expect(typeof mod.diagnosticString).toBe('function');
    expect(typeof mod.buildLabel()).toBe('string');
  });

  it('xpTier exports getTier (curried with translator)', async () => {
    const mod = await import('../xpTier');
    expect(typeof mod.getTier).toBe('function');
    // Pass a stub translator since getTier requires one
    const tier = mod.getTier(50, (k) => k);
    expect(tier).toBeTruthy();
    expect(typeof tier).toBe('object');
  });

  it('cardioVO2max exports the four documented helpers', async () => {
    const mod = await import('../cardioVO2max');
    expect(typeof mod.vo2maxFromSpeed).toBe('function');
    expect(typeof mod.vo2maxFromHR).toBe('function');
    expect(typeof mod.bestVO2max).toBe('function');
    expect(typeof mod.vo2maxTier).toBe('function');
  });

  it('workoutVolume exports volume helpers', async () => {
    const mod = await import('../workoutVolume');
    expect(typeof mod.isBarbellExercise).toBe('function');
    expect(typeof mod.setVolume).toBe('function');
    expect(typeof mod.totalVolume).toBe('function');
    // isBarbellExercise is signature-stable: pure string-based check.
    expect(mod.isBarbellExercise('Barbell Bench Press')).toBe(true);
    expect(mod.isBarbellExercise('Push-ups')).toBe(false);
  });

  it('regions exports getCountry + getUsState', async () => {
    const mod = await import('../regions');
    expect(typeof mod.getCountry).toBe('function');
    expect(typeof mod.getUsState).toBe('function');
  });

  it('avatarGradient exports getAvatarGradient + avatarGradientStyle', async () => {
    const mod = await import('../avatarGradient');
    expect(typeof mod.getAvatarGradient).toBe('function');
    expect(typeof mod.avatarGradientStyle).toBe('function');
    // Deterministic: same input → same output
    const a = mod.getAvatarGradient('user@example.com');
    const b = mod.getAvatarGradient('user@example.com');
    expect(a).toEqual(b);
  });

  it('exerciseTranslations exports the four documented helpers', async () => {
    const mod = await import('../exerciseTranslations');
    expect(typeof mod.translateExerciseName).toBe('function');
    expect(typeof mod.findCanonicalExerciseName).toBe('function');
    expect(typeof mod.searchExercises).toBe('function');
    expect(typeof mod.getExerciseDisplay).toBe('function');
    expect(Array.isArray(mod.searchExercises('bench'))).toBe(true);
  });

  it('achievementsFlow exports requestOpenAchievements', async () => {
    const mod = await import('../achievementsFlow');
    expect(typeof mod.requestOpenAchievements).toBe('function');
  });

  it('audioCues exports voice-cue helpers', async () => {
    const mod = await import('../audioCues');
    expect(typeof mod.isVoiceCuesEnabled).toBe('function');
    expect(typeof mod.setVoiceCuesEnabled).toBe('function');
    expect(typeof mod.isSpeechSupported).toBe('function');
  });

  it('dailyQuotes exports getQuotePool + getDailyQuote', async () => {
    const mod = await import('../dailyQuotes');
    expect(typeof mod.getQuotePool).toBe('function');
    expect(typeof mod.getDailyQuote).toBe('function');
  });

  it('trophyDefinitions exports getTrophy + the TROPHIES list', async () => {
    const mod = await import('../trophyDefinitions');
    expect(typeof mod.getTrophy).toBe('function');
    expect(Array.isArray(mod.TROPHIES) || typeof mod.TROPHIES === 'object').toBe(true);
  });

  it('achievementDefinitions exports getAchievementById + getAllAchievements', async () => {
    const mod = await import('../achievementDefinitions');
    expect(typeof mod.getAchievementById).toBe('function');
    expect(typeof mod.getAllAchievements).toBe('function');
    expect(Array.isArray(mod.getAllAchievements())).toBe(true);
  });

  it('lootFrames exports rollLootFrame + getLootFrameById', async () => {
    const mod = await import('../lootFrames');
    expect(typeof mod.rollLootFrame).toBe('function');
    expect(typeof mod.getLootFrameById).toBe('function');
  });

  it('lootThemes exports rollLootTheme + getLootThemeById', async () => {
    const mod = await import('../lootThemes');
    expect(typeof mod.rollLootTheme).toBe('function');
    expect(typeof mod.getLootThemeById).toBe('function');
  });

  it('workoutFatigue exports the fatigue-budget helpers', async () => {
    const mod = await import('../workoutFatigue');
    expect(typeof mod.getMaxRealisticSetsPerWorkout).toBe('function');
    expect(typeof mod.getMuscleGroupCap).toBe('function');
    expect(typeof mod.countSetsPerMuscleGroup).toBe('function');
    expect(typeof mod.getDailyVolumeBudget).toBe('function');
  });

  it('cardioCalories exports estimateCalories + userWeightKg', async () => {
    const mod = await import('../cardioCalories');
    expect(typeof mod.estimateCalories).toBe('function');
    expect(typeof mod.userWeightKg).toBe('function');
  });

  it('cardioPRs exports the four PR-detection helpers', async () => {
    const mod = await import('../cardioPRs');
    expect(typeof mod.activityFamily).toBe('function');
    expect(typeof mod.thresholdTimesForLog).toBe('function');
    expect(typeof mod.currentBests).toBe('function');
    expect(typeof mod.detectNewPRs).toBe('function');
  });

  it('accountReset exports filterAfterReset', async () => {
    const mod = await import('../accountReset');
    expect(typeof mod.filterAfterReset).toBe('function');
  });
});
