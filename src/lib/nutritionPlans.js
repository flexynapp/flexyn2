// src/lib/nutritionPlans.js
// Diet plan templates + scaling + dietary restriction helpers.
// All meal macros are defined at a 2000 kcal baseline and scaled
// proportionally to the user's actual calorie target.

export const DIETARY_RESTRICTIONS = [
  { id: 'vegetarian', label: 'Vegetarian', emoji: '🥬', desc: 'No meat or seafood' },
  { id: 'vegan',      label: 'Vegan',      emoji: '🌱', desc: 'No animal products' },
  { id: 'gluten_free', label: 'Gluten-Free', emoji: '🌾', desc: 'No wheat, barley, or rye' },
  { id: 'dairy_free',  label: 'Dairy-Free',  emoji: '🥛', desc: 'No milk, cheese, or dairy' },
  { id: 'nut_free',    label: 'Nut-Free',    emoji: '🥜', desc: 'No tree nuts or peanuts' },
  { id: 'keto',        label: 'Keto',        emoji: '🥑', desc: 'Very low carb, high fat' },
  { id: 'paleo',       label: 'Paleo',       emoji: '🦴', desc: 'No grains, legumes, or dairy' },
  { id: 'halal',       label: 'Halal',       emoji: '☪️',  desc: 'Halal certified only' },
  { id: 'kosher',      label: 'Kosher',      emoji: '✡️',  desc: 'Kosher certified only' },
];

