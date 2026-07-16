// Unit tests for the dietary-restriction substitution engine
// (src/lib/nutritionPlans.js). These lock in the core guarantee: after
// adaptPlan(), NO surviving ingredient violates the user's restrictions —
// for every single restriction and for stacked combinations. Also covers
// the classifier's tricky exclusions (plant milks / seed butters aren't
// dairy, coconut/nutmeg aren't tree nuts, "toasted" seeds aren't bread,
// and our own swap targets aren't re-flagged).

import { describe, it, expect } from 'vitest';
import {
  PLAN_TEMPLATES,
  classifyIngredient,
  adaptIngredient,
  adaptPlan,
} from '@/lib/nutritionPlans';

// Which tags each restriction must eliminate — mirrors RESTRICTION_TAGS in
// the module (kept here as the test's independent source of truth).
const RESTRICTION_TAGS = {
  vegetarian:  ['meat', 'fish', 'shellfish'],
  vegan:       ['meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey'],
  dairy_free:  ['dairy'],
  gluten_free: ['gluten'],
  nut_free:    ['nuts'],
  halal:       ['pork'],
  kosher:      ['pork', 'shellfish'],
  paleo:       ['grain', 'legume', 'dairy'],
  keto:        ['grain', 'starch', 'sugar'],
  // Allergens
  egg:         ['egg'],
  fish:        ['fish'],
  shellfish:   ['shellfish'],
  soy:         ['soy'],
  sesame:      ['sesame'],
};

const leaksFor = (plan, restrictions) => {
  const leaks = [];
  for (const meal of plan.meals) {
    for (const ing of meal.ingredients) {
      const tags = classifyIngredient(ing.name);
      for (const r of restrictions) {
        for (const t of (RESTRICTION_TAGS[r] || [])) {
          if (tags.has(t)) leaks.push(`${meal.id}:${ing.name}(${t})`);
        }
      }
    }
  }
  return leaks;
};

describe('classifyIngredient', () => {
  it('tags obvious offenders', () => {
    expect(classifyIngredient('Cottage Cheese').has('dairy')).toBe(true);
    expect(classifyIngredient('Whole Wheat Toast').has('gluten')).toBe(true);
    expect(classifyIngredient('Walnuts').has('nuts')).toBe(true);
    expect(classifyIngredient('Chicken Breast').has('meat')).toBe(true);
    expect(classifyIngredient('Atlantic Salmon').has('fish')).toBe(true);
    expect(classifyIngredient('Whole Eggs').has('egg')).toBe(true);
    expect(classifyIngredient('Bacon').has('pork')).toBe(true);
  });

  it('does not false-positive on plant-based look-alikes', () => {
    expect(classifyIngredient('Almond Milk').has('dairy')).toBe(false);
    expect(classifyIngredient('Sunflower Seed Butter').has('dairy')).toBe(false);
    expect(classifyIngredient('Coconut Yogurt').has('dairy')).toBe(false);
    expect(classifyIngredient('Coconut').has('nuts')).toBe(false);
    expect(classifyIngredient('Nutmeg').has('nuts')).toBe(false);
    expect(classifyIngredient('Toasted Pumpkin Seeds').has('gluten')).toBe(false);
    expect(classifyIngredient('Quinoa').has('gluten')).toBe(false); // GF pseudo-grain
  });

  it('does not re-flag its own compliant swap targets', () => {
    expect(classifyIngredient('High-Protein Soy Yogurt').has('dairy')).toBe(false);
    expect(classifyIngredient('Vegan Butter').has('dairy')).toBe(false);
    expect(classifyIngredient('Nutritional Yeast').has('dairy')).toBe(false);
    expect(classifyIngredient('Portobello Steak').has('meat')).toBe(false);
    expect(classifyIngredient('Smoky Tempeh Bacon').has('pork')).toBe(false);
    expect(classifyIngredient('Certified GF Rolled Oats').has('gluten')).toBe(false);
  });
});

describe('adaptIngredient', () => {
  it('swaps an offender and records the original', () => {
    const out = adaptIngredient({ name: 'Cottage Cheese', amount: '½ cup' }, ['dairy_free']);
    expect(out.swapped).toBe(true);
    expect(out.swappedFrom).toBe('Cottage Cheese');
    expect(out.name).not.toBe('Cottage Cheese');
    expect(classifyIngredient(out.name).has('dairy')).toBe(false);
  });

  it('leaves compliant ingredients untouched', () => {
    const out = adaptIngredient({ name: 'Broccoli', amount: '1 cup' }, ['dairy_free', 'vegan']);
    expect(out.swapped).toBeUndefined();
    expect(out.name).toBe('Broccoli');
  });

  it('is a no-op with no restrictions', () => {
    const ing = { name: 'Chicken Breast', amount: '6 oz' };
    expect(adaptIngredient(ing, [])).toBe(ing);
  });
});

