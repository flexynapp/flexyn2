import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null, isLoadingAuth: false }) }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (_k, english) => english, t: (k) => k }),
}));

import PublicProfile from '../PublicProfile';

// Mirrors the public branch in App.jsx: one catch-all route, no params.
const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="*" element={<PublicProfile />} /></Routes>
  </MemoryRouter>,
);

describe('PublicProfile on a shared /@username link', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it('looks up the username in the path', async () => {
    renderAt('/@sean');
    await waitFor(() => expect(rpc).toHaveBeenCalledWith(
      'get_public_profile_by_username', { p_username: 'sean' },
    ));
  });

  it('shows the profile it found', async () => {
    rpc.mockResolvedValue({ data: { id: 'u1', username: 'sean', full_name: 'Sean' }, error: null });
    const { findAllByText } = renderAt('/@sean');
    expect((await findAllByText('@sean')).length).toBeGreaterThan(0);
  });
});

describe('PublicProfile privacy', () => {
  beforeEach(() => rpc.mockReset());

  it('shows the private gate when the server withholds stats', async () => {
    rpc.mockResolvedValue({
      data: { id: 'u2', username: 'kim', is_private: true, full_view: false, current_level: null },
      error: null,
    });
    const { findByText, queryByText } = renderAt('/@kim');
    expect(await findByText('This profile is private')).toBeTruthy();
    expect(queryByText('Level')).toBeNull();
  });

  it('shows stats when the server grants full view', async () => {
    rpc.mockResolvedValue({
      data: { id: 'u3', username: 'ana', is_private: true, full_view: true, current_level: 7, workout_streak: 3 },
      error: null,
    });
    const { findByText, queryByText } = renderAt('/@ana');
    expect(await findByText('Level')).toBeTruthy();
    expect(queryByText('This profile is private')).toBeNull();
  });
});
