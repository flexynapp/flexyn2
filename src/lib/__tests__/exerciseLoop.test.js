import { describe, it, expect } from 'vitest';
import { blendPose, canLoop, poseAt, REP_SECONDS } from '@/lib/exerciseLoop';
import { POSES } from '@/lib/data/exercisePoses';

describe('blendPose', () => {
  it('turns the short way round', () => {
    expect(blendPose({ torso: 350 }, { torso: 10 }, 0.5).torso).toBeCloseTo(360, 6);
  });
  it('blends points straight and keeps discrete fields', () => {
    const p = blendPose({ hip: [0, 100], armBend: 1, prop: 'bar' }, { hip: [10, 120], armBend: 1, prop: 'bar' }, 0.5);
    expect(p.hip).toEqual([5, 110]);
    expect(p.armBend).toBe(1);
    expect(p.prop).toBe('bar');
  });
});

describe('poseAt', () => {
  const frames = POSES['Bodyweight Squat'].frames;
  it('starts on the first frame and reaches the middle frame', () => {
    expect(poseAt(frames, 0).pose).toEqual(frames[0]);
    const bottom = poseAt(frames, 2.0);
    expect(bottom.pose.hip[1]).toBeCloseTo(frames[1].hip[1], 6);
  });
  it('lights up only during the pause at the bottom', () => {
    expect(poseAt(frames, 1).hold).toBe(false);
    expect(poseAt(frames, 2.1).hold).toBe(true);
    expect(poseAt(frames, 2.5).hold).toBe(false);
  });
  it('loops without a jump', () => {
    const end = poseAt(frames, REP_SECONDS - 0.0001).pose;
    const start = poseAt(frames, REP_SECONDS).pose;
    expect(end.hip[1]).toBeCloseTo(start.hip[1], 3);
  });
});

describe('canLoop', () => {
  it('loops most of the drawn exercises', () => {
    const names = Object.keys(POSES);
    const looping = names.filter((n) => canLoop(POSES[n].frames));
    expect(looping.length).toBeGreaterThanOrEqual(names.length - 4);
  });
  it('keeps the stills when the elbow flips direction between frames', () => {
    expect(canLoop(POSES['Overhead Press'].frames)).toBe(false);
  });
});
