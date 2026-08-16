// src/lib/translatorArg.js
//
// The contract for passing a translator INTO a module that cannot call
// `useLanguage()` — pure data catalogs, data-layer functions, anything whose
// tests mock a bare `@/api/db`.
//
// The shape is `tFallback`'s, exactly:
//
//     t(key, englishFallback, vars?) -> string
//
// so a component hands its own `tFallback` straight through with no adapter.
//
// ── Why this module exists rather than a local helper per file ────────────
//
// `coachI18n.js` had the correct version and said why it had to stay
// correct — "if the two ever diverge, a missing key renders differently from
// a present one and the bug is invisible in English." SIX other modules then
// wrote the WRONG version independently:
//
//     const asIs = (_key, english) => english;
//
// which silently drops the third argument. That is right for a fixed string
// and wrong for a template, and the difference does not show up until
// somebody converts one of the module's strings to the interpolated form —
// at which point the default starts rendering `Champion, S{n}` and
// `{emoji} Trophy earned: {name}` to whoever called without a translator.
// That is exactly what happened to trophyDefinitions.js when the trophy
// catalog was extracted (aaa88343), and it turned `main` red.
//
// All six now default to `enT`: trophyDefinitions.js, data/crewTreasury.js,
// lootCatalog.js, crewPermissions.js, and the two profile hero rails
// (ProfileTierBanner.jsx, ProfileContestRail.jsx). The last two are the ones
// to watch — their fallbacks ARE templates (`'{n} XP to {lv} {next}'`,
// `'Trained {n} of the last 7 days'`, and three aria-labels) with the braces
// filled by hand-rolled `.replace()` chains beside each call. Nothing renders
// wrong today because every call is two-argument, but converting any of them
// to the canonical three-argument form is a one-line change that would have
// silently reintroduced the bug under the old default.
//
// Two further copies interpolate correctly but omit the
// `typeof str === 'string'` guard, so a non-string template would throw
// rather than pass through: `formatFallback` in data/notifications.js and
// `tr` in ErrorBoundary.jsx. Left alone — neither can currently receive a
// non-string — but if either is touched, it should come here rather than be
// repaired in place.
//
// Known sharp edge, inherited unchanged from every copy: the replacement goes
// through `String.prototype.replace`, so `$&`, `$'` and `$1` inside a VALUE
// are interpreted as replacement patterns. Fixing it means `() => String(v)`,
// which would change output, so it is deliberately not done here.
//
// The live translators in LanguageContext (`t`, `tFallback`) inline the same
// loop. They are deliberately NOT importing this: that is the hot path, it
// has no default-translator problem to solve, and the duplication there is
// two call sites in one file rather than seven across the tree.

/**
 * Interpolate `{name}` placeholders, exactly as `tFallback` does for its
 * fallback string. Kept identical on purpose: if the two ever diverge, a
 * missing key renders differently from a present one and the bug is
 * invisible in English.
 */
export function interpolate(str, vars) {
  if (!vars || typeof str !== 'string') return str;
  let out = str;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return out;
}

/**
 * The default translator: ignore the key, return the interpolated English.
 *
 * This is what makes an un-threaded caller inert. It is also the honest
 * behaviour for a language with no translations for that domain yet —
 * `getTranslation` resolves `language → en → key`, so a real `tFallback`
 * lands on the same English string anyway.
 *
 * "Inert" means the English a caller would have got before the strings were
 * extracted — NOT the raw template. A default that returns `{n}` is not
 * inert, it is broken.
 */
export const enT = (key, english, vars) => interpolate(english, vars);

/**
 * Normalize whatever a caller passed into something callable.
 * Guards the case where a caller threads `ctx.t` through several layers and
 * one of them drops it — a `t` of `undefined` should degrade to English, not
 * throw halfway through building a reply.
 */
export function asT(t) {
  return typeof t === 'function' ? t : enT;
}
