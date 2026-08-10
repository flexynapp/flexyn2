/**
 * `useListFormatter` / locale list separators.
 *
 * The reason this file exists is the finding it pins in the second block:
 * `Intl.ListFormat`'s `type: 'unit'` LOOKS like "a list without the and",
 * which is exactly what a tag or enumeration list wants. It is not. It is
 * for measurement units ("5 ft, 3 in"), and in Chinese it emits NO separator
 * whatsoever while German and French still inject their conjunction.
 *
 * That is why the 2026-08-10 sweep converted only the genuine prose
 * conjunction lists and deliberately left every enumeration on a plain
 * comma. Without this test the next person reaches for `unit`, ships
 * "胸三頭筋肩" to Chinese users, and nothing fails.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { LanguageProvider } from '@/lib/LanguageContext';
import { useListFormatter } from '@/lib/intl';

// createElement rather than JSX so this stays a .js file alongside the rest
// of src/lib/__tests__ — vite only parses JSX out of .jsx.
const wrapper = ({ children }) => React.createElement(LanguageProvider, null, children);

/**
 * LanguageProvider renders a loading shell until its async bootstrap
 * resolves, so children — and therefore the hook — have not mounted on the
 * first synchronous render and `result.current` is still null. Component
 * tests never hit this because their assertions run after effects flush;
 * renderHook reads the value immediately.
 */
async function listFormatter() {
  const { result } = renderHook(() => useListFormatter(), { wrapper });
  await waitFor(() => expect(typeof result.current).toBe('function'));
  return result.current;
}

describe('useListFormatter', () => {
  it('produces a real conjunction, which a join can never do', async () => {
    const fmt = await listFormatter();
    expect(fmt(['body weight', 'height', 'age'])).toBe('body weight, height, and age');
  });

  it('handles one and two items without a stray separator', async () => {
    const fmt = await listFormatter();
    expect(fmt(['age'])).toBe('age');
    expect(fmt(['height', 'age'])).toBe('height and age');
  });

  it('drops empty entries and returns empty string for nothing', async () => {
    const fmt = await listFormatter();
    expect(fmt([])).toBe('');
    expect(fmt(null)).toBe('');
    expect(fmt(['age', null, undefined, ''])).toBe('age');
  });
});

describe("Intl.ListFormat type:'unit' is NOT a separator-only list", () => {
  // Guarding a decision, not our code. If a future ICU release makes `unit`
  // behave the way it reads, this test fails and the enumeration sites
  // become convertible — which is a good failure to be told about.
  it('emits no separator at all in Chinese', () => {
    const zh = new Intl.ListFormat('zh', { style: 'short', type: 'unit' })
      .format(['chest', 'triceps', 'shoulders']);
    expect(zh).toBe('chesttricepsshoulders');
  });

  it('still injects a conjunction word in German and French', () => {
    const de = new Intl.ListFormat('de', { style: 'short', type: 'unit' }).format(['a', 'b', 'c']);
    const fr = new Intl.ListFormat('fr', { style: 'short', type: 'unit' }).format(['a', 'b', 'c']);
    expect(de).toContain('und');
    expect(fr).toContain('et');
  });

  it('conjunction, by contrast, is correct in CJK without any "and" word', () => {
    // Japanese conjunction lists use 、 and no conjunction word — which is
    // why `conjunction` is the right type even for short label lists there.
    const ja = new Intl.ListFormat('ja', { style: 'long', type: 'conjunction' }).format(['a', 'b']);
    expect(ja).toBe('a、b');
  });
});
