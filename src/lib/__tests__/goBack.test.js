import { describe, it, expect, vi, afterEach } from 'vitest';
import { goBack, hasInAppHistory, routerStateWithoutPayload } from '@/lib/goBack';

describe('goBack', () => {
  afterEach(() => { window.history.replaceState(null, ''); });

  it('goes back one entry when there is an in-app page behind this one', () => {
    window.history.replaceState({ key: 'a', idx: 2 }, '');
    const navigate = vi.fn();
    goBack(navigate);
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('falls back to Dashboard on the first page of a visit, so Back never leaves the app', () => {
    window.history.replaceState({ key: 'a', idx: 0 }, '');
    const navigate = vi.fn();
    goBack(navigate);
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('falls back when history.state carries no router index', () => {
    window.history.replaceState({}, '');
    expect(hasInAppHistory()).toBe(false);
    const navigate = vi.fn();
    goBack(navigate, '/hub');
    expect(navigate).toHaveBeenCalledWith('/hub');
  });

  it('routerStateWithoutPayload keeps key and idx and drops the hand-off payload', () => {
    window.history.replaceState({ key: 'k', idx: 4, usr: { repeatFromLog: { id: 1 } } }, '');
    expect(routerStateWithoutPayload()).toEqual({ key: 'k', idx: 4, usr: null });
  });
});
