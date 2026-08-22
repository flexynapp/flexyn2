/**
 * A content warning set on a video or a poll was thrown away.
 *
 * The CW picker lives in `renderPrivacyButtons()`, which every one of the
 * five compose steps mounts — so the control was offered on polls and videos
 * exactly as it was on a status. Only the generic `create()` forwarded it.
 * The video and poll paths were written by copying the crew and schedule
 * spreads and stopping there, which is the tell: three call sites, two of
 * them missing one line each, and no way to see it except by reading all
 * three side by side.
 *
 * The worst of it is not the poll. A Status carrying a clip is routed to
 * `submitVideoPost` on purpose (one upload path, one orphan cleanup), so the
 * video branch is where EVERY video post is created — meaning any video post
 * with a warning on it published unblurred, past a ContentWarningGate that
 * was working perfectly and simply never given a warning to gate on.
 *
 * A source scan rather than a render test, and deliberately so: the failure
 * mode is a sixth compose step arriving next quarter and its author copying
 * whichever create() they happen to be looking at. A test that drove the
 * three paths that exist today would say nothing about the fourth. This
 * fails the moment a create() in this file does not carry the shared object.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REL = 'src/components/hub/HubComposer.jsx';
const src = readFileSync(resolve(process.cwd(), REL), 'utf8');

/** Every `hubPosts.create({ … })` argument, matched by brace depth. */
function createCallBodies(text) {
  const out = [];
  const needle = 'hubPosts.create({';
  let from = 0;
  for (;;) {
    const start = text.indexOf(needle, from);
    if (start === -1) return out;
    let depth = 0;
    let i = start + needle.length - 1; // sitting on the opening brace
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) break; }
    }
    out.push({ line: text.slice(0, start).split('\n').length, body: text.slice(start, i + 1) });
    from = i + 1;
  }
}

describe('HubComposer content warnings', () => {
  it('has the three create() paths this test is scoped to', () => {
    // Keeps the assertion below honest. If the composer is refactored down
    // to one create(), a per-call check would pass on a single call site
    // while saying nothing — this fails instead and asks to be re-read.
    expect(createCallBodies(src).length).toBeGreaterThanOrEqual(3);
  });

  it('forwards the warning from every create(), not just the status path', () => {
    const missing = createCallBodies(src)
      .filter(({ body }) => !body.includes('...cwFields'))
      .map(({ line }) => `${REL}:${line}`);
    expect(
      missing,
      'spread ...cwFields here — a warning the user set is otherwise dropped silently',
    ).toEqual([]);
  });

  it('builds cwFields from the picker state, so the spread is not an empty object', () => {
    // The guard against "fixed" by declaring `const cwFields = {}`: the
    // object has to actually depend on cwType and carry both columns.
    const decl = src.match(/const cwFields\s*=[\s\S]{0,400}?;\n/);
    expect(decl, 'cwFields must exist').toBeTruthy();
    expect(decl[0]).toContain('cwType');
    expect(decl[0]).toContain('content_warning:');
    expect(decl[0]).toContain('content_warning_label:');
    expect(decl[0]).toContain('cwLabel');
  });
});
