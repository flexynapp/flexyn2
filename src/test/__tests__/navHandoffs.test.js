// Every router-state hand-off must have a reader.
//
// navigate('/page', { state: { someKey } }) fails silently when the page
// reads a different key: the tap lands on the page and nothing happens.
// Three shipped that way, found in the navigation audit (2026-09-24):
// "Repeat this workout" sent `repeatLog` to a page reading `repeatFromLog`,
// Today's Plan sent `selectedRegimenId` to a page reading nothing, and the
// crew war card sent `openCrewWars`, which Hub never read. No unit test
// caught any of them because each side was correct on its own.
//
// This scans the source for every key sent through navigate(..., { state })
// and fails if no non-test file reads `state?.<key>` or `state.<key>`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '__tests__' || name === 'i18n-langs' || name === 'test') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

// Strip line comments so a key quoted in an explanatory comment (several
// files describe the old broken keys) counts as neither a send nor a read.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

const files = walk(ROOT).map((f) => ({ f, src: stripComments(fs.readFileSync(f, 'utf8')) }));

function sentKeys() {
  const sent = new Map();
  const re = /navigate\(\s*[^,()]+,\s*\{[^{}]*?state:\s*\{([^{}]*)\}/g;
  for (const { f, src } of files) {
    let m;
    while ((m = re.exec(src))) {
      for (const part of m[1].split(',')) {
        const key = part.trim().split(/[:\s]/)[0];
        if (/^[A-Za-z_$][\w$]*$/.test(key)) {
          if (!sent.has(key)) sent.set(key, []);
          sent.get(key).push(path.relative(ROOT, f));
        }
      }
    }
  }
  return sent;
}

describe('router state hand-offs', () => {
  const sent = sentKeys();

  it('finds the hand-offs it is meant to guard', () => {
    // If the regex rots and matches nothing, every check below passes vacuously.
    expect(sent.has('repeatFromLog')).toBe(true);
    expect(sent.has('startRegimen')).toBe(true);
    expect(sent.size).toBeGreaterThanOrEqual(6);
  });

  it('every key sent through navigate state is read somewhere', () => {
    const unread = [];
    for (const [key, senders] of sent) {
      const read = new RegExp(`state(\\?)?\\.${key}\\b|\\{[^}]*\\b${key}\\b[^}]*\\}\\s*=\\s*(location\\.)?state`);
      if (!files.some(({ src }) => read.test(src))) unread.push(`${key} (sent from ${senders.join(', ')})`);
    }
    expect(unread).toEqual([]);
  });
});
