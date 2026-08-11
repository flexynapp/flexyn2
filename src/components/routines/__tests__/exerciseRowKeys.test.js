import { describe, it, expect } from 'vitest';
import { exerciseRowKeys } from '@/components/routines/MyRoutineSheet';

/* The grip beside each exercise in a routine day was decorative. Connecting
 * it needed a React key, and the rows had been using `key={index}` — which is
 * exactly the key you cannot use on a reorderable list: after a move, index 0
 * is a different exercise, so React reuses the DOM node for the wrong row and
 * framer animates the wrong element.
 *
 * These rows carry no id (`{ name, muscles }` is the whole shape, and adding
 * one means changing what gets persisted into routine JSON), so the key is
 * derived. The case that makes a naive `key={name}` wrong is a day that lists
 * the same lift twice, which is legitimate — a heavy top set early and a
 * back-off later.
 */

const list = (...names) => names.map((name) => ({ name, muscles: [] }));

describe('exerciseRowKeys', () => {
  it('keys distinct exercises by name, which is stable across a reorder', () => {
    expect(exerciseRowKeys(list('Squat', 'Bench', 'Row')))
      .toEqual(['Squat#1', 'Bench#1', 'Row#1']);
    // Reordered: the SAME keys travel with the same exercises, which is what
    // lets React move the nodes instead of rebuilding them.
    expect(exerciseRowKeys(list('Row', 'Squat', 'Bench')))
      .toEqual(['Row#1', 'Squat#1', 'Bench#1']);
  });

  it('disambiguates a lift that legitimately appears twice in a day', () => {
    expect(exerciseRowKeys(list('Squat', 'Bench', 'Squat')))
      .toEqual(['Squat#1', 'Bench#1', 'Squat#2']);
  });

  it('never emits a duplicate key, which is the whole point', () => {
    const keys = exerciseRowKeys(list('Curl', 'Curl', 'Curl', 'Press', 'Curl'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['Curl#1', 'Curl#2', 'Curl#3', 'Press#1', 'Curl#4']);
  });

  it('handles an empty day', () => {
    expect(exerciseRowKeys([])).toEqual([]);
  });

  it('returns one key per exercise, in order', () => {
    const day = list('A', 'B', 'C', 'D');
    expect(exerciseRowKeys(day)).toHaveLength(day.length);
  });
});
