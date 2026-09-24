import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useUrlState } from '@/hooks/useUrlState';

let nav;
function Page() {
  const [tab, setTab] = useUrlState('tab', 'trends', ['trends', 'records', 'body']);
  const location = useLocation();
  nav = useNavigate();
  return (
    <div>
      <span data-testid="tab">{tab}</span>
      <span data-testid="url">{location.pathname + location.search}</span>
      <button onClick={() => setTab('records')}>records</button>
      <button onClick={() => setTab(prev => (prev === 'body' ? 'trends' : 'body'))}>toggle</button>
    </div>
  );
}

const renderAt = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="/progress" element={<Page />} /></Routes>
  </MemoryRouter>,
);
const tab = () => screen.getByTestId('tab').textContent;
const url = () => screen.getByTestId('url').textContent;

describe('useUrlState', () => {
  it('starts on the view the URL names', () => {
    renderAt('/progress?tab=records');
    expect(tab()).toBe('records');
  });

  it('ignores a value it does not know, so a stale link cannot blank the page', () => {
    renderAt('/progress?tab=nope');
    expect(tab()).toBe('trends');
  });

  it('writes the view into the URL when it changes, and nothing for the default', () => {
    renderAt('/progress');
    expect(url()).toBe('/progress');
    act(() => screen.getByText('records').click());
    expect(url()).toBe('/progress?tab=records');
    act(() => screen.getByText('toggle').click());
    expect(tab()).toBe('body');
    act(() => screen.getByText('toggle').click());
    expect(url()).toBe('/progress');
  });

  it('keeps other params when it writes', () => {
    renderAt('/progress?x=1');
    act(() => screen.getByText('records').click());
    expect(url()).toBe('/progress?x=1&tab=records');
  });

  it('follows a link that names a different view', () => {
    renderAt('/progress?tab=records');
    act(() => nav('/progress?tab=body'));
    expect(tab()).toBe('body');
  });

  it('puts its param back when the page strips its own one-shot params', () => {
    renderAt('/progress?tab=records');
    act(() => nav('/progress', { replace: true }));
    expect(tab()).toBe('records');
    expect(url()).toBe('/progress?tab=records');
  });

  it('does not add a history entry per switch, so Back leaves the page', () => {
    function Other() { return <span data-testid="url">/dashboard</span>; }
    render(
      <MemoryRouter initialEntries={['/dashboard', '/progress']} initialIndex={1}>
        <Routes>
          <Route path="/progress" element={<Page />} />
          <Route path="/dashboard" element={<Other />} />
        </Routes>
      </MemoryRouter>,
    );
    act(() => screen.getByText('records').click());
    act(() => screen.getByText('toggle').click());
    act(() => nav(-1));
    expect(url()).toBe('/dashboard');
  });
});
