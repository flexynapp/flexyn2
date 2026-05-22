// Tests for StoryOverlayRenderer — the read-side renderer that paints
// persisted overlays (mig 111) on top of a story's base media. We
// assert on rendered output for each `kind` and verify the
// future-friendly behavior (unknown kinds render nothing).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StoryOverlayRenderer from '../StoryOverlayRenderer';

describe('StoryOverlayRenderer', () => {
  it('renders nothing when overlays is empty or missing', () => {
    const { container: a } = render(<StoryOverlayRenderer overlays={[]} />);
    const { container: b } = render(<StoryOverlayRenderer overlays={null} />);
    const { container: c } = render(<StoryOverlayRenderer />);
    expect(a.firstChild).toBeNull();
    expect(b.firstChild).toBeNull();
    expect(c.firstChild).toBeNull();
  });

  it('renders emoji overlays at the supplied normalized coords', () => {
    render(<StoryOverlayRenderer overlays={[
      { kind: 'emoji', emoji: '🔥', x: 0.25, y: 0.75 },
    ]} />);
    const node = screen.getByText('🔥');
    expect(node).toBeInTheDocument();
    expect(node.style.left).toBe('25%');
    expect(node.style.top).toBe('75%');
  });

  it('renders text overlays with custom color + font', () => {
    render(<StoryOverlayRenderer overlays={[
      { kind: 'text', text: 'PR!', color: '#ff0000', font: 'casual', x: 0.5, y: 0.5 },
    ]} />);
    const node = screen.getByText('PR!');
    expect(node).toBeInTheDocument();
    expect(node.style.color).toMatch(/rgb\(255, 0, 0\)|#ff0000/i);
  });

  it('renders sticker overlays with their label', () => {
    render(<StoryOverlayRenderer overlays={[
      { kind: 'sticker', label: '300 lbs', x: 0.5, y: 0.5 },
    ]} />);
    expect(screen.getByText('300 lbs')).toBeInTheDocument();
  });

  it('renders nothing for unknown kinds (forward-compat with v2 clients)', () => {
    const { container } = render(<StoryOverlayRenderer overlays={[
      { kind: 'poll', x: 0.5, y: 0.5 },
      { kind: 'music-attribution', x: 0.5, y: 0.5 },
    ]} />);
    expect(container.textContent).toBe('');
  });

  it('clamps out-of-range coords to the [0,1] window', () => {
    render(<StoryOverlayRenderer overlays={[
      { kind: 'emoji', emoji: '⭐', x: 1.7, y: -0.2 },
    ]} />);
    const node = screen.getByText('⭐');
    expect(node.style.left).toBe('100%');
    expect(node.style.top).toBe('0%');
  });

  it('renders multiple overlays in order', () => {
    render(<StoryOverlayRenderer overlays={[
      { kind: 'emoji', emoji: '🔥', x: 0.2, y: 0.2 },
      { kind: 'emoji', emoji: '💪', x: 0.8, y: 0.8 },
      { kind: 'text', text: 'hi', x: 0.5, y: 0.5 },
    ]} />);
    expect(screen.getByText('🔥')).toBeInTheDocument();
    expect(screen.getByText('💪')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
  });
});
