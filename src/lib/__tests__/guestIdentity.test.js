/**
 * A guest is fully authenticated and has no email, and six places disagreed
 * about what to do with that.
 *
 * `signInAnonymously()` produces an account with NO `auth.users.email` —
 * measured at 0 of 27 in migration 366. The address it does have is
 * `guest_<uuid>@flexyn.guest` on `user_profiles`, written by migration 172's
 * trigger. Four modules each carried their own correct copy of the fallback
 * (sleepLogs, stepLogs, moodLogs, and makeEntity in api/db.js) and two more
 * needed it and did something else:
 *
 *   storyReactions  wrote the raw auth email into a NOT NULL column, so a
 *                   guest's reaction 23502'd. The emoji lit up optimistically
 *                   and silently reverted, and no retry could ever work.
 *   storyHighlights GUARDED on it, so a guest got "Could not create — try
 *                   again" every time, describing neither cause nor remedy.
 *
 * Four copies and two divergences is the shape that produced the seven-copy
 * default translator, six of which were wrong. One helper now, and the last
 * test here is the one that keeps it one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { accountEmail } from '../guestIdentity';

describe('accountEmail', () => {
  it('prefers a real address', () => {
    expect(accountEmail({ id: 'abc', email: 'kegan@example.com' })).toBe('kegan@example.com');
  });

  it('synthesises the placeholder the trigger wrote for a guest', () => {
    // Must match migration 172's `handle_new_user` exactly, or the row is
    // keyed by an address nothing else looks it up under.
    expect(accountEmail({ id: '11111111-2222-3333-4444-555555555555' }))
      .toBe('guest_11111111-2222-3333-4444-555555555555@flexyn.guest');
  });

  it('returns null when there is no account at all', () => {
    // Distinct from a guest: callers gate on this to mean "not signed in".
    expect(accountEmail(null)).toBeNull();
    expect(accountEmail(undefined)).toBeNull();
    expect(accountEmail({})).toBeNull();
  });

  it('does not invent an address from an empty string id', () => {
    expect(accountEmail({ id: '', email: '' })).toBeNull();
  });
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p, out); }
    else if (/\.jsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('there is one copy of it', () => {
  it('nothing hand-rolls the guest placeholder any more', () => {
    // The literal that was copied four times. A fifth copy is how the two
    // divergences happened, so this is the guard against a sixth.
    const offenders = [];
    for (const f of walk(resolve(process.cwd(), 'src'))) {
      if (f.endsWith('guestIdentity.js')) continue;
      const text = readFileSync(f, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // the reasoning names it
        if (/`guest_\$\{[^}]+\}@flexyn\.guest`/.test(line)) {
          offenders.push(`${f.replace(process.cwd() + '/', '')}:${i + 1}`);
        }
      });
    }
    expect(offenders, 'import accountEmail instead of re-deriving it').toEqual([]);
  });

  it('the modules that used to hand-roll it now import it', () => {
    for (const rel of [
      'src/lib/data/sleepLogs.js',
      'src/lib/data/stepLogs.js',
      'src/lib/data/moodLogs.js',
      'src/api/db.js',
      'src/lib/data/storyReactions.js',
      'src/lib/data/storyHighlights.js',
    ]) {
      expect(readFileSync(resolve(process.cwd(), rel), 'utf8'), `${rel} should use the helper`)
        .toMatch(/accountEmail/);
    }
  });
});

describe('the two that were broken for guests', () => {
  const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

  it('a story reaction writes an address, never a NULL', () => {
    expect(read('src/lib/data/storyReactions.js')).toMatch(/user_email: accountEmail\(user\)/);
  });

  it('creating a highlight no longer refuses an account with no auth email', () => {
    const f = read('src/lib/data/storyHighlights.js');
    expect(f).toMatch(/if \(!user\?\.id\) return \{ ok: false, reason: 'unauthenticated' \};/);
    expect(f, 'the email half of the guard is what turned guests away')
      .not.toMatch(/!user\?\.id \|\| !user\?\.email/);
  });
});
