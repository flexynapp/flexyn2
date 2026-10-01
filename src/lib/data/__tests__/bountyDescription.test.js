import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/supabaseClient', () => ({ supabase: { auth: { onAuthStateChange: vi.fn() } } }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

import { bountyDescription } from '../bounties';

describe('bountyDescription', () => {
  it('converts session volume to kg like the other weight metrics', () => {
    const text = bountyDescription({ metric: 'session_volume', target_value: 2204.62 }, 'en', 'kg');
    expect(text).toBe('Session volume: beat 1,000 kg');
  });

  it('names the lift and uses no dash', () => {
    const text = bountyDescription(
      { metric: 'single_lift_reps', exercise_name: 'Squat', target_value: 12 }, 'en', 'lbs',
    );
    expect(text).toBe('Max reps on Squat: beat 12 reps');
    expect(text).not.toMatch(/[—–]/);
  });

  it('goes through the translator with every variable', () => {
    const tf = vi.fn((key, _en, vars) => `${key}|${JSON.stringify(vars || {})}`);
    bountyDescription({ metric: 'weekly_volume', target_value: 100 }, 'en', 'lbs', tf);
    expect(tf).toHaveBeenCalledWith('bounty.desc.plain', expect.any(String),
      expect.objectContaining({ target: '100', unit: 'lbs' }));
  });
});
