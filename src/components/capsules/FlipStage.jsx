// src/components/capsules/FlipStage.jsx
//
// Option B for the capsule open: "flip it". One tap pops the canister and a
// card rises out of it face down. Its edge is already the rarity colour, so
// the user knows how good it is before they know what it is, and the second
// tap flips it. That split is what makes a pack opening work on the
// hundredth go: the colour is the gasp, the flip is the payoff.
//
// The flip hands over to the reveal edge-on: this turns the card back to
// 90 degrees, and the reveal plate turns in from -90, so the swap happens
// at the one angle where there is nothing to see.
//
// Presentation only. The item was rolled and granted before this mounts.

import { useCallback, useEffect, useRef, useState } from 'react';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { triggerHaptic } from '@/lib/haptic';
import { useLanguage } from '@/lib/LanguageContext';
import CapsuleCanister from './CapsuleCanister';
import { NotchedCorner } from './parts';
import { dramaFor, OPEN_TIMING } from './openFx';

// The wordmark, never translated (i18nCoverage pins the brand name).
const BRAND = 'Flexyn';
const BARS = { standard: 1, premium: 2, elite: 3 };
export const PLATE_SIZE = 'clamp(140px, 24vh, 200px)';

/**
 * @param {object} fx           the opener's stage (useOpenerFx)
 * @param {string} rarity       what the server rolled
 * @param {string} tier         capsule tier, for the canister's finish
 * @param {boolean} [batch]     shorter beats
 * @param {() => void} onDone   the card is edge-on; show the reveal
 */
