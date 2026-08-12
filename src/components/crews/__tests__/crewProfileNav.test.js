/**
 * Tapping a person in Crews opens their profile.
 *
 * Sean, 12 Aug: "when I click roster and I try to click Kegan it does not
 * bring me to his page. Same thing when I'm in chat."
 *
 * The cause was a PROP CHAIN with one missing link, and the reason it was
 * invisible is the shape of the failure: every consumer calls
 * `onViewProfile?.(…)` with an optional chain, so an undefined callback is a
 * silent no-op rather than a TypeError. Four of the five links were wired —
 * CrewPage → CrewMemberDirectory, CrewPage → CrewChat, CrewChat → member
 * panel — and CrewsSection in the middle neither accepted the prop nor passed
 * it, so every one of those correct links received undefined.
 *
 * Nothing threw, nothing logged, and reading any single file made the feature
 * look wired. That is why this test walks the WHOLE chain rather than testing
 * one component: a unit test on CrewMemberDirectory would have passed
 * throughout the entire period the feature was broken.
 *
 * The chat avatar is a second, separate defect in the same report — it was a
 * plain <div> with no click target at all, so no amount of prop-threading
 * would have helped it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const HUB       = read('src/pages/Hub.jsx');
const SECTION   = read('src/components/crews/CrewsSection.jsx');
const PAGE      = read('src/components/crews/CrewPage.jsx');
const DIRECTORY = read('src/components/crews/CrewMemberDirectory.jsx');
const CHAT      = read('src/components/crews/CrewChat.jsx');
const MESSAGE   = read('src/components/crews/CrewMessageItem.jsx');

// The JSX block where one component mounts another, so "does A pass X to B"
// is asked of the actual call site rather than of the file as a whole.
function mountOf(src, tag) {
  const start = src.indexOf(`<${tag}`);
  if (start === -1) return '';
  const end = src.indexOf('/>', start);
  const endTag = src.indexOf(`</${tag}>`, start);
  const stop = end === -1 ? endTag : (endTag === -1 ? end : Math.min(end, endTag));
  return src.slice(start, stop === -1 ? start + 600 : stop);
}

describe('the prop chain, link by link', () => {
  it('Hub gives CrewsSection a profile handler', () => {
    // THE broken link. Everything below it was already correct.
    expect(mountOf(HUB, 'CrewsSection')).toMatch(/onViewProfile=/);
  });

  it('CrewsSection accepts it', () => {
    expect(SECTION).toMatch(/function CrewsSection\(\{[^}]*onViewProfile/);
  });

  it('CrewsSection forwards it to CrewPage', () => {
    expect(mountOf(SECTION, 'CrewPage')).toMatch(/onViewProfile=\{onViewProfile\}/);
  });

  it('CrewPage accepts it', () => {
    expect(PAGE).toMatch(/function CrewPage\(\{[^}]*onViewProfile/);
  });

  it('CrewPage forwards it to the roster', () => {
    expect(mountOf(PAGE, 'CrewMemberDirectory')).toMatch(/onViewProfile=\{onViewProfile\}/);
  });

  it('CrewPage forwards it to chat', () => {
    expect(mountOf(PAGE, 'CrewChat')).toMatch(/onViewProfile=\{onViewProfile\}/);
  });

  it('the roster actually calls it', () => {
    expect(DIRECTORY).toMatch(/onViewProfile\?\.\(/);
  });
});

describe('the chat avatar is a real control', () => {
  it('renders as a button when a handler is present', () => {
    // Was a plain <div> — no onClick, no role, nothing to tap.
    expect(MESSAGE).toMatch(/const Tag = open \? 'button' : 'div'/);
  });

  it('degrades to a div when no handler is wired', () => {
    // A button that does nothing is worse than a non-interactive avatar: it
    // advertises an action the surface cannot perform.
    expect(MESSAGE).toMatch(/onClick=\{open \|\| undefined\}/);
  });

  it('carries an accessible name naming the person', () => {
    expect(MESSAGE).toMatch(/aria-label=\{open \? `Open \$\{profile\?\.username/);
  });

  it('every Avatar in the file receives the handler', () => {
    // Three message shapes render an Avatar — text, one-time image, timed
    // image. Missing one leaves a dead avatar in a message type nobody
    // remembers to test.
    const uses = MESSAGE.match(/<Avatar /g) || [];
    const wired = MESSAGE.match(/<Avatar profile=\{senderProfile\} onViewProfile=\{onViewProfile\} \/>/g) || [];
    expect(uses.length).toBeGreaterThan(0);
    expect(wired.length).toBe(uses.length);
  });

  it('CrewChat passes it down to the message rows', () => {
    expect(mountOf(CHAT, 'CrewMessageItem')).toMatch(/onViewProfile=\{onViewProfile\}/);
  });
});
