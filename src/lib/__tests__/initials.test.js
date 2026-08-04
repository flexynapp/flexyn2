import { describe, it, expect } from 'vitest';
import { initialsFor } from '../initials';

describe('initialsFor', () => {
  it('prefers username over full_name', () => {
    // This ordering IS the fix — five of six call sites were already
    // username-based and Hub profiles are username-only by design, so
    // resolving the drift the other way would have leaked real names onto
    // a surface that deliberately does not show them.
    expect(initialsFor({ username: 'revbot', full_name: 'Alex Rivera' })).toBe('RE');
  });

  it('falls back to full_name initials when there is no username', () => {
    expect(initialsFor({ full_name: 'Alex Rivera' })).toBe('AR');
  });

  it('takes only the first two words of a longer name', () => {
    expect(initialsFor({ full_name: 'Ada Beatrice Clarke' })).toBe('AB');
  });

  it('does not emit a leading space from irregular whitespace', () => {
    // '  Kegan' split on ' ' used to yield ['', '', 'Kegan'] → ' K', which
    // renders visibly off-centre inside the avatar circle.
    expect(initialsFor({ full_name: '  Kegan  Bergeron ' })).toBe('KB');
  });

  it('falls back to the email local-part, never the full address', () => {
    const out = initialsFor({ email: 'j.smith.cfo@acme.com' });
    expect(out).toBe('J.');
    expect(out).not.toContain('@');
    expect(out).not.toContain('acme');
  });

  it('returns the fallback when there is nothing usable', () => {
    expect(initialsFor(null)).toBe('?');
    expect(initialsFor(undefined)).toBe('?');
    expect(initialsFor({})).toBe('?');
    expect(initialsFor({ username: '', full_name: '   ', email: '' })).toBe('?');
  });

  it('honours a custom fallback', () => {
    expect(initialsFor(null, '–')).toBe('–');
  });

  it('treats a bare string as a username', () => {
    expect(initialsFor('revbot')).toBe('RE');
  });

  it('always upper-cases', () => {
    expect(initialsFor({ username: 'kegan' })).toBe('KE');
    expect(initialsFor({ full_name: 'ada lovelace' })).toBe('AL');
  });

  it('agrees between the two call sites that used to disagree', () => {
    // ProfileMenu passed the whole user object; HubProfile passes only the
    // resolved username. For any account carrying a username, both must land
    // on the same two letters — that identity is the whole point of the file.
    const user = { username: 'revbot', full_name: 'Alex Rivera', email: 'a@b.com' };
    expect(initialsFor(user)).toBe(initialsFor({ username: user.username }));
  });
});
