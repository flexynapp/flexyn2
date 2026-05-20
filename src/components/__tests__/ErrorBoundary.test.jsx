import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import ErrorBoundary from '../ErrorBoundary';

// The ErrorBoundary's functional wrapper calls useLocation / useNavigate
// so it can auto-reset on route change and provide a Go-Home handler.
// Tests must therefore mount it inside a <MemoryRouter>. This helper
// keeps each render() call's intent clear without duplicating the wrap.
function renderInRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function rerenderInRouter(rerender, ui) {
  return rerender(<MemoryRouter>{ui}</MemoryRouter>);
}

// A component that always throws during render
function Bomb({ message = 'test crash' }) {
  throw new Error(message);
}

// A component that renders normally
function Fine() {
  return <div>Everything is fine</div>;
}

// ─── Normal rendering ─────────────────────────────────────────────────────────

describe('ErrorBoundary — normal rendering', () => {
  it('renders children when there is no error', () => {
    renderInRouter(
      <ErrorBoundary label="Test">
        <Fine />
      </ErrorBoundary>
    );
    expect(screen.getByText('Everything is fine')).toBeInTheDocument();
  });
});

// ─── Error catching ───────────────────────────────────────────────────────────

describe('ErrorBoundary — error catching', () => {
  it('shows fallback UI when a child throws', () => {
    renderInRouter(
      <ErrorBoundary label="CrashTest">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('shows "Try again" button in the fallback UI', () => {
    renderInRouter(
      <ErrorBoundary label="CrashTest">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows "Go to Home" button in the fallback UI', () => {
    renderInRouter(
      <ErrorBoundary label="CrashTest">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByRole('button', { name: /go to home/i })).toBeInTheDocument();
  });

  it('shows "Copy details" button in the fallback UI', () => {
    renderInRouter(
      <ErrorBoundary label="CrashTest">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByRole('button', { name: /copy details/i })).toBeInTheDocument();
  });

  it('does NOT render the crashed child', () => {
    renderInRouter(
      <ErrorBoundary label="CrashTest">
        <Bomb message="intentional test error" />
      </ErrorBoundary>
    );
    // The child's output should not be present
    expect(screen.queryByText('intentional test error')).not.toBeInTheDocument();
  });
});

// ─── Recovery ─────────────────────────────────────────────────────────────────

describe('ErrorBoundary — Try again', () => {
  it('resets error state when "Try again" is clicked', () => {
    // Render with a Bomb, then replace with Fine after reset
    // We simulate this by making Bomb conditional
    let shouldThrow = true;

    function MaybeThrow() {
      if (shouldThrow) throw new Error('transient error');
      return <Fine />;
    }

    const { rerender } = renderInRouter(
      <ErrorBoundary label="Recovery">
        <MaybeThrow />
      </ErrorBoundary>
    );

    // Fallback is showing
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    // Fix the condition and reset the boundary
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    rerenderInRouter(rerender,
      <ErrorBoundary label="Recovery">
        <MaybeThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText('Everything is fine')).toBeInTheDocument();
  });
});

// ─── label prop ───────────────────────────────────────────────────────────────

describe('ErrorBoundary — label prop', () => {
  it('logs the label name to console.error on crash', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderInRouter(
      <ErrorBoundary label="MyWidget">
        <Bomb />
      </ErrorBoundary>
    );
    const logged = spy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('MyWidget')
    );
    expect(logged).toBeDefined();
    spy.mockRestore();
  });
});
