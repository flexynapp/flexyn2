import { describe, it, expect } from 'vitest';
import {
  distance,
  midpoint,
  angleAt,
  angleFromVertical,
  ifConfident,
  bodyDetectionScore,
  landmarksToMap,
  POSE_LANDMARK_INDEX,
  bestSide,
} from '../formCoach/geometry';
import {
  analyzeSquat,
  analyzeDeadlift,
  analyzeBench,
  analyzePushup,
  analyzePullup,
  analyzeOhp,
  analyzeGeneric,
  routeAnalyzer,
} from '../formCoach/rules';

// ─── Geometry ─────────────────────────────────────────────────────────────────

describe('distance', () => {
  it('returns euclidean distance between two points', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it('returns 0 for the same point', () => {
    expect(distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });
  it('returns null on missing inputs', () => {
    expect(distance(null, { x: 0, y: 0 })).toBeNull();
    expect(distance({ x: 0, y: 0 }, null)).toBeNull();
  });
});

describe('midpoint', () => {
  it('returns the midpoint', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
});

describe('angleAt', () => {
  // Standing leg straight: hip above knee above ankle → 180°
  it('returns ~180° for collinear points', () => {
    const a = angleAt({ x: 100, y: 100 }, { x: 100, y: 200 }, { x: 100, y: 300 });
    expect(a).toBeCloseTo(180, 1);
  });

  it('returns 90° for a right angle', () => {
    const a = angleAt({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 });
    expect(a).toBeCloseTo(90, 1);
  });

  it('returns null on missing inputs', () => {
    expect(angleAt(null, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe('angleFromVertical', () => {
  it('returns 0° for a perfectly vertical line', () => {
    expect(angleFromVertical({ x: 100, y: 0 }, { x: 100, y: 200 })).toBeCloseTo(0, 1);
  });
  it('returns 90° for a perfectly horizontal line', () => {
    expect(angleFromVertical({ x: 0, y: 100 }, { x: 200, y: 100 })).toBeCloseTo(90, 1);
  });
  it('returns 45° for a diagonal', () => {
    expect(angleFromVertical({ x: 0, y: 0 }, { x: 100, y: 100 })).toBeCloseTo(45, 1);
  });
});

describe('ifConfident', () => {
  it('returns the keypoint when score meets threshold', () => {
    const kp = { x: 1, y: 2, score: 0.5 };
    expect(ifConfident(kp, 0.3)).toBe(kp);
  });
  it('returns null below threshold', () => {
    expect(ifConfident({ x: 1, y: 2, score: 0.1 }, 0.3)).toBeNull();
  });
  it('handles null safely', () => {
    expect(ifConfident(null, 0.3)).toBeNull();
  });
});

describe('landmarksToMap', () => {
  // A 33-landmark MediaPipe pose where landmark i sits at (i/100, i/50).
  const landmarks = Array.from({ length: 33 }, (_, i) => ({
    x: i / 100, y: i / 50, z: 0, visibility: 0.9,
  }));

  it('names the 17 MoveNet joints from MediaPipe indices', () => {
    const map = landmarksToMap(landmarks);
    expect(Object.keys(map).sort()).toEqual(Object.keys(POSE_LANDMARK_INDEX).sort());
    expect(Object.keys(map)).toHaveLength(17);
  });

  it('uses the documented MediaPipe indices for the joints the rules read', () => {
    expect(POSE_LANDMARK_INDEX).toMatchObject({
      nose: 0,
      left_shoulder: 11, right_shoulder: 12,
      left_elbow: 13, right_elbow: 14,
      left_wrist: 15, right_wrist: 16,
      left_hip: 23, right_hip: 24,
      left_knee: 25, right_knee: 26,
      left_ankle: 27, right_ankle: 28,
    });
  });

  it('scales normalised coordinates to pixels and maps visibility to score', () => {
    const map = landmarksToMap(landmarks, 200, 100);
    // left_hip is landmark 23: (0.23, 0.46) → (46, 46)
    expect(map.left_hip.x).toBeCloseTo(46);
    expect(map.left_hip.y).toBeCloseTo(46);
    expect(map.left_hip.score).toBe(0.9);
  });

  it('treats a missing visibility as zero confidence, not full', () => {
    const map = landmarksToMap([{ x: 0.5, y: 0.5 }]);
    expect(map.nose.score).toBe(0);
  });

  it('zeroes the score of a joint MediaPipe placed outside the image', () => {
    // Measured on a close-up push-up: a knee at x = -35px with visibility 0.5.
    const lm = [{ x: -0.055, y: 0.5, visibility: 0.5 }];
    expect(landmarksToMap(lm, 640, 427).nose.score).toBe(0);
    // Just inside the 2% margin still counts.
    expect(landmarksToMap([{ x: 1.01, y: 0.5, visibility: 0.9 }]).nose.score).toBe(0.9);
  });

  it('handles undefined input', () => {
    expect(landmarksToMap()).toEqual({});
  });
});

describe('bodyDetectionScore', () => {
  it('returns 0 for empty keypoints', () => {
    expect(bodyDetectionScore({})).toBe(0);
  });

  it('returns the average confidence across major joints', () => {
    const kp = {
      left_shoulder:  { score: 1 }, right_shoulder: { score: 1 },
      left_elbow:     { score: 1 }, right_elbow:    { score: 1 },
      left_wrist:     { score: 1 }, right_wrist:    { score: 1 },
      left_hip:       { score: 1 }, right_hip:      { score: 1 },
      left_knee:      { score: 1 }, right_knee:     { score: 1 },
      left_ankle:     { score: 1 }, right_ankle:    { score: 1 },
    };
    expect(bodyDetectionScore(kp)).toBe(1);
  });

  it('partial detection lowers the score', () => {
    const kp = {
      left_shoulder: { score: 0.5 }, right_shoulder: { score: 0.5 },
      left_hip:      { score: 0.5 }, right_hip:      { score: 0.5 },
    };
    expect(bodyDetectionScore(kp)).toBeCloseTo(0.5, 2);
  });
});

describe('bestSide', () => {
  it('picks the side with higher visibility', () => {
    const kp = {
      left_shoulder:  { x: 1, y: 1, score: 0.3 },
      right_shoulder: { x: 2, y: 2, score: 0.9 },
    };
    const r = bestSide(kp, 'left_shoulder', 'right_shoulder');
    expect(r.side).toBe('right');
    expect(r.kp.x).toBe(2);
  });

  it('falls back to whichever side exists', () => {
    const kp = { left_shoulder: { x: 1, y: 1, score: 0.5 } };
    const r = bestSide(kp, 'left_shoulder', 'right_shoulder');
    expect(r.side).toBe('left');
  });

  it('returns null when neither side exists', () => {
    expect(bestSide({}, 'left_x', 'right_x')).toBeNull();
  });
});

// ─── Rule analyzers — synthetic poses ─────────────────────────────────────────

/**
 * Build a fake side-on squat keypoint map.
 * @param {object} opts
 * @param {number} opts.kneeAngle — interior knee angle in degrees
 * @param {number} opts.torsoLean — torso lean from vertical, degrees
 */
function fakeSquatPose({ kneeAngle = 90, torsoLean = 20 } = {}) {
  // Shoulder, hip, knee, ankle on a 2D side view (x: forward, y: down)
  const hip   = { x: 200, y: 200, score: 0.9 };
  // Torso: lean from vertical of `torsoLean` degrees
  const torsoRad = (torsoLean * Math.PI) / 180;
  const shoulder = {
    x: hip.x - Math.sin(torsoRad) * 100,
    y: hip.y - Math.cos(torsoRad) * 100,
    score: 0.9,
  };
  // Knee placed in front of hip (forward-flexed leg)
  const knee = { x: hip.x + 60, y: hip.y + 70, score: 0.9 };
  // Ankle at angle that produces target knee angle
  const halfA = (kneeAngle * Math.PI) / 180 / 2;
  const len = 90;
  const ankle = {
    x: knee.x - Math.cos(halfA) * len * 0.2,
    y: knee.y + Math.sin(halfA) * len + len * 0.3,
    score: 0.9,
  };
  return {
    left_shoulder: shoulder, right_shoulder: shoulder,
    left_hip:      hip,      right_hip:      hip,
    left_knee:     knee,     right_knee:     knee,
    left_ankle:    ankle,    right_ankle:    ankle,
  };
}

describe('analyzeSquat', () => {
  it('returns a feedback object with the expected shape', () => {
    const result = analyzeSquat(fakeSquatPose({ kneeAngle: 85 }));
    expect(result).toHaveProperty('overall_score');
    expect(result).toHaveProperty('form_rating');
    expect(result).toHaveProperty('good_points');
    expect(result).toHaveProperty('corrections');
    expect(result).toHaveProperty('injury_risks');
    expect(result).toHaveProperty('tip');
    expect(typeof result.overall_score).toBe('number');
    expect(result.overall_score).toBeGreaterThanOrEqual(0);
    expect(result.overall_score).toBeLessThanOrEqual(10);
  });

  it('flags shallow squats (knee >> 100°)', () => {
    const result = analyzeSquat(fakeSquatPose({ kneeAngle: 140 }));
    expect(result.corrections.some(c => /deeper/i.test(c))).toBe(true);
  });

  it('flags excessive forward lean as both correction and injury risk at extreme', () => {
    const result = analyzeSquat(fakeSquatPose({ kneeAngle: 90, torsoLean: 70 }));
    expect(result.corrections.some(c => /lean/i.test(c))).toBe(true);
    expect(result.injury_risks.some(r => /back/i.test(r))).toBe(true);
  });

  it('returns a low score with helpful copy when no body is detected', () => {
    const result = analyzeSquat({});
    expect(result.overall_score).toBeLessThanOrEqual(5);
    expect(result.corrections.length).toBeGreaterThan(0);
  });
});

describe('analyzeDeadlift / analyzeBench / analyzePushup / analyzePullup / analyzeOhp', () => {
  it('all return a valid feedback shape from an empty pose (no_body fallback)', () => {
    [analyzeDeadlift, analyzeBench, analyzePushup, analyzePullup, analyzeOhp].forEach(fn => {
      const result = fn({});
      expect(result.overall_score).toBeGreaterThanOrEqual(0);
      expect(result.overall_score).toBeLessThanOrEqual(10);
      expect(typeof result.form_rating).toBe('string');
      expect(Array.isArray(result.good_points)).toBe(true);
      expect(Array.isArray(result.corrections)).toBe(true);
      expect(Array.isArray(result.injury_risks)).toBe(true);
    });
  });
});

describe('analyzeGeneric', () => {
  it('mentions the unsupported exercise name', () => {
    const result = analyzeGeneric({}, 'Romanian Deadlift');
    expect(result.corrections.some(c => /romanian deadlift/i.test(c))).toBe(true);
  });
});

describe('routeAnalyzer', () => {
  it('routes squat variants to the squat analyzer', () => {
    expect(routeAnalyzer('Squat')).toBe(analyzeSquat);
    expect(routeAnalyzer('Back Squat')).toBe(analyzeSquat);
    expect(routeAnalyzer('Front Squat')).toBe(analyzeSquat);
  });

  it('routes deadlift variants to the deadlift analyzer', () => {
    expect(routeAnalyzer('Deadlift')).toBe(analyzeDeadlift);
    expect(routeAnalyzer('Sumo Deadlift')).toBe(analyzeDeadlift);
  });

  it('routes bench variants to the bench analyzer', () => {
    expect(routeAnalyzer('Bench')).toBe(analyzeBench);
    expect(routeAnalyzer('Bench Press')).toBe(analyzeBench);
    expect(routeAnalyzer('Incline Bench Press')).toBe(analyzeBench);
  });

  it('routes push-up variants', () => {
    expect(routeAnalyzer('Push-up')).toBe(analyzePushup);
    expect(routeAnalyzer('Push Up')).toBe(analyzePushup);
    expect(routeAnalyzer('Pushup')).toBe(analyzePushup);
  });

  it('routes pull-up + chin-up variants', () => {
    expect(routeAnalyzer('Pull-up')).toBe(analyzePullup);
    expect(routeAnalyzer('Pullup')).toBe(analyzePullup);
    expect(routeAnalyzer('Chin-up')).toBe(analyzePullup);
  });

  it('routes overhead press variants', () => {
    expect(routeAnalyzer('Overhead Press')).toBe(analyzeOhp);
    expect(routeAnalyzer('OHP')).toBe(analyzeOhp);
    expect(routeAnalyzer('Shoulder Press')).toBe(analyzeOhp);
  });

  it('falls through to the generic analyzer for unknown exercises', () => {
    const fn = routeAnalyzer('Snatch');
    expect(typeof fn).toBe('function');
    // Generic analyzer takes the keypoints and returns a result
    const result = fn({});
    expect(result).toHaveProperty('overall_score');
  });
});
