/**
 * Progress → Body, translatability.
 *
 * The tab shipped with ZERO translation calls: every string on it was an
 * English literal on an app that ships 15 languages. Nothing looked broken,
 * which is the problem — an English literal and a correct English fallback
 * render identically, so the only moment the difference shows is when a
 * translation lands and half the screen ignores it.
 *
 * So these tests do not check that the tab says the right thing in English.
 * They check that every string on it GOES THROUGH the translation layer, by
 * rendering with a stub that returns a marked template for every key and
 * asserting no English survives.
 *
 * The `mark` stub deliberately IGNORES the English fallback, per the i18n
 * section of CLAUDE.md. The house stub `(key, english) => english` cannot
 * see a dropped `vars` argument — the English fallback is a template that has
 * already interpolated, so it reads correctly whether or not the call site
 * forwarded its vars. That blind spot shipped a literal "Dormiste {n} h" to
 * Spanish once already.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import fs from 'fs';

vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));

/** Templates for the keys that carry a `{placeholder}`. A call site that
 *  drops its vars leaves the `{n}` in the output, where the assertions below
 *  can see it. Everything else just gets marked with its own key. */
const TPL = {
  'bodyMap.headline.recovery.one': 'XX:{n} musculo',
  'bodyMap.headline.recovery.other': 'XX:{n} musculos',
  'bodyMap.detail.daysAgo': 'XX:hace {n}d',
};
const mark = (key, _english, vars) => {
  let s = TPL[key] ?? `XX:${key}`;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    });
  }
  return s;
};
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (key, english, vars) => mark(key, english, vars) }),
}));

import MuscleGroupHeatmap from '@/components/progress/MuscleGroupHeatmap';
import { domainByLang } from '@/lib/__tests__/i18nCatalogs.fixture';

const bodyMapTranslations = domainByLang('bodyMap');

const EN = bodyMapTranslations.en;
const day = (n) => new Date(Date.now() - n * 86400000).toISOString();

/* Legs today: quads, hamstrings and calves all read recovery 0, so the
   headline takes its plural branch with n = 3. */
const LEG_DAY = [{
  date: day(0),
  exercises: [{ name: 'Back Squat', muscle_groups: ['Legs'], sets: [{ weight: 225, reps: 5 }] }],
}];

let container;
beforeEach(() => { ({ container } = render(<MuscleGroupHeatmap logs={LEG_DAY} />)); });
afterEach(cleanup);

