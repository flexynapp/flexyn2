// src/components/leagues/RankUpSequence.jsx
//
// The rank up: a full-screen stage that plays the next time someone opens
// Today after moving up a league (or a level inside one). It is built on the
// capsule open's stage (openFx: the sunburst, the shock rings, the sparks,
// the shake and the flash) and follows the same beats, so the two moments
// feel like one family:
//
//   charge  the crest they had strains in place, and the new league's colour
//           leaks through a crack in it, the way a hot capsule leaks at the
//           seam before it pops
//   break   the old crest splits along the crack and the halves fly apart
//   slam    the new crest drops in from above the camera and lands with the
//           burst, the shake and the haptic
//   stamp   "Promoted", the league name, then the road ahead: every crest on
//           the ladder, and how far the Strength Score is from the next one
//
// Every league up the ladder is a bigger moment than the one below
// (RANK_DRAMA in rankUp.js). A level step inside a league (Gold II to Gold
// III) runs the same stage turned down: a shorter strain, no break, the crest
// gains its new ornament and lands.
//
// The last beat is the point. A promotion that ends on the crest you just
// got is a trophy; one that ends on the next crest, dimmed, with a bar that
// is already part full, is a reason to train this week.
//
// Presentation only. The server moved the league; nothing here writes.
// Reduced motion lands straight on the final frame.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { triggerHaptic } from '@/lib/haptic';
import { TIERS, getTier, nextTier, leagueTierName } from '@/lib/leagueTiers';
import { rankDramaFor } from '@/lib/rankUp';
import { OpenerStage, useOpenerFx } from '@/components/capsules/openFx';
import LeagueTierIcon from '@/components/leagues/LeagueTierIcon';
import { Button } from '@/components/ui/button';

// The crack the old crest breaks along, as a fraction of its box. The two
// clip paths share it so the halves fit back together exactly.
const CRACK = [[50, 0], [44, 30], [55, 52], [46, 75], [52, 100]];
const LEFT_CLIP = `polygon(0 0, ${CRACK.map(([x, y]) => `${x}% ${y}%`).join(', ')}, 0 100%)`;
const RIGHT_CLIP = `polygon(100% 0, ${CRACK.map(([x, y]) => `${x}% ${y}%`).join(', ')}, 100% 100%)`;
const CRACK_POINTS = CRACK.map(([x, y]) => `${x},${y}`).join(' ');

// Where the strain jolts land in the charge keyframes, so a haptic tick
// arrives with each one.
const CHARGE_TICKS = [0.25, 0.45, 0.64, 0.68, 0.72];

const CREST = 'w-44 h-44';
const SLAM_MS = 640;

/**
 * @param {object}   props
 * @param {{ kind: 'tier'|'level', from: {tier, level}, to: {tier, level} }} props.move
 * @param {object}   [props.strength]  my_league_strength's payload, for the road ahead
 * @param {Function} props.onClose
 * @param {Function} [props.onViewLeague]
 */
