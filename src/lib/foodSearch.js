// src/lib/foodSearch.js
//
// The ranking half of "Search" in the Log Meal panel.
//
// ── WHY THIS SEARCHES ONLY THE USER'S OWN FOOD ───────────────────────────────
//
// Three sources, all of them the user's own and all of them already local:
//
//   scan    — food_items rows this user created by scanning a barcode nothing
//             else knew. Their scanner history.
//   recipe  — nutrition_recipes they saved.
//   recent  — distinct foods out of their own nutrition_logs.
//
// That is a deliberate boundary, not an oversight. It buys the one property
// the feature lives or dies on: **it can run on every keystroke.** Open Food
// Facts allows ten searches a minute per IP and their documentation says
// plainly not to wire it to a search-as-you-type field, so a global tier
// could never autocomplete — it would have to sit behind an explicit tap and
// a countdown. Searching what the user has already eaten needs no network
// call at all, and for a food diary the same twenty foods are most of what
// anyone ever logs.
//
// Opening this up to the whole approved community catalogue later is one more
// array passed into `rankFoodMatches` — the ranking below already carries a
// `source` per entry and does not care where the rows came from.
//
// ── WHY RANKING IS ITS OWN MODULE ────────────────────────────────────────────
//
// The ordering IS the feature. A search that returns the right twenty foods
// in the wrong order is a search nobody uses. Keeping it pure — arrays in,
// array out, no I/O, no React — is what makes it testable against the real
// production shapes rather than through a mounted component.

/** Where a result came from. Drives the badge in the sheet. */
export const FOOD_SOURCE = {
  RECENT: 'recent',
  SCAN:   'scan',
  RECIPE: 'recipe',
};

// Hydration shares nutrition_logs — 118 of the 126 rows in production are
// water, stored as food_name 'Water' or 'Water|N'. Any list of "foods" built
// from this table has to drop them or it is mostly glasses of water. Same
// predicate as Nutrition.jsx:72 and HydrationRing.jsx:41.
const isWaterRow = (e) =>
  e?.food_name === 'Water' || e?.food_name?.startsWith?.('Water|');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * How well `name` matches `q`. Lower is better; null means no match at all.
 *
 * The tiers matter more than they look. "chicken" should put *Chicken breast*
 * above *Grilled lemon chicken*, and both above *Chicken-fried steak sauce* —
 * a plain `includes` filter returns all three in whatever order the database
 * happened to hand back.
 */
export function matchRank(name, q) {
  const n = norm(name);
  if (!n) return null;
  // An empty query matches everything at the same rank, which is what makes
  // the idle "recent foods" list the same code path as a search. The sort
  // then falls straight through to usage, which is the right idle order.
  if (!q) return 0;
  if (n === q) return 0;                       // exact
  if (n.startsWith(q)) return 1;               // starts with the query
  // A word inside the name starting with the query — "roasted CHICKen".
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n)) return 2;
  if (n.includes(q)) return 3;                 // anywhere
  return null;
}

const ts = (v) => Date.parse(v || '') || 0;

// A scanned barcode carries a manufacturer's label; a saved recipe carries
// numbers the user computed; a diary row carries whatever was typed that day.
// When the same food arrives from two sources, the lower weight wins the
// record's details. Declared above its use in `add()` — see CLAUDE.md's TDZ
// note; `no-use-before-define` is on at warn level.
const SOURCE_WEIGHT = {
  [FOOD_SOURCE.SCAN]:   0,
  [FOOD_SOURCE.RECIPE]: 1,
  [FOOD_SOURCE.RECENT]: 2,
};

/**
 * Merge, rank and de-duplicate the three local sources.
 *
 * @param {object} input
 * @param {string} input.query
 * @param {object[]} [input.logs]      nutrition_logs rows (this user's)
 * @param {object[]} [input.foodItems] food_items rows this user created
 * @param {object[]} [input.recipes]   nutrition_recipes rows (this user's)
 * @param {object} [opts]
 * @param {number} [opts.limit=25]
 * @returns {object[]} ranked, de-duplicated entries ready to render and log
 */
