// Tests for src/lib/adminRoles.js — the client-side admin gate. The
// server enforces the same list inside is_app_admin() in migration
// 084, so the client check is decoration.

import { describe, it, expect } from 'vitest';
import { isAppAdmin, ADMIN_USERNAMES } from '../adminRoles';

describe('isAppAdmin', () => {
  it('returns true when username matches the whitelist (any case)', () => {
    expect(isAppAdmin({ username: 'sean' })).toBe(true);
    expect(isAppAdmin({ username: 'Sean' })).toBe(true);
    expect(isAppAdmin({ username: 'KEGAN' })).toBe(true);
  });

  it('falls back to email prefix when username is unset', () => {
    expect(isAppAdmin({ email: 'kegan@flexyn.app' })).toBe(true);
    expect(isAppAdmin({ email: 'Admin@example.com' })).toBe(true);
  });

  it('returns false for a non-whitelisted user', () => {
    expect(isAppAdmin({ username: 'random', email: 'random@x.com' })).toBe(false);
  });

  it('returns false for null / undefined input', () => {
    expect(isAppAdmin(null)).toBe(false);
    expect(isAppAdmin(undefined)).toBe(false);
  });

  it('returns false for missing username AND missing email', () => {
    expect(isAppAdmin({})).toBe(false);
  });

  it('exports a non-empty ADMIN_USERNAMES list', () => {
    expect(Array.isArray(ADMIN_USERNAMES)).toBe(true);
    expect(ADMIN_USERNAMES.length).toBeGreaterThan(0);
  });
});
