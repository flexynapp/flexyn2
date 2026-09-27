// Capsule rows are written only by the server. open_capsule_atomic rolls and
// marks a capsule opened, finalize_capsule_claim stamps it collected, and the
// grant RPCs create them; the user_capsules guard trigger refuses a client
// UPDATE or INSERT outright. src/lib/data/capsules.js carried a direct
// `update({ is_opened: true })` with no callers until the round 2 redesign
// removed it. This keeps it, and anything like it, from coming back.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'i18n-langs') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe('the client never writes a capsule row', () => {
  it('has no insert, update, upsert or delete against user_capsules', () => {
    const offenders = [];
    for (const file of walk(path.resolve('src'))) {
      // Comments are stripped: capsules.js explains the old INSERT in prose.
      const src = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      // Each chain from .from('user_capsules') to the end of its statement.
      for (const m of src.matchAll(/\.from\(\s*['"]user_capsules['"]\s*\)([^;]*)/g)) {
        if (/\.(insert|update|upsert|delete)\s*\(/.test(m[1])) {
          offenders.push(path.relative(process.cwd(), file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('opens capsules through the server functions', () => {
    const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
    expect(read('src/components/hub/CapsuleOpener.jsx')).toMatch(/rpc\('open_capsule_atomic'/);
    expect(read('src/lib/inventoryFlow.js')).toMatch(/rpc\('finalize_capsule_claim'/);
    expect(read('src/lib/data/capsules.js')).not.toMatch(/export\s+async\s+function\s+openCapsule\b/);
  });
});