export function rankFoodMatches({ query, logs = [], foodItems = [], recipes = [] } = {}, { limit = 25 } = {}) {
  const q = norm(query);

  /** @type {Map<string, object>} */
  const byKey = new Map();

  const add = (entry) => {
    const rank = matchRank(entry.name, q);
    if (rank == null) return;
    // De-dupe on name + brand, NOT on id: the same food legitimately arrives
    // from two sources — you scanned it once (scan) and have eaten it six
    // times since (recent) — and showing it twice is the MyFitnessPal
    // duplicate problem reproduced locally.
    const key = `${norm(entry.name)}|${norm(entry.brand)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...entry, rank, key });
      return;
    }
    // Merge: keep the richer record, sum the usage, keep the newest touch,
    // and prefer the more trustworthy source label.
    const merged = {
      ...prev,
      // A scanned or saved record carries a real serving label and full
      // macros; a diary row often carries only what was typed that day.
      ...(SOURCE_WEIGHT[entry.source] < SOURCE_WEIGHT[prev.source] ? entry : {}),
      rank: Math.min(prev.rank, rank),
      timesLogged: (prev.timesLogged || 0) + (entry.timesLogged || 0),
      lastUsedAt: Math.max(prev.lastUsedAt || 0, entry.lastUsedAt || 0),
      key,
    };
    byKey.set(key, merged);
  };

  // ── scanner history ──
  for (const f of foodItems) {
    const n = f?.nutrition && typeof f.nutrition === 'object' ? f.nutrition : {};
    add({
      id: f.id,
      name: f.name,
      brand: f.brand || null,
      source: FOOD_SOURCE.SCAN,
      servingLabel: f.serving_label || '1 serving',
      calories:  num(n.calories ?? f.calories),
      protein_g: num(n.protein  ?? f.protein),
      carbs_g:   num(n.carbs    ?? f.carbs),
      fat_g:     num(n.fat      ?? f.fat),
      fiber_g:   num(n.fiber    ?? f.fiber),
      sodium_mg: num(n.sodium   ?? f.sodium),
      sugar_g:   num(n.sugar),
      barcode: f.barcode || null,
      timesLogged: 0,
      lastUsedAt: ts(f.created_at || f.created_date),
    });
  }

  // ── saved recipes ──
  for (const r of recipes) {
    const t = r?.totals && typeof r.totals === 'object' ? r.totals : {};
    const servings = num(r.servings) || 1;
    // `totals` is the whole recipe; the diary logs one serving.
    const per = (v) => Math.round((num(v) / servings) * 10) / 10;
    add({
      id: r.id,
      name: r.name,
      brand: null,
      source: FOOD_SOURCE.RECIPE,
      servingLabel: `1 of ${servings} servings`,
      calories:  Math.round(num(t.calories) / servings),
      protein_g: per(t.protein_g ?? t.protein),
      carbs_g:   per(t.carbs_g   ?? t.carbs),
      fat_g:     per(t.fat_g     ?? t.fat),
      fiber_g:   per(t.fiber_g   ?? t.fiber),
      sodium_mg: per(t.sodium_mg ?? t.sodium),
      sugar_g:   per(t.sugar_g   ?? t.sugar),
      timesLogged: 0,
      lastUsedAt: ts(r.updated_at || r.created_at),
    });
  }

  // ── the diary itself ──
  for (const l of logs) {
    if (isWaterRow(l)) continue;
    if (!l?.food_name) continue;
    add({
      id: l.id,
      name: l.food_name,
      brand: l.brand || null,
      source: FOOD_SOURCE.RECENT,
      servingLabel: l.serving_size || '1 serving',
      calories:  num(l.calories),
      protein_g: num(l.protein_g ?? l.protein),
      carbs_g:   num(l.carbs_g   ?? l.carbs),
      fat_g:     num(l.fat_g     ?? l.fat),
      fiber_g:   num(l.fiber_g   ?? l.fiber),
      sodium_mg: num(l.sodium_mg ?? l.sodium),
      sugar_g:   num(l.sugar_g ?? l.ai_meta?.sugar_g),
      timesLogged: 1,
      lastUsedAt: ts(l.created_at || l.date),
    });
  }

  return [...byKey.values()]
    .sort((a, b) =>
      a.rank - b.rank ||                                   // best match first
      (b.timesLogged || 0) - (a.timesLogged || 0) ||       // then what you eat most
      (b.lastUsedAt || 0) - (a.lastUsedAt || 0) ||         // then most recent
      a.name.localeCompare(b.name))                        // then stable
    .slice(0, limit);
}

/**
 * The idle list — what the sheet shows before a single character is typed.
 *
 * Deliberately the SAME call with an empty query rather than a second code
 * path: every entry ranks 0, so the sort falls straight through to
 * most-logged-first, which is the right idle order for a food diary. A diary
 * is overwhelmingly repetition — the useful list before you type is the one
 * you already eat.
 */
export function recentFoods(sources = {}, { limit = 12 } = {}) {
  return rankFoodMatches({ ...sources, query: '' }, { limit });
}
