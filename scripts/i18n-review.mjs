// The consistency checks a machine CAN make about a translation, so the
// expensive native pass starts from prose instead of from bookkeeping.
//
//   npm run i18n:review            released locales
//   npm run i18n:review -- es fr   named locales
//
// It answers four questions that do not need a native speaker:
//   1. Is the register consistent with the one _glossary.json decided?
//   2. Did a term the glossary says to keep in English get translated?
//   3. Does one translated word serve two different English terms?
//   4. Does any string change shape — placeholders, newlines, markdown?
//
// FOUR TRAPS, all of which produced wrong findings before being fixed. Every
// one of them reported confidently, which is what makes them worth naming.
//
//   \b IS ASCII-ONLY. `\btes\b` matches the "tes" inside "vous êtes", because
//   ê is a non-word character to the regex engine. That reported 115 French
//   register violations that were all correct vous. Use the W() helper.
//
//   SOME FRENCH VERBS ARE SPELLED THE SAME IN je AND tu. "je peux" / "tu
//   peux", sais, veux, dois, choisis. A verb list alone can never be evidence
//   of register; only the pronoun and the possessives are.
//
//   SPANISH su/sus IS THE ORDINARY THIRD-PERSON POSSESSIVE. "su perfil" is
//   "their profile" far more often than it is usted. Every hit it produced
//   was a false positive, so it is not tested for at all.
//
//   A VERB AT SENTENCE START MAY BE A NOUN. "Partage impossible" is "sharing
//   impossible", "Note d'administration" is a note, and "Entre l'entraînement
//   et le cardio" is the preposition "between". The imperative scan is a
//   CANDIDATE list for a human to read, never an auto-fix.
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'src/locales';
const load = (l) => JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(DIR, '_meta.json'), 'utf8'));
const gloss = JSON.parse(fs.readFileSync(path.join(DIR, '_glossary.json'), 'utf8'));
const en = load('en');

const argv = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const LANGS = argv.length ? argv : meta.released.locales.filter((l) => l !== 'en');

// Unicode-aware word boundary. See trap 1.
const W = (body) => new RegExp(`(?<![\\p{L}\\p{M}])(?:${body})(?![\\p{L}\\p{M}])`, 'iu');

// Register markers. Only the unambiguous ones — see traps 2 and 3.
const REGISTER = {
  es: {
    want: 'tú',
    wrong: [W('usted|ustedes'), W('guarde|elija|introduzca|seleccione|pulse|configure|revise|escriba|añada|inicie|comparta|elimine|envíe|consulte|ingrese|actualice')],
    // usted imperatives whose tú form differs; candidates only
    imperatives: 'Toque|Abra|Cierre|Busque|Cree|Modifique|Cambie|Espere|Utilice|Haga|Vaya|Ponga|Mire|Vea|Encuentre|Intente|Pruebe|Vuelva|Empiece|Termine|Registre|Guarde|Marque|Presione|Verifique|Compruebe|Comparta|Elija|Seleccione|Escriba|Añada',
  },
  de: {
    // du throughout. Capitalised Sie/Ihr is AMBIGUOUS in German — formal you,
    // but also she/they/her — so these are candidates for a human, never an
    // auto-fix, and they live in the imperatives slot rather than `wrong`.
    // Seven genuine Sie strings were found and corrected on 2026-08-16.
    want: 'du',
    wrong: [],
    imperatives: 'Legen Sie|Absolvieren Sie|Laufen Sie|Tippen Sie|Wählen Sie|Geben Sie|Öffnen Sie|Speichern Sie|Klicken Sie|Melden Sie|Stellen Sie|Prüfen Sie|Halten Sie|Nutzen Sie|Beachten Sie|Bitte geben Sie',
  },
  pt: {
    // pt-BR. Both halves matter and the catalog had drifted on both: 37 Plans
    // strings arrived in EUROPEAN Portuguese AND the tu register — "à tua
    // alimentação", "Configura", "Registá-la", "para alimentares o esforço" —
    // while the other 3,759 were Brazilian with seu/sua. Same defect French
    // had, in a second dimension.
    want: 'seu/sua (pt-BR)',
    wrong: [W('tu|teu|tua|teus|tuas|contigo'),
            W('registar|ecrã|equipa|ginásio|guardar|definições|partilhar|autocarro')],
    // pt-PT imperatives; the pt-BR você form differs (Configure, Substitua)
    imperatives: 'Configura|Substitui|Regista|Guarda|Partilha|Elimina|Adiciona|Escolhe|Verifica|Consulta',
  },
  fr: {
    want: 'vous',
    // `te` was absent until 2026-08-30, and it is the marker that matters:
    // unlike ta/ton (which need the possessor, not the address, to disambiguate)
    // a standalone `te` is only ever the tu object pronoun — vous has no such
    // form. Its absence is why "Je te défie en duel" sat in the catalog reading
    // clean while the imperative scan, which has no `défie`, could not see it
    // either. Neither axis covered it.
    wrong: [W('tu'), W("ton|ta|tes|toi|te|t'|t’")],
    imperatives: 'Choisis|Ajoute|Regarde|Ouvre|Lance|Partage|Vérifie|Réessaie|Enregistre|Sélectionne|Touche|Appuie|Saisis|Écris|Commence|Termine|Essaie|Reviens|Découvre|Trouve|Prends|Mets|Complète|Active|Désactive|Modifie|Change|Supprime|Retire|Garde|Continue|Attends|Consulte|Utilise|Clique|Scanne|Ferme|Annule|Valide|Envoie|Gagne|Atteins|Dépasse|Collectionne|Nourris|Crée|Fixe|Récupère|Réactive|Donne|Pose|Suis',
  },
};