export default function FlipStage({ fx, rarity, tier, batch = false, onDone }) {
  const { tFallback } = useLanguage();
  const t = batch ? OPEN_TIMING.batch : OPEN_TIMING.single;
  const tint = rarityTint(rarity).color;
  const hot = dramaFor(rarity).hot;

  const [step, setStep] = useState('closed');   // closed → rising → down → flipping
  const canRef = useRef(null);
  const cardRef = useRef(null);
  const timersRef = useRef([]);
  const stepRef = useRef('closed');
  const later = useCallback((fn, ms) => { timersRef.current.push(setTimeout(fn, ms)); }, []);
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);
  const go = (s) => { stepRef.current = s; setStep(s); };

  const waiting = !rarity;
  const pop = useCallback(() => {
    if (waiting || stepRef.current !== 'closed') return;
    go('rising');
    const point = fx.aimAt(canRef.current, 0.45);
    fx.burst(point, 'common', { scale: 0.5, shake: false });
    triggerHaptic('primary');
    const can = canRef.current;
    if (can && typeof can.animate === 'function' && !fx.reduced) {
      can.animate([{ transform: 'scale(1.1, 0.86)' }, { transform: 'scale(0.95, 1.07)', offset: 0.4 }, { transform: 'none' }],
        { duration: 420, easing: 'cubic-bezier(0.3, 1.3, 0.5, 1)' });
    }
    // The card comes up out of the mouth, turning once on the way.
    requestAnimationFrame(() => {
      const card = cardRef.current;
      if (!card) return;
      if (can && typeof card.animate === 'function' && !fx.reduced) {
        const c = can.getBoundingClientRect();
        const k = card.getBoundingClientRect();
        const dy = (c.top + c.height * 0.45) - (k.top + k.height / 2);
        card.animate([
          { transform: `translateY(${dy}px) scale(0.2) rotate(-30deg)`, opacity: 0 },
          { transform: `translateY(${dy * 0.5}px) scale(0.7) rotate(-8deg)`, opacity: 1, offset: 0.35 },
          { transform: 'translateY(-14px) scale(1.06) rotate(3deg)', offset: 0.72 },
          { transform: 'none' },
        ], { duration: t.rise, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'backwards' });
      }
      later(() => {
        go('down');
        fx.aimAt(cardRef.current);
        // The tell, on the stage: an epic or better tints the rays now.
        fx.setRays(hot ? tint : null, hot ? 0.08 : 0.03, { fast: hot });
        if (hot) fx.burst(fx.aimAt(cardRef.current), rarity, { scale: 0.35, shake: false });
        triggerHaptic(hot ? 'success' : 'subtle');
      }, t.rise);
    });
  }, [waiting, fx, hot, later, rarity, t.rise, tint]);

  const flip = useCallback(() => {
    if (stepRef.current !== 'down') return;
    go('flipping');
    const card = cardRef.current;
    if (card && typeof card.animate === 'function' && !fx.reduced) {
      card.animate([
        { transform: 'perspective(700px) none' },
        { transform: 'perspective(700px) translateY(-10px) scale(1.08)', offset: 0.35 },
        { transform: 'perspective(700px) translateY(-6px) scale(1.06) rotateY(90deg)' },
      ], { duration: t.flip + 120, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' });
    }
    triggerHaptic('subtle');
    later(onDone, fx.reduced ? 0 : t.flip + 120);
  }, [fx.reduced, later, onDone, t.flip]);

  // Someone who only watches still gets the open and the flip.
  useEffect(() => {
    fx.aimAt(canRef.current, 0.45);
    fx.setRays(null, 0.03);
    if (!waiting) later(pop, t.firstAuto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (step === 'down') later(flip, Math.round(t.auto * 1.4));
  }, [step, flip, later, t.auto]);

  const onTap = () => (stepRef.current === 'closed' ? pop() : flip());
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); }
  };
  const hint = step === 'closed'
    ? tFallback('capsuleOpener.tapToOpen', 'Tap to open')
    : tFallback('capsuleOpener.tapToFlip', 'Tap to flip');
  const showCard = step !== 'closed';

  return (
    <div
      className="relative flex-1 min-h-[320px] flex flex-col items-center justify-end gap-6 px-5 pb-6 select-none touch-manipulation cursor-pointer outline-none"
      role="button"
      tabIndex={0}
      aria-label={hint}
      onPointerDown={onTap}
      onKeyDown={onKey}
    >
      {/* The card, face down. Centred in the stage, above the canister. */}
      <div className="absolute inset-x-0 top-[8%] flex justify-center pointer-events-none">
        <div ref={cardRef} style={{ visibility: showCard ? 'visible' : 'hidden' }}>
          <div
            className="relative rounded-2xl bg-card flex items-center justify-center overflow-hidden"
            style={{ width: PLATE_SIZE, height: PLATE_SIZE, border: `2px solid ${tint}` }}
          >
            {/* The back of the card: an inset rule, the wordmark and the
                capsule's grade bars, all in one muted ink. */}
            <span className="absolute inset-2 rounded-xl border border-muted-foreground/25" aria-hidden="true" />
            <div className="flex flex-col items-center gap-2 text-muted-foreground" aria-hidden="true">
              <span className="font-display text-title tracking-wide opacity-60">{BRAND}</span>
              <span className="flex gap-1 opacity-60">
                {Array.from({ length: BARS[tier] ?? 1 }, (_, i) => (
                  <span key={i} className="block w-1 h-2.5 rounded-sm bg-current" />
                ))}
              </span>
            </div>
            <span className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: tint }} aria-hidden="true" />
            <NotchedCorner />
          </div>
        </div>
      </div>

      <div
        ref={canRef}
        className={`canister-stand transition-opacity duration-500 ${waiting ? 'canister-wait' : ''}`}
        style={{ opacity: step === 'down' || step === 'flipping' ? 0.35 : 1 }}
      >
        <CapsuleCanister tier={tier} open={showCard} lidFly={!fx.reduced} height="clamp(120px, 22vh, 190px)" />
      </div>

      <span className="text-label font-semibold uppercase tracking-wider text-muted-foreground" aria-live="polite">
        {step === 'rising' || step === 'flipping' ? ' ' : hint}
      </span>
    </div>
  );
}
