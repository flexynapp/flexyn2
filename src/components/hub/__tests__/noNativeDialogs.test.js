/**
 * The Hub's confirmations must be in-app, not browser chrome.
 *
 * `window.confirm` renders the OS dialog: wrong font, wrong buttons, ignores
 * the theme, and its Cancel/OK labels come from the BROWSER's locale rather
 * than the app's — so a Spanish user gets Spanish buttons around an English
 * question, and an Arabic user gets an LTR dialog on an RTL screen. On an
 * installed PWA it reads as the app falling out into the system.
 *
 * This is a source scan rather than a render test on purpose: the failure mode
 * is someone adding a fourth `confirm()` in a hurry, and a scan catches that
 * without needing every future call site to have a test written for it. It is
 * scoped to the three files fixed on 11 Aug rather than the whole app, because
 * ~23 other native confirms still exist elsewhere and this is not the change
 * that removes them — widening the glob later is the intended direction.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
  'src/components/hub/HubCommentsInline.jsx',
  'src/components/hub/HubPostCard.jsx',
];

// `confirm(` preceded by a word char is something like `confirmDelete(` — a
// name of ours, not the global. We want the bare global and `window.confirm`.
const NATIVE = /(?:window\s*\.\s*confirm\s*\(|(?<![\w.])confirm\s*\()/;

describe('hub confirmations are in-app', () => {
  it.each(FILES)('%s uses no native confirm()', (rel) => {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line])
      // Skip comment lines — this file's own rationale mentions the name.
      .filter(([, line]) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter(([, line]) => NATIVE.test(line));

    expect(
      offenders.map(([n, l]) => `${rel}:${n}  ${l.trim()}`),
      'use ConfirmDialog instead of the browser dialog',
    ).toEqual([]);
  });

  it.each(FILES)('%s uses no native alert()', (rel) => {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter(([, line]) => /(?:window\s*\.\s*alert\s*\(|(?<![\w.])alert\s*\()/.test(line));
    expect(offenders.map(([n, l]) => `${rel}:${n}  ${l.trim()}`)).toEqual([]);
  });
});
