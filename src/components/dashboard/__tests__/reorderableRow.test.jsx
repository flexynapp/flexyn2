import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Reorder } from 'framer-motion';
import { ReorderableRow, DragHandle } from '../ReorderableRow';

/* The bug this file exists to stop coming back.
 *
 * Dashboard and Nutrition both had `dragListener={editMode}` on their reorder
 * rows, so the whole row was a drag surface. On a phone that made customize
 * mode nearly unscrollable in two independent ways, and both are visible right
 * here in the DOM:
 *
 *   - framer writes `touch-action: pan-x` / `user-select: none` / `draggable`
 *     onto a `drag="y"` item whose listener is live (its
 *     render/html/use-props.mjs writes all three from ONE branch,
 *     `props.drag && props.dragListener !== false`). pan-x switches off the
 *     browser's vertical scrolling over every row.
 *   - a touch on a card that moved reordered the page instead of scrolling it.
 *
 * So the assertions below are the fix stated as a contract: nothing on the row
 * claims the vertical gesture, and the handle — the one element that should —
 * claims it explicitly. `touch-action` is the load-bearing one; the other two
 * come from the same branch and are asserted because they prove the branch
 * itself did not run, which is the actual regression to catch.
 */

function renderRow(children) {
  return render(
    <Reorder.Group axis="y" values={['a']} onReorder={vi.fn()} as="div">
      <ReorderableRow value="a" layout={false} className="row">
        {children}
      </ReorderableRow>
    </Reorder.Group>,
  );
}

describe('ReorderableRow — the row must not eat the scroll gesture', () => {
  it('leaves the row free to scroll: no touch-action, user-select or draggable', () => {
    const { container } = renderRow(() => <div>card content</div>);
    const row = container.querySelector('.row');

    expect(row).toBeTruthy();
    // Empty string, not 'pan-x' — framer only writes these when the drag
    // listener is live, so an empty value proves it is not.
    expect(row.style.touchAction).toBe('');
    expect(row.style.userSelect).toBe('');
    expect(row.getAttribute('draggable')).toBeNull();
  });

  it('hands the drag controls to its children so only a handle can start one', () => {
    const seen = [];
    renderRow((dragControls) => {
      seen.push(dragControls);
      return <div>card content</div>;
    });

    expect(seen).toHaveLength(1);
    expect(typeof seen[0].start).toBe('function');
  });
});

describe('DragHandle — the one element that does claim it', () => {
  it('carries touch-none so the drag does not fight the page scroller', () => {
    render(<DragHandle dragControls={{ start: vi.fn() }} label="Drag to reorder" />);
    expect(screen.getByRole('button', { name: 'Drag to reorder' }).className)
      .toContain('touch-none');
  });

  it('is a 32px target, not the bare 14px glyph both pages used to ship', () => {
    render(<DragHandle dragControls={{ start: vi.fn() }} label="Drag to reorder" />);
    const cls = screen.getByRole('button', { name: 'Drag to reorder' }).className;
    expect(cls).toContain('w-8');
    expect(cls).toContain('h-8');
  });

  it('starts the drag on pointerdown, which is what makes it the only handle', () => {
    const start = vi.fn();
    render(<DragHandle dragControls={{ start }} label="Drag to reorder" />);

    const handle = screen.getByRole('button', { name: 'Drag to reorder' });
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

    expect(start).toHaveBeenCalledTimes(1);
  });
});
