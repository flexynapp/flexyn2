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
  fr: {
    want: 'vous',
    wrong: [W('tu'), W("ton|ta|tes|toi|t'|t’")],
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
    const wrong = strings
      .filter(([, v]) => cfg.wrong.some((p) => p.test(v)))
      .map(([k, v]) => `${k}  ⇢  ${v.slice(0, 80)}`);
    section(`register is ${cfg.want} throughout`, wrong);

    const impRe = new RegExp(`(?:^|[.!?¡¿…—\\n]\\s*)(?:${cfg.imperatives})(?=\\s|\\.|,|!|\\?|$)`, 'u');
    const imps = strings.filter(([, v]) => impRe.test(v)).map(([k, v]) => `${k}  ⇢  ${v.slice(0, 80)}`);
    section(`wrong-register imperatives (CANDIDATES — read them, a noun looks identical)`, imps, { candidate: true });
  }

  // 2. TERMS THE GLOSSARY KEEPS IN ENGLISH
  const dropped = [];
  for (const [k, v] of strings) {
    const e = en[k];
    if (typeof e !== 'string') continue;
    for (const t of gloss.doNotTranslate.terms) {
      const re = W(FAMILY[t] || t);
      if (re.test(e) && !re.test(v)) { dropped.push(`${k}  [${t}]  ${v.slice(0, 60)}`); break; }
    }
  }
  section('do-not-translate terms kept', dropped);

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
}

console.log(`\n${problems === 0 ? '✓ no consistency problems' : `✗ ${problems} problem(s)`} across ${LANGS.join(', ')}`);
console.log('  Lines marked ? are candidates for a human to read, not defects.');
console.log('  None of this says the prose is GOOD — see _meta.json $passes.\n');
process.exit(problems ? 1 : 0);
