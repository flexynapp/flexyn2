/**
 * The Coach's generated text is translatable — and, crucially, is UNCHANGED
 * for every caller that does not opt in.
 *
 * That second half is what makes this refactor safe. The pure modules
 * (`trainingModifiers`, `responders`, `onboardingCoach`) cannot call a hook,
 * so `t` arrives as an argument; every entry point defaults it to English.
 * A caller that never heard of `t` — including every test written before
 * this — has to get byte-identical output, the same posture CLAUDE.md
 * describes for this subsystem's other context inputs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { interpolate, enT, asT } from '@/lib/aiCoach/coachI18n';
import { buildTrainingModifiers, fuelNote } from '@/lib/aiCoach/trainingModifiers';
import { respond } from '@/lib/aiCoach/responders';
import { answerOnboarding, OB, NUT } from '@/lib/aiCoach/onboardingCoach';

/** A stub that IGNORES the English fallback, the way a real locale does. */
const es = (key, _english, vars) => interpolate(`[${key}]`, vars);

describe('coachI18n plumbing', () => {
  it('interpolates the same way tFallback does', () => {
    // If these two ever diverge, a missing key renders differently from a
    // present one and the bug is invisible in English.
    expect(interpolate('Rest is {sec}s longer', { sec: 20 })).toBe('Rest is 20s longer');
    expect(interpolate('{a} and {a}', { a: 'x' })).toBe('x and x');
    expect(interpolate('no vars', undefined)).toBe('no vars');
  });

  it('degrades a missing or malformed translator to English instead of throwing', () => {
    // A ctx threaded through several layers can lose `t` on the way. That
    // must cost the translation, not the reply.
    expect(asT(undefined)('k', 'English {n}', { n: 1 })).toBe('English 1');
    expect(asT('not a function')('k', 'English')).toBe('English');
    expect(asT(es)('k', 'English')).toBe('[k]');
    expect(enT('k', 'English {n}', { n: 2 })).toBe('English 2');
  });
});

describe('buildTrainingModifiers is inert without a translator', () => {
  it('returns the exact English a pre-i18n caller got', () => {
    const { notes } = buildTrainingModifiers({
      goal: 'strength', nutritionGoal: 'lose', weeklyRateLbs: 1, feel: 'rough', age: 62,
    });
    expect(notes).toContain('Built for strength: lower reps, longer rests.');
    expect(notes).toContain('You are eating in a deficit, so this session trims a set and keeps the weight heavy — intensity is what protects strength while cutting.');
    expect(notes).toContain('You said you feel rough — lighter, shorter and with more rest. Showing up counts; this still maintains.');
    expect(notes.some(n => n.startsWith('Rest is 20s longer'))).toBe(true);
  });

  it('changes no NUMBER when a translator is supplied', () => {
    const args = { goal: ['strength', 'endurance'], nutritionGoal: 'gain', age: 70, feel: 'good' };
    const en = buildTrainingModifiers(args);
    const loc = buildTrainingModifiers({ ...args, t: es });
    // Translation must move copy and nothing else — these numbers are what
    // generateWorkout applies to the bar.
    expect(loc.loadMultiplier).toBe(en.loadMultiplier);
    expect(loc.setsDelta).toBe(en.setsDelta);
    expect(loc.repDelta).toBe(en.repDelta);
    expect(loc.restDeltaSec).toBe(en.restDeltaSec);
    expect(loc.applied).toEqual(en.applied);
  });
});

describe('every generated note actually routes through a key', () => {
  // The failure this catches: a note added later with a literal string and
  // no key. It renders perfectly in English forever and never translates,
  // which is exactly how this whole surface got missed the first time.
  const localized = (args) => buildTrainingModifiers({ ...args, t: es }).notes;

  it('covers goal, diet, fuel, cycle, feel and age notes', () => {
    const notes = localized({
      goal: 'strength', nutritionGoal: 'lose', weeklyRateLbs: 1,
      cycleState: { phase: 'luteal' }, age: 70,
    });
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n).toMatch(/^\[coach\./);
  });

  it('covers the blended-goal sentence and its goal labels', () => {
    const [blend] = localized({ goal: ['strength', 'endurance', 'mobility'] });
    // The label list is interpolated INTO the key'd sentence, so the labels
    // have to be translated too — a raw English "strength, endurance" inside
    // a Spanish sentence is the mixed-script failure.
    expect(blend).toBe('[coach.note.goal.blend]');
  });

  it('covers both fuel branches, including the food name', () => {
    expect(fuelNote(['vegan'], es)).toBe('[coach.note.fuel.named]');
    // Every named option ruled out → the un-named fallback.
    expect(fuelNote(['vegan', 'keto', 'paleo', 'soy', 'egg'], es)).toBe('[coach.note.fuel.generic]');
  });
});

