// Duplicate-save handling belongs to workouts.create, the only save that
// carries an idempotency key. It used to live in the generic insert in
// src/api/db.js, where every table paid for a check only one table needed
// and nothing at the workouts module said the behaviour existed.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('idempotent workout saves', () => {
  it('src/api/db.js does not handle idempotency keys', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../db.js'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/idempotency|__duplicate/);
  });

  it('workouts.create does', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../lib/data/workouts.js'), 'utf8');
    expect(src).toMatch(/__duplicate: true/);
  });
});
