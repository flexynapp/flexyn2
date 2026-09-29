// The de-dup behind the app-wide quest completion cue. Two things notice a
// completion (recordActions on this device, the Today card's refetch for any
// device) and the user must hear about it exactly once.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  announceQuestCompleted, markQuestsSeen, subscribeQuestCompleted, _resetQuestCompletion,
} from '../questCompletion';

beforeEach(() => _resetQuestCompletion());

describe('questCompletion', () => {
  it('delivers each row once, however many times it is announced', () => {
    const heard = [];
    subscribeQuestCompleted((r) => heard.push(r.id));
    expect(announceQuestCompleted({ id: 'q1', completed_at: 'x' })).toBe(true);
    expect(announceQuestCompleted({ id: 'q1', completed_at: 'x' })).toBe(false);
    announceQuestCompleted({ id: 'q2', completed_at: 'x' });
    expect(heard).toEqual(['q1', 'q2']);
  });

  it('never announces a row that was already complete when first seen', () => {
    const heard = [];
    subscribeQuestCompleted((r) => heard.push(r.id));
    markQuestsSeen([{ id: 'done', completed_at: 'x' }, { id: 'open', completed_at: null }]);
    announceQuestCompleted({ id: 'done', completed_at: 'x' });
    announceQuestCompleted({ id: 'open', completed_at: 'y' });
    expect(heard).toEqual(['open']);
  });

  it('holds announcements made before anyone listens, then flushes them', () => {
    announceQuestCompleted({ id: 'early', completed_at: 'x' });
    const heard = [];
    subscribeQuestCompleted((r) => heard.push(r.id));
    expect(heard).toEqual(['early']);
  });

  it('stops delivering after unsubscribe', () => {
    const heard = [];
    const off = subscribeQuestCompleted((r) => heard.push(r.id));
    off();
    announceQuestCompleted({ id: 'q', completed_at: 'x' });
    expect(heard).toEqual([]);
  });

  it('ignores rows without an id', () => {
    expect(announceQuestCompleted(null)).toBe(false);
    expect(announceQuestCompleted({ completed_at: 'x' })).toBe(false);
  });
});