describe('every string on the Body tab goes through the translation layer', () => {
  it('leaves no English literal on the screen', () => {
    // The exact literals that used to be hardcoded in the JSX. If one comes
    // back, it renders in English while everything around it is marked.
    const WAS_HARDCODED = [
      'Progress · Muscle map', 'LIVE', 'NO DATA',
      'Recovery', 'Volume', '7 DAYS', '30 DAYS', '90 DAYS',
      'FRONT', 'BACK', 'FRESH', 'FATIGUED', 'LESS', 'MORE VOLUME',
      'Recovery by muscle', 'Volume by muscle',
      'Quads', 'Hamstrings', 'Calves', 'Legs',
    ];
    for (const s of WAS_HARDCODED) {
      expect(container.textContent, `"${s}" is still a hardcoded literal`).not.toContain(s);
    }
  });

  it('renders the mode, range, legend and figure labels from keys', () => {
    for (const key of [
      'bodyMap.kicker', 'bodyMap.data.live',
      'bodyMap.mode.recovery', 'bodyMap.mode.volume',
      'bodyMap.figure.front', 'bodyMap.figure.back',
      'bodyMap.legend.fresh', 'bodyMap.legend.fatigued',
      'bodyMap.list.recovery',
    ]) {
      expect(container.textContent, `${key} did not reach the screen`).toContain(`XX:${key}`);
    }
    // The window picker only exists in Volume mode; Recovery ignores it.
    expect(container.textContent).not.toContain('XX:bodyMap.range.30d');
    fireEvent.click(screen.getByText('XX:bodyMap.mode.volume'));
    for (const key of [
      'bodyMap.range.7d', 'bodyMap.range.30d', 'bodyMap.range.90d',
      'bodyMap.list.volume', 'bodyMap.rangeShort.30d',
    ]) {
      expect(container.textContent, `${key} did not reach the screen`).toContain(`XX:${key}`);
    }
  });

  it('swaps the whole headline, and forwards its count', () => {
    // Not `getByText('XX:3 musculos')` alone: the point is that the number
    // arrived through `vars`, so a dropped third argument has to be visible.
    expect(screen.getByText('XX:3 musculos')).toBeTruthy();
    expect(container.textContent).not.toContain('{n}');
  });

  it('reads muscle and region names from the shared namespaces', () => {
    // 13 of the 14 muscles and 2 of the 4 regions already ship in all 15
    // languages under `muscleGroups.*`, and the other 2 regions were named
    // by the colour encoding under `regions.*`. A second vocabulary here
    // would be two answers to one question — and the worse one.
    expect(container.textContent).toContain('XX:muscleGroups.quads');
    expect(container.textContent).toContain('XX:muscleGroups.legs');
    expect(container.textContent).toContain('XX:regions.push');
    // ...and NOT regions.other, which means "core and the remainder". This
    // tab's fourth region is Core exactly.
    expect(container.textContent).not.toContain('XX:regions.other');
    expect(container.textContent).toContain('XX:muscleGroups.core');
  });

  it('translates the detail sheet, including its "{n}d ago"', () => {
    fireEvent.click(screen.getByText('XX:muscleGroups.quads'));
    expect(screen.getByText('XX:bodyMap.detail.recov')).toBeTruthy();
    expect(screen.getByText('XX:bodyMap.status.needsRest')).toBeTruthy();
    expect(screen.getByText('XX:bodyMap.detail.close')).toBeTruthy();
    // Trained today → "0d ago", and a 0 that survives interpolation proves
    // the var was forwarded rather than defaulted.
    expect(container.textContent).toContain('XX:hace 0d');
    expect(container.textContent).not.toContain('{n}');
    for (const s of ['RECOV', 'SETS', 'VOLUME', 'LAST', 'CLOSE', 'Needs rest', 'd ago']) {
      expect(container.textContent, `"${s}" is still a hardcoded literal`).not.toContain(s);
    }
  });
});

describe('the key list and the call sites agree', () => {
  // tFallback hides a typo perfectly: a misspelled key renders its English
  // fallback forever, so the screen looks right and no translation ever
  // applies to it. Only a static check catches that.
  const src = fs.readFileSync('src/components/progress/MuscleGroupHeatmap.jsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const used = new Set([...src.matchAll(/'(bodyMap\.[\w.]+)'/g)].map((m) => m[1]));

  it('every key the component asks for exists in `src/locales/*.json`', () => {
    const missing = [...used].filter((k) => !(k in EN));
    expect(missing, `keys with no English: ${missing.join(', ')}`).toEqual([]);
  });

  it('every key in `src/locales/*.json` is asked for', () => {
    const orphans = Object.keys(EN).filter((k) => !used.has(k));
    expect(orphans, `unused keys: ${orphans.join(', ')}`).toEqual([]);
  });

  it('ships every RELEASED locale, so nothing here falls back to English', () => {
    // Was 'ships English only'. That described the shelved state rather than a
    // policy: the reason given was that a missing language should fall back
    // rather than blank, and a present translation does not blank either. What
    // matters is that this domain covers whatever the app actually offers.
    const released = JSON.parse(
      fs.readFileSync('src/locales/_meta.json', 'utf8'),
    ).released.locales;
    // A SUPERSET, not equality. A shelved locale carrying translations is fine
    // and is how a locale gets finished before it is offered — French reached
    // this domain while still shelved. What must hold is that every locale the
    // app actually offers is covered.
    const present = new Set(Object.keys(bodyMapTranslations));
    const uncovered = released.filter((l) => !present.has(l));
    expect(uncovered, `released locales missing from bodyMap: ${uncovered.join(', ')}`).toEqual([]);
  });
});
