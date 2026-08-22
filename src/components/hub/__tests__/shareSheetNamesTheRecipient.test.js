/**
 * Every row in the share sheet's DM tab said "@User".
 *
 * `const handle = 'User'` — a literal, not a lookup. So twenty conversations
 * rendered twenty identical rows reading "US" / "@User", on a sheet whose
 * only action is to send immediately on tap. Choosing who to forward a post
 * to was guesswork, and the send had already happened by the time the mistake
 * was visible.
 *
 * HubMessages resolves the same thing correctly a few files away, from
 * `participant_ids` through a profiles-by-id map. The fix reuses that
 * derivation AND its query key, so the two share one cache entry.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const SHEET    = read('src/components/hub/ShareSheetModal.jsx');
const MESSAGES = read('src/components/hub/HubMessages.jsx');

// Comment lines stripped before scanning for the literal: the fix's own
// comment quotes the bug it replaced, and the file explaining a defect should
// not be what re-triggers the check for it. Same approach as noNativeDialogs.
const codeOnly = (src) => src
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

describe('ShareSheetModal DM rows', () => {
  it('does not hardcode the handle', () => {
    expect(codeOnly(SHEET), "the literal 'User' is the bug").not.toMatch(/const handle = 'User'/);
  });

  it('resolves the other participant from the conversation', () => {
    expect(SHEET).toMatch(/participant_ids \|\| \[\]\)\.find\(id => id && id !== user\?\.id\)/);
    expect(SHEET).toMatch(/profilesById\[otherId\]\?\.username/);
  });

  it('falls back to the translated placeholder, not to a hardcoded word', () => {
    // "Athlete" is the catalog's English for this key and is translated in
    // all eight locales; a bare English literal here would ship untranslated.
    expect(SHEET).toMatch(/tFallback\('hub\.profile\.anonymousAthlete', 'Athlete'\)/);
  });

  it('shares HubMessages\' cache key rather than starting a second one', () => {
    // Both sheets are open over the same inbox. A different key would fetch
    // the same profiles twice and let the two disagree.
    const keyOf = (src) => (src.match(/queryKey: \['hubMessageProfiles'[^\]]*\]/) || [])[0];
    expect(keyOf(SHEET), 'the share sheet must use the shared key').toBeTruthy();
    expect(keyOf(SHEET)).toBe(keyOf(MESSAGES));
  });

  it('HubMessages still derives it the way this file copies', () => {
    // Keeps the assertions above honest: if HubMessages changes shape, the
    // copy here is no longer "the same derivation" and should be re-read.
    expect(MESSAGES).toMatch(/participant_ids \|\| \[\]\)\.find\(id => id && id !== user\?\.id\)/);
  });
});
