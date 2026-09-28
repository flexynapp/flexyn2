import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@/lib/haptic', () => ({ triggerHaptic: vi.fn() }));

import QuickLogButton from '../QuickLogButton';

describe('QuickLogButton', () => {
  it('says nothing when pressed, and confirms only once the save lands', () => {
    let answer;
    render(<QuickLogButton onLog={(a) => { answer = a; }} label="Log to today" doneLabel="Logged Oats" />);
    fireEvent.click(screen.getByRole('button', { name: 'Log to today' }));
    expect(screen.getByRole('status')).toHaveTextContent('');
    act(() => answer.onSuccess());
    expect(screen.getByRole('status')).toHaveTextContent('Logged Oats');
  });

  it('leaves failures to the feedback pill, which can say why', () => {
    let answer;
    render(<QuickLogButton onLog={(a) => { answer = a; }} label="Log to today" doneLabel="Logged Oats" />);
    fireEvent.click(screen.getByRole('button'));
    expect(answer.onError).toBeUndefined();
  });
});
