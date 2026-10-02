// src/components/capsules/CrackStage.jsx
//
// The capsule open: "crack it" (Kegan's pick, 2026-10-02). The user taps
// the canister and every tap is a strike. A strike either climbs one rarity
// (the cracks and the seam light up in the new colour, a rung on the ladder
// slams in, the rarity's name stamps above the canister, and its colour
// pours into the field behind) or opens the canister on what it has
// reached. Every strike stirs the field. The script comes from climbPlan in
// src/lib/capsuleClimb.js.
//
// Why this and not a reel: a reel is six seconds of watching, the same six
// seconds every time. Here a Common is one tap and about a second, and only
// a rare pull takes longer, because it is climbing. The open is something
// the user does, and the hundredth open still has a moment of truth on
// every tap: does it climb?
//
// Presentation only. The item was rolled and granted before this mounts.
//
// Taps are queued, so mashing works: the strike in flight finishes, then the
// next one starts at once. If nobody taps, it strikes on its own after a
// pause, so the open never stalls on someone who just watches.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { rarityName } from '@/components/capsules/words';
import { triggerHaptic } from '@/lib/haptic';
import { useLanguage } from '@/lib/LanguageContext';
import { climbPlan, climbRank, CLIMB_LADDER } from '@/lib/capsuleClimb';
import CapsuleCanister from './CapsuleCanister';
import { dramaFor, OPEN_TIMING } from './openFx';

// Cracks drawn over the canister, in its own 120x166 box, in the order they
// appear. Lid first, then the body, so the shell looks like it is giving
// way from the top.
const CRACKS = [
  'M60 15L56.5 24L62.5 30.5L57.5 40',
  'M31 48L38.5 52L35 59.5L44.5 64',
  'M91 38L84 45L88.5 52.5L80.5 59',
  'M41 97L48.5 104L44 112L53 118.5',
  'M88.5 94L80.5 102.5L85.5 110L76.5 117',
  'M62 128L57.5 137.5L64 147',
];

// One quick squash on the strike, then a slow swell while it decides.
const STRIKE_FRAMES = [
  { transform: 'scale(1)' },
  { transform: 'scale(1.09, 0.88)', offset: 0.12 },
  { transform: 'scale(0.97, 1.04)', offset: 0.32 },
  { transform: 'scale(1.035)', offset: 1 },
];
// The climb: a hop with an overshoot, landing back on the floor.
const CLIMB_FRAMES = [
  { transform: 'scale(1.035)' },
  { transform: 'translateY(-14px) scale(1.08)', offset: 0.3 },
  { transform: 'translateY(2px) scale(1.04, 0.96)', offset: 0.65 },
  { transform: 'none' },
];

/**
 * @param {object} fx           the opener's stage (useOpenerFx)
 * @param {string} rarity       what the server rolled
 * @param {string} tier         capsule tier, for the canister's finish
 * @param {boolean} [batch]     shorter beats, one capsule of several
 * @param {() => void} onDone   the canister is open; show the reveal
 */
