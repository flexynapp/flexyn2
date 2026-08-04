import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { OnboardingCoachButton, OnboardingCoachSheet } from '@/components/onboarding/OnboardingCoach';
import { OB, NUT } from '@/lib/aiCoach/onboardingCoach';

const ask = (text) => {
  fireEvent.change(screen.getByLabelText('Ask the AI Coach'), { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send'));
};

describe('OnboardingCoachButton', () => {
  it('is reachable by its accessible name and fires', () => {
    const onClick = vi.fn();
    render(<OnboardingCoachButton onClick={onClick} />);
    fireEvent.click(screen.getByLabelText('Ask the AI Coach'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingCoachSheet', () => {
  it('renders nothing until opened', () => {
    render(<OnboardingCoachSheet open={false} stepId={OB.GOAL} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens with the step intro and its starter prompts', () => {
    render(<OnboardingCoachSheet open stepId={OB.EXPERIENCE} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/how much training does your body have behind it/i)).toBeTruthy();
    expect(screen.getByText('Which one am I?')).toBeTruthy();
  });

  it('answers a typed question', () => {
    render(<OnboardingCoachSheet open stepId={OB.INJURY} onClose={() => {}} />);
    ask('why does this matter?');
    expect(screen.getByText(/pulled out of your plan/i)).toBeTruthy();
  });

  it('offers an Apply button and hands the payload back', () => {
    const onApply = vi.fn();
    render(<OnboardingCoachSheet open stepId={OB.GOAL} onClose={() => {}} onApply={onApply} />);
    ask('I want to lose fat');

    const apply = screen.getByRole('button', { name: /Select Lose fat/i });
    fireEvent.click(apply);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toEqual(
      expect.objectContaining({ field: 'goal', value: ['lose'] }),
    );
  });

  // Without an onApply the sheet is advice-only. Rendering a button that
  // silently does nothing would be worse than rendering none.
  it('hides the Apply button when the host cannot act on it', () => {
    render(<OnboardingCoachSheet open stepId={OB.GOAL} onClose={() => {}} />);
    ask('I want to lose fat');
    expect(screen.queryByRole('button', { name: /Select Lose fat/i })).toBeNull();
  });

  it('marks a suggestion as applied so it cannot be double-fired', () => {
    const onApply = vi.fn();
    render(<OnboardingCoachSheet open stepId={OB.GOAL} onClose={() => {}} onApply={onApply} />);
    ask('I want to build muscle');

    const apply = screen.getByRole('button', { name: /Select Add muscle/i });
    fireEvent.click(apply);
    fireEvent.click(apply);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Applied/i })).toBeTruthy();
  });

  it('reads the draft when suggesting, so the answer follows earlier steps', () => {
    const onApply = vi.fn();
    render(
      <OnboardingCoachSheet
        open stepId={OB.DAYS} onClose={() => {}} onApply={onApply}
        draft={{ level: 'newbie', goal: ['strength'] }}
      />,
    );
    ask('how many days should I train?');
    fireEvent.click(screen.getByRole('button', { name: /Select Mon, Wed, Fri/i }));
    // Monday-first indices, matching Onboarding's WEEKDAYS.
    expect(onApply.mock.calls[0][0].value).toEqual([0, 2, 4]);
  });

  // The conversation is about ONE question. Carrying "pick Build strength"
  // into the injury step would leave stale advice above an unrelated one.
  it('resets when the step changes underneath it', () => {
    const { rerender } = render(<OnboardingCoachSheet open stepId={OB.GOAL} onClose={() => {}} />);
    ask('I want to lose fat');
    expect(screen.getByText(/That reads as/i)).toBeTruthy();

    rerender(<OnboardingCoachSheet open stepId={OB.INJURY} onClose={() => {}} />);
    expect(screen.queryByText(/That reads as/i)).toBeNull();
    expect(screen.getByText(/anything currently injured/i)).toBeTruthy();
  });

  it('renders nothing for a step it has no knowledge of', () => {
    render(<OnboardingCoachSheet open stepId="not_a_real_step" onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('serves the nutrition flow from the same sheet', () => {
    const onApply = vi.fn();
    render(
      <OnboardingCoachSheet
        open stepId={NUT.ACTIVITY} onClose={() => {}} onApply={onApply}
        draft={{ currentLbs: 180 }}
      />,
    );
    ask('I sit at a desk all day');
    fireEvent.click(screen.getByRole('button', { name: /Select Sedentary/i }));
    expect(onApply.mock.calls[0][0]).toEqual(
      expect.objectContaining({ field: 'activity', value: 'sedentary' }),
    );
  });

  it('closes from its own control', () => {
    const onClose = vi.fn();
    render(<OnboardingCoachSheet open stepId={OB.GOAL} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close coach'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders **bold** as emphasis rather than literal asterisks', () => {
    render(<OnboardingCoachSheet open stepId={OB.GOAL} onClose={() => {}} />);
    ask('I want to lose fat');
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toMatch(/\*\*/);
    expect(within(dialog).getByText('Lose fat').tagName).toBe('STRONG');
  });
});
