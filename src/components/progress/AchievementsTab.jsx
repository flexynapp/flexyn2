// src/components/progress/AchievementsTab.jsx
//
// The Achievements surface, rendered inside AchievementsVault.
//
// ── What changed and why ──────────────────────────────────────────
//
// This used to read `public.achievements` against the 26 definitions in
// achievementDefinitions.js. That table had no server grant path —
// migration 189 removed the client INSERT policy to stop badge forgery
// and nothing replaced it — so production held ONE row across every
// user, an `xp_250` that wasn't even in the catalog. The page rendered
// "1 / 26" with an empty Completed tab and 26 progress bars frozen at
// zero. Every one of those badges was unobtainable.
//
// It now reads `user_trophies`, which is server-granted against real SQL
// criteria (migrations 167 + 323), and is organised by LADDER rather
// than by flat category:
//
//   • "Next up" leads — the three closest rungs across every ladder.
//     This is the answer to "what do I do now", and it is always
//     populated because ladders have infinite tails.
//   • Each ladder shows ONE live rung plus the ones already earned.
//     Clearing a rung doesn't leave a gap; the next rung moves into the
//     same slot, so there is never a finished-looking wall.
//   • The counter is named-rungs-earned over named-rungs-total. Tail
//     rungs are excluded on purpose — a denominator that grows forever
//     reads as a collection you can never finish.

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Lock, Check, Share2, Loader2, Infinity as InfinityIcon } from 'lucide-react';
import { toast } from '@/lib/toast';
import { shareAchievementPost } from '@/lib/data/shareAchievement';
import {
  TROPHIES,
  TROPHY_TIERS,
  TROPHY_CATEGORIES,
  LADDERS,
  rungsFor,
  nextRung,
  rungProgress,
  getTrophy,
  isUnlocked,
  lockedTrophies,
  requirementsFor,
  ladderName,
  ladderUnit,
  trophyCategoryName,
  trophyDescription,
  trophyName,
} from '@/lib/trophyDefinitions';
import { useLanguage } from '@/lib/LanguageContext';
import { useDateFormatter, useListFormatter, useNumberFormatter } from '@/lib/intl';
import EmptyState from '@/components/EmptyState';
import LeagueTierIcon from '@/components/leagues/LeagueTierIcon';

// How many "closest rung" cards lead the page. Three is enough to offer a
// choice without turning the top of the page into a second full list.
const NEXT_UP_COUNT = 3;

function TierStripe({ tier }) {
  const meta = TROPHY_TIERS[tier] || TROPHY_TIERS.bronze;
  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-0 bottom-0"
      style={{ height: 2, background: meta.color }}
    />
  );
}

function Medallion({ trophy, earned, size = 44 }) {
  return (
    <div
      className={`relative shrink-0 rounded-xl flex items-center justify-center overflow-hidden ${
        earned ? 'bg-secondary/40' : 'bg-muted/50'
      }`}
      style={{ width: size, height: size }}
    >
      <span
        className="leading-none"
        style={{
          fontSize: Math.round(size * 0.52),
          // Locked badges keep their own art rather than becoming a
          // generic padlock — you should be able to see what you're
          // working toward, not just that something exists.
          ...(earned ? {} : { filter: 'grayscale(1) brightness(0.5)', opacity: 0.75 }),
        }}
      >
        {trophy.leagueTier ? (
          <LeagueTierIcon
            tier={trophy.leagueTier}
            style={{ width: Math.round(size * 0.8), height: Math.round(size * 0.8) }}
            className=""
          />
        ) : trophy.emoji}
      </span>
      {earned && <TierStripe tier={trophy.tier} />}
    </div>
  );
}

/**
 * One ladder. Shows every earned rung as a medallion row, then the ONE
 * rung currently in play with its progress bar.
 */
