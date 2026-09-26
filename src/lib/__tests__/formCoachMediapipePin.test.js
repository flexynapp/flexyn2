import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MEDIAPIPE_VERSION, WASM_BASE_URL, MODEL_URL } from '../formCoach/analyzeForm';

// The WASM runtime is fetched from a CDN at a pinned version while the JS glue
// comes from node_modules. If the two drift, the landmarker fails to start on
// every device with an opaque WASM error, so pin them together.
describe('MediaPipe version pin', () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'));
  const installed = JSON.parse(readFileSync(
    resolve(__dirname, '../../../node_modules/@mediapipe/tasks-vision/package.json'), 'utf8',
  ));

  it('package.json pins an exact version (no caret or tilde)', () => {
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toBe(MEDIAPIPE_VERSION);
  });

  it('the installed package matches the CDN WASM version', () => {
    expect(installed.version).toBe(MEDIAPIPE_VERSION);
    expect(WASM_BASE_URL).toContain(`@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`);
  });

  it('the model URL is a versioned path, not latest', () => {
    expect(MODEL_URL).not.toMatch(/\/latest\//);
  });
});