export default function CrackStage({ fx, rarity, tier, batch = false, onDone }) {
  const { tFallback } = useLanguage();
  // No rarity yet: the roll is still in flight, so the canister waits on
  // the same spot it will be struck on and nothing answers a tap.
  const waiting = !rarity;
  const plan = useMemo(() => (rarity ? climbPlan(rarity) : []), [rarity]);
  const t = batch ? OPEN_TIMING.batch : OPEN_TIMING.single;

  const [at, setAt] = useState('common');       // the rung reached so far
  const [cracks, setCracks] = useState(0);
  const [stamp, setStamp] = useState(null);      // { key, rarity } above the canister
  const [open, setOpen] = useState(false);
  const [struck, setStruck] = useState(false);

  const canRef = useRef(null);
  const stepRef = useRef(0);
  const busyRef = useRef(false);
  const queuedRef = useRef(false);
  const autoRef = useRef(null);
  const timersRef = useRef([]);
  const doneRef = useRef(false);

  const later = useCallback((fn, ms) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const animate = useCallback((frames, duration, easing = 'cubic-bezier(0.2, 0.9, 0.3, 1)') => {
    const el = canRef.current;
    if (!el || fx.reduced || typeof el.animate !== 'function') return;
    el.animate(frames, { duration, easing, fill: 'forwards' });
  }, [fx.reduced]);

  const aim = useCallback((fy = 0.45) => fx.aimAt(canRef.current, fy), [fx]);

  // Forward declaration through a ref: a finished strike starts the next
  // queued one, and the auto timer strikes too.
  const strikeRef = useRef(() => {});

  const settle = useCallback(() => {
    busyRef.current = false;
    if (doneRef.current) return;
    if (queuedRef.current) {
      queuedRef.current = false;
      strikeRef.current();
      return;
    }
    clearTimeout(autoRef.current);
    autoRef.current = later(() => strikeRef.current(), stepRef.current === 0 ? t.firstAuto : t.auto);
  }, [later, t.firstAuto, t.auto]);

  const strike = useCallback(() => {
    if (doneRef.current || waiting) return;
    if (busyRef.current) { queuedRef.current = true; return; }
    const step = plan[stepRef.current];
    if (!step) return;
    busyRef.current = true;
    stepRef.current += 1;
    clearTimeout(autoRef.current);
    setStruck(true);

    // The hit itself: a crack, a puff, a tick.
    setCracks(c => Math.min(CRACKS.length, c + 1));
    animate(STRIKE_FRAMES, t.decide, 'cubic-bezier(0.3, 0.8, 0.4, 1)');
    fx.burst(aim(0.4), 'common', { scale: 0.22, shake: false });
    fx.paint({ stir: 0.35 });
    triggerHaptic('subtle');

    later(() => {
      if (step.kind === 'climb') {
        const to = step.to;
        const rank = climbRank(to);
        setAt(to);
        setStamp({ key: stepRef.current, rarity: to });
        animate(CLIMB_FRAMES, t.climb);
        fx.burst(aim(0.45), to, { scale: 0.5 + rank * 0.13, shake: rank >= 2 });
        fx.paint({ rarity: to, mood: 'landed', stir: dramaFor(to).stir });
        triggerHaptic(rank >= 3 ? 'success' : 'primary');
        later(settle, t.climb);
        return;
      }
      if (step.kind === 'hold') {
        animate([{ transform: 'scale(1.035)' }, { transform: 'none' }], 200);
        later(settle, 200);
        return;
      }
      // The open: the lid goes and the field churns, then settles into the
      // colour the canister opened on.
      doneRef.current = true;
      setOpen(true);
      animate([{ transform: 'scale(1.1, 0.86)' }, { transform: 'scale(0.95, 1.07)', offset: 0.4 }, { transform: 'none' }], 420,
        'cubic-bezier(0.3, 1.3, 0.5, 1)');
      const d = dramaFor(step.to);
      fx.burst(aim(0.45), step.to, { scale: 0.6, shake: d.shake > 0 });
      fx.paint({ rarity: step.to, mood: 'break', stir: 1 });
      later(() => fx.paint({ mood: 'landed' }), 420);
      triggerHaptic('primary');
      later(onDone, t.afterPop);
    }, t.decide);
  }, [waiting, plan, animate, aim, fx, later, settle, onDone, t]);
  strikeRef.current = strike;

  // First auto strike, for someone who only watches.
  useEffect(() => {
    aim();
    // Each capsule starts on Common, so in a batch the field pours back to
    // grey before the next one is struck.
    fx.paint({ rarity: 'common', mood: waiting ? 'enter' : 'landed' });
    if (waiting) return undefined;
    autoRef.current = later(() => strikeRef.current(), t.firstAuto);
    return () => clearTimeout(autoRef.current);
  }, [waiting, aim, fx, later, t.firstAuto]);

  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); strike(); }
  };

  const tint = rarityTint(at).color;
  const topRank = Math.max(climbRank(at), climbRank('legendary'));
  const rungs = CLIMB_LADDER.slice(0, topRank + 1);

  return (
    <div
      className="relative flex-1 min-h-[300px] flex flex-col items-center justify-center gap-6 px-5 select-none touch-manipulation cursor-pointer outline-none"
      role="button"
      tabIndex={0}
      aria-label={tFallback('capsuleOpener.tapToCrack', 'Tap to crack')}
      onPointerDown={strike}
      onKeyDown={onKey}
    >
      {/* The rarity reached, stamped in on every climb. Holds its height so
          the canister never moves when the first name lands. */}
      <div className="h-12 flex items-end justify-center" aria-live="polite">
        {stamp && (
          <span
            key={stamp.key}
            className="reveal-stamp font-display text-display"
            style={{ color: rarityTint(stamp.rarity).color }}
          >
            {rarityName(tFallback, stamp.rarity)}
          </span>
        )}
      </div>

      {/* At Epic and up the canister breathes between strikes: it is
          holding something. Slow on purpose, under 2 a second. */}
      <div className={climbRank(at) >= 3 && !open ? 'canister-breathe' : ''}>
      <div ref={canRef} className={`canister-stand relative ${waiting ? 'canister-wait' : ''}`}>
        <CapsuleCanister
          tier={tier}
          open={open}
          lidFly={!fx.reduced}
          seam={open ? null : (at === 'common' && cracks === 0 ? null : tint)}
          seamMs={240}
          height="clamp(170px, 30vh, 250px)"
        />
        {!open && cracks > 0 && (
          <svg
            viewBox="0 0 120 166"
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ overflow: 'visible' }}
            aria-hidden="true"
          >
            {CRACKS.slice(0, cracks).map((d, i) => (
              <g key={i} className="crack-in" style={{ transformOrigin: `${d.slice(1).split(/[L ]/)[0]}px ${d.split(/[L ]/)[1]}px` }}>
                <path d={d} fill="none" stroke="#0F1215" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
                <path d={d} fill="none" stroke={tint} strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round"
                  style={{ transition: 'stroke 200ms ease' }} />
              </g>
            ))}
          </svg>
        )}
      </div>
      </div>

      {/* The ladder: one rung per rarity, lit up to where the climb is. A
          sixth rung appears only if the climb goes past Legendary. */}
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {rungs.map((r) => {
          const lit = climbRank(r) <= climbRank(at);
          const c = rarityTint(r).color;
          return (
            <span
              key={r}
              className={`block h-2 w-9 rounded-full ${lit && r !== 'common' ? 'climb-rung-lit' : ''}`}
              style={{ background: lit ? c : 'hsl(var(--border))' }}
            />
          );
        })}
      </div>

      <span
        className="text-label font-medium text-muted-foreground transition-opacity duration-300"
        style={{ opacity: struck ? 0 : 1 }}
      >
        {tFallback('capsuleOpener.tapToCrack', 'Tap to crack')}
      </span>
    </div>
  );
}
