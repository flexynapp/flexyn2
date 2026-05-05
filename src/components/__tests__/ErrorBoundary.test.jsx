import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ErrorBoundary from '../ErrorBoundary';

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
    render(
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
    render(
      <ErrorBoundary label="CrashTest">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('shows "Try again" button in the fallback UI', () => {
    render(
      <ErrorBoundary label="CrashTest">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('does NOT render the crashed child', () => {
    render(
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

    const { rerender } = render(
      <ErrorBoundary label="Recovery">
        <MaybeThrow />
      </ErrorBoundary>
    );

    // Fallback is showing
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    // Fix the condition and reset the boundary
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    rerender(
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
    render(
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
