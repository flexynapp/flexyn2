// Tests for src/components/ui/FormattedNumberInput — verifies that
// the input formats on blur, reverts to raw on focus, parses pasted
// values with separators, clamps to min/max on commit, and yields
// null for empty input rather than NaN.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FormattedNumberInput from '../FormattedNumberInput';

describe('FormattedNumberInput', () => {
  it('renders the formatted value when blurred', () => {
    render(<FormattedNumberInput value={1234} onChange={() => {}} locale="en-US" />);
    const input = screen.getByRole('textbox');
    expect(input.value).toBe('1,234');
  });

  it('reverts to raw digits when focused', () => {
    render(<FormattedNumberInput value={1234} onChange={() => {}} locale="en-US" />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    expect(input.value).toBe('1234');
  });

  it('formats again on blur', () => {
    render(<FormattedNumberInput value={1234} onChange={() => {}} locale="en-US" />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    expect(input.value).toBe('1234');
    fireEvent.blur(input);
    expect(input.value).toBe('1,234');
  });

  it('parses typed input and calls onChange with a Number', () => {
    const onChange = vi.fn();
    render(<FormattedNumberInput value={null} onChange={onChange} locale="en-US" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '500' } });
    expect(onChange).toHaveBeenCalledWith(500);
  });

  it('returns null when the input is cleared', () => {
    const onChange = vi.fn();
    render(<FormattedNumberInput value={100} onChange={onChange} locale="en-US" />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('strips locale group separator from pasted input (en)', () => {
    const onChange = vi.fn();
    render(<FormattedNumberInput value={null} onChange={onChange} locale="en-US" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '1,500' } });
    expect(onChange).toHaveBeenLastCalledWith(1500);
  });

  it('preserves decimal values when allowDecimals=true', () => {
    const onChange = vi.fn();
    render(<FormattedNumberInput value={null} onChange={onChange} locale="en-US" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '100.5' } });
    expect(onChange).toHaveBeenLastCalledWith(100.5);
  });

  it('strips decimal separator when allowDecimals=false', () => {
    const onChange = vi.fn();
    render(<FormattedNumberInput value={null} onChange={onChange} locale="en-US" allowDecimals={false} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '100.5' } });
    expect(onChange).toHaveBeenLastCalledWith(1005);
  });

  it('clamps to min on blur', () => {
    const onChange = vi.fn();
    render(<FormattedNumberInput value={-5} onChange={onChange} min={0} locale="en-US" />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('clamps to max on blur', () => {
    const onChange = vi.fn();
    render(<FormattedNumberInput value={9999} onChange={onChange} max={1500} locale="en-US" />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(1500);
  });
});
