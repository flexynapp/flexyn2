// src/components/RollingNumber.jsx
//
// A number whose digits turn like an odometer when it goes UP, ones first,
// and which shows the success colour for a moment because something good
// happened. Reward tier (see TIER in @/lib/motion): the pop spring, under
// 0.7s, and the only kind of motion allowed to turn a number green.
//
// Use it through `<AnimatedNumber roll />` for a balance or total that
// changes while the user watches it (coins after a sale, league points
// after a quest). A plain count up is still right for a number arriving
// with its card.
//
// Rules this keeps, each learned from the preview:
// - A drop SNAPS. Rolling down reads as a loss being celebrated, and a
//   purchase is not a reward.
// - Digits are tabular. Sofia Sans digits are proportional by default (the
//   1 is about 20% narrower than the 0), so a rolling number with
//   proportional figures shifts sideways as it turns.
// - Each column is keyed by its place counted from the RIGHT, so 999 to
//   1,000 adds a column on the left instead of re-keying every digit.
// - Screen readers get the whole number once, not ten digits per column.
// - A balance often arrives twice on open: the cached profile, then the
//   live figure a moment later. Changes in the first second after mount
//   are that settling, not an earning, so they snap.
// - With Reduce Motion on, App.jsx's MotionConfig strips the transform and
//   the number simply changes.

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SPRING, STAGGER } from '@/lib/motion';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const FLASH_MS = 900;
const SETTLE_MS = 1000;

export default function RollingNumber({ value, format = (n) => String(Math.round(n)), className = '' }) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  const text = format(n);
  const prev = useRef(n);
  const mountedAt = useRef(0);
  const [flash, setFlash] = useState(false);
  useEffect(() => { mountedAt.current = Date.now(); }, []);
  const settled = () => mountedAt.current > 0 && Date.now() - mountedAt.current >= SETTLE_MS;
  const gained = settled() && n > prev.current;

  useEffect(() => {
    if (settled() && n > prev.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), FLASH_MS);
      prev.current = n;
      return () => clearTimeout(t);
    }
    prev.current = n;
    return undefined;
  }, [n]);

  const chars = [...text];
  const last = chars.length - 1;
  return (
    <span
      className={`inline-flex items-center leading-[1.15em] tabular-nums transition-colors duration-500 ${flash ? 'text-success' : ''} ${className}`}
    >
      <span className="sr-only">{text}</span>
      {chars.map((c, i) => {
        const place = last - i;
        if (!/[0-9]/.test(c)) return <span key={`s${place}`} aria-hidden="true">{c}</span>;
        return (
          <span key={`d${place}`} aria-hidden="true" className="inline-block h-[1.15em] overflow-hidden">
            <motion.span
              className="flex flex-col"
              animate={{ y: `${-Number(c) * 10}%` }}
              transition={gained ? { ...SPRING.pop, delay: place * STAGGER } : { duration: 0 }}
            >
              {DIGITS.map((d) => <span key={d} className="h-[1.15em] leading-[1.15em]">{d}</span>)}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}
