import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  show, dismiss, getSnapshot, subscribe, _reset,
  DEFAULT_DURATION_MS, ACTION_MIN_MS, ERROR_HOLD_MS,
} from '../feedbackStore';

beforeEach(() => { vi.useFakeTimers(); _reset(); });
afterEach(() => { _reset(); vi.useRealTimers(); });

const cur = () => getSnapshot().current;

describe('feedbackStore', () => {
  it('shows one message at a time; a new one replaces the current', () => {
    show('success', 'Saved');
    show('info', 'Heads up');
    expect(cur().message).toBe('Heads up');
    expect(getSnapshot().queue).toHaveLength(0);
  });

  it('expires each kind after its default duration', () => {
    show('success', 'Saved');
    vi.advanceTimersByTime(DEFAULT_DURATION_MS.success - 1);
    expect(cur()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(cur()).toBeNull();
  });

  it('keeps a message with an action long enough to press', () => {
    show('success', 'Deleted', { duration: 1000, action: { label: 'Undo', onClick() {} } });
    vi.advanceTimersByTime(ACTION_MIN_MS - 1);
    expect(cur()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(cur()).toBeNull();
  });

  it('honours an explicit duration, including Infinity', () => {
    show('info', 'Sticky', { duration: Infinity });
    vi.advanceTimersByTime(60_000);
    expect(cur().message).toBe('Sticky');
  });

  it('updates in place when the same id is shown again, and restarts the clock', () => {
    const id = show('info', 'Uploading', { id: 'up' });
    expect(id).toBe('up');
    vi.advanceTimersByTime(DEFAULT_DURATION_MS.info - 100);
    const firstKey = cur().key;
    show('success', 'Uploaded', { id: 'up' });
    expect(cur().message).toBe('Uploaded');
    expect(cur().key).not.toBe(firstKey);
    vi.advanceTimersByTime(DEFAULT_DURATION_MS.success - 1);
    expect(cur()).not.toBeNull();
  });

  it('does not let a cheerful message wipe a fresh error; it queues and plays after', () => {
    show('error', 'Could not save');
    show('success', 'Quest progress');
    expect(cur().message).toBe('Could not save');
    expect(getSnapshot().queue.map((q) => q.message)).toEqual(['Quest progress']);
    vi.advanceTimersByTime(DEFAULT_DURATION_MS.error);
    expect(cur().message).toBe('Quest progress');
  });

  it('lets a non-error replace an error once the error has had its hold time', () => {
    show('error', 'Could not save');
    vi.advanceTimersByTime(ERROR_HOLD_MS);
    show('success', 'Saved');
    expect(cur().message).toBe('Saved');
  });

  it('lets a newer error replace an error immediately', () => {
    show('error', 'First');
    show('error', 'Second');
    expect(cur().message).toBe('Second');
  });

  it('dismiss(id) clears the current message, runs onDismiss and plays the next', () => {
    const onDismiss = vi.fn();
    show('error', 'Failed', { id: 'e', onDismiss });
    show('info', 'Next');
    dismiss('e');
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(cur().message).toBe('Next');
  });

  it('dismiss() with no id clears everything', () => {
    show('error', 'Failed');
    show('info', 'Queued');
    dismiss();
    expect(cur()).toBeNull();
    expect(getSnapshot().queue).toHaveLength(0);
  });

  it('notifies subscribers', () => {
    const l = vi.fn();
    const off = subscribe(l);
    show('success', 'Saved');
    expect(l).toHaveBeenCalled();
    off();
  });
});
