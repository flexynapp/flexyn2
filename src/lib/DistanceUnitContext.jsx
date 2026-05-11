import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { db } from '@/api/db';

const DistanceUnitContext = createContext({ distanceUnit: 'mi', setDistanceUnit: () => {} });

const LS_KEY = 'flexyn_distance_unit';
const DEFAULT_UNIT = 'mi';
const VALID = ['mi', 'km'];

function readCache() {
  try {
    const v = localStorage.getItem(LS_KEY);
    return VALID.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function DistanceUnitProvider({ children }) {
  const [distanceUnit, setDistanceUnitState] = useState(() => readCache() ?? DEFAULT_UNIT);
  const hydratedFromServer = useRef(false);

  // On mount, sync from server (mirror WeightUnitContext pattern)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await db.auth.me();
        const serverUnit = me?.distance_unit;
        if (!cancelled && serverUnit && VALID.includes(serverUnit) && serverUnit !== distanceUnit) {
          setDistanceUnitState(serverUnit);
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

  const setDistanceUnit = (unit) => {
    if (!VALID.includes(unit)) return;
    setDistanceUnitState(unit);
    try { localStorage.setItem(LS_KEY, unit); } catch {}
    // Best-effort server write. Fails silently if not signed in.
    try {
      db.auth.updateMe({ distance_unit: unit }).catch(() => {});
    } catch {}
  };

  return (
    <DistanceUnitContext.Provider value={{ distanceUnit, setDistanceUnit }}>
      {children}
    </DistanceUnitContext.Provider>
  );
}

export function useDistanceUnit() {
  const ctx = useContext(DistanceUnitContext);
  if (!ctx) throw new Error('useDistanceUnit must be used within a DistanceUnitProvider');
  return ctx;
}