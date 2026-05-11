import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { db } from '@/api/db';

const WeightUnitContext = createContext({ weightUnit: 'lbs', setWeightUnit: () => {} });

const LS_KEY = 'flexyn_weight_unit';
const DEFAULT_UNIT = 'lbs';
const VALID = ['lbs', 'kg', 'stone'];

function readCache() {
  try {
    const v = localStorage.getItem(LS_KEY);
    return VALID.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function WeightUnitProvider({ children }) {
  const [weightUnit, setWeightUnitState] = useState(() => readCache() ?? DEFAULT_UNIT);
  const hydratedFromServer = useRef(false);

  // On mount, sync from server (mirror LanguageContext pattern)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await db.auth.me();
        const serverUnit = me?.weight_unit;
        if (!cancelled && serverUnit && VALID.includes(serverUnit) && serverUnit !== weightUnit) {
          setWeightUnitState(serverUnit);
          try { localStorage.setItem(LS_KEY, serverUnit); } catch {}
        }
      } catch {
        // Not signed in or request failed — keep localStorage value.
      } finally {
        hydratedFromServer.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setWeightUnit = (unit) => {
    if (!VALID.includes(unit)) return;
    setWeightUnitState(unit);
    try { localStorage.setItem(LS_KEY, unit); } catch {}
    // Best-effort server write. Fails silently if not signed in.
    try {
      db.auth.updateMe({ weight_unit: unit }).catch(() => {});
    } catch {}
  };

  return (
    <WeightUnitContext.Provider value={{ weightUnit, setWeightUnit }}>
      {children}
    </WeightUnitContext.Provider>
  );
}

export function useWeightUnit() {
  const ctx = useContext(WeightUnitContext);
  if (!ctx) throw new Error('useWeightUnit must be used within a WeightUnitProvider');
  return ctx;
}