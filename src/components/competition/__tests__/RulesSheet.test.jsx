import { describe, it, expect } from 'vitest';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';
import { RULE_KEYS } from '@/components/competition/RulesSheet';

// The rules are the one place a new user learns how these features score,
// so a line that reads English under a Spanish screen, or drifts from its
// catalog entry, defeats the point of the button.
describe('RulesSheet catalog', () => {
  const entries = Object.entries(RULE_KEYS);

  it('covers all three features', () => {
    for (const id of ['duels', 'rival', 'crewWars']) {
      expect(RULE_KEYS[`rules.${id}.title`]).toBeTruthy();
    }
  });

  it('matches en.json exactly and is translated in es and fr', () => {
    for (const [key, english] of entries) {
      expect(en[key], key).toBe(english);
      expect(es[key], key).toBeTruthy();
      expect(fr[key], key).toBeTruthy();
    }
  });

  it('carries no dashes in display copy', () => {
    for (const [key] of entries) {
      for (const cat of [en, es, fr]) expect(cat[key], key).not.toMatch(/[—–]| - /);
    }
  });
});
