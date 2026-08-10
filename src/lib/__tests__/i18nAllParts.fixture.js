// The union of every English key across all i18n part files.
//
// A key's English half and its translations do not have to live in the same
// part file — `scripts/split-i18n.mjs` merges them before anything reads
// them, and `notifications.markAllReadError` is a real example (English in
// i18n-batch2.js, the other 14 in i18n-notifications.js). Tests that check a
// single part file for internal symmetry need this to tell a legitimate
// split from an orphan.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const en = new Set();

for (const file of fs.readdirSync(LIB).filter(f => /^i18n-[a-z0-9-]+\.js$/.test(f))) {
  const mod = await import(path.join(LIB, file));
  const obj = mod.default || Object.values(mod).find(v => v && typeof v === 'object' && v.en);
  if (!obj?.en) continue;
  for (const k of Object.keys(obj.en)) en.add(k);
}

export default { en };
