// Tests for VoiceMemoRecorder's exported formatDuration helper. The
// component itself uses MediaRecorder + getUserMedia, both of which
// are messy to stub in jsdom — full integration testing is left to
// manual QA. The formatter is the only logic worth unit-testing here.

import { describe, it, expect } from 'vitest';
import { formatDuration } from '../VoiceMemoRecorder';

describe('formatDuration', () => {
  it('renders sub-minute durations as 0:SS', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(1500)).toBe('0:01');
    expect(formatDuration(59_999)).toBe('0:59');
  });

  it('renders multi-minute durations as M:SS', () => {
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(90_000)).toBe('1:30');
    expect(formatDuration(125_000)).toBe('2:05');
  });

  it('floors fractional seconds', () => {
    expect(formatDuration(2_999)).toBe('0:02');
  });

  it('clamps negative input to 0:00', () => {
    expect(formatDuration(-100)).toBe('0:00');
  });
});
