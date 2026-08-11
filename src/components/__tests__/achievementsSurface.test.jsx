// Render + behaviour tests for the Achievements surface (audit 2026-08-11).
//
// These are REGRESSION tests, not characterization tests — every
// assertion here describes what the surface should do, and each one that
// pins a fix says which defect it pins.
//
// Scope is the five sub-features the audit covers, one describe block
// each: unlocked badges, progress toward the next badge, categories,
// date unlocked, and share.
//
// Why this file renders rather than unit-testing the catalog: jsdom
// paints nothing, but it still resolves which branch ran, and every
// defect found in this audit was a wiring defect — a value read from the
// wrong key, a list read from the wrong table — which is exactly what a
// render test catches and a catalog test cannot.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AchievementsTab from '@/components/progress/AchievementsTab';
import { TROPHIES, TROPHY_CATEGORIES, getTrophy } from '@/lib/trophyDefinitions';

// ── stubs ────────────────────────────────────────────────────────────
//
// The tFallback stub INTERPOLATES rather than returning the fallback
// verbatim. CLAUDE.md's i18n section is explicit that the usual
// `(key, english) => english` stub is blind to a wrapper that drops its
// vars — it hands back an already-interpolated English string and passes
// either way. Interpolating here means a missing third argument shows up
// as a literal "{name}" in an assertion.
const t = (k) => k;
const tFallback = (_k, fb, vars) =>
  String(fb).replace(/\{(\w+)\}/g, (_, n) => (vars?.[n] ?? `{${n}}`));

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ t, tFallback, language: 'en' }),
}));

vi.mock('@/lib/intl', () => ({
  useDateFormatter: () => (d) => `DATE(${new Date(d).toISOString().slice(0, 10)})`,
  useNumberFormatter: () => (n) => String(n),
  useListFormatter: () => (items) => items.join(' + '),
}));

const shareAchievementPost = vi.fn();
vi.mock('@/lib/data/shareAchievement', () => ({
  shareAchievementPost: (...a) => shareAchievementPost(...a),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a) => toastSuccess(...a), error: (...a) => toastError(...a) },
}));

const USER = { id: 'u1', email: 'a@b.c', username: 'kegan' };

