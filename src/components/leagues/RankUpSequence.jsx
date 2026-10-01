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
// A demotion is its own, sombre sequence (Kegan, 2026-09-30): no sunburst
// colour, no sparks, no shake. The crest greys and sinks, the lower one
// rises quietly in its place, and it ends on the road back: the league they
// left, and the Strength Score it takes to return.
//
// The last beat is the point. A promotion that ends on the crest you just
// got is a trophy; one that ends on the next crest, dimmed, with a bar that
// is already part full, is a reason to train this week.
//
// Presentation only. The server moved the league; nothing here writes.
// Reduced motion lands straight on the final frame.

import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { triggerHaptic } from '@/lib/haptic';
import { TIERS, getTier, nextTier, leagueTierName } from '@/lib/leagueTiers';
import { rankDramaFor } from '@/lib/rankUp';
import { chargeBeats, chargeFrames, flyFrames, impactFrames, landingFrames } from '@/lib/rankUpMotion';
import { OpenerStage, useOpenerFx } from '@/components/capsules/openFx';
import TierIcon from '@/components/leagues/LeagueTierIcon';
import { Button } from '@/components/ui/button';

// The crack the old crest breaks along, as a fraction of its box. The two
// clip paths share it so the halves fit back together exactly.
const CRACK = [[50, 0], [44, 30], [55, 52], [46, 75], [52, 100]];
const LEFT_CLIP = `polygon(0 0, ${CRACK.map(([x, y]) => `${x}% ${y}%`).join(', ')}, 0 100%)`;
const RIGHT_CLIP = `polygon(100% 0, ${CRACK.map(([x, y]) => `${x}% ${y}%`).join(', ')}, 100% 100%)`;
const CRACK_POINTS = CRACK.map(([x, y]) => `${x},${y}`).join(' ');

// The crests are big SVG trees and there are a dozen on this screen. None of
// them changes after the first render, so a phase change must not rebuild
// them: in a slow frame budget that rebuild was the dropped frame at the
// start of the charge.
const LeagueTierIcon = memo(TierIcon);

const CREST = 'w-44 h-44';
const MUTED = '#89949F';
const SLAM_MS = 900;
const LEVEL_MS = 720;
// Layers that are about to move are promoted up front, so the first frame
// of each beat does not pay for building them.
const LAYER = { willChange: 'transform, opacity' };
// Not 0: a fully transparent layer is not drawn, so it would be drawn for
// the first time on the frame it is needed. This is invisible and ready.
const PARKED = 0.001;

/** A flat copy of a crest laid over it: white for the heat of a charge, grey
 *  for a demotion. Its filter is static (drawn once); only its opacity
 *  animates, which composites where an animated filter repaints. */
const Tint = forwardRef(function Tint({ tier, level, start = 0, tone = 'hot' }, ref) {
  return (
    <div ref={ref} data-tint={tone} className="absolute inset-0 pointer-events-none"
      style={{ opacity: start, willChange: 'opacity', filter: tone === 'hot' ? 'brightness(0) invert(1)' : 'grayscale(1) brightness(0.45)' }}
      aria-hidden="true">
      <LeagueTierIcon tier={tier} level={level} className={CREST} />
    </div>
  );
});

