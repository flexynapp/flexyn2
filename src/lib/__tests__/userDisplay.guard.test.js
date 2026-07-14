// Guard test: no email (or email fragment) may be rendered in the UI layer.
//
// ENTERPRISE RULE — a user is shown by username/full name, never by email.
// This scans src/components and src/pages for the `email.split('@')` pattern
// (deriving a "name" from an email's local part) and fails the build if any
// reappear. Use src/lib/userDisplay.js (displayName / handle) instead.
//
// Rare, legitimate non-display uses of an email's local part (e.g. computing a
// value that is never rendered) may opt out by putting `email-local-part-ok`
// in a comment on the same line.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { displayName, handle, maskEmail } from '../userDisplay';

const ROOTS = ['src/components', 'src/pages'];
const CODE_EXT = /\.(jsx?|tsx?)$/;
const EMAIL_SPLIT = /\.split\((['"])@\1\)/;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (CODE_EXT.test(name)) acc.push(full);
  }
  return acc;
}

describe('UI never renders an email fragment', () => {
  it('has no email.split("@") in src/components or src/pages', () => {
    const offenders = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (EMAIL_SPLIT.test(line) && !line.includes('email-local-part-ok')) {
            offenders.push(`${file}:${i + 1}  ${line.trim()}`);
          }
        });
      }
    }
    expect(
      offenders,
      `email→name fallback found (renders PII); use displayName/handle:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('userDisplay helper never leaks email', () => {
  it('resolves names without ever returning an email', () => {
    expect(displayName({ username: 'kegan' })).toBe('kegan');
    expect(displayName({ author_name: '@coach' })).toBe('coach');
    expect(displayName({ full_name: 'Sam Fit' })).toBe('Sam Fit');
    expect(displayName({ email: 'secret@example.com' })).toBe('Athlete');
    expect(displayName({ email: 'secret@example.com' }, 'Someone')).toBe('Someone');
    expect(displayName(null)).toBe('Athlete');
    expect(handle({ username: 'kegan' })).toBe('@kegan');
    expect(handle({ email: 'secret@example.com' })).toBe('@athlete');
  });

  it('maskEmail hides the local part and never emits a full address', () => {
    expect(maskEmail('john.doe@gmail.com')).toBe('joh•••@gmail.com');
    expect(maskEmail('a@b.com')).toBe('a•••@b.com');
    expect(maskEmail(null)).toBe('account');
    expect(maskEmail('notanemail')).toBe('account');
  });
});
