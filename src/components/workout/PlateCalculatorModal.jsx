// src/components/workout/PlateCalculatorModal.jsx
//
// On-demand plate calculator. Type any target weight + pick your bar →
// see exactly what to load PER SIDE (visual barbell + "2×45 + 1×25").
// Reuses the same plate math (platesPerSide) and PlateDiagram as the
// inline per-set diagram, so the numbers always agree. Bar choice
// persists app-wide via setActiveBarLbs.

import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calculator } from 'lucide-react';
import PlateDiagram from './PlateDiagram';
import { BAR_PRESETS, getActiveBarLbs, setActiveBarLbs, platesPerSide } from '@/lib/barInventory';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { toLbs, formatWeightNumber } from '@/lib/weightUnit';

export default function PlateCalculatorModal({ open, onClose, initialWeightLbs = null }) {
  const { weightUnit } = useWeightUnit();
  const [barLbs, setBarLbs] = useState(() => getActiveBarLbs());
  const [input, setInput] = useState(() =>
    initialWeightLbs ? formatWeightNumber(initialWeightLbs, weightUnit) : '',
  );

  const targetLbs = toLbs(parseFloat(input) || 0, weightUnit);
  const perSide = useMemo(() => platesPerSide(targetLbs, barLbs), [targetLbs, barLbs]);

  // Loaded total from the plates we could place — surfaces any remainder
  // when the target isn't reachable with standard plates.
  const loadedLbs = (perSide || []).reduce((sum, { plate, count }) => sum + plate * count * 2, barLbs);
  const remainderLbs = targetLbs - loadedLbs;
  const hasInput = !!input && targetLbs > 0;

  const chooseBar = (lbs) => {
    setBarLbs(lbs);
    setActiveBarLbs(lbs);
  };

  const breakdownText = (perSide && perSide.length)
    ? perSide.map(({ plate, count }) => `${count}×${plate}`).join('  +  ')
    : null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-sm"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            initial={{ y: '100%', opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0.6 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Plate calculator"
            className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-primary" />
                <h3 className="font-heading font-bold text-base">Plate calculator</h3>
              </div>
              <button onClick={onClose} aria-label="Close" className="p-1 rounded-md text-muted-foreground hover:bg-secondary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target weight input */}
            <div>
              <label className="text-micro font-bold uppercase tracking-wide text-muted-foreground">Target weight</label>
              <div className="relative mt-1">
                <input
                  type="number"
                  inputMode="decimal"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="w-full h-14 rounded-xl bg-secondary/50 border border-border text-center text-3xl font-heading font-black tabular-nums focus:outline-none focus:border-primary/50"
                />
                <span className="absolute end-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">{weightUnit}</span>
              </div>
            </div>

            {/* Bar selector */}
            <div>
              <label className="text-micro font-bold uppercase tracking-wide text-muted-foreground">Bar</label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {BAR_PRESETS.map((bar) => {
                  const active = bar.lbs === barLbs;
                  return (
                    <button
                      key={bar.id}
                      type="button"
                      onClick={() => chooseBar(bar.lbs)}
                      className={[
                        'px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                        active ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:bg-secondary',
                      ].join(' ')}
                    >
                      {bar.label} · {formatWeightNumber(bar.lbs, weightUnit)}{weightUnit}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Result */}
            <div className="rounded-xl bg-secondary/40 border border-border p-4 min-h-[120px] flex flex-col items-center justify-center text-center">
              {!hasInput ? (
                <p className="text-sm text-muted-foreground">Enter a weight to see what to load.</p>
              ) : targetLbs < barLbs ? (
                <p className="text-sm text-muted-foreground">That's below the bar weight — just the empty bar.</p>
              ) : !perSide || perSide.length === 0 ? (
                <p className="text-sm font-semibold">Just the bar — no plates needed.</p>
              ) : (
                <>
                  <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground mb-1">Per side</p>
                  <p className="font-heading font-black text-lg mb-2">{breakdownText}</p>
                  <PlateDiagram plates={perSide} barLbs={barLbs} />
                  {remainderLbs > 0.1 && (
                    <p className="text-micro text-primary mt-2">
                      ~{formatWeightNumber(remainderLbs, weightUnit)} {weightUnit} short — no small enough plate.
                    </p>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
