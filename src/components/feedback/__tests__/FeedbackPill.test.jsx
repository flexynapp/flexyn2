import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('@/lib/haptic', () => ({ triggerHaptic: vi.fn() }));

import FeedbackPill from '../FeedbackPill';
import { toast } from '@/lib/toast';
import { _reset, getSnapshot } from '@/lib/feedbackStore';
import { triggerHaptic } from '@/lib/haptic';

beforeEach(() => { _reset(); vi.clearAllMocks(); });
afterEach(() => { act(() => _reset()); });

describe('FeedbackPill', () => {
  it('renders a toast.success() call as the pill and announces it politely', () => {
    render(<FeedbackPill />);
    act(() => { toast.success('Weight saved'); });
    expect(screen.getByRole('status')).toHaveTextContent('Weight saved');
    expect(document.querySelector('[data-feedback-pill]')).toHaveTextContent('Weight saved');
    expect(triggerHaptic).toHaveBeenCalledWith('success');
  });

  it('announces errors assertively with a warning haptic', () => {
    render(<FeedbackPill />);
    act(() => { toast.error('Could not save', { description: 'Check your connection.' }); });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Check your connection.');
    expect(triggerHaptic).toHaveBeenCalledWith('warning');
  });

  it('runs the action and dismisses when its button is pressed', () => {
    const onClick = vi.fn();
    render(<FeedbackPill />);
    act(() => { toast('Set 2 deleted', { action: { label: 'Undo', onClick } }); });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(getSnapshot().current).toBeNull();
  });

  it('dismisses on tap when there is no action', () => {
    render(<FeedbackPill />);
    act(() => { toast.info('Auto-paused'); });
    fireEvent.click(document.querySelector('[data-feedback-pill]'));
    expect(getSnapshot().current).toBeNull();
  });

  it('shows a caller-supplied emoji icon', () => {
    render(<FeedbackPill />);
    act(() => { toast.success('Prestige II achieved!', { icon: '🔥' }); });
    expect(document.querySelector('[data-feedback-pill]')).toHaveTextContent('🔥');
  });
});