const PLAN_COLORS = {
  orange: { card: 'from-orange-500/20 to-orange-400/5', badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400', bar: 'bg-orange-500' },
  red:    { card: 'from-red-500/20 to-red-400/5',       badge: 'bg-red-500/15 text-red-600 dark:text-red-400',          bar: 'bg-red-500' },
  green:  { card: 'from-green-500/20 to-green-400/5',   badge: 'bg-green-500/15 text-green-600 dark:text-green-400',    bar: 'bg-green-500' },
  purple: { card: 'from-purple-500/20 to-purple-400/5', badge: 'bg-purple-500/15 text-purple-600 dark:text-purple-400', bar: 'bg-purple-500' },
  blue:   { card: 'from-blue-500/20 to-blue-400/5',     badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',       bar: 'bg-blue-500' },
};
export { PLAN_COLORS };

// NOTE: `excludedFor` must list EVERY restriction a plan violates,
// including ingredient-level ones — if any meal contains dairy, the plan
// must list 'dairy_free'; if any meal contains wheat/bread, 'gluten_free';
// tree nuts/peanuts, 'nut_free'; etc. filterPlans() hides a plan whenever
// an active restriction appears here, so an incomplete list leaks
// off-limits foods to the user (e.g. cottage cheese to a dairy-free user).
export const PLAN_TEMPLATES = [
  {
    id: 'lean_muscle',
    name: 'Lean Muscle Builder',
    tagline: 'High protein, moderate carbs for building lean mass',
    icon: '💪',
    color: 'orange',
    goalFit: ['gain', 'maintain'],
    // Contains dairy (Greek Yogurt, Cottage Cheese) + grains/potato → not paleo.
    excludedFor: ['vegetarian', 'vegan', 'keto', 'dairy_free', 'paleo'],
    baseCalories: 2000,
    baseMacros: { protein: 180, carbs: 200, fat: 55 },
    meals: [
      {
        id: 'breakfast', name: 'Power Breakfast', time: 'Breakfast · 7:00 AM',
        kcal: 480, macros: { p: 38, c: 52, f: 12 },
        ingredients: [
          { name: 'Whole Eggs',    amount: '3 large',     note: 'scrambled or fried' },
          { name: 'Rolled Oats',   amount: '¾ cup dry',   note: 'cooked with water' },
          { name: 'Banana',        amount: '1 medium',    note: 'sliced on top' },
          { name: 'Black Coffee',  amount: '1 cup',       note: 'unsweetened' },
        ],
      },
      {
        id: 'lunch', name: 'Chicken & Rice Bowl', time: 'Lunch · 12:30 PM',
        kcal: 580, macros: { p: 52, c: 68, f: 8 },
        ingredients: [
          { name: 'Chicken Breast', amount: '6 oz',        note: 'grilled, boneless skinless' },
          { name: 'White Rice',     amount: '1 cup cooked', note: 'jasmine or basmati' },
          { name: 'Broccoli',       amount: '1½ cups',     note: 'steamed' },
          { name: 'Olive Oil',      amount: '1 tsp',        note: 'drizzled' },
        ],
      },
      {
        id: 'snack1', name: 'Afternoon Fuel', time: 'Snack · 3:30 PM',
        kcal: 200, macros: { p: 20, c: 18, f: 6 },
        ingredients: [
          { name: 'Greek Yogurt',  amount: '¾ cup',  note: '0% fat plain' },
          { name: 'Blueberries',   amount: '½ cup',  note: 'fresh or frozen' },
          { name: 'Honey',         amount: '1 tsp',  note: 'raw' },
        ],
      },
      {
        id: 'dinner', name: 'Steak & Red Potato', time: 'Dinner · 7:00 PM',
        kcal: 620, macros: { p: 52, c: 46, f: 22 },
        ingredients: [
          { name: 'Sirloin Steak',  amount: '6 oz',  note: 'lean cut, grilled' },
          { name: 'Red Potatoes',   amount: '8 oz',  note: 'roasted with herbs' },
          { name: 'Asparagus',      amount: '1 cup', note: 'roasted with olive oil' },
          { name: 'Garlic',         amount: '2 cloves', note: 'minced' },
        ],
      },
      {
        id: 'snack2', name: 'Evening Protein', time: 'Snack · 9:00 PM',
        kcal: 120, macros: { p: 18, c: 16, f: 7 },
        ingredients: [
          { name: 'Cottage Cheese', amount: '½ cup',  note: 'low-fat' },
          { name: 'Mixed Berries',  amount: '¼ cup',  note: 'any variety' },
        ],
      },
    ],
    supplements: [
      { name: 'Creatine Monohydrate', dose: '5g',        timing: 'Pre/post workout', benefit: 'Strength + recovery',    icon: '⚡' },
      { name: 'Vitamin D3',           dose: '2000 IU',   timing: 'With breakfast',    benefit: 'Immunity + bone health', icon: '☀️' },
      { name: 'Magnesium Glycinate',  dose: '400mg',     timing: 'Before bed',        benefit: 'Sleep + muscle recovery',icon: '🌙' },
      { name: 'Vitamin C',            dose: '500mg',     timing: 'With any meal',     benefit: 'Immunity + collagen',    icon: '🍊' },
    ],
  },
  {
    id: 'fat_loss',
    name: 'Fat Loss Protocol',
    tagline: 'High satiety, calorie-controlled to accelerate fat loss',
    icon: '🔥',
    color: 'red',
    goalFit: ['lose'],
    // Dairy (String/Cottage Cheese) + wheat toast + almond butter + quinoa.
    excludedFor: ['vegetarian', 'vegan', 'keto', 'dairy_free', 'gluten_free', 'nut_free', 'paleo'],
    baseCalories: 2000,
    baseMacros: { protein: 190, carbs: 160, fat: 60 },
    meals: [
      {
        id: 'breakfast', name: 'High-Protein Start', time: 'Breakfast · 7:00 AM',
        kcal: 380, macros: { p: 42, c: 28, f: 10 },
        ingredients: [
          { name: 'Egg Whites',        amount: '6 large', note: 'scrambled with spinach' },
          { name: 'Whole Wheat Toast', amount: '1 slice', note: '100% whole wheat' },
          { name: 'Baby Spinach',      amount: '2 cups',  note: 'wilted' },
          { name: 'Avocado',           amount: '¼ medium', note: 'sliced' },
        ],
      },
      {
        id: 'lunch', name: 'Grilled Chicken Salad', time: 'Lunch · 12:30 PM',
        kcal: 480, macros: { p: 50, c: 38, f: 12 },
        ingredients: [
          { name: 'Chicken Breast',  amount: '6 oz',         note: 'grilled, sliced' },
          { name: 'Quinoa',          amount: '½ cup cooked', note: 'rinsed and cooked' },
          { name: 'Mixed Greens',    amount: '3 cups',       note: 'arugula, spinach, romaine' },
          { name: 'Cherry Tomatoes', amount: '½ cup',        note: 'halved' },
          { name: 'Lemon Dressing',  amount: '1 tbsp',       note: 'lemon juice + olive oil' },
        ],
      },
      {
        id: 'snack1', name: 'Smart Snack', time: 'Snack · 3:30 PM',
        kcal: 160, macros: { p: 16, c: 12, f: 5 },
        ingredients: [
          { name: 'Celery Sticks',  amount: '4 stalks', note: 'washed and cut' },
          { name: 'Almond Butter',  amount: '1 tbsp',   note: 'natural, no sugar added' },
          { name: 'String Cheese',  amount: '1 stick',  note: 'low-fat mozzarella' },
        ],
      },
      {
        id: 'dinner', name: 'Baked Salmon & Veggies', time: 'Dinner · 7:00 PM',
        kcal: 520, macros: { p: 48, c: 40, f: 16 },
        ingredients: [
          { name: 'Atlantic Salmon',   amount: '6 oz',    note: 'baked with herbs' },
          { name: 'Cauliflower Rice',  amount: '1½ cups', note: 'sautéed' },
          { name: 'Green Beans',       amount: '1 cup',   note: 'steamed' },
          { name: 'Lemon',             amount: '½ lemon', note: 'squeezed over salmon' },
        ],
      },
      {
        id: 'snack2', name: 'Night Protein', time: 'Snack · 9:00 PM',
        kcal: 150, macros: { p: 24, c: 8, f: 3 },
        ingredients: [
          { name: 'Cottage Cheese',          amount: '½ cup', note: 'low-fat' },
          { name: 'Cucumber',                amount: '½ cup', note: 'sliced' },
          { name: 'Everything Bagel Seasoning', amount: '½ tsp', note: 'sprinkled' },
        ],
      },
    ],
    supplements: [
      { name: 'Fish Oil (Omega-3)',  dose: '2g EPA/DHA', timing: 'With meals',     benefit: 'Anti-inflammatory + fat metabolism', icon: '🐟' },
      { name: 'Vitamin C',          dose: '1000mg',      timing: 'With breakfast', benefit: 'Immunity + cortisol control',        icon: '🍊' },
      { name: 'Zinc',               dose: '25mg',        timing: 'With dinner',    benefit: 'Immunity + testosterone',            icon: '⚡' },
      { name: 'Vitamin D3',         dose: '2000 IU',     timing: 'With breakfast', benefit: 'Metabolism + immunity',              icon: '☀️' },
    ],
  },
  {
    id: 'plant_power',
    name: 'Plant Power',
    tagline: 'Complete nutrition from whole plant foods — no sacrifice needed',
    icon: '🌱',
    color: 'green',
    goalFit: ['lose', 'maintain', 'gain'],
    // Vegan (dairy- & nut-free already), but has granola + whole-grain bread
    // (gluten) and grains/legumes (not paleo).
    excludedFor: ['keto', 'gluten_free', 'paleo'],
    baseCalories: 2000,
    baseMacros: { protein: 140, carbs: 240, fat: 62 },
    meals: [
      {
        id: 'breakfast', name: 'Protein Smoothie Bowl', time: 'Breakfast · 7:30 AM',
        kcal: 480, macros: { p: 32, c: 68, f: 10 },
        ingredients: [
          { name: 'Plant Protein Powder', amount: '1 scoop',  note: 'pea or hemp protein' },
          { name: 'Frozen Banana',        amount: '1 large',  note: 'blended as base' },
          { name: 'Mixed Berries',        amount: '½ cup',   note: 'frozen' },
          { name: 'Granola',              amount: '¼ cup',   note: 'oat-based, low sugar' },
          { name: 'Chia Seeds',           amount: '1 tbsp',  note: 'topping' },
        ],
      },
      {
        id: 'lunch', name: 'Red Lentil Soup', time: 'Lunch · 12:30 PM',
        kcal: 520, macros: { p: 34, c: 72, f: 8 },
        ingredients: [
          { name: 'Red Lentils',       amount: '¾ cup dry',   note: 'rinsed and simmered' },
          { name: 'Diced Tomatoes',    amount: '1 can (14oz)', note: 'no salt added' },
          { name: 'Spinach',           amount: '2 cups',       note: 'stirred in at end' },
          { name: 'Whole Grain Bread', amount: '1 slice',      note: 'toasted' },
          { name: 'Cumin & Turmeric',  amount: '1 tsp each',  note: 'spices' },
        ],
      },
      {
        id: 'snack1', name: 'Hummus & Veggies', time: 'Snack · 3:30 PM',
        kcal: 220, macros: { p: 10, c: 24, f: 10 },
        ingredients: [
          { name: 'Hummus',       amount: '4 tbsp', note: 'classic or roasted red pepper' },
          { name: 'Carrot Sticks', amount: '1 cup', note: 'raw' },
          { name: 'Cucumber',     amount: '½ cup', note: 'sliced' },
          { name: 'Bell Pepper',  amount: '½ cup', note: 'sliced' },
        ],
      },
      {
        id: 'dinner', name: 'Tofu Stir-Fry', time: 'Dinner · 7:00 PM',
        kcal: 580, macros: { p: 38, c: 62, f: 18 },
        ingredients: [
          { name: 'Extra Firm Tofu',     amount: '8 oz',         note: 'pressed and cubed' },
          { name: 'Brown Rice',          amount: '¾ cup cooked', note: 'long grain' },
          { name: 'Stir-Fry Vegetables', amount: '2 cups',       note: 'broccoli, snap peas, carrots' },
          { name: 'Tamari Sauce',        amount: '2 tbsp',       note: 'gluten-free soy sauce' },
          { name: 'Sesame Oil',          amount: '1 tsp',        note: 'toasted, finish drizzle' },
        ],
      },
      {
        id: 'snack2', name: 'Seed & Fruit Mix', time: 'Snack · 9:00 PM',
        kcal: 200, macros: { p: 8, c: 22, f: 10 },
        ingredients: [
          { name: 'Pumpkin Seeds',      amount: '2 tbsp', note: 'roasted, no salt' },
          { name: 'Sunflower Seeds',    amount: '1 tbsp', note: 'hulled' },
          { name: 'Dried Mango',        amount: '¼ cup',  note: 'unsweetened' },
          { name: 'Dark Chocolate Chips', amount: '1 tbsp', note: '70%+ cacao, dairy-free' },
        ],
      },
    ],
    supplements: [
      { name: 'Vitamin B12',      dose: '1000mcg',           timing: 'With breakfast',    benefit: 'Energy + nerve function',  icon: '⚡' },
      { name: 'Algae Omega-3',    dose: '500mg DHA',          timing: 'With largest meal', benefit: 'Brain + heart health',     icon: '🌊' },
      { name: 'Vitamin D3 (Vegan)', dose: '2000 IU',         timing: 'With breakfast',    benefit: 'Immunity + bone health',   icon: '☀️' },
      { name: 'Iron + Vitamin C', dose: '18mg + 500mg',       timing: 'Between meals',     benefit: 'Blood health + energy',    icon: '🩸' },
    ],
  },
  {
    id: 'keto_performance',
    name: 'Keto Performance',
    tagline: 'Ultra-low carb, high fat — sharp focus and accelerated fat burn',
    icon: '🥑',
    color: 'purple',
    goalFit: ['lose', 'maintain'],
    // Adds macadamia nuts (nut_free) + dairy/processed meats (not paleo).
    excludedFor: ['vegetarian', 'vegan', 'dairy_free', 'halal', 'kosher', 'nut_free', 'paleo'],
    baseCalories: 2000,
    baseMacros: { protein: 150, carbs: 20, fat: 155 },
    meals: [
      {
        id: 'breakfast', name: 'Bacon & Eggs', time: 'Breakfast · 7:00 AM',
        kcal: 520, macros: { p: 38, c: 2, f: 40 },
        ingredients: [
          { name: 'Whole Eggs', amount: '3 large',   note: 'fried in butter' },
          { name: 'Bacon',      amount: '3 slices',  note: 'uncured, no sugar added' },
          { name: 'Avocado',    amount: '½ medium',  note: 'sliced' },
          { name: 'Butter',     amount: '1 tbsp',    note: 'grass-fed unsalted' },
        ],
      },
      {
        id: 'lunch', name: 'Beef Lettuce Wraps', time: 'Lunch · 12:30 PM',
        kcal: 560, macros: { p: 42, c: 6, f: 40 },
        ingredients: [
          { name: 'Ground Beef',           amount: '6 oz',      note: '80/20, cooked and seasoned' },
          { name: 'Romaine Lettuce Leaves', amount: '4 large',  note: 'as wraps' },
          { name: 'Cheddar Cheese',        amount: '1 oz',      note: 'shredded' },
          { name: 'Sour Cream',            amount: '2 tbsp',    note: 'full fat' },
          { name: 'Jalapeño',              amount: '1 small',   note: 'sliced, optional' },
        ],
      },
      {
        id: 'snack1', name: 'Fat Bomb Snack', time: 'Snack · 3:30 PM',
        kcal: 200, macros: { p: 10, c: 2, f: 18 },
        ingredients: [
          { name: 'Hard Cheese',     amount: '1.5 oz',   note: 'gouda or cheddar' },
          { name: 'Pepperoni Slices', amount: '10 slices', note: 'nitrate-free preferred' },
          { name: 'Cucumber',        amount: '½ cup',    note: 'sliced' },
        ],
      },
      {
        id: 'dinner', name: 'Salmon & Zucchini Noodles', time: 'Dinner · 7:00 PM',
        kcal: 580, macros: { p: 46, c: 8, f: 42 },
        ingredients: [
          { name: 'Atlantic Salmon',  amount: '7 oz',     note: 'pan-seared with butter' },
          { name: 'Zucchini Noodles', amount: '2 cups',   note: 'spiralized' },
          { name: 'Heavy Cream',      amount: '3 tbsp',   note: 'for cream sauce' },
          { name: 'Parmesan',         amount: '2 tbsp',   note: 'grated' },
          { name: 'Garlic',           amount: '2 cloves', note: 'minced' },
        ],
      },
      {
        id: 'snack2', name: 'Keto Night Cap', time: 'Snack · 9:00 PM',
        kcal: 140, macros: { p: 14, c: 2, f: 15 },
        ingredients: [
          { name: 'Macadamia Nuts', amount: '1 oz',  note: 'raw or dry-roasted' },
          { name: 'Dark Chocolate', amount: '½ oz',  note: '90%+ cacao' },
        ],
      },
    ],
    supplements: [
      { name: 'Electrolytes',          dose: 'Daily packet',      timing: 'Morning',           benefit: 'Prevent keto flu + hydration',  icon: '⚡' },
      { name: 'Magnesium Glycinate',   dose: '400mg',             timing: 'Before bed',        benefit: 'Sleep + muscle cramps',         icon: '🌙' },
      { name: 'MCT Oil',               dose: '1 tbsp',            timing: 'With coffee or food', benefit: 'Quick ketone fuel + energy',  icon: '🧠' },
      { name: 'Vitamin D3 + K2',       dose: '2000 IU + 100mcg', timing: 'With breakfast',    benefit: 'Bone health + immunity',        icon: '☀️' },
    ],
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean Balance',
    tagline: 'Heart-healthy, sustainable eating for longevity and performance',
    icon: '🫒',
    color: 'blue',
    goalFit: ['maintain', 'lose'],
    // Fish (not vegetarian) + dairy (yogurt/feta/cheese) + wheat toast/crackers
    // (gluten) + walnuts/almond butter (nuts) + grains (not paleo).
    excludedFor: ['vegan', 'keto', 'vegetarian', 'dairy_free', 'gluten_free', 'nut_free', 'paleo'],
    baseCalories: 2000,
    baseMacros: { protein: 130, carbs: 225, fat: 72 },
    meals: [
      {
        id: 'breakfast', name: 'Greek Morning Bowl', time: 'Breakfast · 7:00 AM',
        kcal: 420, macros: { p: 28, c: 50, f: 12 },
        ingredients: [
          { name: 'Greek Yogurt',      amount: '1 cup',  note: '2% plain' },
          { name: 'Walnuts',           amount: '1 oz',   note: 'roughly chopped' },
          { name: 'Mixed Berries',     amount: '½ cup',  note: 'fresh or frozen' },
          { name: 'Honey',             amount: '1 tsp',  note: 'raw' },
          { name: 'Whole Grain Toast', amount: '1 slice', note: 'with a drizzle of olive oil' },
        ],
      },
      {
        id: 'lunch', name: 'Tuna Quinoa Bowl', time: 'Lunch · 12:30 PM',
        kcal: 540, macros: { p: 44, c: 56, f: 14 },
        ingredients: [
          { name: 'Canned Tuna',       amount: '5 oz',         note: 'in water, drained' },
          { name: 'Quinoa',            amount: '¾ cup cooked', note: 'cooled' },
          { name: 'Kalamata Olives',   amount: '10 olives',    note: 'pitted, halved' },
          { name: 'Feta Cheese',       amount: '1 oz',         note: 'crumbled' },
          { name: 'Cherry Tomatoes',   amount: '½ cup',        note: 'halved' },
          { name: 'Lemon + Olive Oil', amount: '1 tbsp each',  note: 'as dressing' },
        ],
      },
      {
        id: 'snack1', name: 'Olive & Cracker Plate', time: 'Snack · 3:30 PM',
        kcal: 200, macros: { p: 10, c: 14, f: 13 },
        ingredients: [
          { name: 'Whole Grain Crackers', amount: '5 pieces', note: '100% whole grain' },
          { name: 'Hummus',               amount: '3 tbsp',   note: 'classic' },
          { name: 'String Cheese',        amount: '1 stick',  note: 'mozzarella' },
        ],
      },
      {
        id: 'dinner', name: 'Grilled Sea Bass', time: 'Dinner · 7:00 PM',
        kcal: 580, macros: { p: 44, c: 60, f: 18 },
        ingredients: [
          { name: 'Sea Bass or Tilapia',  amount: '6 oz',  note: 'grilled with herbs' },
          { name: 'Brown Rice',           amount: '¾ cup cooked', note: 'long grain' },
          { name: 'Roasted Vegetables',   amount: '2 cups', note: 'zucchini, peppers, eggplant' },
          { name: 'Extra Virgin Olive Oil', amount: '1 tbsp', note: 'drizzled' },
          { name: 'Fresh Herbs',          amount: 'to taste', note: 'parsley, oregano, basil' },
        ],
      },
      {
        id: 'snack2', name: 'Fruit & Nut Finish', time: 'Snack · 9:00 PM',
        kcal: 170, macros: { p: 6, c: 22, f: 8 },
        ingredients: [
          { name: 'Mixed Nuts',   amount: '1 oz',   note: 'almonds, pistachios, walnuts' },
          { name: 'Apple',        amount: '1 medium', note: 'sliced' },
          { name: 'Almond Butter', amount: '1 tsp',  note: 'natural, no sugar added' },
        ],
      },
    ],
    supplements: [
      { name: 'Fish Oil (Omega-3)', dose: '2g EPA/DHA', timing: 'With meals',     benefit: 'Heart + brain health',  icon: '🐟' },
      { name: 'Vitamin D3',         dose: '2000 IU',    timing: 'With breakfast', benefit: 'Immunity + mood',        icon: '☀️' },
      { name: 'Vitamin C',          dose: '500mg',      timing: 'With any meal',  benefit: 'Immunity + antioxidant', icon: '🍊' },
      { name: 'Probiotic',          dose: '10B CFU',    timing: 'With breakfast', benefit: 'Gut health + immunity',  icon: '🦠' },
    ],
  },
];

/** Scale a plan's kcal and macros to the user's actual calorie target */
export function scalePlan(plan, targetCalories) {
  if (!targetCalories || targetCalories <= 0) return plan;
  const factor = targetCalories / plan.baseCalories;
  return {
    ...plan,
    scaledCalories: Math.round(plan.baseCalories * factor),
    scaledMacros: {
      protein: Math.round(plan.baseMacros.protein * factor),
      carbs:   Math.round(plan.baseMacros.carbs   * factor),
      fat:     Math.round(plan.baseMacros.fat      * factor),
    },
    meals: plan.meals.map(meal => ({
      ...meal,
      kcal: Math.round(meal.kcal * factor),
      macros: {
        p: Math.round(meal.macros.p * factor),
        c: Math.round(meal.macros.c * factor),
        f: Math.round(meal.macros.f * factor),
      },
    })),
  };
}

/** Return plans that don't conflict with the user's restrictions */
export function filterPlans(restrictions = []) {
  if (!restrictions.length) return PLAN_TEMPLATES;
  return PLAN_TEMPLATES.filter(
    plan => !restrictions.some(r => plan.excludedFor.includes(r))
  );
}

// localStorage helpers for dietary restrictions (synced to user profile when possible)
const STORAGE_KEY = 'flexyn_dietary_restrictions';
export function loadRestrictions(userProfile) {
  try {
    const fromProfile = userProfile?.dietary_restrictions;
    if (Array.isArray(fromProfile) && fromProfile.length > 0) return fromProfile;
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
export function persistRestrictions(restrictions) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(restrictions)); } catch {}
}

/* ═══════════════════════════════════════════════════════════════════════════
   INGREDIENT SUBSTITUTION ENGINE

   Rather than hide plans that clash with a user's diet, we ADAPT them —
   swapping each off-limits ingredient for a compliant one that keeps the
   meal's role (protein / carb / fat) and stays genuinely tasty and
   nutrient-dense. A dairy-free user still gets Lean Muscle Builder, but its
   cottage cheese becomes whipped silken tofu, its Greek yogurt becomes
   high-protein soy yogurt, and so on.

   Design:
   • classifyIngredient(name) tags an ingredient (dairy, gluten, nuts, meat,
     fish, egg, pork, grain, legume, starch, sugar, honey).
   • RESTRICTION_TAGS says which tags each restriction must eliminate.
   • Building-block swap maps (DAIRY_SWAPS, MEAT_SWAPS, …) hold curated,
     appetising replacements keyed by the exact ingredient name.
   • SWAPS composes them per restriction (vegan = meat + fish + dairy + egg +
     honey, etc.). GENERIC_SWAPS is a tasteful fallback for any future
     ingredient a specific map doesn't cover.
   • adaptIngredient / adaptPlan apply the swaps and tag what changed so the
     UI can show "was cottage cheese".
   ═══════════════════════════════════════════════════════════════════════════ */

// Lower-case keyword detection. Careful with false positives: plant "milks"
// and nut/seed "butters" are NOT dairy; "coconut"/"nutmeg" are NOT tree nuts.
export function classifyIngredient(name) {
  const s = String(name).toLowerCase();
  const tags = new Set();
  const has = (...kw) => kw.some(k => s.includes(k));
  // Compliant markers — words that appear on our SWAP TARGETS. They keep the
  // classifier from re-flagging an already-compliant swap (e.g. "Soy Yogurt"
  // isn't dairy, "GF Oats" isn't gluten, "Portobello Steak" isn't meat), which
  // matters when a user stacks multiple restrictions.
  const plantDairy   = /coconut|soy|almond|oat|cashew|hemp|rice|flax|pea|vegan|dairy-free|plant-based|nutritional yeast/.test(s);
  const glutenFree   = /gluten-free|grain-free|\bgf\b|certified gf|almond-flour|cauliflower|seed cracker|cucumber|sweet potato/.test(s);
  const plantProtein = /tofu|tempeh|portobello|seitan|mushroom|plant-based|lentil|chickpea|\bvegan\b/.test(s);
  // Seed/nut "butters" are not dairy.
  const nonDairyButter = /(almond|peanut|cashew|sunflower|seed|cocoa|apple|shea|nut)[\s-]*butter/.test(s);

  // Dairy
  if (!plantDairy && (
      has('cheese', 'yogurt', 'yoghurt', 'whey', 'casein', 'custard', 'ghee') ||
      has('milk') || has('cream') || (has('butter') && !nonDairyButter))) tags.add('dairy');
  // Egg
  if (/\begg/.test(s)) tags.add('egg');
  // Gluten (oats flagged: commonly cross-contaminated). Quinoa is NOT gluten.
  // `toast` via word boundary so "toasted [seeds]" isn't read as bread.
  if (!glutenFree && (has('wheat', 'barley', 'rye', 'bread', 'cracker', 'pasta', 'flour', 'couscous', 'bagel', 'oats', 'granola') || /\btoast\b/.test(s))) tags.add('gluten');
  // Tree nuts / peanuts (coconut, nutmeg, water chestnut, nut-free excluded)
  if (!s.includes('nut-free') && (
      /\b(almond|walnut|pecan|cashew|pistachio|macadamia|hazelnut|peanut|brazil nut)\b/.test(s) ||
      (s.includes('nut') && !/coconut|nutmeg|water chestnut|butternut|nutrition/.test(s)))) tags.add('nuts');
  // Animal flesh — skipped for plant-protein swap targets.
  if (!plantProtein) {
    if (has('chicken', 'turkey', 'duck')) { tags.add('meat'); tags.add('poultry'); }
    if (has('beef', 'steak', 'sirloin', 'lamb', 'veal', 'bison')) { tags.add('meat'); tags.add('redmeat'); }
    if (has('bacon', 'pepperoni', 'ham', 'pork', 'sausage', 'prosciutto', 'salami') && !has('turkey', 'beef')) { tags.add('meat'); tags.add('pork'); }
    if (has('salmon', 'tuna', 'tilapia', 'sea bass', 'cod', 'sardine', 'mackerel', 'trout', 'halibut') || /\bfish\b/.test(s)) tags.add('fish');
    if (has('shrimp', 'prawn', 'crab', 'lobster', 'oyster', 'clam', 'mussel', 'scallop')) tags.add('shellfish');
  }
  if (has('honey')) tags.add('honey');
  // Carb sources (for keto / paleo)
  if (!glutenFree && (has('rice', 'oats', 'quinoa', 'bread', 'granola', 'cracker', 'wheat', 'couscous', 'pasta', 'corn', 'barley') || /\btoast\b/.test(s))) tags.add('grain');
  if (has('lentil', 'bean', 'chickpea', 'hummus', 'tofu', 'tempeh', 'edamame', 'soy') && !has('soy sauce', 'soy milk')) tags.add('legume');
  if (has('potato') && !has('sweet potato')) tags.add('starch');
  if (has('banana', 'honey', 'dried mango', 'maple')) tags.add('sugar');
  return tags;
}

const RESTRICTION_TAGS = {
  vegetarian:  ['meat', 'fish', 'shellfish'],
  vegan:       ['meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey'],
  dairy_free:  ['dairy'],
  gluten_free: ['gluten'],
  nut_free:    ['nuts'],
  halal:       ['pork'],
  kosher:      ['pork', 'shellfish'],
  paleo:       ['grain', 'legume', 'dairy'],
  // No blanket 'legume' for keto — tofu/soy are low-carb & keto-friendly;
  // the high-carb legumes (lentils, beans) have their own specific swaps.
  keto:        ['grain', 'starch', 'sugar'],
};

// ── Curated building blocks (keyed by exact ingredient name, lower-case) ──
const DAIRY_SWAPS = {
  'greek yogurt':   { name: 'High-Protein Soy Yogurt', note: 'unsweetened, plant-based' },
  'cottage cheese': { name: 'Whipped Silken Tofu',     note: 'blended with lemon & sea salt — creamy, high-protein' },
  'string cheese':  { name: 'Coconut Mozzarella Stick', note: 'melty, dairy-free' },
  'feta cheese':    { name: 'Marinated Tofu Feta',     note: 'lemon, oregano & olive oil' },
  'cheddar cheese': { name: 'Dairy-Free Cheddar Shreds', note: 'coconut-oil based' },
  'sour cream':     { name: 'Coconut Sour Cream',      note: 'coconut cream + lime' },
  'hard cheese':    { name: 'Aged Coconut Cheese',     note: 'sharp, dairy-free' },
  'heavy cream':    { name: 'Coconut Cream',           note: 'full-fat, silky' },
  'parmesan':       { name: 'Nutritional Yeast',       note: 'nutty, cheesy, B12-rich' },
  'butter':         { name: 'Vegan Butter',            note: 'plant-based, rich' },
};
const MEAT_SWAPS = {
  'chicken breast':  { name: 'Marinated Tempeh',   note: 'grilled — high-protein, savory' },
  'sirloin steak':   { name: 'Portobello Steak',   note: 'balsamic-marinated, seared' },
  'ground beef':     { name: 'Lentil-Mushroom Crumble', note: 'seasoned, umami-rich' },
  'bacon':           { name: 'Smoky Tempeh Bacon', note: 'maple-glazed, crisp' },
  'pepperoni slices':{ name: 'Plant-Based Pepperoni', note: 'pea-protein, spiced' },
};
const FISH_SWAPS = {
  'atlantic salmon':    { name: 'Nori-Wrapped Tofu Steak', note: 'seared — sea flavor, omega-rich' },
  'canned tuna':        { name: 'Chickpea Smash',          note: 'mashed chickpeas + seaweed flakes' },
  'sea bass or tilapia':{ name: 'Marinated Tofu Fillet',   note: 'herb-grilled' },
};
const EGG_SWAPS = {
  'whole eggs': { name: 'Scrambled Tofu',        note: 'turmeric + black salt for eggy flavor' },
  'egg whites': { name: 'Chickpea Flour Scramble', note: 'fluffy, high-protein' },
};
const HONEY_SWAPS = { 'honey': { name: 'Maple Syrup', note: 'pure, plant-based' } };
const NUT_SWAPS = {
  'almond butter':  { name: 'Sunflower Seed Butter', note: 'creamy, nut-free' },
  'walnuts':        { name: 'Toasted Pumpkin Seeds', note: 'crunchy, nut-free' },
  'mixed nuts':     { name: 'Mixed Seeds',           note: 'pumpkin, sunflower & hemp' },
  'macadamia nuts': { name: 'Roasted Pumpkin Seeds', note: 'buttery, nut-free' },
};
const GLUTEN_SWAPS = {
  'rolled oats':          { name: 'Certified GF Rolled Oats', note: 'gluten-free' },
  'whole wheat toast':    { name: 'Gluten-Free Seeded Toast', note: 'toasted' },
  'whole grain bread':    { name: 'Gluten-Free Whole-Grain Bread', note: 'seeded' },
  'whole grain toast':    { name: 'Gluten-Free Seeded Toast', note: 'toasted' },
  'whole grain crackers': { name: 'Seed Crackers',           note: 'gluten-free' },
  'granola':              { name: 'Gluten-Free Granola',      note: 'certified GF oats' },
};
const PORK_SWAPS = {
  'bacon':            { name: 'Turkey Bacon',   note: 'pork-free' },
  'pepperoni slices': { name: 'Beef Pepperoni', note: 'pork-free' },
};
const PALEO_SWAPS = {
  'rolled oats':          { name: 'Coconut Chia Porridge', note: 'grain-free, warming' },
  'white rice':           { name: 'Cauliflower Rice',      note: 'riced & sautéed' },
  'brown rice':           { name: 'Cauliflower Rice',      note: 'riced & sautéed' },
  'quinoa':               { name: 'Cauliflower Rice',      note: 'grain-free' },
  'whole wheat toast':    { name: 'Sweet Potato Toast',    note: 'roasted slabs' },
  'whole grain bread':    { name: 'Sweet Potato Toast',    note: 'roasted slabs' },
  'whole grain toast':    { name: 'Sweet Potato Toast',    note: 'roasted slabs' },
  'whole grain crackers': { name: 'Cucumber Rounds',       note: 'crisp, grain-free' },
  'granola':              { name: 'Grain-Free Granola',    note: 'nuts & seeds' },
  'red lentils':          { name: 'Cauliflower & Mushroom Base', note: 'hearty, grain-free' },
  'hummus':               { name: 'Baba Ganoush',          note: 'roasted eggplant dip' },
  'extra firm tofu':      { name: 'Grilled Chicken',       note: 'or portobello — grain/legume-free' },
  'greek yogurt':         { name: 'Coconut Yogurt',        note: 'dairy-free, paleo' },
  'cottage cheese':       { name: 'Coconut Yogurt Bowl',   note: 'dairy-free' },
  'butter':               { name: 'Coconut Oil',           note: 'paleo cooking fat' },
};
const KETO_SWAPS = {
  'rolled oats':       { name: 'Cauliflower Porridge', note: 'low-carb, cinnamon' },
  'banana':            { name: 'Mixed Berries',        note: '½ cup — lower sugar' },
  'white rice':        { name: 'Cauliflower Rice',     note: 'low-carb' },
  'brown rice':        { name: 'Cauliflower Rice',     note: 'low-carb' },
  'quinoa':            { name: 'Cauliflower Rice',      note: 'low-carb' },
  'red potatoes':      { name: 'Roasted Radishes',     note: 'crispy, low-carb' },
  'honey':             { name: 'Monk Fruit Drops',     note: 'zero-carb sweetener' },
  'granola':           { name: 'Keto Nut & Seed Clusters', note: 'grain-free, crunchy' },
  'whole wheat toast': { name: 'Almond-Flour Bread',   note: 'low-carb' },
  'whole grain bread': { name: 'Almond-Flour Bread',   note: 'low-carb' },
  'red lentils':       { name: 'Cauliflower Base',     note: 'low-carb' },
};

const SWAPS = {
  vegetarian:  { ...MEAT_SWAPS, ...FISH_SWAPS },
  vegan:       { ...MEAT_SWAPS, ...FISH_SWAPS, ...DAIRY_SWAPS, ...EGG_SWAPS, ...HONEY_SWAPS },
  dairy_free:  { ...DAIRY_SWAPS },
  gluten_free: { ...GLUTEN_SWAPS },
  nut_free:    { ...NUT_SWAPS },
  halal:       { ...PORK_SWAPS },
  kosher:      { ...PORK_SWAPS },
  paleo:       { ...PALEO_SWAPS },
  keto:        { ...KETO_SWAPS },
};

// Tasteful fallback if a future ingredient has no specific swap.
const GENERIC_SWAPS = {
  dairy:  { name: 'Plant-Based Dairy Swap', note: 'coconut- or soy-based' },
  meat:   { name: 'Plant Protein',          note: 'tofu, tempeh or seitan' },
  fish:   { name: 'Marinated Tofu',         note: 'sea-seasoned' },
  egg:    { name: 'Tofu Scramble',          note: 'black salt for eggy flavor' },
  honey:  { name: 'Maple Syrup',            note: 'plant-based' },
  nuts:   { name: 'Seed Mix',               note: 'pumpkin & sunflower' },
  gluten: { name: 'Gluten-Free Swap',       note: 'certified GF' },
  grain:  { name: 'Cauliflower Rice',       note: 'grain-free' },
  legume: { name: 'Cauliflower Base',       note: 'legume-free' },
  starch: { name: 'Roasted Radishes',       note: 'low-carb' },
  sugar:  { name: 'Fresh Berries',          note: 'lower sugar' },
  pork:   { name: 'Turkey or Beef',         note: 'pork-free' },
};

// Order matters only when several restrictions target the same ingredient;
// broadest patterns first so their curated swap wins.
const RESTRICTION_ORDER = ['vegan', 'vegetarian', 'paleo', 'keto', 'dairy_free', 'gluten_free', 'nut_free', 'halal', 'kosher'];

/** Adapt a single ingredient for the active restrictions. Returns a new
 *  object; when swapped it carries `swapped` + `swappedFrom` for the UI. */
export function adaptIngredient(ing, restrictions = []) {
  if (!restrictions.length) return ing;
  let cur = { ...ing };
  let original = null;
  for (const r of RESTRICTION_ORDER) {
    if (!restrictions.includes(r)) continue;
    const key = cur.name.toLowerCase().trim();
    let rep = SWAPS[r]?.[key];
    if (!rep) {
      const tags = classifyIngredient(cur.name);
      const hit = (RESTRICTION_TAGS[r] || []).find(t => tags.has(t));
      if (hit) rep = GENERIC_SWAPS[hit];
    }
    if (rep && rep.name.toLowerCase() !== cur.name.toLowerCase()) {
      if (original === null) original = cur.name;
      cur = { ...cur, name: rep.name, note: rep.note ?? cur.note };
    }
  }
  if (original !== null) { cur.swapped = true; cur.swappedFrom = original; }
  return cur;
}

/** Adapt a whole plan for the user's restrictions — swaps offending
 *  ingredients across every meal and records how many were changed. */
export function adaptPlan(plan, restrictions = []) {
  if (!restrictions.length) return plan;
  let swapCount = 0;
  const meals = plan.meals.map(meal => ({
    ...meal,
    ingredients: meal.ingredients.map(ing => {
      const next = adaptIngredient(ing, restrictions);
      if (next.swapped) swapCount += 1;
      return next;
    }),
  }));
  return { ...plan, meals, adaptedFor: restrictions, swapCount };
}
