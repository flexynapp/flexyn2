/**
 * TapToCopy — the shared copy affordance.
 *
 * It built both of its user-facing strings by interpolating an English noun
 * into an English frame: `Copied ${label}` and `Copy ${label}`, with the
 * noun hardcoded at every call site. Six screens of copy feedback, and six
 * aria-labels, were English in all 15 languages — on a component whose
 * entire job is making a number one-tap shareable.
 *
 * Both strings carry a `{label}` placeholder, so per CLAUDE.md the stub
 * here IGNORES the English fallback: the house `(key, english) => english`
 * stub hands back the already-interpolated English and passes whether or
 * not the call site forwarded its vars.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const successToast = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: { success: (...a) => successToast(...a), error: vi.fn() } }));
vi.mock('@/lib/haptic', () => ({ triggerHaptic: vi.fn() }));

const TPL = {
  'copy.toast': 'XX:copiado: {label}',
  'copy.action': 'XX:copiar {label}',
};
const mark = (key, _en, vars) => {
  let s = TPL[key] ?? `XX:${key}`;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)); });
  return s;
};
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (k, e, v) => mark(k, e, v) }),
}));

import TapToCopy from '@/components/TapToCopy';

const writeText = vi.fn(() => Promise.resolve());
beforeEach(() => {
  successToast.mockClear();
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(cleanup);

describe('both strings go through the translation layer', () => {
  it('labels the control from a key, with the noun forwarded', () => {
    render(<TapToCopy value="225 lb" label="racha"><span>225</span></TapToCopy>);
    // Not just `toContain('XX:copiar')` — the noun has to have arrived
    // through vars, so a dropped third argument is visible here.
    expect(screen.getByLabelText('XX:copiar racha')).toBeTruthy();
  });

  it('toasts from a key, with the noun forwarded', async () => {
    render(<TapToCopy value="225 lb" label="racha"><span>225</span></TapToCopy>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(successToast).toHaveBeenCalled());
    expect(successToast.mock.calls[0][0]).toBe('XX:copiado: racha');
  });

  it('translates its own default noun when a caller passes none', () => {
    render(<TapToCopy value="225 lb"><span>225</span></TapToCopy>);
    // The default used to be the English literal 'value' in the signature,
    // where no hook can reach it.
    expect(screen.getByLabelText('XX:copiar XX:copy.noun.value')).toBeTruthy();
  });

  it('leaves no English frame on the element', () => {
    render(<TapToCopy value="225 lb" label="racha"><span>225</span></TapToCopy>);
    const el = screen.getByRole('button');
    expect(el.getAttribute('aria-label')).not.toContain('Copy ');
    expect(el.getAttribute('aria-label')).not.toContain('{label}');
  });

  it('still copies the value itself, which is not translated', async () => {
    render(<TapToCopy value="225 lb" label="racha"><span>225</span></TapToCopy>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('225 lb'));
  });

  it('does not toast when there is nothing to copy', () => {
    render(<TapToCopy value="   " label="racha"><span>—</span></TapToCopy>);
    fireEvent.click(screen.getByRole('button'));
    expect(successToast).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('every call site passes a translated noun', () => {
  it('has no hardcoded label= string left', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const hits = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!/__tests__|node_modules/.test(e.name)) walk(p); continue; }
        if (!/\.jsx$/.test(e.name)) continue;
        const src = fs.readFileSync(p, 'utf8');
        if (!/<TapToCopy/.test(src)) continue;
        // `label="rank"` — a bare string is the shape that was wrong at
        // every one of these six call sites.
        for (const m of src.matchAll(/<TapToCopy[\s\S]{0,400}?>/g)) {
          const bare = m[0].match(/\blabel=["'][^"']+["']/);
          if (bare) hits.push(`${p}: ${bare[0]}`);
        }
      }
    })('src');
    expect(hits, `hardcoded labels: ${hits.join(', ')}`).toEqual([]);
  });
});
