// src/lib/aiCoach/coachI18n.js
//
// How the AI Coach's generated text gets translated.
//
// ── The constraint that shapes this ──────────────────────────────────────
//
// The coach's replies are produced by PURE modules — `responders.js`,
// `onboardingCoach.js`, `trainingModifiers.js`. CLAUDE.md's AI Coach section
// requires they stay that way: "No I/O, no React — callers fetch the context
// and pass it in." So they cannot call `useLanguage()`, and importing the
// LanguageContext would drag React into a module whose test suite mocks a
// bare `@/api/db`.
//
// So translation arrives the same way every other piece of context does: as
// an argument. `t` has the exact signature of `tFallback` from
// LanguageContext —
//
//     t(key, englishFallback, vars?) -> string
//
// which means a component can pass its own `tFallback` straight through with
// no adapter, and `askCoach(user, message, ctx)` — which already threads
// `ctx.language` for the LLM path — carries it for the rules path too.
//
// ── Why the default matters more than it looks ───────────────────────────
//
// Every entry point defaults `t` to `enT` below. That is deliberate and
// mirrors the rule the same CLAUDE.md section states about this subsystem's
// other context inputs: "All three default to inert, so a caller that passes
// none gets the exact workout the generator produced before any of this
// existed." A caller that passes no `t` — including every existing test —
// gets byte-identical English out. The extraction is therefore a no-op on
// behaviour until translations actually land, which is what makes it safe to
// do in one pass across ~2,600 lines.
//
// ── What this is NOT ─────────────────────────────────────────────────────
//
// It is not a translation store. Keys live in `src/locales/*.json` like
// every other domain, English-only for now per the no-machine-translation
// rule. This module only supplies the plumbing and the English fallback.

// ── The plumbing itself now lives one level up ───────────────────────────
//
// `interpolate` / `enT` / `asT` were written here first and then copied,
// wrongly, into four other modules — see src/lib/translatorArg.js for the
// list and for what the wrong copy costs. They are general to any module
// that takes a translator as an argument, not specific to the coach, so
// they live there now and are re-exported here so every `from './coachI18n'`
// import in this subsystem keeps working unchanged.

export { interpolate, enT, asT } from '@/lib/translatorArg';
