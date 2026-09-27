// src/api/__tests__/noDynamicEntityLookup.test.js
//
// Each table moved off the old `db.entities` client has a ratchet that fails
// on `entities.<Name>` outside its data module. A lookup by a name held in a
// string, `db.entities[name]`, gets past every one of them: the Coach context
// read meals and weigh-ins that way after both tables were declared done.
//
// This fails on any new bracket lookup. The one file still doing it is listed
// below, and the list is checked in both directions, so fixing it without
// taking it off the list also fails rather than leaving a stale exception.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const KNOWN = [
  // Share cards fetch the shared row by id when the post has no snapshot.
  // It spans five tables, so it moves when the last of them does.
  join('components', 'hub', 'PostActivityBlock.jsx'),
];

describe('no lookup of db.entities by a string name', () => {
  it('only the known file does it, and it still does', () => {
    const root = join(process.cwd(), 'src');
    const found = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'i18n-langs') walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        const code = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        if (/entities\s*(\?\.)?\s*\[/.test(code)) found.push(relative(root, p));
      }
    };
    walk(root);
    expect(found.sort()).toEqual([...KNOWN].sort());
  });
});
