// The Base44-shaped `db.entities.X` client was removed on 2026-09-27, after
// every table had moved to its own module in src/lib/data/. It built a table
// accessor from a string, so no name was ever checked: PostActivityBlock
// asked for an entity called 'Workout' and silently got nothing.
//
// Two guards keep it gone, and this file tests both: the export no longer
// has it, and the lint rule that refuses it is wired to real source paths.
// A rule that exists but matches no files passes every lint run in silence.

import { describe, it, expect, vi } from 'vitest';
import { ESLint } from 'eslint';

vi.mock('@/api/supabaseClient', () => ({
  supabase: { auth: { onAuthStateChange: vi.fn() } },
}));
vi.mock('@/lib/pushCleanup', () => ({ unsubscribePushOnLogout: vi.fn() }));

describe('db.entities is gone', () => {
  it('db no longer exports it', async () => {
    const { db } = await import('@/api/db');
    expect('entities' in db).toBe(false);
  });

  it.each([
    ['src/lib/data/anything.js', 'db.entities.Goal.list()'],
    ['src/components/hub/Anything.jsx', "db['entities'].Goal"],
    ['src/pages/Anything.jsx', 'const { entities } = db; entities.Goal.list();'],
  ])('lint refuses it in %s', async (filePath, code) => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(
      `import { db } from '@/api/db';\n${code}\n`,
      { filePath },
    );
    const hits = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe(2);
  });
});