function LadderRow({ ladderId, earnedIds, signal, progress, fmtNum, fmtList, tFallback }) {
  const ladder = LADDERS[ladderId];
  const unit = ladderUnit(ladderId, tFallback);
  const rungs = rungsFor(ladderId);
  const earned = rungs.filter((r) => earnedIds.has(r.id));
  const allEarned = rungs.length > 0 && earned.length >= rungs.length;
  // "No next rung" and "finished" are NOT the same thing, and conflating
  // them shipped a self-contradiction. On the five ladders that
  // deliberately dead-end (crew, cardio, cross, level, gauntlet) a user
  // whose signal already clears the top threshold has no next rung while
  // still holding none of the badges — the server grants on the next
  // checkpoint, and the two queries behind this page have separate
  // staleTimes, so they legitimately disagree for a window. That
  // rendered "✓ Ladder complete." beside a "0 / 1" counter. Verified
  // against production: one live user is in a crew with no crew_squad.
  //
  // So when there is no next rung but the top one is unearned, keep
  // showing that top rung. Its bar reads a clamped "1 / 1", which is the
  // honest state: you have met the bar and the badge is pending.
  const live = nextRung(ladderId, signal, progress)
    || (allEarned ? null : rungs[rungs.length - 1] || null);
  // A rung may be measured by its OWN signal rather than its ladder's —
  // see rungSignal(). Reading the ladder's number for such a rung draws
  // a bar out of an unrelated statistic.
  const liveValue = live && live.signal
    ? Number(progress?.[live.signal]) || 0
    : signal;
  const isTail = !!live?.isTail;
  // A ladder with no live rung has genuinely ended (the deliberate dead
  // ends). Say so, rather than rendering an empty progress bar.
  const finished = !live;
  // A ladder whose next rung is gated shows the gate instead of a bar.
  // Rendering "0 / 1 wars" at someone who is not in a crew reads as a
  // task they are failing rather than one they have not opened yet.
  const gated = !!live && !isUnlocked(live, earnedIds);
  const gate = gated ? requirementsFor(live, earnedIds).filter((r) => !r.done) : [];

  const prog = live ? rungProgress(live, liveValue) : null;

  return (
    <div className="py-3 border-b border-border last:border-b-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-sm font-semibold">{ladderName(ladderId, tFallback)}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {earned.length} / {rungs.length}
        </span>
      </div>

      {earned.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {earned.map((r) => (
            <Medallion key={r.id} trophy={r} earned size={28} />
          ))}
        </div>
      )}

      {finished ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Check className="w-3.5 h-3.5 text-success" />
          {tFallback('progress.ladderComplete', 'Ladder complete.')}
        </div>
      ) : gated ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          {/* Was a bare English literal with a hardcoded `, ` separator, in a
              component whose other three strings ARE translated. Both halves
              had to move: localizing the separator inside an untranslated
              sentence would have produced a mixed-script line, which is worse
              than a consistent English one. */}
          <span className="truncate">
            {tFallback('progress.unlocksWith', 'Unlocks with {items}', {
              items: fmtList(gate.map((r) => r.name)),
            })}
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Medallion trophy={live} earned={false} size={28} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium truncate">
                {trophyName(live, tFallback)}
                {isTail && (
                  <InfinityIcon className="inline w-3 h-3 ms-1 align-[-1px] text-muted-foreground" />
                )}
              </span>
              {/* A binary rung is a yes/no, not a count. Rendering
                  "0 / 1" on it reads as a broken progress bar. */}
              {!live.binary && (
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {fmtNum(Math.min(Math.round(liveValue), prog.target))} / {fmtNum(prog.target)}
                  {unit ? ` ${unit}` : ''}
                </span>
              )}
            </div>
            {!live.binary && (
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-1.5">
                <div
                  className="h-full bg-primary transition-[width] duration-500"
                  style={{ width: `${prog.pct}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AchievementsTab({ trophies = [], progress = {}, user = null }) {
  const { t, tFallback } = useLanguage();
  const fmtDate = useDateFormatter();
  const fmtNum = useNumberFormatter();
  const fmtList = useListFormatter();
  const [tab, setTab] = useState('progress');
  // Single-flight: only one share in the air at a time.
  const [sharingId, setSharingId] = useState(null);

  const handleShare = async (trophy, row) => {
    if (sharingId) return;
    setSharingId(row.trophy_id);
    let res;
    try {
      res = await shareAchievementPost({
        user,
        // shareAchievementPost predates trophies and speaks the old
        // achievement shape. Adapt rather than fork it — the payload it
        // builds is what HubPostCard already knows how to render.
        achievement: {
          achievement_id: trophy.id,
          name:           trophy.name,
          description:    trophy.description,
          icon:           trophy.emoji,
          unlockedDate:   row.earned_at,
        },
      });
    } catch (err) {
      // A network blip throws rather than returning { ok }. Without this
      // the button stayed spinning forever and the user saw nothing.
      try {
        const { reportError } = await import('@/lib/reportError');
        reportError(err, {
          feature: 'achievements.share',
          level: 'warning',
          userEmail: user?.email,
          trophyId: trophy.id,
        });
      } catch { /* reportError unavailable */ }
      res = { ok: false, error: err?.message || 'network' };
    } finally {
      setSharingId(null);
    }
    if (res.ok) {
      toast.success(tFallback('achievements.shareSuccess', 'Shared to Hub!'));
    } else {
      toast.error(tFallback(
        'achievements.shareFailed',
        "Couldn't share: {reason}",
        { reason: res.error || 'try again' },
      ));
    }
  };

  const earnedIds = useMemo(
    () => new Set(trophies.map((r) => r.trophy_id)),
    [trophies],
  );

  const signalFor = (ladderId) => {
    const key = LADDERS[ladderId]?.signal;
    const raw = key ? progress[key] : 0;
    return Number(raw) || 0;
  };

  // "Next up" — the closest rungs by completion percentage, across every
  // ladder. Ladders sitting at 0 are included (a brand-new user has to be
  // offered something) but rank below anything already started.
  const nextUp = useMemo(() => {
    const candidates = Object.keys(LADDERS)
      .map((id) => {
        const value = signalFor(id);
        const rung = nextRung(id, value, progress);
        // Locked rungs are not "next" — offering something the server
        // would refuse to grant is worse than offering nothing.
        if (!rung || !isUnlocked(rung, earnedIds)) return null;
        // Measure the rung by its own signal where it declares one.
        const rungValue = rung.signal ? Number(progress?.[rung.signal]) || 0 : value;
        return { ladderId: id, rung, value: rungValue, pct: rungProgress(rung, rungValue).pct };
      })
      .filter(Boolean);
    candidates.sort((a, b) => b.pct - a.pct);
    return candidates.slice(0, NEXT_UP_COUNT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, earnedIds]);

  // Everything still gated behind an unearned prerequisite. Counted and
  // listed at the bottom so the catalog's depth is visible without
  // padding the ladders with entries nobody can act on yet.
  const locked = useMemo(() => lockedTrophies(earnedIds), [earnedIds]);

  const earnedRows = useMemo(() => {
    // Rows carry earned_at; resolve each through getTrophy so generated
    // tail ids and league season trophies render alongside catalog ones.
    return trophies
      .map((row) => ({ row, trophy: getTrophy(row.trophy_id) }))
      .filter((x) => x.trophy);
  }, [trophies]);

  const namedTotal = TROPHIES.length;
  // Tails, league seasons and XP milestones all sit outside TROPHIES, so
  // none of them may count against a denominator drawn from it — a
  // numerator that can exceed its denominator reads as a broken counter.
  const namedEarned = earnedRows.filter(
    (x) => !x.trophy.isTail && !x.trophy.season && !x.trophy.isXpMilestone,
  ).length;
  const pct = namedTotal > 0 ? Math.round((namedEarned / namedTotal) * 100) : 0;
  const extra = earnedRows.length - namedEarned;

  return (
    <div>
      {/* Collection header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-primary" />
            <h2 className="font-heading font-bold text-lg">{t('progress.achievements')}</h2>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {namedEarned} / {namedTotal}
            {/* Tails and season trophies sit outside the denominator, so
                they'd silently vanish from the count without this. */}
            {extra > 0 && ` +${extra}`}
          </span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Next up — the whole point of the ladder structure. */}
      {tab === 'progress' && nextUp.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {tFallback('progress.nextUp', 'Next up')}
          </h3>
          <div className="space-y-2">
            {nextUp.map(({ ladderId, rung, value, pct: p }) => (
              <div key={ladderId} className="flex items-center gap-2 rounded-xl bg-secondary/30 p-2">
                <Medallion trophy={rung} earned={false} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{trophyName(rung, tFallback)}</p>
                  <p className="text-xs text-muted-foreground truncate">{trophyDescription(rung, tFallback)}</p>
                  {/* Same rule as the ladder rows: a yes/no rung has no
                      fraction to draw, and a 0%-wide bar under it reads
                      as progress that has stalled rather than a thing
                      you either have or don't. */}
                  {!rung.binary && (
                    <div className="w-full h-1 bg-muted rounded-full overflow-hidden mt-1.5">
                      <div className="h-full bg-primary" style={{ width: `${p}%` }} />
                    </div>
                  )}
                </div>
                {!rung.binary && (
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {Math.round(p)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border mb-6">
        {[
          ['progress', tFallback('progress.activeAchievements', 'In progress')],
          ['earned', tFallback('progress.completedAchievements', 'Earned')],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground active:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="popLayout">
        {tab === 'progress' ? (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-6"
          >
            {TROPHY_CATEGORIES.map((cat) => {
              const ladderIds = Object.keys(LADDERS).filter((id) => LADDERS[id].category === cat.id);
              if (!ladderIds.length) return null;
              return (
                <div key={cat.id}>
                  <h3 className="font-heading font-bold text-sm mb-1">
                    <span className="me-1.5" aria-hidden="true">{cat.emoji}</span>
                    {trophyCategoryName(cat, tFallback)}
                  </h3>
                  <div className="rounded-xl bg-card px-3">
                    {ladderIds.map((id) => (
                      <LadderRow
                        key={id}
                        ladderId={id}
                        earnedIds={earnedIds}
                        signal={signalFor(id)}
                        progress={progress}
                        fmtNum={fmtNum}
                        fmtList={fmtList}
                        tFallback={tFallback}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Locked — the last row on the page. These are gated behind
                other achievements rather than a number, so they carry
                what unlocks them instead of a progress bar. */}
            {locked.length > 0 && (
              <div>
                <h3 className="font-heading font-bold text-sm mb-1 flex items-center justify-between">
                  <span>
                    <Lock className="inline w-3.5 h-3.5 me-1.5 align-[-2px]" aria-hidden="true" />
                    {tFallback('progress.locked', 'Locked')}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {locked.length}
                  </span>
                </h3>
                <div className="rounded-xl bg-card px-3">
                  {locked.map((t) => {
                    const reqs = requirementsFor(t, earnedIds);
                    const done = reqs.filter((r) => r.done).length;
                    return (
                      <div key={t.id} className="py-3 border-b border-border last:border-b-0">
                        <div className="flex items-start gap-2">
                          <Medallion trophy={t} earned={false} size={28} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-semibold truncate">{trophyName(t, tFallback)}</span>
                              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                                {done} / {reqs.length}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{trophyDescription(t, tFallback)}</p>
                            {/* Naming the outstanding requirements is the
                                whole point — a locked badge with no stated
                                route is just a tease. */}
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {reqs.map((r) => (
                                <span
                                  key={r.id}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-micro ${
                                    r.done
                                      ? 'bg-success/15 text-success'
                                      : 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {r.done ? <Check className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
                                  {r.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="earned"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {earnedRows.length === 0 ? (
              <EmptyState
                icon={Lock}
                title={tFallback('progress.noneCompletedTitle', 'No badges yet')}
                body={t('progress.noneCompleted')}
              />
            ) : (
              <div className="space-y-2">
                {earnedRows.map(({ row, trophy }) => (
                  <div key={row.trophy_id} className="flex items-center gap-3 rounded-xl bg-card p-3">
                    <Medallion trophy={trophy} earned size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{trophyName(trophy, tFallback)}</p>
                      <p className="text-xs text-muted-foreground truncate">{trophyDescription(trophy, tFallback)}</p>
                      {row.earned_at && (
                        <p className="text-xs text-muted-foreground/80 mt-0.5">
                          {t('progress.unlockedOn')} {fmtDate(row.earned_at)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleShare(trophy, row)}
                      disabled={sharingId === row.trophy_id}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-micro font-bold uppercase tracking-wide text-primary hover:bg-primary/10 active:bg-primary/10 transition-colors disabled:opacity-50 shrink-0"
                      aria-label={tFallback('achievements.share.aria', 'Share {name} to Hub', { name: trophyName(trophy, tFallback) })}
                    >
                      {sharingId === row.trophy_id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Share2 className="w-3 h-3" />}
                      {tFallback('achievements.share.label', 'Share')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