beforeEach(() => {
  shareAchievementPost.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

/** Switch to the Earned tab. Radix-free plain buttons, but userEvent anyway. */
async function openEarned() {
  await userEvent.click(screen.getByRole('button', { name: 'In progress' })
    .parentElement.querySelector('button:nth-child(2)'));
}

// ── 1. Unlocked badges ───────────────────────────────────────────────
describe('unlocked badges', () => {
  it('renders an earned trophy with its real catalog name and art', async () => {
    render(<AchievementsTab
      trophies={[{ trophy_id: 'first_rep', earned_at: '2026-08-07T10:00:00Z' }]}
      progress={{ workouts: 1 }}
      user={USER}
    />);
    await openEarned();
    expect(screen.getByText('First Rep')).toBeTruthy();
    expect(screen.getByText('Logged your first workout.')).toBeTruthy();
  });

  it('drops a row whose id is not in the catalog rather than rendering a blank card', async () => {
    // The legacy `public.achievements` table's one production row is an
    // `xp_250` that was never in any catalog. A row the client cannot
    // resolve must vanish, not render as an untitled medallion.
    render(<AchievementsTab
      trophies={[
        { trophy_id: 'first_rep', earned_at: '2026-08-07T10:00:00Z' },
        { trophy_id: 'xp_250', earned_at: '2026-05-01T10:00:00Z' },
      ]}
      progress={{ workouts: 1 }}
      user={USER}
    />);
    await openEarned();
    expect(screen.getByText('First Rep')).toBeTruthy();
    expect(screen.queryByText(/xp_250/)).toBeNull();
  });

  it('resolves generated tail and league-season ids alongside catalog ones', async () => {
    render(<AchievementsTab
      trophies={[
        { trophy_id: 'sessions_x1', earned_at: '2026-08-07T10:00:00Z' },
        { trophy_id: 'league_s5_legend', earned_at: '2026-08-07T10:00:00Z' },
      ]}
      progress={{}}
      user={USER}
    />);
    await openEarned();
    expect(screen.getByText('Centurion II')).toBeTruthy();
    expect(screen.getByText('Season 5 Legend')).toBeTruthy();
  });

  it('counts named rungs against the catalog and tails as a +N surplus', () => {
    render(<AchievementsTab
      trophies={[
        { trophy_id: 'first_rep', earned_at: '2026-08-07T10:00:00Z' },
        { trophy_id: 'sessions_x1', earned_at: '2026-08-07T10:00:00Z' },
      ]}
      progress={{}}
      user={USER}
    />);
    // 1 named of the whole catalog, plus one tail outside the denominator.
    // The counter is one span built from three JSX children, so match on
    // the assembled textContent rather than a single text node.
    const counter = screen.getByText(
      (_, el) => el?.tagName === 'SPAN'
        && el.textContent.replace(/\s+/g, ' ').trim() === `1 / ${TROPHIES.length} +1`,
    );
    expect(counter).toBeTruthy();
  });

  it('shows the empty state rather than a zeroed grid at nothing earned', async () => {
    render(<AchievementsTab trophies={[]} progress={{}} user={USER} />);
    await openEarned();
    expect(screen.getByText('No badges yet')).toBeTruthy();
  });
});

// ── 2. Progress toward the next badge ────────────────────────────────
describe('progress toward the next badge', () => {
  it('draws the live rung against the ladder signal', () => {
    render(<AchievementsTab trophies={[]} progress={{ workouts: 12 }} user={USER} />);
    // 12 workouts → next named rung is Committed at 50.
    expect(screen.getByText('12 / 50 workouts')).toBeTruthy();
  });

  it('clamps the readout to the target instead of overflowing it', () => {
    render(<AchievementsTab trophies={[]} progress={{ journalEntries: 999 }} user={USER} />);
    // Past every named journal rung, so the live rung is a tail at 100.
    expect(screen.queryByText(/999 \/ 50/)).toBeNull();
  });

  it('measures a rung by its OWN signal where it declares one', () => {
    // DEFECT PINNED: `gauntlet_path` declares signal:'gauntletPath' and
    // nothing read it, so the gauntlet ladder measured a yes/no
    // path-completion rung against the count of challenges cleared.
    render(<AchievementsTab
      trophies={[]}
      progress={{ gauntletDone: 5, gauntletPath: 0 }}
      user={USER}
    />);
    // 5 cleared → bronze rung done, so the live rung is the gold one,
    // and being binary it must render NO "5 / 1" fraction.
    expect(screen.getAllByText('Gauntlet Cleared').length).toBeGreaterThan(0);
    expect(screen.queryByText(/5 \/ 1\b/)).toBeNull();
  });

  it('offers the bronze gauntlet rung to a new user, not the gold one', () => {
    render(<AchievementsTab
      trophies={[]}
      progress={{ gauntletDone: 0, gauntletPath: 0 }}
      user={USER}
    />);
    expect(screen.getByText('Gauntlet Runner')).toBeTruthy();
  });

  it('states the gate instead of a bar when the next rung is locked', () => {
    // crewwar_1 requires crew_squad. Rendering "0 / 1 wars" at someone
    // not in a crew reads as a task they are failing.
    render(<AchievementsTab trophies={[]} progress={{ crewWars: 0 }} user={USER} />);
    expect(screen.getByText('Unlocks with Squad Member')).toBeTruthy();
  });

  it('says a dead-end ladder is complete only when every rung is EARNED', () => {
    render(<AchievementsTab
      trophies={[
        { trophy_id: 'cross_3', earned_at: '2026-08-01T09:00:00Z' },
        { trophy_id: 'cross_5', earned_at: '2026-08-01T09:00:00Z' },
        { trophy_id: 'cross_8', earned_at: '2026-08-01T09:00:00Z' },
      ]}
      progress={{ activityTypes: 99 }}   // `cross` deliberately dead-ends
      user={USER}
    />);
    expect(screen.getAllByText('Ladder complete.').length).toBeGreaterThan(0);
  });

  it('does NOT claim completion on a dead-end ladder with nothing earned', () => {
    // DEFECT PINNED: `finished` was `!nextRung(...)`, so a dead-end
    // ladder whose threshold is already met rendered "Ladder complete."
    // next to a "0 / 1" counter. One live production user (in a crew,
    // no crew_squad badge) sees exactly this. Found by rendering — jsdom
    // paints nothing, and the two halves sit in different elements, so a
    // green suite said nothing about the contradiction.
    render(<AchievementsTab trophies={[]} progress={{ crewCount: 3 }} user={USER} />);
    expect(screen.queryByText('Ladder complete.')).toBeNull();
    // Instead the top rung stays visible, clamped, as a pending badge.
    expect(screen.getByText('1 / 1')).toBeTruthy();
  });
});

// ── 3. Categories ────────────────────────────────────────────────────
describe('achievement categories', () => {
  it('renders every declared category as a heading', () => {
    render(<AchievementsTab trophies={[]} progress={{}} user={USER} />);
    for (const cat of TROPHY_CATEGORIES) {
      expect(screen.getAllByText(cat.name).length, `category ${cat.id} missing`)
        .toBeGreaterThan(0);
    }
  });

  it('files each ladder under its own category and nowhere else', () => {
    render(<AchievementsTab trophies={[]} progress={{}} user={USER} />);
    // "Sessions" is an Iron ladder; it must appear exactly once.
    expect(screen.getAllByText('Sessions').length).toBe(1);
  });

  it('keeps capstones OUT of the category sections and in Locked', () => {
    // Capstones have no ladder and no numeric criterion, so a category
    // section would have nowhere to put them.
    render(<AchievementsTab trophies={[]} progress={{}} user={USER} />);
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getAllByText('Iron Master').length).toBeGreaterThan(0);
  });

  it('names the outstanding requirements on a locked entry', () => {
    render(<AchievementsTab trophies={[]} progress={{}} user={USER} />);
    const apex = screen.getByText('Flexyn Complete').closest('div.flex-1');
    expect(within(apex).getByText('Ironlung')).toBeTruthy();
  });
});

// ── 4. Date unlocked ─────────────────────────────────────────────────
describe('date unlocked', () => {
  it('renders the earned date through the language-bound formatter', async () => {
    render(<AchievementsTab
      trophies={[{ trophy_id: 'first_rep', earned_at: '2026-08-07T10:00:00Z' }]}
      progress={{}}
      user={USER}
    />);
    await openEarned();
    // Proves it goes through useDateFormatter (Intl) and not date-fns
    // `format()`, which binds no locale — see CLAUDE.md's i18n section.
    expect(screen.getByText(/DATE\(2026-08-07\)/)).toBeTruthy();
  });

  it('omits the date line entirely when earned_at is missing', async () => {
    render(<AchievementsTab
      trophies={[{ trophy_id: 'first_rep', earned_at: null }]}
      progress={{ workouts: 1 }}
      user={USER}
    />);
    await openEarned();
    expect(screen.getByText('First Rep')).toBeTruthy();
    expect(screen.queryByText(/DATE\(/)).toBeNull();
    // and never a bare "Invalid Date" or an epoch fallback
    expect(screen.queryByText(/Invalid Date|1970/)).toBeNull();
  });
});

// ── 5. Share ─────────────────────────────────────────────────────────
describe('share achievement', () => {
  const earned = [{ trophy_id: 'first_rep', earned_at: '2026-08-07T10:00:00Z' }];

  it('sends the trophy AND its earned date into the share payload', async () => {
    shareAchievementPost.mockResolvedValue({ ok: true, postId: 'p1' });
    render(<AchievementsTab trophies={earned} progress={{}} user={USER} />);
    await openEarned();
    await userEvent.click(screen.getByRole('button', { name: /Share First Rep to Hub/ }));

    expect(shareAchievementPost).toHaveBeenCalledTimes(1);
    const arg = shareAchievementPost.mock.calls[0][0];
    expect(arg.user).toBe(USER);
    expect(arg.achievement).toMatchObject({
      achievement_id: 'first_rep',
      name: 'First Rep',
      icon: getTrophy('first_rep').emoji,
      unlockedDate: '2026-08-07T10:00:00Z',
    });
  });

  it('labels the control through i18n, with the badge name interpolated', async () => {
    shareAchievementPost.mockResolvedValue({ ok: true });
    render(<AchievementsTab trophies={earned} progress={{}} user={USER} />);
    await openEarned();
    // A literal "{name}" here would mean the vars were dropped between
    // the call site and tFallback — the JournalView failure mode.
    expect(screen.getByRole('button', { name: 'Share First Rep to Hub' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /\{name\}/ })).toBeNull();
  });

  it('toasts success on a shared badge', async () => {
    shareAchievementPost.mockResolvedValue({ ok: true, postId: 'p1' });
    render(<AchievementsTab trophies={earned} progress={{}} user={USER} />);
    await openEarned();
    await userEvent.click(screen.getByRole('button', { name: /Share First Rep/ }));
    expect(toastSuccess).toHaveBeenCalledWith('Shared to Hub!');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reports the reason when the share is refused', async () => {
    shareAchievementPost.mockResolvedValue({ ok: false, error: '22P02' });
    render(<AchievementsTab trophies={earned} progress={{}} user={USER} />);
    await openEarned();
    await userEvent.click(screen.getByRole('button', { name: /Share First Rep/ }));
    expect(toastError).toHaveBeenCalledWith("Couldn't share: 22P02");
  });

  it('recovers from a THROWN share rather than spinning forever', async () => {
    // shareAchievementPost returns {ok:false} on a handled failure but
    // throws on a network blip. Without the catch the button stayed
    // disabled with a spinner and the user got no feedback at all.
    shareAchievementPost.mockRejectedValue(new Error('offline'));
    render(<AchievementsTab trophies={earned} progress={{}} user={USER} />);
    await openEarned();
    const btn = screen.getByRole('button', { name: /Share First Rep/ });
    await userEvent.click(btn);
    // The catch block awaits a dynamic import of reportError before it
    // toasts, so the assertion has to outlive that microtask.
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't share: offline"));
    expect(btn.disabled).toBe(false);
  });
});