describe('adaptPlan — no restriction leaks', () => {
  for (const restriction of Object.keys(RESTRICTION_TAGS)) {
    it(`produces a compliant plan for every template: ${restriction}`, () => {
      for (const template of PLAN_TEMPLATES) {
        const adapted = adaptPlan(template, [restriction]);
        expect(leaksFor(adapted, [restriction])).toEqual([]);
      }
    });
  }

  // Exhaustive guard against the ordering bug where a later restriction's
  // swap reintroduces an earlier one's offender (e.g. paleo swapping tofu →
  // chicken breaks a stacked vegan). Every pair of restrictions, every plan.
  const ALL = Object.keys(RESTRICTION_TAGS);
  const PAIRS = ALL.flatMap((a, i) => ALL.slice(i + 1).map(b => [a, b]));
  for (const pair of PAIRS) {
    it(`produces a compliant plan for stacked restrictions: ${pair.join('+')}`, () => {
      for (const template of PLAN_TEMPLATES) {
        const adapted = adaptPlan(template, pair);
        expect(leaksFor(adapted, pair)).toEqual([]);
      }
    });
  }

  it('handles the all-restrictions-and-allergens-at-once stack with zero leaks', () => {
    for (const template of PLAN_TEMPLATES) {
      const adapted = adaptPlan(template, ALL);
      expect(leaksFor(adapted, ALL)).toEqual([]);
    }
  });

  it('SAFETY: never feeds soy to a soy-allergic user, even when the diet swap is soy', () => {
    // The classic trap: a soy-allergic vegan whose meat/dairy swaps are tofu.
    const dangerStacks = [['soy', 'vegan'], ['soy', 'vegan', 'nut_free'], ['soy', 'vegetarian', 'paleo']];
    for (const stack of dangerStacks) {
      for (const template of PLAN_TEMPLATES) {
        const adapted = adaptPlan(template, stack);
        for (const meal of adapted.meals) {
          for (const ing of meal.ingredients) {
            expect(classifyIngredient(ing.name).has('soy')).toBe(false);
          }
        }
      }
    }
  });

  it('SAFETY: every ingredient is compliant even under all 5 allergens at once', () => {
    const allergens = ['egg', 'fish', 'shellfish', 'soy', 'sesame'];
    for (const template of PLAN_TEMPLATES) {
      const adapted = adaptPlan(template, allergens);
      expect(leaksFor(adapted, allergens)).toEqual([]);
    }
  });

  it('marks swapped ingredients and counts them', () => {
    const dairyPlan = PLAN_TEMPLATES.find(p => p.id === 'lean_muscle');
    const adapted = adaptPlan(dairyPlan, ['dairy_free']);
    expect(adapted.swapCount).toBeGreaterThan(0);
    const swapped = adapted.meals.flatMap(m => m.ingredients).filter(i => i.swapped);
    expect(swapped.length).toBe(adapted.swapCount);
  });

  it('does not swap anything in an already-compliant plan', () => {
    // Plant Power is vegan → naturally dairy-free; nothing to swap.
    const plantPower = PLAN_TEMPLATES.find(p => p.id === 'plant_power');
    const adapted = adaptPlan(plantPower, ['dairy_free']);
    expect(adapted.swapCount).toBe(0);
  });

  it('returns the plan unchanged with no restrictions', () => {
    const template = PLAN_TEMPLATES[0];
    expect(adaptPlan(template, [])).toBe(template);
  });

  it('substitutes non-vegan supplements too (no fish oil for a vegan)', () => {
    for (const restriction of ['vegetarian', 'vegan']) {
      for (const template of PLAN_TEMPLATES) {
        const adapted = adaptPlan(template, [restriction]);
        const names = (adapted.supplements || []).map(s => s.name.toLowerCase());
        expect(names.some(n => n.includes('fish oil'))).toBe(false);
      }
    }
    // And the swap is surfaced for the UI.
    const fatLoss = PLAN_TEMPLATES.find(p => p.id === 'fat_loss');
    const adapted = adaptPlan(fatLoss, ['vegan']);
    const algae = adapted.supplements.find(s => s.name === 'Algae Omega-3');
    expect(algae).toBeTruthy();
    expect(algae.swapped).toBe(true);
    expect(algae.swappedFrom).toBe('Fish Oil (Omega-3)');
  });
});
