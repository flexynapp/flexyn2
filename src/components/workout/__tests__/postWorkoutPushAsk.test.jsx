// Asking for notifications right after a workout is saved. The ask must
// only appear when a yes is still possible, and only once, or it becomes
// the nag that gets the app's notifications blocked for good.

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PostWorkoutPushAsk, { shouldAskAfterWorkout } from '../PostWorkoutPushAsk';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const h = vi.hoisted(() => ({
  push: { isSupported: true, isSubscribed: false, permission: 'default', isLoading: false, subscribe: vi.fn() },
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/usePushSubscription', () => ({ usePushSubscription: () => h.push }));
vi.mock('@/lib/toast', () => ({ toast: { success: h.success, error: h.error } }));

function Harness({ onDone = () => {} }) {
  const [armed, setArmed] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setArmed(true)}>finish</button>
      <PostWorkoutPushAsk armed={armed} onDone={() => { setArmed(false); onDone(); }} />
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  Object.assign(h.push, { isSupported: true, isSubscribed: false, permission: 'default' });
  h.push.subscribe.mockReset();
});

describe('shouldAskAfterWorkout', () => {
  it('asks only when a yes is still possible and it has not asked before', () => {
    const base = { isSupported: true, isSubscribed: false, permission: 'default', asked: false };
    expect(shouldAskAfterWorkout(base)).toBe(true);
    expect(shouldAskAfterWorkout({ ...base, isSupported: false })).toBe(false);
    expect(shouldAskAfterWorkout({ ...base, isSubscribed: true })).toBe(false);
    expect(shouldAskAfterWorkout({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldAskAfterWorkout({ ...base, permission: 'granted' })).toBe(false);
    expect(shouldAskAfterWorkout({ ...base, asked: true })).toBe(false);
  });
});

describe('after a workout', () => {
  it('asks, and turning it on subscribes', async () => {
    h.push.subscribe.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);
    expect(screen.queryByText('Keep your streak alive')).toBeNull();
    fireEvent.click(screen.getByText('finish'));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(h.push.subscribe).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalled();
  });

  it('asks only once on this device, even after Not now', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('finish'));
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText('Turn on notifications')).toBeNull());
    fireEvent.click(screen.getByText('finish'));
    expect(screen.queryByText('Turn on notifications')).toBeNull();
  });

  it('never asks someone the browser has already answered', () => {
    h.push.permission = 'denied';
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);
    fireEvent.click(screen.getByText('finish'));
    expect(screen.queryByText('Turn on notifications')).toBeNull();
    expect(onDone).toHaveBeenCalled();
  });
});