describe('the blended-goal list uses the locale, not hand-rolled grammar', () => {
  it('forms an English conjunction with the Oxford comma', () => {
    const [blend] = buildTrainingModifiers({ goal: ['strength', 'endurance', 'mobility'] }).notes;
    // Was `labels.slice(0,-1).join(', ') + ' and ' + last`, which is an
    // English-only rule. Intl supplies each locale's own — and en-US's
    // includes the serial comma, which the hand-rolled version omitted.
    expect(blend).toBe(
      'Balancing strength, endurance, and mobility — reps and rests land between what each one would ask for on its own.',
    );
  });

  it('handles the two-goal case without a stray separator', () => {
    const [blend] = buildTrainingModifiers({ goal: ['strength', 'muscle'] }).notes;
    expect(blend).toContain('Balancing strength and muscle —');
  });
});

// ── responders.js ───────────────────────────────────────────────────────────

describe('rules-engine replies route through keys and default to English', () => {
  // Only the responders that touch no database are exercised here — the
  // data-heavy ones are covered by the suites that already mock supabase.
  const DB_FREE = ['rest_day', 'nutrition_tip', 'hydration', 'plateau', 'unknown'];

  it.each(DB_FREE)('%s renders English with no translator', async (id) => {
    const reply = await respond({ user: {}, intent: { id, params: { raw: 'x' } } });
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(20);
    // A key that leaked through instead of its fallback would look like this.
    expect(reply).not.toMatch(/^\[?coach\./);
  });

  it.each(DB_FREE)('%s routes every line through a key', async (id) => {
    const reply = await respond({
      user: {}, intent: { id, params: { raw: 'x' } }, t: es, language: 'es',
    });
    // Each reply is one or two keys plus structural blank lines, so a
    // localized render should contain no untranslated prose at all.
    for (const line of reply.split('\n').filter(Boolean)) {
      expect(line).toMatch(/\[coach\./);
    }
  });

  it('a responder that throws still answers, in the caller language', async () => {
    // `respond` catches and returns a fixed apology; it used to be a bare
    // English literal outside every locale.
    const reply = await respond({
      user: {}, intent: { id: 'rest_day' }, t: () => { throw new Error('boom'); },
    });
    expect(typeof reply).toBe('string');
  });
});

// ── onboardingCoach.js ──────────────────────────────────────────────────────

describe('onboarding coach: inference branches route through keys', () => {
  // These are the `recommend` / `free` replies — the ones that read what
  // someone typed and propose a selection. They interpolate label maps and
  // day names, so they are where a half-extraction shows up as an English
  // noun inside a translated sentence.
  const ask = (stepId, message, t) =>
    answerOnboarding({ stepId, draft: { level: 'newbie', currentLbs: 200, targetLbs: 180 }, message, t, language: 'es' });

  it.each([
    [OB.GOAL, 'I want to get stronger', 'coach.onboarding.goal'],
    [OB.EXPERIENCE, "I've been lifting for 3 years", 'coach.onboarding.level'],
    [NUT.GOAL, 'I want to drop some weight', 'coach.onboarding.nutritionGoal'],
    [NUT.ACTIVITY, 'I sit at a desk all day', 'coach.onboarding.activity'],
  ])('%s infers and answers entirely in keys', (stepId, message, prefix) => {
    const { reply, apply } = ask(stepId, message, es);
    expect(reply).toContain(`[${prefix}.`);
    // The label the user taps has to be translated too — it was the one
    // user-visible string here that is not prose.
    if (apply) expect(apply.label).toMatch(/^\[coach\.onboarding\./);
  });

  it('leaves the applied VALUE alone while translating its label', () => {
    // Translation must never reach the thing being selected.
    const en = ask(NUT.ACTIVITY, 'I sit at a desk all day');
    const loc = ask(NUT.ACTIVITY, 'I sit at a desk all day', es);
    expect(loc.apply.field).toBe(en.apply.field);
    expect(loc.apply.value).toBe(en.apply.value);
    expect(loc.apply.value).toBe('sedentary');
  });

  it('is inert with no translator', () => {
    const { reply, apply } = ask(OB.GOAL, 'I want to get stronger');
    expect(reply).toContain('That reads as **Build strength**');
    expect(apply.label).toBe('Select Build strength');
  });

  it('localizes the weekday names it suggests, not just the sentence', () => {
    // `DAY_NAMES` is a hardcoded English array; the reply and the apply
    // label both have to come from Intl, and they have to MATCH each other —
    // the comment above DAY_NAMES records what shipped when they did not.
    const { reply, apply } = answerOnboarding({
      stepId: OB.DAYS, draft: { level: 'newbie' }, message: 'how many days should I train?',
      language: 'de',
    });
    expect(apply.value).toEqual([0, 2, 4]);
    // Asserted against Intl's own output rather than a literal — the exact
    // abbreviation (with or without a trailing period) varies by ICU
    // version, and pinning it would make this fail on a Node upgrade for a
    // reason that has nothing to do with the code.
    const de = [0, 2, 4].map(i => new Intl.DateTimeFormat('de', { weekday: 'short' })
      .format(new Date(2024, 0, 1 + i))).join(', ');
    expect(apply.label).toContain(de);
    // The reply and the label must agree — DAY_NAMES' own comment records
    // that a coach which SAID one set of days and SELECTED another shipped.
    expect(reply).toContain(de);
    expect(apply.label).not.toContain('Mon, Wed, Fri');
  });
});

describe('no onboarding guide reply is a bare literal', () => {
  // The standing guard. Every reply this module can produce has to come out
  // of a key, so a future literal shows up as English inside a translated
  // thread HERE rather than in someone's app. It is a source scan because
  // there are 73 guide closures behind six optional hooks, and no fixture
  // reaches all of them.
  //
  // It works by blanking each `T(...)` call span with paren matching, rather
  // than by looking a fixed number of lines up. A line window was the first
  // attempt and was wrong in both directions: it missed a key written as a
  // template literal, and it could not see the top of a long joined array.
  it('leaves no prose string outside a T() call', () => {
    let src = readFileSync('src/lib/aiCoach/onboardingCoach.js', 'utf8');

    // Blank comments and regex literals — both legitimately hold prose, and
    // NEGATORS/inferLevel are full of English words inside character classes.
    src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    src = src.replace(/^[ \t]*\/\/.*$/gm, (m) => ' '.repeat(m.length));
    src = src.replace(/\/(?![/*])(?:\\.|\[(?:\\.|[^\]])*\]|[^/\n\\])+\/[gimsuy]*/g,
      (m) => ' '.repeat(m.length));

    // Blank every T( ... ) span, parens balanced, so nested calls and
    // multi-line joined arrays are all covered.
    const chars = src.split('');
    for (let i = 0; i < chars.length - 1; i++) {
      if (chars[i] !== 'T' || chars[i + 1] !== '(') continue;
      if (/[\w$.]/.test(chars[i - 1] || '')) continue;   // asT(, enT( etc.
      let depth = 0;
      for (let j = i + 1; j < chars.length; j++) {
        if (chars[j] === '(') depth++;
        else if (chars[j] === ')') {
          depth--;
          if (depth === 0) {
            for (let k = i; k <= j; k++) if (chars[k] !== '\n') chars[k] = ' ';
            i = j;
            break;
          }
        }
      }
    }

    const stray = [];
    chars.join('').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/(`[^`]*`|'[^']*'|"[^"]*")/g)) {
        const t = m[0].slice(1, -1);
        if (t.length < 20) continue;
        if (!/[a-z]{2}\s+[a-z]{2}/.test(t)) continue;
        stray.push(`${i + 1}: ${t.slice(0, 70)}`);
      }
    });
    expect(stray).toEqual([]);
  });
});

describe('every coach key a T() call names exists in English', () => {
  // The gap this closes: `tFallback` renders its English fallback for a key
  // that is absent from the aggregate, so a missing key is INVISIBLE at
  // runtime — the reply looks perfect. What it actually costs is the
  // translator, who has nothing to translate. Six joined-array keys had
  // slipped through the extraction that way before this test existed.
  it('has no key used in the generators but absent from en', () => {
    const src = ['onboardingCoach', 'responders', 'trainingModifiers']
      .map(f => readFileSync(`src/lib/aiCoach/${f}.js`, 'utf8')).join('\n');
    const en = new Set(
      [...readFileSync('src/lib/i18n-langs/en.js', 'utf8').matchAll(/"([^"]+)":/g)].map(m => m[1]),
    );
    const used = [...src.matchAll(/T\(\s*'(coach\.[\w.]+)'/g)].map(m => m[1]);
    expect(used.length).toBeGreaterThan(150);
    expect([...new Set(used)].filter(k => !en.has(k)).sort()).toEqual([]);
  });
});
