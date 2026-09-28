// UI ratchet: counts the patterns CLAUDE.md's UI composition rules ban,
// per file, so the count can only go DOWN.
//
// The rules have been written down since Aug 2026 (four hues, no
// decorative gradient, no glassmorphism, two elevation levels, four radius
// roles). A 2026-09-24 audit against a "vibe coded websites" report found
// the rules were right and the code had never been brought to them:
// 99 backdrop-blur, 114 off-palette purples, 96 Sparkles icons, 48
// gradients, 61 heavy shadows. Writing a rule does not stop the next
// commit from adding a 100th. This does.
//
// Two exceptions are product decisions (kegan, 2026-09-24), not
// oversights, so the ratchet ignores those files outright:
//   • purple is a RARITY colour, allowed in the tier/loot definitions
//   • Sparkles is the AI Coach's mark, allowed in the coach surfaces
//
//   npm run ui:ratchet             what is outstanding, against the baseline
//   npm run ui:ratchet -- --write  re-baseline, deliberately, after a cleanup
import fs from 'node:fs';
import path from 'node:path';

const SRC      = 'src';
const BASELINE = 'src/test/uiRatchet.baseline.json';

export const RULES = {
  purple: {
    why: 'Four hues, no exceptions. Purple is kept ONLY as a rarity colour.',
    re: /\b(?:bg|text|from|to|via|border|ring|shadow|fill|stroke)-(?:purple|violet|fuchsia|indigo)-\d+/g,
    allow: ['src/lib/xpTier.js', 'src/lib/lootCatalog.js'],
  },
  gradient: {
    why: 'No gradient as decoration.',
    re: /\bbg-gradient-to-[a-z]+/g,
  },
  backdropBlur: {
    why: 'No glassmorphism. A translucent bar over scrolling content is the tell.',
    re: /\bbackdrop-blur(?:-[a-z0-9]+)?\b/g,
  },
  sparkles: {
    why: 'Sparkles is the AI Coach mark only.',
    re: /\bSparkles\b/g,
    allow: ['src/components/coach/', 'src/lib/aiCoach/'],
  },
  heavyShadow: {
    why: 'Two elevation levels: hairline, or shadow-md. xl/2xl on a 390px screen is a tell.',
    re: /\bshadow-(?:xl|2xl)\b/g,
  },
  colouredShadow: {
    why: 'Coloured shadows are banned.',
    re: /\bshadow-(?:primary|purple|violet|fuchsia|indigo|orange|amber|emerald|red|blue|green|yellow|pink|rose|cyan|teal|sky)(?:[-/]\d+)?\b/g,
  },
  offScaleRadius: {
    why: 'Radius is sm / lg / 2xl / full. 3xl and hand-typed px radii are outside the system.',
    re: /\brounded(?:-[a-z]{1,2})?-(?:3xl|\[[\d.]+(?:px|rem)\])/g,
  },
  subFloorText: {
    why: 'Text floors at 11px (text-micro).',
    re: /\btext-\[(?:[0-9]|10)(?:\.\d+)?px\]/g,
  },
  hardcodedFont: {
    why: 'Type is Archivo for headings and Figtree for everything else, set ONCE as --font-heading / --font-body / --font-mono in src/index.css. A face typed anywhere else does not move when the brand font does, which is how three stacks came to coexist on one screen.',
    // An inline fontFamily / font-family that is not a token, a Tailwind
    // arbitrary face (font-['Inter']), or a literal canvas font string
    // (canvas cannot read CSS variables, so it goes through a helper).
    re: /\bfontFamily\s*[:=]\s*\{?\s*['"`](?!var\(--font-|inherit)|font-family\s*[:=](?!\s*['"]?(?:var\(--font-|inherit))|\bfont-\[['"]?[A-Za-z]|\.font\s*=\s*['"`]/g,
    // Deliberate, not drift: the Snake game's pixel face, and the logo
    // wordmark, which is the brand mark rather than type.
    allow: ['src/components/hub/SnakeGameModal.jsx', 'src/components/SplashScreen.jsx'],
  },
  hoverMotion: {
    why: 'This app ships to phones. Hover motion does nothing on touch and jitters with a mouse.',
    re: /\bwhileHover\b|\bhover:(?:-?translate-[xy]|scale|rotate)-/g,
  },
};

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'i18n-langs' || e.name === 'locales' || e.name === 'test') continue;
      sourceFiles(p, out);
    } else if (/\.(jsx?|css)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

// Comments carry the reasoning in this repo and often NAME the banned
// pattern ("no backdrop-blur here because…"). Counting those would punish
// exactly the explanation we want, so strip them first. Crude on purpose:
// a `//` inside a string on the same line is rare in class lists.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

export function measure(root = SRC) {
  const counts = {};
  for (const [rule] of Object.entries(RULES)) counts[rule] = {};
  for (const file of sourceFiles(root)) {
    const rel = file.split(path.sep).join('/');
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    for (const [rule, spec] of Object.entries(RULES)) {
      if (spec.allow?.some((a) => rel === a || rel.startsWith(a))) continue;
      const n = (text.match(spec.re) || []).length;
      if (n) counts[rule][rel] = n;
    }
  }
  return counts;
}

export function readBaseline(p = BASELINE) {
  if (!fs.existsSync(p)) return { counts: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const total = (m) => Object.values(m || {}).reduce((a, b) => a + b, 0);

if (import.meta.url === `file://${process.argv[1]}`) {
  const counts = measure();
  if (process.argv.includes('--write')) {
    const sorted = Object.fromEntries(Object.entries(counts).map(([r, m]) =>
      [r, Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)))]));
    fs.writeFileSync(BASELINE, JSON.stringify({
      $comment:
        'Per-file counts of patterns CLAUDE.md bans. They may SHRINK, never grow. See ' +
        'scripts/ui-ratchet.mjs and src/test/__tests__/uiRatchet.test.js. After a cleanup, ' +
        're-baseline with `npm run ui:ratchet -- --write` so the lower number is the new ceiling.',
      $totals: Object.fromEntries(Object.entries(counts).map(([r, m]) => [r, total(m)])),
      counts: sorted,
    }, null, 2) + '\n');
    console.log(`wrote ${BASELINE}`);
  } else {
    const base = readBaseline().counts;
    for (const [rule, m] of Object.entries(counts)) {
      console.log(`${rule.padEnd(16)} ${String(total(m)).padStart(5)}  (baseline ${total(base[rule])})`);
    }
  }
}
