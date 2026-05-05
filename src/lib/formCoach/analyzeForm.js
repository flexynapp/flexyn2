// src/lib/formCoach/analyzeForm.js
//
// Real form analyzer. Loads TensorFlow.js + MoveNet on first use, runs pose
// detection on a captured frame, and routes to the per-exercise rule analyzer.
//
// Bundle impact: TF.js + MoveNet ≈ 3 MB lazy-loaded the first time the user
// opens Form Coach. Cached by the browser for subsequent calls.

import { keypointsToMap, bodyDetectionScore } from './geometry';
import { routeAnalyzer } from './rules';

let _detector = null;
let _loadingPromise = null;

/**
 * Lazy-load and cache the MoveNet detector. Called on first analyze; later
 * calls return the cached instance. The TF.js + pose-detection imports are
 * dynamic so the 3 MB bundle isn't pulled into pages that don't use it.
 */
async function loadDetector() {
  if (_detector) return _detector;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    // Dynamic imports — these chunks are split off the main bundle
    const tf = await import('@tensorflow/tfjs');
    await import('@tensorflow/tfjs-backend-webgl');
    const poseDetection = await import('@tensorflow-models/pose-detection');

    await tf.ready();
    // WebGL is the fastest backend in modern browsers; falls through to CPU
    // automatically if unavailable
    try { await tf.setBackend('webgl'); } catch { /* fallback to cpu */ }

    const model = poseDetection.SupportedModels.MoveNet;
    _detector = await poseDetection.createDetector(model, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: false,
    });
    return _detector;
  })();

  try {
    return await _loadingPromise;
  } finally {
    _loadingPromise = null;
  }
}

/**
 * Decode a data URL into an HTMLImageElement that MoveNet can consume.
 */
function dataUrlToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Failed to decode image: ' + e.message));
    img.src = dataUrl;
  });
}

/**
 * Analyze the captured frame. Returns the same shape as FeedbackPanel expects:
 *   {
 *     overall_score: 0-10,
 *     form_rating:   string,
 *     good_points:   string[],
 *     corrections:   string[],
 *     injury_risks:  string[],
 *     tip:           string,
 *     // Plus a few internal fields that the modal uses but FeedbackPanel ignores:
 *     _exerciseName,
 *     _bodyDetectionScore,
 *     _poseQuality:  'good' | 'partial' | 'no_body',
 *   }
 *
 * On total detection failure (no person in frame), returns a friendly result
 * asking the user to reposition. We never throw to the caller.
 */
export async function analyzeForm(imageDataUrl, exerciseName) {
  if (!imageDataUrl) {
    return makeNoBodyResult(exerciseName);
  }

  let detector;
  try {
    detector = await loadDetector();
  } catch (err) {
    console.error('[formCoach] failed to load MoveNet:', err);
    return {
      overall_score: 0,
      form_rating: 'Couldn\'t analyze',
      good_points: [],
      corrections: [
        'Failed to load the form-coach model. Check your internet connection and try again.',
      ],
      injury_risks: [],
      tip: 'The first analysis downloads the AI model (~3 MB). It\'s cached after that.',
      _exerciseName: exerciseName,
      _poseQuality: 'no_body',
    };
  }

  let img;
  try {
    img = await dataUrlToImage(imageDataUrl);
  } catch (err) {
    console.error('[formCoach] image decode failed:', err);
    return makeNoBodyResult(exerciseName);
  }

  let poses;
  try {
    poses = await detector.estimatePoses(img, { flipHorizontal: false });
  } catch (err) {
    console.error('[formCoach] pose estimation threw:', err);
    return makeNoBodyResult(exerciseName);
  }

  if (!poses || poses.length === 0 || !poses[0]?.keypoints) {
    return makeNoBodyResult(exerciseName);
  }

  const kpMap = keypointsToMap(poses[0].keypoints);
  const bodyScore = bodyDetectionScore(kpMap);

  if (bodyScore < 0.18) {
    return makeNoBodyResult(exerciseName);
  }

  // Run the per-exercise analyzer
  const analyzer = routeAnalyzer(exerciseName);
  const result = analyzer(kpMap);

  // Annotate quality so the modal can warn users about partial detections
  let quality = 'good';
  if (bodyScore < 0.35) quality = 'partial';

  return {
    ...result,
    _exerciseName: exerciseName,
    _bodyDetectionScore: bodyScore,
    _poseQuality: quality,
    _keypoints: kpMap, // for optional pose overlay rendering
  };
}

function makeNoBodyResult(exerciseName) {
  return {
    overall_score: 0,
    form_rating: 'No body detected',
    good_points: [],
    corrections: [
      'I couldn\'t see your full body in the frame.',
      'Try: better lighting, plain background, full body visible from head to feet.',
    ],
    injury_risks: [],
    tip: 'For most lifts, side-on framing at hip height works best.',
    _exerciseName: exerciseName,
    _poseQuality: 'no_body',
  };
}

/**
 * Pre-warm the detector so the first analysis is faster. Call this when the
 * user opens the Form Coach modal but before they capture, so the model is
 * already loading in the background.
 */
export function prewarmDetector() {
  loadDetector().catch(() => { /* errors surfaced on first analyze() call */ });
}
