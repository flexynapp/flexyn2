// Structural tests for the `equipment` i18n domain (src/locales/*.json,
// sliced by the prefixes in src/locales/_meta.json).
//
// These check SHAPE, not translation quality — no test can tell you
// whether the Korean reads naturally. What they can do is stop the
// silent failures: a locale drifting out of sync when someone adds a
// key to `en` only, a lost {gym} placeholder, or a string quietly left
// in English and mistaken for translated.

import { describe, it, expect } from 'vitest';
import { domainByLang, meta } from './i18nCatalogs.fixture';

const equipmentI18n = domainByLang('equipment');
const REVIEW_PENDING = meta().reviewPending.equipment;

const LANGS = ['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','tr','pl','nl'];
const enKeys = Object.keys(equipmentI18n.en).sort();

describe('coverage', () => {
  it('ships all 15 supported languages', () => {
    for (const l of LANGS) expect(equipmentI18n[l], `missing block: ${l}`).toBeTruthy();
    expect(Object.keys(equipmentI18n).sort()).toEqual([...LANGS].sort());
  });

  it.each(LANGS)('%s has exactly the English key set', (lang) => {
    expect(Object.keys(equipmentI18n[lang]).sort()).toEqual(enKeys);
  });

  it.each(LANGS)('%s has no blank values', (lang) => {
    for (const [k, v] of Object.entries(equipmentI18n[lang])) {
      expect(String(v).trim(), `${lang}.${k} is blank`).not.toBe('');
    }
  });
});

describe('placeholders', () => {
  it('every locale keeps the {gym} token', () => {
    // Dropping it renders a heading with no gym name; translating it
    // breaks the .replace() at the call site just as silently.
    for (const l of LANGS) {
      expect(equipmentI18n[l]['implement.atGymNamed'], `${l} lost {gym}`).toContain('{gym}');
    }
  });

  it('no locale invents a placeholder the code does not supply', () => {
    for (const l of LANGS) {
      for (const [k, v] of Object.entries(equipmentI18n[l])) {
        const tokens = String(v).match(/\{[a-z]+\}/gi) || [];
        const ALLOWED_PLACEHOLDERS = {
          'implement.atGymNamed': ['{gym}'],
          'gymEquipEditor.pending': ['{n}'],
        };
        const allowed = ALLOWED_PLACEHOLDERS[k] || [];
        for (const t of tokens) {
          expect(allowed, `${l}.${k} has an unsupported placeholder ${t}`).toContain(t);
        }
      }
    }
  });
});

describe('nothing silently left in English', () => {
  // A value identical to English is usually a skipped string rather than
  // a deliberate choice. The exceptions below are real: short loanwords
  // that genuinely are the same word in that language.
  const LEGITIMATE_MATCHES = new Set([
    'nl:gymEquip.pickBrand',   // "Merk" differs, but guard the pattern
    // Cardio is on _glossary.json's doNotTranslate list, so the group
    // heading is English in every language ON PURPOSE. Listed per language
    // rather than as a wildcard: a wildcard here would also swallow the next
    // key that happens to start with the same prefix.
    ...['es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', 'tr', 'pl', 'nl']
      .map(l => `${l}:gymEquip.group.cardio`),
    // "Kettlebells" is the loanword these five actually use. Polish inflects
    // it (Kettlebelle) and so is genuinely translated.
    'es:gymEquip.group.kettlebell',
    'fr:gymEquip.group.kettlebell',
    'de:gymEquip.group.kettlebell',
    'pt:gymEquip.group.kettlebell',
    'nl:gymEquip.group.kettlebell',
    // "Machines" is spelled the same in French and Dutch.
    'fr:gymEquip.group.machine',
    'nl:gymEquip.group.machine',
  ]);

  it.each(LANGS.filter(l => l !== 'en'))('%s translates every string', (lang) => {
    const same = enKeys.filter(k =>
      equipmentI18n[lang][k] === equipmentI18n.en[k] &&
      !LEGITIMATE_MATCHES.has(`${lang}:${k}`)
    );
    expect(same, `${lang} left untranslated: ${same.join(', ')}`).toEqual([]);
  });
});

describe('review bookkeeping', () => {
  it('lists every non-English locale as pending native review', () => {
    // This file is machine-translated. REVIEW_PENDING is how a reviewer
    // knows what still needs a human pass — if a locale gets reviewed,
    // it comes off this list, and this test keeps the list honest about
    // which languages actually exist.
    for (const l of REVIEW_PENDING) {
      expect(LANGS, `REVIEW_PENDING names unknown locale ${l}`).toContain(l);
      expect(equipmentI18n[l], `REVIEW_PENDING names absent locale ${l}`).toBeTruthy();
    }
    expect(REVIEW_PENDING).not.toContain('en');
  });
});

describe('terminology consistency with the rest of the app', () => {
  it('uses Brazilian Portuguese, matching the existing corpus', () => {
    // The app's pt is pt-BR (você / usuário / arquivo / Salvar). An
    // earlier draft of this file shipped European forms, which read as
    // a different app to a Brazilian user.
    expect(equipmentI18n.pt['implement.save']).toBe('Salvar');
    expect(equipmentI18n.pt['implement.photoType']).toContain('arquivo');
    expect(equipmentI18n.pt['implement.yourGear']).toContain('Seu');
  });

  it('reuses the wording of already-translated keys elsewhere', () => {
    // These two overlap with existing human translations (common.save,
    // nutrition.barcode.brand). Matching them keeps one vocabulary
    // across the app instead of two words for the same button.
    expect(equipmentI18n.fr['implement.save']).toBe('Sauvegarder');
    expect(equipmentI18n.ja['gymEquip.pickBrand']).toBe('ブランド');
    expect(equipmentI18n.ru['gymEquip.pickBrand']).toBe('Бренд');
  });

  it('keeps the two trust badges distinct in every locale', () => {
    // "Listed by the gym" (owner added it) and "Confirmed" (owner
    // vouched for a member's entry) mean different things. A locale
    // that collapses them loses a distinction the UI depends on.
    for (const l of LANGS) {
      expect(
        equipmentI18n[l]['gymEquip.byGym'],
        `${l} collapsed byGym and confirmed into the same string`
      ).not.toBe(equipmentI18n[l]['gymEquip.confirmed']);
    }
  });
});
