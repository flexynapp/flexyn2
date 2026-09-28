import { describe, it, expect } from 'vitest';
import { matchPath } from 'react-router-dom';
import { usernameFromPath } from '../profileLink';

describe('usernameFromPath', () => {
  it('reads the handle from a shared profile link', () => {
    expect(usernameFromPath('/@sean')).toBe('sean');
    expect(usernameFromPath('/@sean/')).toBe('sean');
  });

  it('decodes an escaped handle and survives a malformed escape', () => {
    expect(usernameFromPath('/@j%C3%B8rn')).toBe('jørn');
    expect(usernameFromPath('/@bad%')).toBe('bad%');
  });

  it('returns empty for anything that is not a profile link', () => {
    expect(usernameFromPath('/')).toBe('');
    expect(usernameFromPath('/@')).toBe('');
    expect(usernameFromPath('/hub')).toBe('');
    expect(usernameFromPath(undefined)).toBe('');
  });

  // Why the helper exists. If the router ever learns partial segments this
  // fails, and the route pattern can come back.
  it('is needed because the router cannot match /@:username', () => {
    expect(matchPath('/@:username', '/@sean')).toBeNull();
  });
});