/**
 * @param {object}   props
 * @param {{ kind: 'tier'|'level'|'down', from: {tier, level}, to: {tier, level} }} props.move
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
  const isDown = move.kind === 'down';
  const fromTier = getTier(move.from.tier);
  const toTier = getTier(move.to.tier);
  // A demotion keeps the stage grey: the only colour on it is the crest.
  const color = isDown ? MUTED : toTier.color;

  const [phase, setPhase] = useState(() => (fx.reduced ? 'landed' : 'enter'));
  const timers = useRef([]);
  const charge = useRef(null);
  const oldRef = useRef(null);
  const newRef = useRef(null);
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const oldTintRef = useRef(null);
  const newHotRef = useRef(null);
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

  // A ring in the new league's colour pulled in onto the crest, arriving
  // on a heartbeat. The capsule's rings go out; these come in, so the break
  // reads as the release of something gathered.
  const implode = useCallback((c, duration, size) => {
    const host = fx.sparkRef.current;
    const pt = fx.aimAt(oldRef.current);
    if (!host || !pt || typeof host.animate !== 'function') return;
    const n = document.createElement('div');
    Object.assign(n.style, {
      position: 'absolute', left: `${pt.x}px`, top: `${pt.y}px`, width: `${size}px`, height: `${size}px`,
      marginLeft: `${-size / 2}px`, marginTop: `${-size / 2}px`, borderRadius: '9999px',
      border: `2px solid ${c}`, opacity: '0', pointerEvents: 'none', willChange: 'transform, opacity',
    });
    host.appendChild(n);
    const a = n.animate(
      [{ transform: 'scale(1)', opacity: 0 }, { transform: 'scale(0.62)', opacity: 0.7, offset: 0.45 }, { transform: 'scale(0.26)', opacity: 0 }],
      { duration, easing: 'cubic-bezier(0.55, 0, 0.8, 0.3)', fill: 'both' },
    );
    a.onfinish = () => n.remove();
    a.oncancel = () => n.remove();
  }, [fx]);

  // ── The timeline ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'enter') return;
    // Draw the sunburst once now, invisibly, while the screen fades in, so
    // its first frame is not drawn on the first frame of the charge.
    fx.setRays(color, PARKED);
    // A beat on the old crest before anything moves, so the eye is on it.
    later(() => setPhase('charge'), 450);
  }, [phase, later, fx, color]);

  useEffect(() => {
    if (phase !== 'charge') return;
    fx.aimAt(oldRef.current);
    const el = oldRef.current;
    if (isDown) {
      // No tell and no beats: one low pulse as the crest greys and sinks.
      triggerHaptic('warning');
      el?.animate?.(
        [
          { transform: 'none', opacity: 1, easing: 'cubic-bezier(0.3, 0, 0.5, 1)' },
          { transform: 'translateY(-4px)', opacity: 1, offset: 0.2, easing: 'cubic-bezier(0.55, 0, 0.75, 0.35)' },
          { transform: 'translateY(36px) scale(0.9)', opacity: 0 },
        ],
        { duration: drama.charge, fill: 'forwards' },
      );
      oldTintRef.current?.animate?.(
        [{ opacity: 0 }, { opacity: 0.9 }],
        { duration: drama.charge * 0.7, easing: 'ease-in-out', fill: 'forwards' },
      );
      later(() => setPhase('landed'), drama.charge);
      return;
    }
    // The tell: the new league's colour starts turning behind the old crest.
    fx.setRays(color, drama.rays * 0.45, { fast: isTier });
    const c = chargeFrames({ kind: move.kind, duration: drama.charge });
    charge.current = c;
    el?.animate?.(c.crest, { duration: drama.charge, easing: 'linear', fill: 'forwards' });
    oldTintRef.current?.animate?.(c.hot, { duration: drama.charge, easing: 'linear', fill: 'forwards' });
    // Every heartbeat lands with a haptic tick and, on a promotion, a ring
    // pulled in to arrive on it.
    chargeBeats(move.kind).forEach((at, i) => {
      const t = Math.round(drama.charge * at);
      later(() => triggerHaptic('subtle'), t);
      if (isTier) {
        const d = Math.min(560, Math.max(320, t));
        later(() => implode(color, d, 380 + i * 12), t - d);
      }
    });
    later(() => setPhase(isTier ? 'break' : 'landed'), drama.charge);
  }, [phase, fx, color, drama, isTier, isDown, move.kind, later, implode]);

  useLayoutEffect(() => {
    if (phase !== 'break') return;
    const point = fx.aimAt(oldRef.current);
    fx.burst(point, null, { color, drama: { ...drama, flash: 0 }, scale: 0.7, shake: false });
    triggerHaptic('warning');
    const end = charge.current?.end;
    // The halves leave white hot, where the charge left them, and cool as
    // they fall.
    const fly = (el, dir) => {
      if (!el?.animate) return;
      el.style.opacity = '1';
      el.animate(flyFrames(dir, end), { duration: 950, easing: 'linear', fill: 'forwards' });
      el.querySelector('[data-tint]')?.animate?.(
        [{ opacity: charge.current?.hotEnd ?? 0.6 }, { opacity: 0 }],
        { duration: 500, easing: 'ease-out', fill: 'forwards' },
      );
    };
    fly(leftRef.current, -1);
    fly(rightRef.current, 1);
    // A flash in the new league's colour, the release of the build.
    const host = fx.sparkRef.current;
    if (host && typeof host.animate === 'function') {
      const f = document.createElement('div');
      Object.assign(f.style, { position: 'absolute', inset: '0', background: color, opacity: '0', pointerEvents: 'none', willChange: 'opacity' });
      host.appendChild(f);
      const a = f.animate([{ opacity: 0 }, { opacity: Math.min(0.45, drama.flash * 1.6), offset: 0.12 }, { opacity: 0 }],
        { duration: 600, easing: 'ease-out', fill: 'both' });
      a.onfinish = () => f.remove();
    }
    later(() => setPhase('landed'), 200);
  }, [phase, fx, color, drama, later]);

  // The landing. Runs once, when the new crest takes the stage.
  useLayoutEffect(() => {
    if (phase !== 'landed') return;
    const el = newRef.current;
    const point = fx.aimAt(el);
    fx.setRays(color, drama.rays, { double: isTier && ['diamond', 'legend'].includes(toTier.id), fast: false });
    if (fx.reduced || typeof el?.animate !== 'function') return;
    if (isDown) {
      // The lower crest rises quietly into place. Nothing hits.
      el.animate(
        [
          { transform: 'translateY(28px) scale(0.96)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 1100, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
      );
      return;
    }
    const duration = isTier ? SLAM_MS : LEVEL_MS;
    const { frames, impact } = landingFrames({
      kind: move.kind, duration, startScale: charge.current?.end?.scale ?? 1, startY: charge.current?.end?.y ?? 0,
    });
    el.animate(frames, { duration, easing: 'linear', fill: 'backwards' });
    newHotRef.current?.animate?.(
      isTier
        ? [{ opacity: 0.9 }, { opacity: 0.9, offset: impact / duration }, { opacity: 0 }]
        : [{ opacity: charge.current?.hotEnd ?? 0.3 }, { opacity: 0.45, offset: impact / duration }, { opacity: 0 }],
      { duration: impact + 520, easing: 'ease-out', fill: 'forwards' },
    );
    const t = setTimeout(() => {
      fx.burst(point, null, { color, drama, scale: isTier ? 1 : 0.6, shake: false });
      // The screen takes the hit as one smooth dip, sized by the league.
      fx.shakeRef.current?.animate?.(impactFrames(drama.shake * (isTier ? 1 : 0.7)), { duration: 560, easing: 'linear' });
      triggerHaptic(isTier ? 'success' : 'primary');
    }, Math.round(impact));
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

  // Tapping the stage mid-charge goes straight to the landing.
  const skip = () => {
    if (phase !== 'enter' && phase !== 'charge') return;
    clearTimers();
    oldRef.current?.getAnimations?.().forEach((a) => a.cancel());
    setPhase('landed');
  };

// ── Words ─────────────────────────────────────────────────────────────────
  const fromName = leagueTierName(fromTier, tFallback, move.from.level);
  const toName = isTier || isDown
    ? leagueTierName(toTier, tFallback)
    : leagueTierName(toTier, tFallback, move.to.level);
  const eyebrow = isDown
    ? tFallback('rankUp.demoted', 'Moved down')
    : isTier
      ? tFallback('rankUp.promoted', 'Promoted')
      : tFallback('rankUp.newLevel', 'New level');
  const sub = isDown
    ? tFallback('rankUp.subDown', 'Down from {league}.', { league: fromName })
    : isTier
    ? tFallback('rankUp.subTier', 'Up from {league}.', { league: fromName })
    : tFallback('rankUp.subLevel', 'Another qualified week in {league}.', { league: leagueTierName(toTier, tFallback) });

  // The road ahead. After a demotion it is the road back to the league
  // they just left.
  const next = isDown ? fromTier : nextTier(toTier.id);
  const nextLabel = isDown
    ? tFallback('rankUp.back', 'Back to {league}', { league: leagueTierName(fromTier, tFallback) })
    : tFallback('rankUp.next', 'Next: {league}', { league: leagueTierName(next || toTier, tFallback) });
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
      label: nextLabel,
      value: tFallback('rankUp.scoreOf', '{score} of {floor}', { score: fmt(score), floor: fmt(floor) }),
      pct,
      color: next.color,
    };
  } else {
    goal = {
      label: nextLabel,
      text: tFallback('rankUp.noScore', 'Log a press, squat or deadlift to get your Strength Score.'),
    };
  }

  const landed = phase === 'landed';
  const charging = phase === 'enter' || phase === 'charge';
  const impactAt = isDown ? 600
    : landingFrames({ kind: move.kind, duration: isTier ? SLAM_MS : LEVEL_MS }).impact;
  const hit = fx.reduced ? 0 : Math.round(impactAt) + drama.hold;
  const beat = (n) => ({ animationDelay: `${hit + n * 130}ms` });
  const toIndex = TIERS.findIndex((t) => t.id === toTier.id);
  // Everything the landing shows is laid out from the first frame and only
  // made visible when it lands, so the crest never moves when it appears.
  // (It used to jump 150px up the screen at the moment of impact.)
  const shown = landed ? undefined : { visibility: 'hidden' };
  const anim = (cls) => (landed ? cls : '');

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
      <div ref={fx.shakeRef} className="relative mx-auto w-full max-w-lg flex-1 flex flex-col min-h-0 px-6" style={LAYER}>
        <header className="h-[60px] shrink-0 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`${anim('reveal-rise')} h-11 w-11 -me-2 flex items-center justify-center rounded-full text-muted-foreground`}
            style={{ ...beat(4), ...shown }}
            aria-label={tFallback('common.close', 'Close')}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 flex flex-col justify-center pb-6">
          {/* The crest. One box, so the old crest, its halves and the new
              crest all sit on exactly the same spot. All of them mount on the
              first frame, while the screen is still fading in, and are handed
              over by opacity: mounting one mid-sequence cost a dropped frame
              at the start of the charge. */}
          <div className="relative mx-auto" style={{ width: 176, height: 176 }}>
            {!fx.reduced && (
              <div ref={oldRef} className={`absolute inset-0 rank-crest ${phase === 'enter' ? 'reveal-rise' : ''}`}
                style={{ ...LAYER, opacity: charging ? undefined : 0 }} aria-hidden="true">
                <LeagueTierIcon tier={fromTier.id} level={move.from.level} className={CREST} />
                <Tint ref={oldTintRef} tier={fromTier.id} level={move.from.level} tone={isDown ? 'grey' : 'hot'} />
                {isTier && (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={`absolute inset-0 w-full h-full ${phase === 'charge' ? 'rank-crack' : 'opacity-0'}`}
                    style={{ animationDuration: `${drama.charge}ms` }} aria-hidden="true">
                    <polyline points={CRACK_POINTS} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
              </div>
            )}
            {isTier && !fx.reduced && (
              <>
                <div ref={leftRef} className="absolute inset-0 rank-crest pointer-events-none" style={{ ...LAYER, clipPath: LEFT_CLIP, opacity: PARKED }} aria-hidden="true">
                  <LeagueTierIcon tier={fromTier.id} level={move.from.level} className={CREST} />
                  <Tint tier={fromTier.id} level={move.from.level} start={0.6} />
                </div>
                <div ref={rightRef} className="absolute inset-0 rank-crest pointer-events-none" style={{ ...LAYER, clipPath: RIGHT_CLIP, opacity: PARKED }} aria-hidden="true">
                  <LeagueTierIcon tier={fromTier.id} level={move.from.level} className={CREST} />
                  <Tint tier={fromTier.id} level={move.from.level} start={0.6} />
                </div>
              </>
            )}
            <div ref={newRef} className="absolute inset-0 rank-crest" style={{ ...LAYER, opacity: landed ? 1 : PARKED }} aria-hidden={!landed}>
              {/* Once landed it keeps breathing, so the finished screen is
                  alive rather than a still. */}
              <div className={`w-full h-full ${anim('rank-float')}`} style={{ animationDelay: `${hit + 400}ms` }}>
                <LeagueTierIcon tier={toTier.id} level={move.to.level} className={CREST} />
                <Tint ref={newHotRef} tier={toTier.id} level={move.to.level} />
              </div>
            </div>
          </div>

          {/* Under the crest: the old name while it strains, then the new,
              in the same spot. */}
          <div className="pt-6 text-center grid">
            <p
              className={`[grid-area:1/1] self-start ${phase === 'enter' ? 'reveal-rise' : ''} text-caption font-bold text-muted-foreground transition-opacity duration-300`}
              style={charging ? undefined : { opacity: 0 }}
              aria-hidden={!charging}
            >
              {fromName}
            </p>
            <div className="[grid-area:1/1]" style={shown}>
              <p className={`${anim(isDown ? 'reveal-rise' : 'reveal-new')} inline-block text-micro font-bold uppercase tracking-widest`} style={{ ...beat(0), color }}>
                {eyebrow}
              </p>
              <h2 id="rank-up-title" className={`${anim(isDown ? 'reveal-rise' : 'reveal-stamp')} font-display text-3xl leading-tight pt-2`} style={beat(0.4)}>
                {toName}
              </h2>
              <p className={`${anim('reveal-rise')} text-caption text-muted-foreground pt-2`} style={beat(1)}>{sub}</p>
            </div>
          </div>

          <div className="pt-6 flex flex-col gap-6" style={shown}>
            <div className={anim('reveal-rise')} style={beat(2)}>
              <div className="border-t border-border" />
              {/* The ladder: every league, the ones reached in colour, the
                  ones ahead dimmed and waiting. */}
              <ol className="relative flex items-end justify-between pt-6" aria-label={tFallback('rankUp.ladder', 'Leagues')}>
                {TIERS.map((t, i) => {
                  const here = i === toIndex;
                  const ahead = i > toIndex;
                  return (
                    <li key={t.id} className={`flex flex-col items-center gap-1 ${anim(here ? 'reveal-stamp' : 'reveal-rise')}`}
                      style={beat(2.2 + i * 0.35)} aria-current={here ? 'step' : undefined}>
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

            <div className={`${anim('reveal-rise')} flex flex-col gap-2`} style={beat(3)}>
              {goal.label && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-caption font-bold">{goal.label}</span>
                  {goal.value && <span className="text-caption text-muted-foreground tabular-nums">{goal.value}</span>}
                </div>
              )}
              {goal.pct != null && (
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full origin-left rtl:origin-right ${anim('rank-fill')}`}
                    style={{ background: goal.color, transform: `scaleX(${goal.pct})`, ...beat(3.5) }}
                  />
                </div>
              )}
              {goal.text && <p className="text-caption text-muted-foreground">{goal.text}</p>}
            </div>
          </div>
        </div>

        <div className={`${anim('reveal-rise')} pb-6 flex flex-col gap-2`} style={{ ...beat(4), ...shown }}>
          <Button ref={ctaRef} className="w-full h-12" onClick={onClose}>
            {isDown ? tFallback('rankUp.ctaDown', 'Win it back') : tFallback('rankUp.cta', 'Keep climbing')}
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
      </div>
    </div>
  );
}