// Term FAMILIES, not singular→plural. Mapping only one direction reported
// "Aucun Crew" as having dropped the term "Crews", when aucun takes the
// singular in French and the translation was correct.
const FAMILY = {
  Crew: 'Crew|Crews', Crews: 'Crew|Crews',
  Capsule: 'Capsule|Capsules', Rep: 'Rep|Reps', Reps: 'Rep|Reps',
  PR: 'PR|PRs',
};
const ph = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');
const nl = (s) => (String(s).match(/\n/g) || []).length;
const md = (s) => (String(s).match(/\*\*/g) || []).length;

let problems = 0;
const section = (title, rows, { candidate = false } = {}) => {
  if (!candidate) problems += rows.length;
  console.log(`\n  ${candidate ? '?' : rows.length ? '✗' : '✓'} ${title} — ${rows.length}`);
  rows.slice(0, 20).forEach((r) => console.log(`      ${r}`));
  if (rows.length > 20) console.log(`      … ${rows.length - 20} more`);
};

for (const lang of LANGS) {
  const dict = load(lang);
  const strings = Object.entries(dict).filter(([, v]) => typeof v === 'string');
  console.log(`\n═══ ${lang} — ${strings.length} strings ═══`);

  // 1. REGISTER
  const cfg = REGISTER[lang];
  if (cfg) {
    // The register rule governs how the APP addresses the user. A share sheet
    // is what one USER sends another, so it follows the register friends
    // actually use — tu in French, even though the app says vous. Declared in
    // register.exempt so the decision survives the next audit instead of being
    // rediscovered and "fixed". See doNotTranslate.exempt for the same shape.
    const rExempt = (gloss.register && gloss.register.exempt) || {};
    const governed = strings.filter(([k]) => !(k in rExempt));

    const wrong = governed
      .filter(([, v]) => cfg.wrong.some((p) => p.test(v)))
      .map(([k, v]) => `${k}  ⇢  ${v.slice(0, 80)}`);
    section(`register is ${cfg.want} throughout`, wrong);

    const impRe = new RegExp(`(?:^|[.!?¡¿…—\\n]\\s*)(?:${cfg.imperatives})(?=\\s|\\.|,|!|\\?|$)`, 'u');
    const imps = governed.filter(([, v]) => impRe.test(v)).map(([k, v]) => `${k}  ⇢  ${v.slice(0, 80)}`);
    section(`wrong-register imperatives (CANDIDATES — read them, a noun looks identical)`, imps, { candidate: true });
  }

  // 2. TERMS THE GLOSSARY KEEPS IN ENGLISH
  //
  // Only checkable for a locale written in Latin script. Japanese keeps these
  // terms by TRANSLITERATING them — カーディオ is "Cardio", ストリーク is
  // "streak" — so a Latin-script matcher calls every one of them a violation.
  // Run against the shelved locales this produced 89 findings for ja and 78
  // for ar, nearly all of them wrong, against 40 real ones for de. Reporting a
  // number that is mostly false is worse than reporting nothing, so a
  // non-Latin locale gets the rows as CANDIDATES and never as failures.
  // Telling a transliteration from a real translation needs the expected
  // katakana/hangul/Cyrillic form per term, which belongs in _glossary.json if
  // one of these locales is ever released.
  const latin = strings.filter(([, v]) => /\p{Script=Latin}/u.test(v)).length / (strings.length || 1);
  const latinScript = latin >= 0.5;

  // German and Dutch form CLOSED COMPOUNDS, so a kept term is welded into a
  // longer word: Cardiotraining, Cardioreeks, welkomstcapsule, Vormcoach. A
  // word-boundary match calls every one of those a translation and would have
  // had me "fixing" correct Dutch. So a term also counts as kept when it sits
  // at the edge of a word — bounded on at least ONE side.
  //
  // The same allowance covers INFLECTING languages, which attach case endings
  // to a kept term rather than compounding: Polish "Opublikuj na Hubie" is the
  // locative of Hub and is correct, and Turkish suffixes the same way.
  //
  // Length-gated at 3 on purpose. "PR" and "XP" as loose substrings match half
  // the Romance vocabulary ("primo", "progresso"), which would report every
  // real violation as kept and hide the thing this check exists to find.
  const keptBy = (term, s) => {
    if (W(term).test(s)) return true;
    if (term.replace(/\|.*/, '').length < 3) return false;
    return new RegExp(`(?:(?<![\\p{L}\\p{M}])(?:${term})|(?:${term})(?![\\p{L}\\p{M}]))`, 'iu').test(s);
  };

  // Declared exceptions: the English carries the term, but as an ordinary
  // word rather than the product noun — "activity level", "blocked at the
  // browser level", and "level pegging", where `level` is the ADJECTIVE
  // meaning tied. Those must stay translated, so flagging them forever would
  // train people to mute this section, and a checker people mute is worse
  // than no checker. Each entry in `doNotTranslate.exempt` names its reason.
  const exempt = gloss.doNotTranslate.exempt || {};
  const dropped = [];
  for (const [k, v] of strings) {
    const e = en[k];
    if (typeof e !== 'string') continue;
    if (k in exempt) continue;
    for (const t of gloss.doNotTranslate.terms) {
      const fam = FAMILY[t] || t;
      if (W(fam).test(e) && !keptBy(fam, v)) { dropped.push(`${k}  [${t}]  ${v.slice(0, 60)}`); break; }
    }
  }
  if (latinScript) section('do-not-translate terms kept', dropped);
  else section(
    `do-not-translate terms (NOT CHECKABLE — ${lang} is not Latin script, so a kept term is transliterated and looks identical to a translated one)`,
    dropped, { candidate: true });

  // 3. ONE TRANSLATED WORD SERVING TWO ENGLISH TERMS
  // The Regimen/Routine and Streak/Set collisions were both this shape, and
  // both were invisible to every other check in the repo.
  const collisions = [];
  const terms = Object.entries(gloss[lang] || {}).filter(([k]) => !k.startsWith('$'));
  const byTarget = new Map();
  for (const [src, tgt] of terms) {
    const key = tgt.toLowerCase();
    byTarget.set(key, [...(byTarget.get(key) || []), src]);
  }
  // A collision the glossary has already written up is not news. It stays
  // visible but stops failing the run, so a NEW one is what turns this red.
  const accepted = new Set((gloss[lang]?.$acceptedCollisions || []).map((s) => s.toLowerCase()));
  const known = [];
  for (const [tgt, srcs] of byTarget) {
    if (srcs.length < 2) continue;
    const sig = [...srcs].sort().join('|').toLowerCase();
    const line = `"${tgt}" is the glossary translation of ${srcs.length} terms: ${srcs.join(', ')}`;
    (accepted.has(sig) ? known : collisions).push(line);
  }
  section('no NEW word translates two English terms', collisions);
  if (known.length) section('documented collisions, open for the native pass', known, { candidate: true });

  // 4. SHAPE
  const shape = [];
  for (const [k, v] of strings) {
    const e = en[k];
    if (e === undefined) { shape.push(`${k}: ORPHAN — no such key in en.json`); continue; }
    if (typeof e !== 'string') continue;
    if (ph(v) !== ph(e)) shape.push(`${k}: placeholders [${ph(v) || '∅'}] vs en [${ph(e) || '∅'}]`);
    else if (nl(v) !== nl(e)) shape.push(`${k}: ${nl(v)} newlines vs en ${nl(e)}`);
    else if (md(v) !== md(e)) shape.push(`${k}: ${md(v)} ** vs en ${md(e)}`);
  }
  section('placeholder / newline / markdown parity', shape);

  // 5. NOUNS THE APP GREW WITHOUT A GLOSSARY ROW
  //
  // Standing rule (kegan, 2026-08-16): a new product noun gets a glossary row
  // in the change that ships it. This is what stops the rule decaying — a term
  // that recurs across many English strings and has no row is exactly how
  // Regimen ended up with THREE German renderings and how "Rutina" ended up
  // meaning both Regimen and Routine.
  //
  // Candidates only. A recurring capitalised word is often a heading, a UI verb
  // or a proper noun that needs no row, so this is a list to read, never a
  // failure. Anything already in the glossary, in doNotTranslate, or on the
  // stop-list below is filtered out.
  const glossed = new Set([
    ...Object.keys(gloss[lang] || {}), ...gloss.doNotTranslate.terms,
  ].filter((k) => !k.startsWith('$')).flatMap((k) => {
    // A glossed term covers its plural too, or "Workouts" reports as missing
    // while "Workout" sits in the glossary one line above.
    const l = k.toLowerCase();
    return [l, `${l}s`, l.endsWith('s') ? l.slice(0, -1) : `${l}es`];
  }));
  const STOP = new Set(['the','your','you','and','for','with','this','that','from','when','what',
    'all','new','open','close','add','edit','save','back','next','done','more','less','not','yet',
    'day','days','week','weeks','time','none','off','one','two','see','get','set','sets','log',
    'app','flexyn','ok','tap','use','out','top','now','here','it','a','an','is','are','to','of',
    'in','on','at','by','or','if','no','be','we','my','me','can','has','have','was','will']);
  // MID-SENTENCE capitalisation only. A capital at the start of a string, or
  // after a full stop, is just a sentence — "Complete a workout", "Send
  // report". A capital in the MIDDLE is what a product noun looks like ("open
  // your Capsule", "your Crew"), and that is the thing that needs a row.
  const freq = new Map();
  for (const [, v] of Object.entries(en)) {
    if (typeof v !== 'string') continue;
    for (const m of v.matchAll(/(?<![\p{L}\p{M}])[A-Z][a-z]{3,}(?![\p{L}\p{M}])/gu)) {
      const before = v.slice(0, m.index).replace(/\s+$/, '');
      if (before === '' || /[.!?:•\n]$/.test(before)) continue; // sentence-initial
      const lw = m[0].toLowerCase();
      if (glossed.has(lw) || STOP.has(lw)) continue;
      freq.set(m[0], (freq.get(m[0]) || 0) + 1);
    }
  }
  const candidates = [...freq.entries()].filter(([, n]) => n >= 6)
    .sort((a, b) => b[1] - a[1])
    .map(([w, n]) => `${w} — ${n} English strings, no glossary row`);
  section('recurring nouns with no glossary row (CANDIDATES — add a row or ignore)', candidates, { candidate: true });
}

console.log(`\n${problems === 0 ? '✓ no consistency problems' : `✗ ${problems} problem(s)`} across ${LANGS.join(', ')}`);
console.log('  Lines marked ? are candidates for a human to read, not defects.');
console.log('  None of this says the prose is GOOD — see _meta.json $passes.\n');
process.exit(problems ? 1 : 0);
