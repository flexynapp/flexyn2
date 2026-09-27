// The exercise search draws ONE panel under the field: the equipment filter
// on top, the matches below it, and a plain line when nothing matches. The
// chips used to float with no surface over whatever sat below the field.

import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@/test/utils';
import ExerciseAutocomplete from '../ExerciseAutocomplete';
import { LanguageProvider } from '@/lib/LanguageContext';

function Host() {
  const [v, setV] = useState('');
  return (
    <LanguageProvider>
      <ExerciseAutocomplete value={v} onChange={setV} onSelect={() => {}} placeholder="Search exercise" />
    </LanguageProvider>
  );
}

const type = async (text) => {
  render(<Host />);
  const input = await screen.findByPlaceholderText('Search exercise');
  fireEvent.change(input, { target: { value: text } });
  return input;
};

describe('exercise search panel', () => {
  it('draws the filter chips and the matches inside one container', async () => {
    await type('bench');
    const chip = screen.getByRole('button', { name: /^all$/i });
    const match = screen.getAllByRole('button', { name: /bench press/i })[0];
    const panel = chip.closest('.rounded-2xl');
    expect(panel).not.toBeNull();
    expect(panel.contains(match)).toBe(true);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    // Orange stays on the acting button; a pressed chip is neutral.
    expect(chip.className).not.toMatch(/bg-primary/);
  });

  it('says so in a plain line when nothing matches', async () => {
    await type('zzqxv');
    expect(screen.getByText('No exercise matches that name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument();
  });

  it('draws nothing for an empty query', async () => {
    const input = await type('bench');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByRole('button', { name: /^all$/i })).toBeNull();
    expect(screen.queryByText('No exercise matches that name.')).toBeNull();
  });

  it('draws nothing for whitespace', async () => {
    await type('   ');
    expect(screen.queryByRole('button', { name: /^all$/i })).toBeNull();
    expect(screen.queryByText('No exercise matches that name.')).toBeNull();
  });
});
