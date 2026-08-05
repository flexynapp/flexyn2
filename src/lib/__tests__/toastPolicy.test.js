// src/lib/__tests__/toastPolicy.test.js
//
// The toast policy has now been wrong twice, in the same direction, and both
// times the symptom was silence rather than an error — so nothing failed and
// nobody noticed for a month.
//
//   2026-08-04  271 of 283 `success` calls rendered nothing.
//   2026-08-05  28 of 28 `info` / `message` / `warning` calls rendered nothing.
//
// The second one is the interesting one: the first fix scanned only `success`,
// concluded the problem was solved, and left three variants in exactly the
// same state. What made both invisible is that `keepIfAction` returns
// `undefined` and every call site ignores the return value. A dropped toast
// looks identical to a delivered one from the caller's side.
//
// So this file asserts on the OUTCOME — did sonner actually get called — and
// not on how the module is written. If someone re-filters a variant, this
// fails and tells them to re-run the audit first.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sonnerCalls = [];

vi.mock('sonner', () => {
  const rec = (variant) => (message, opts) => {
    sonnerCalls.push({ variant, message, opts });
    return 'toast-id';
  };
  const t = rec('default');
  t.success = rec('success');
  t.info = rec('info');
  t.message = rec('message');
  t.warning = rec('warning');
  t.error = rec('error');
  t.loading = rec('loading');
  t.custom = rec('custom');
  t.dismiss = rec('dismiss');
  return { toast: t };
});

const { toast } = await import('@/lib/toast');

beforeEach(() => { sonnerCalls.length = 0; });
afterEach(() => { sonnerCalls.length = 0; });

// The variants that must reach the user with no `action` attached. Every one
// of these carries messages about something the user just did.
const MUST_DELIVER = ['success', 'info', 'message', 'warning', 'error'];

describe('toast policy — variants that must reach the user', () => {
  for (const variant of MUST_DELIVER) {
    it(`toast.${variant}() delivers with no action attached`, () => {
      toast[variant]('a message with no action');
      expect(
        sonnerCalls,
        `toast.${variant} dropped a message that carried no \`action\`.\n` +
          `If this was deliberate, re-run the call-site audit first: a variant\n` +
          `where every caller passes no action is not being filtered, it is\n` +
          `being switched off. See the header of src/lib/toast.js.`,
      ).toHaveLength(1);
      expect(sonnerCalls[0].variant).toBe(variant);
    });
  }

  it('passes options through, so descriptions and actions survive', () => {
    const action = { label: 'Undo', onClick: () => {} };
    toast.success('Deleted', { description: 'Gone for good', action });
    expect(sonnerCalls[0].opts).toMatchObject({ description: 'Gone for good', action });
  });

  it('still suppresses decoration', () => {
    toast.loading('spinner');
    toast.custom('whatever');
    expect(sonnerCalls).toHaveLength(0);
  });

  it('keeps plain toast() action-gated', () => {
    // The bare form is the one the original policy was really aimed at, and
    // it is the only place the gate still applies.
    toast('passive badge');
    expect(sonnerCalls).toHaveLength(0);

    toast('undo me', { action: { label: 'Undo', onClick: () => {} } });
    expect(sonnerCalls).toHaveLength(1);
  });
});

// ── The audit that caught it, as a standing check ──────────────────────────
//
// Counting call sites is what turned "these are the chatty ones" into "all 28
// of them are switched off". Keep measuring it: if a variant ever goes back
// behind the gate, this number is the argument.

describe('toast call-site audit', () => {
  const SRC = resolve(process.cwd(), 'src');

  function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (!['node_modules', '__tests__'].includes(entry)) walk(p, out);
      } else if (/\.jsx?$/.test(entry)) out.push(p);
    }
    return out;
  }

  // Paren-balanced so a multi-line call is read whole; string-aware so a
  // paren inside a message doesn't end the call early.
  function callsFor(src, variant) {
    const out = [];
    const re = new RegExp(`toast\\.${variant}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length - 1;
      const start = i;
      let depth = 0;
      let quote = null;
      for (; i < src.length; i++) {
        const c = src[i];
        if (quote) {
          if (c === '\\') { i++; continue; }
          if (c === quote) quote = null;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) break; }
      }
      out.push(src.slice(start, i + 1));
    }
    return out;
  }

  it('most callers still pass no action — which is why the gate could not stay', () => {
    const files = walk(SRC).filter((f) => !f.endsWith(`lib${'/'}toast.js`));
    let total = 0;
    let withoutAction = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const variant of ['info', 'message', 'warning']) {
        for (const call of callsFor(src, variant)) {
          total++;
          if (!/\baction\s*:/.test(call)) withoutAction++;
        }
      }
    }
    // Not asserting an exact count — call sites come and go. Asserting the
    // shape of the problem: these variants are overwhelmingly used without an
    // action, so gating them on one is equivalent to deleting them.
    expect(total).toBeGreaterThan(10);
    expect(withoutAction / total).toBeGreaterThan(0.5);
  });
});
