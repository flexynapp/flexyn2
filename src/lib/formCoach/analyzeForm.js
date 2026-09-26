// src/lib/formCoach/analyzeForm.js
//
// Real form analyzer. Loads Google's MediaPipe Pose Landmarker on first use,
// runs pose detection on a captured frame, and routes to the per-exercise
// rule analyzer.
//
// Download on first use, measured 2026-09-26: ~45 KB gzip of JS from our own
// bundle, the ~3.4 MB (gzip) WASM runtime from jsDelivr and the 5.8 MB lite
// model from Google's model bucket, about 9 MB in all. The TF.js + MoveNet
// stack it replaced was about 5.2 MB, so this is BIGGER; it was swapped for
// accuracy and because MediaPipe is maintained and TF.js pose-detection is
// not. Both files are cached by the browser after the first load.

import { landmarksToMap, bodyDetectionScore } from './geometry';
import { routeAnalyzer } from './rules';

// The WASM runtime must match the JS glue exactly, so both are pinned to the
// same version. package.json pins @mediapipe/tasks-vision without a caret for
// this reason, and formCoach.test.js fails if the two ever disagree.
export const MEDIAPIPE_VERSION = '1.0.1';
export const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
// Versioned path ("/1/"), not "/latest/": a model change should be a commit.
export const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let _detector = null;
let _loadingPromise = null;

// Measured on 16 real photos (2026-09-26), MoveNet and MediaPipe put their
// confidence on different scales: MoveNet's body score sat at 0.26 to 0.56
// on clear full-body lifts, MediaPipe's at 0.59 to 1.00, and MediaPipe still
// reports 0.65 for a half-body crop because it places unseen legs inside the
// frame with middling visibility. The old 0.18 / 0.35 gates would let every
// photo through as "good", so they are re-cut for this model: below 0.40 is
// no body (no real photo scored under 0.48), below 0.70 is a partial view
// (that bucket held both crops, both cut-off pull-ups and the close-up).
export const NO_BODY_BELOW = 0.4;
export const PARTIAL_BELOW = 0.7;

/**
 * Lazy-load and cache the pose landmarker. Called on first analyze; later
 * calls return the cached instance. The import is dynamic so none of this is
 * pulled into pages that don't use it.
 *
 * CPU delegate on purpose. This analyses ONE still frame, where the CPU path
 * (WASM + XNNPACK) measured ~50 ms per frame in headless Chromium, and the
 * GPU delegate needs WebGL2 in the iOS web view, which is the least reliable
 * part of the stack for a gain nobody would notice on a single photo.
 */
async function loadDetector() {
  if (_detector) return _detector;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE_URL);
    _detector = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numPoses: 1,
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
 * Decode a data URL into an HTMLImageElement the landmarker can consume.
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
    console.error('[formCoach] failed to load the pose model:', err);
    return {
      overall_score: 0,
      form_rating: 'Couldn\'t analyze',
      good_points: [],
      corrections: [
        'Failed to load the form-coach model. Check your internet connection and try again.',
      ],
      injury_risks: [],
      tip: 'The first analysis downloads the AI model (~9 MB). It\'s cached after that.',
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

  let result;
  try {
    result = detector.detect(img);
  } catch (err) {
    console.error('[formCoach] pose estimation threw:', err);
    return makeNoBodyResult(exerciseName);
  }

  const landmarks = result?.landmarks?.[0];
  if (!landmarks || landmarks.length === 0) {
    return makeNoBodyResult(exerciseName);
  }

  const kpMap = landmarksToMap(
    landmarks,
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
  );
  const bodyScore = bodyDetectionScore(kpMap);

  if (bodyScore < NO_BODY_BELOW) {
    return makeNoBodyResult(exerciseName);
  }

  // Run the per-exercise analyzer
  const analyzer = routeAnalyzer(exerciseName);
  const analysis = analyzer(kpMap);

  // Annotate quality so the modal can warn users about partial detections
  let quality = 'good';
  if (bodyScore < PARTIAL_BELOW) quality = 'partial';

  return {
    ...analysis,
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
