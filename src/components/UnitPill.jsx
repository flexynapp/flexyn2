// src/components/UnitPill.jsx
//
// Tiny tappable pill that toggles the user's global weight unit
// preference (lbs ↔ kg) in one tap, persisting via WeightUnitContext.
// Rendered inline next to weight inputs and displays — removes the
// 4-tap "navigate to settings → find toggle → flip → back" cycle.
//
// The pill changes the GLOBAL preference (mirroring the existing
// Settings toggle) so swaps persist across the whole app and across
// devices. The 200ms cross-fade on the toggle helps the change feel
// deliberate rather than glitchy.
//
// Skips rendering the "stone" option from the canonical context — the
// pill is meant for fast bilateral swaps. Users who actively want
// stone can still get it from Settings.

import { useWeightUnit } from '@/lib/WeightUnitContext';
import { motion, AnimatePresence } from 'framer-motion';

export default function UnitPill({ className = '' }) {
  const { weightUnit, setWeightUnit } = useWeightUnit();
  // Treat anything other than 'kg' as the lb side so a stone-prefering
  // user clicking the pill still gets a sensible binary swap.
  const isKg = weightUnit === 'kg';
  const next = isKg ? 'lbs' : 'kg';
  const label = isKg ? 'kg' : 'lb';

  const handleToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { navigator.vibrate?.(8); } catch { /* ignore */ }
    setWeightUnit(next);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`inline-flex items-center justify-center min-w-[28px] h-5 px-1.5 rounded-md bg-secondary text-micro font-bold uppercase tracking-wider text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-colors ${className}`}
      aria-label={`Switch weight unit to ${next}`}
      title={`Tap to switch to ${next}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.18 }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
