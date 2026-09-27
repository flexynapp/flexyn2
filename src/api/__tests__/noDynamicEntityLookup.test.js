// src/api/__tests__/noDynamicEntityLookup.test.js
//
// Each table moved off the old `db.entities` client has a ratchet that fails
// on `entities.<Name>` outside its data module. A lookup by a name held in a
// string, `db.entities[name]`, gets past every one of them: the Coach context
// read meals and weigh-ins that way after both tables were declared done.
//
// This fails on any bracket lookup.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// PostActivityBlock was the last one; its share-card fallback now calls each
// table's data module by id.
const KNOWN = [];

describe('no lookup of db.entities by a string name', () => {
  it('no source file does it', () => {
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
