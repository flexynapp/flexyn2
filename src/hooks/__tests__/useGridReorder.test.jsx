import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useGridReorder } from '../useGridReorder';

/* The Workout card grid ran on HTML5 drag-and-drop — `draggable`,
 * `dataTransfer`, dragstart/dragover/drop. No touch browser synthesises those
 * events, so on the only two platforms this app ships to the customiser was
 * inert: the toolbar opened, the cards took `cursor: grab`, and nothing moved.
 *
 * These tests drive the replacement the way a finger does — pointerdown on a
 * handle, pointermove across the grid, pointerup — and assert the order
 * actually changed. They would ALL fail against the old implementation, since
 * a pointer gesture produced nothing there at all.
 */

// jsdom does no layout, so elementFromPoint always returns null and the hook
// would never find a drop target. Stub it to answer from a coordinate → slot
// map the tests set up, which is exactly the question the real DOM answers.
const slotAt = new Map();
const realHitTest = document.elementFromPoint;
function stubHitTest() {
  document.elementFromPoint = (x, y) => slotAt.get(`${x},${y}`) ?? null;
}

// Put the real one back. Vitest isolates per file so nothing else should see
// this, but a global that a test assigns and never restores is the kind of
// thing that turns into an unexplainable failure three files away the day
// isolation gets switched off for speed.
afterEach(() => {
  document.elementFromPoint = realHitTest;
  slotAt.clear();
  vi.restoreAllMocks();
});

function Grid({ initial, onOrder }) {
  const [order, setOrder] = useState(initial);
  const { dragIdx, overIdx, handleProps } = useGridReorder(order, (next) => {
    setOrder(next);
    onOrder?.(next);
  });
  return (
    <div>
      <p data-testid="order">{order.join(',')}</p>
      {order.map((id, i) => (
        <div key={id} data-reorder-idx={i} data-testid={`slot-${id}`}>
          <span data-testid={`state-${id}`}>
            {dragIdx === i ? 'dragging' : overIdx === i ? 'over' : ''}
          </span>
          <button {...handleProps(i)} aria-label={`grip ${id}`} />
        </div>
      ))}
    </div>
  );
}

/** A pointer event jsdom will accept — it has no PointerEvent constructor. */
function pointer(type, { x = 0, y = 0, button = 0 } = {}) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
  e.pointerId = 1;
  return e;
}

function grip(id) {
  return screen.getByLabelText(`grip ${id}`);
}

function order() {
  return screen.getByTestId('order').textContent;
}

/** Point (x,y) at the slot rendered for `id`. */
function placeSlot(id, x, y) {
  slotAt.set(`${x},${y}`, screen.getByTestId(`slot-${id}`));
}

describe('useGridReorder — a pointer gesture actually moves a card', () => {
  it('moves the dragged card to the slot the pointer was released over', () => {
    stubHitTest();
    const onOrder = vi.fn();
    render(<Grid initial={['a', 'b', 'c', 'd']} onOrder={onOrder} />);
    placeSlot('c', 50, 50);

    act(() => {
      grip('a').dispatchEvent(pointer('pointerdown'));
      grip('a').dispatchEvent(pointer('pointermove', { x: 50, y: 50 }));
      grip('a').dispatchEvent(pointer('pointerup'));
    });

    expect(order()).toBe('b,c,a,d');
    expect(onOrder).toHaveBeenCalledWith(['b', 'c', 'a', 'd']);
  });

  it('handles a full-width card the same way — hit-testing ignores layout', () => {
    // The nemesis card is `col-span-2`, which is why framer's 1-D Reorder was
    // wrong for this grid. To the hook it is just another slot.
    stubHitTest();
    render(<Grid initial={['a', 'nemesis', 'c']} />);
    placeSlot('a', 10, 10);

    act(() => {
      grip('nemesis').dispatchEvent(pointer('pointerdown'));
      grip('nemesis').dispatchEvent(pointer('pointermove', { x: 10, y: 10 }));
      grip('nemesis').dispatchEvent(pointer('pointerup'));
    });

    expect(order()).toBe('nemesis,a,c');
  });

  it('is a no-op when released on the card it started from', () => {
    stubHitTest();
    const onOrder = vi.fn();
    render(<Grid initial={['a', 'b', 'c']} onOrder={onOrder} />);
    placeSlot('a', 5, 5);

    act(() => {
      grip('a').dispatchEvent(pointer('pointerdown'));
      grip('a').dispatchEvent(pointer('pointermove', { x: 5, y: 5 }));
      grip('a').dispatchEvent(pointer('pointerup'));
    });

    expect(order()).toBe('a,b,c');
    expect(onOrder).not.toHaveBeenCalled();
  });

  it('is a no-op when released over no card at all', () => {
    stubHitTest(); // every coordinate misses
    render(<Grid initial={['a', 'b', 'c']} />);

    act(() => {
      grip('a').dispatchEvent(pointer('pointerdown'));
      grip('a').dispatchEvent(pointer('pointermove', { x: 900, y: 900 }));
      grip('a').dispatchEvent(pointer('pointerup'));
    });

    expect(order()).toBe('a,b,c');
  });

  it('leaves the order untouched when the OS cancels the gesture', () => {
    // A system swipe or an incoming call. Committing here would drop the card
    // somewhere the user never chose.
    stubHitTest();
    render(<Grid initial={['a', 'b', 'c']} />);
    placeSlot('c', 70, 70);

    act(() => {
      grip('a').dispatchEvent(pointer('pointerdown'));
      grip('a').dispatchEvent(pointer('pointermove', { x: 70, y: 70 }));
      grip('a').dispatchEvent(pointer('pointercancel'));
    });

    expect(order()).toBe('a,b,c');
  });

  it('ignores a non-primary button, so a right-click is not a reorder', () => {
    stubHitTest();
    render(<Grid initial={['a', 'b', 'c']} />);
    placeSlot('c', 70, 70);

    act(() => {
      grip('a').dispatchEvent(pointer('pointerdown', { button: 2 }));
      grip('a').dispatchEvent(pointer('pointermove', { x: 70, y: 70 }));
      grip('a').dispatchEvent(pointer('pointerup'));
    });

    expect(order()).toBe('a,b,c');
  });

  it('tracks the card under the pointer as it crosses the grid', () => {
    stubHitTest();
    render(<Grid initial={['a', 'b', 'c']} />);
    placeSlot('b', 20, 20);
    placeSlot('c', 40, 40);

    act(() => { grip('a').dispatchEvent(pointer('pointerdown')); });
    expect(screen.getByTestId('state-a').textContent).toBe('dragging');

    act(() => { grip('a').dispatchEvent(pointer('pointermove', { x: 20, y: 20 })); });
    expect(screen.getByTestId('state-b').textContent).toBe('over');

    act(() => { grip('a').dispatchEvent(pointer('pointermove', { x: 40, y: 40 })); });
    expect(screen.getByTestId('state-b').textContent).toBe('');
    expect(screen.getByTestId('state-c').textContent).toBe('over');
  });

  it('does nothing on a move that never had a pointerdown', () => {
    stubHitTest();
    render(<Grid initial={['a', 'b', 'c']} />);
    placeSlot('c', 70, 70);

    act(() => { grip('a').dispatchEvent(pointer('pointermove', { x: 70, y: 70 })); });

    expect(screen.getByTestId('state-c').textContent).toBe('');
    expect(order()).toBe('a,b,c');
  });
});
