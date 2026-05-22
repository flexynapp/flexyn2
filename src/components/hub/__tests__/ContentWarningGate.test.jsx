// Tests for ContentWarningGate — the blur+reveal wrapper for posts
// flagged with a content_warning. Verifies:
//   • children are visible immediately when no warning is set
//   • children are hidden behind the gate when a warning is set
//   • tapping "Tap to reveal" unlocks
//   • each warning type renders its label
//   • the freeform `customLabel` shows up when type is 'other'

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ContentWarningGate from '../ContentWarningGate';

describe('ContentWarningGate', () => {
  it('renders children directly when no warning is set', () => {
    render(
      <ContentWarningGate>
        <span>visible content</span>
      </ContentWarningGate>
    );
    expect(screen.getByText('visible content')).toBeInTheDocument();
    expect(screen.queryByText(/tap to reveal/i)).not.toBeInTheDocument();
  });

  it('shows the gate overlay for graphic_injury', () => {
    render(
      <ContentWarningGate warning="graphic_injury">
        <span>hidden content</span>
      </ContentWarningGate>
    );
    expect(screen.getByText('Graphic injury')).toBeInTheDocument();
    expect(screen.getByText(/tap to reveal/i)).toBeInTheDocument();
  });

  it('shows the sensitive label', () => {
    render(
      <ContentWarningGate warning="sensitive">
        <span>x</span>
      </ContentWarningGate>
    );
    expect(screen.getByText('Sensitive content')).toBeInTheDocument();
  });

  it('shows the spoiler label', () => {
    render(
      <ContentWarningGate warning="spoiler">
        <span>x</span>
      </ContentWarningGate>
    );
    expect(screen.getByText('Spoiler')).toBeInTheDocument();
  });

  it('uses customLabel when warning is "other"', () => {
    render(
      <ContentWarningGate warning="other" customLabel="Surgery scar">
        <span>x</span>
      </ContentWarningGate>
    );
    expect(screen.getByText('Surgery scar')).toBeInTheDocument();
  });

  it('falls back to "Content warning" for "other" with no customLabel', () => {
    render(
      <ContentWarningGate warning="other">
        <span>x</span>
      </ContentWarningGate>
    );
    expect(screen.getByText('Content warning')).toBeInTheDocument();
  });

  it('unlocks when the reveal button is tapped', () => {
    render(
      <ContentWarningGate warning="sensitive">
        <span data-testid="payload">payload text</span>
      </ContentWarningGate>
    );
    // The payload renders behind the blur even when locked (in the
    // aria-hidden background), so we can't assert on its absence —
    // assert on the reveal button being there pre-tap, gone post-tap.
    const reveal = screen.getByText(/tap to reveal/i);
    expect(reveal).toBeInTheDocument();
    fireEvent.click(reveal);
    expect(screen.queryByText(/tap to reveal/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('payload')).toBeInTheDocument();
  });
});