export default function RankUpSequence({ move, strength, onClose, onViewLeague }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const fx = useOpenerFx();
  const drama = rankDramaFor(move);
  const isTier = move.kind === 'tier';
  const fromTier = getTier(move.from.tier);
  const toTier = getTier(move.to.tier);
  const color = toTier.color;

  const [phase, setPhase] = useState(() => (fx.reduced ? 'landed' : 'enter'));
  const timers = useRef([]);
  const oldRef = useRef(null);
  const newRef = useRef(null);
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const ctaRef = useRef(null);

  useBodyScrollLock();

  const later = useCallback((fn, ms) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // ── The timeline ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'enter') return;
    // A beat on the old crest before anything moves, so the eye is on it.
    later(() => setPhase('charge'), 450);
  }, [phase, later]);

  useEffect(() => {
    if (phase !== 'charge') return;
    fx.aimAt(oldRef.current);
    // The tell: the new league's colour starts turning behind the old
    // crest before it breaks.
    fx.setRays(color, drama.rays * 0.45, { fast: isTier });
    CHARGE_TICKS.forEach((f) => later(() => triggerHaptic('subtle'), Math.round(drama.charge * f)));
    later(() => setPhase(isTier ? 'break' : 'landed'), drama.charge);
  }, [phase, fx, color, drama, isTier, later]);

  useLayoutEffect(() => {
    if (phase !== 'break') return;
    const point = fx.aimAt(oldRef.current);
    fx.burst(point, null, { color, drama, scale: 0.55, shake: false });
    triggerHaptic('warning');
    const fly = (el, dir) => el?.animate?.(
      [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dir * 16}px, -6px) rotate(${dir * 6}deg)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${dir * 150}px, 120px) rotate(${dir * 38}deg)`, opacity: 0 },
      ],
      { duration: 720, easing: 'cubic-bezier(0.3, 0.6, 0.6, 1)', fill: 'forwards' },
    );
    fly(leftRef.current, -1);
    fly(rightRef.current, 1);
    later(() => setPhase('landed'), 170);
  }, [phase, fx, color, drama, later]);

  // The landing. Runs once, when the new crest mounts.
  useLayoutEffect(() => {
    if (phase !== 'landed') return;
    const el = newRef.current;
    const point = fx.aimAt(el);
    fx.setRays(color, drama.rays, { double: isTier && ['diamond', 'legend'].includes(toTier.id), fast: false });
    if (fx.reduced || typeof el?.animate !== 'function') return;
    const big = isTier;
    el.animate(
      big
        ? [
          { transform: 'perspective(800px) translateY(-40px) scale(2.6) rotateX(28deg)', opacity: 0 },
          { transform: 'perspective(800px) translateY(-10px) scale(1.5) rotateX(12deg)', opacity: 1, offset: 0.3 },
          { transform: 'perspective(800px) translateY(6px) scale(0.9) rotateX(0deg)', opacity: 1, offset: 0.62 },
          { transform: 'perspective(800px) scale(1.04)', offset: 0.8 },
          { transform: 'none', opacity: 1 },
        ]
        : [
          { transform: 'scale(1)', opacity: 1 },
          { transform: 'scale(1.28)', opacity: 1, offset: 0.3 },
          { transform: 'scale(0.94)', offset: 0.62 },
          { transform: 'none', opacity: 1 },
        ],
      { duration: big ? SLAM_MS : 520, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', fill: 'backwards' },
    );
    const t = setTimeout(() => {
      fx.burst(point, null, { color, drama, scale: big ? 1 : 0.6, shake: true });
      triggerHaptic(big ? 'success' : 'primary');
    }, Math.round((big ? SLAM_MS : 520) * 0.62));
    return () => clearTimeout(t);
    // The landing only; fx and drama are stable for this sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Focus the way out once it exists, for keyboard and screen readers.
  useEffect(() => {
    if (phase !== 'landed') return undefined;
    const t = setTimeout(() => ctaRef.current?.focus({ preventScroll: true }), fx.reduced ? 0 : 1400);
    return () => clearTimeout(t);
  }, [phase, fx.reduced]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Tapping the stage mid-strain goes straight to the landing.
  const skip = () => {
    if (phase !== 'enter' && phase !== 'charge') return;
    clearTimers();
    setPhase('landed');
  };

  // ── Words ─────────────────────────────────────────────────────────────────
  const fromName = leagueTierName(fromTier, tFallback, move.from.level);
  const toName = isTier
    ? leagueTierName(toTier, tFallback)
    : leagueTierName(toTier, tFallback, move.to.level);
  const eyebrow = isTier
    ? tFallback('rankUp.promoted', 'Promoted')
    : tFallback('rankUp.newLevel', 'New level');
  const sub = isTier
    ? tFallback('rankUp.subTier', 'Up from {league}.', { league: fromName })
    : tFallback('rankUp.subLevel', 'Another qualified week in {league}.', { league: leagueTierName(toTier, tFallback) });

  // The road ahead.
  const next = nextTier(toTier.id);
  const score = strength?.score != null ? Math.round(Number(strength.score)) : null;
  let goal = null;
  if (!next) {
    goal = { text: tFallback('rankUp.top', 'This is the top league. Hold it.') };
  } else if (score != null && strength?.bodyweight_given === false && next.strengthFloor > getTier('gold').strengthFloor) {
    goal = { text: tFallback('rankUp.addBodyweight', 'Add your bodyweight to climb past Gold.') };
  } else if (score != null) {
    const floor = Number(strength?.next_tier === next.id && strength?.next_floor ? strength.next_floor : next.strengthFloor);
    const base = toTier.strengthFloor;
    const pct = Math.max(0.04, Math.min(1, (score - base) / Math.max(1, floor - base)));
    goal = {
      label: tFallback('rankUp.next', 'Next: {league}', { league: leagueTierName(next, tFallback) }),
      value: tFallback('rankUp.scoreOf', '{score} of {floor}', { score: fmt(score), floor: fmt(floor) }),
      pct,
      color: next.color,
    };
  } else {
    goal = {
      label: tFallback('rankUp.next', 'Next: {league}', { league: leagueTierName(next, tFallback) }),
      text: tFallback('rankUp.noScore', 'Log a press, squat or deadlift to get your Strength Score.'),
    };
  }

  const landed = phase === 'landed';
  const hit = fx.reduced ? 0 : (isTier ? Math.round(SLAM_MS * 0.62) : 320) + drama.hold;
  const beat = (n) => ({ animationDelay: `${hit + n * 130}ms` });
  const toIndex = TIERS.findIndex((t) => t.id === toTier.id);

  return (
    <div
      // `dark` pins the app's dark tokens: like the capsule open, this is a
      // stage in either theme and the crests are drawn for a dark ground.
      className="dark fixed inset-0 z-50 flex flex-col bg-background text-foreground overflow-y-auto overflow-x-hidden overscroll-contain"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rank-up-title"
      onClick={skip}
    >
      <OpenerStage fx={fx} />
      <div ref={fx.shakeRef} className="relative mx-auto w-full max-w-lg flex-1 flex flex-col min-h-0 px-6">
        <header className="h-[60px] shrink-0 flex items-center justify-end">
          {landed && (
            <button
              type="button"
              onClick={onClose}
              className="reveal-rise h-11 w-11 -me-2 flex items-center justify-center rounded-full text-muted-foreground"
              style={beat(4)}
              aria-label={tFallback('common.close', 'Close')}
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </header>

        <div className="flex-1 flex flex-col justify-center pb-6">
          {/* The crest. One box, so the old crest, its halves and the new
              crest all sit on exactly the same spot. */}
          <div className="relative mx-auto" style={{ width: 176, height: 176 }}>
            {(phase === 'enter' || phase === 'charge') && (
              <div ref={oldRef} className={`absolute inset-0 rank-crest ${phase === 'charge' ? (isTier ? 'rank-crest-strain-hot' : 'rank-crest-strain') : 'reveal-rise'}`}
                style={phase === 'charge' ? { animationDuration: `${drama.charge}ms` } : undefined}>
                <LeagueTierIcon tier={fromTier.id} level={move.from.level} className={CREST} />
                {isTier && phase === 'charge' && (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full rank-crack"
                    style={{ animationDuration: `${drama.charge}ms` }} aria-hidden="true">
                    <polyline points={CRACK_POINTS} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
              </div>
            )}
            {phase === 'break' && (
              <>
                <div ref={leftRef} className="absolute inset-0" style={{ clipPath: LEFT_CLIP }}>
                  <LeagueTierIcon tier={fromTier.id} level={move.from.level} className={CREST} />
                </div>
                <div ref={rightRef} className="absolute inset-0" style={{ clipPath: RIGHT_CLIP }}>
                  <LeagueTierIcon tier={fromTier.id} level={move.from.level} className={CREST} />
                </div>
              </>
            )}
            {landed && (
              <div ref={newRef} className="absolute inset-0">
                <LeagueTierIcon tier={toTier.id} level={move.to.level} className={CREST} />
              </div>
            )}
          </div>

          {/* Under the crest: the old name while it strains, then the new. */}
          <div className="pt-6 text-center min-h-[92px]">
            {!landed ? (
              phase !== 'break' && (
                <p className="reveal-rise text-caption font-bold text-muted-foreground">{fromName}</p>
              )
            ) : (
              <>
                <p className="reveal-new inline-block text-micro font-bold uppercase tracking-widest" style={{ ...beat(0), color }}>
                  {eyebrow}
                </p>
                <h2 id="rank-up-title" className="reveal-stamp font-display text-3xl leading-tight pt-2" style={beat(0.4)}>
                  {toName}
                </h2>
                <p className="reveal-rise text-caption text-muted-foreground pt-2" style={beat(1)}>{sub}</p>
              </>
            )}
          </div>

          {landed && (
            <div className="pt-6 flex flex-col gap-6">
              <div className="reveal-rise" style={beat(2)}>
                <div className="border-t border-border" />
                {/* The ladder: every league, the ones reached in colour, the
                    ones ahead dimmed and waiting. */}
                <ol className="relative flex items-end justify-between pt-6" aria-label={tFallback('rankUp.ladder', 'Leagues')}>
                  {TIERS.map((t, i) => {
                    const here = i === toIndex;
                    const ahead = i > toIndex;
                    return (
                      <li key={t.id} className="flex flex-col items-center gap-1" aria-current={here ? 'step' : undefined}>
                        <LeagueTierIcon
                          tier={t.id}
                          level={here ? move.to.level : 1}
                          className={`${here ? 'w-14 h-14' : 'w-9 h-9'} ${ahead ? (i === toIndex + 1 ? 'opacity-60' : 'opacity-30 grayscale') : ''}`}
                        />
                        <span className="sr-only">{leagueTierName(t, tFallback)}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="reveal-rise flex flex-col gap-2" style={beat(3)}>
                {goal.label && (
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-caption font-bold">{goal.label}</span>
                    {goal.value && <span className="text-caption text-muted-foreground tabular-nums">{goal.value}</span>}
                  </div>
                )}
                {goal.pct != null && (
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full origin-left rtl:origin-right rank-fill"
                      style={{ background: goal.color, transform: `scaleX(${goal.pct})`, ...beat(3.5) }}
                    />
                  </div>
                )}
                {goal.text && <p className="text-caption text-muted-foreground">{goal.text}</p>}
              </div>
            </div>
          )}
        </div>

        {landed && (
          <div className="reveal-rise pb-6 flex flex-col gap-2" style={beat(4)}>
            <Button ref={ctaRef} className="w-full h-12" onClick={onClose}>
              {tFallback('rankUp.cta', 'Keep climbing')}
            </Button>
            {onViewLeague && (
              <Button
                variant="ghost"
                className="w-full h-11 text-muted-foreground"
                onClick={() => { onClose?.(); onViewLeague(); }}
              >
                {tFallback('rankUp.viewLeague', 'View standings')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
