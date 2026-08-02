import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AnimatedRoutes from '../AnimatedRoutes';

// framer-motion is stubbed so the assertions are about the PROPS AnimatedRoutes
// passes, not about whether an animation frame ran — the real bug is that on a
// hidden document no frame ever runs, which is exactly what a real animation in
// jsdom can't reproduce.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, animate, transition: _transition, ...rest }) => (
      <div
        data-initial={JSON.stringify(initial)}
        data-animate={JSON.stringify(animate)}
        {...rest}
      >
        {children}
      </div>
    ),
  },
}));

function renderAt(path = '/coach') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AnimatedRoutes />}>
          <Route path={path} element={<button type="button">page control</button>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/** Force document.visibilityState/hidden for one test. */
function setHidden(hidden) {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(hidden ? 'hidden' : 'visible');
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('AnimatedRoutes enter transition', () => {
  it('animates in normally when the document is visible', () => {
    setHidden(false);
    renderAt();
    const wrapper = screen.getByText('page control').closest('[data-initial]');
    expect(JSON.parse(wrapper.dataset.initial)).toMatchObject({ opacity: 0 });
    expect(JSON.parse(wrapper.dataset.animate)).toMatchObject({ opacity: 1, x: 0 });
  });

  it('skips the enter animation when the document is hidden at mount', () => {
    // rAF never fires on a hidden document, so an initial of opacity 0 would
    // never be animated away — the page would be invisible but still tappable.
    setHidden(true);
    renderAt();
    const wrapper = screen.getByText('page control').closest('[data-initial]');
    expect(JSON.parse(wrapper.dataset.initial)).toBe(false);
    // It still lands on the visible state, so nothing else about the page changes.
    expect(JSON.parse(wrapper.dataset.animate)).toMatchObject({ opacity: 1, x: 0 });
  });

  it('renders the routed page either way', () => {
    setHidden(true);
    renderAt();
    expect(screen.getByText('page control')).toBeTruthy();
  });
});
