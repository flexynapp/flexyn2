// src/components/gyms/GymEquipmentEditor.jsx
//
// The gym owner's floor editor, mounted in GymEdit alongside the Hours,
// Amenities and Photo Gallery editors.
//
// ── Why this is not the same UI as GymEquipmentTab ───────────────────
//
// The Hub tab is a shared list where anyone in the gym adds one machine
// at a time through a form. That is right for a member who spots
// something missing, and wrong for an owner sitting down to describe a
// forty-machine floor for the first time — forty trips through a form is
// how a setup task gets abandoned halfway.
//
// So this mirrors AmenitiesEditor instead: a grid of pills, tap what you
// have. Same muscle memory as the section directly above it, and the
// whole floor is describable in under a minute.
//
// ── The house-brand shortcut ─────────────────────────────────────────
//
// Gyms buy in packages. A floor is usually mostly one manufacturer, with
// a handful of exceptions, so picking a house brand once and having it
// apply to everything tapped afterwards saves ~40 identical brand
// selections. Exceptions get corrected per-machine on the Hub tab, where
// there is room for it.
//
// ── Scope: the owner's own entries only ──────────────────────────────
//
// This edits the gym's own space (the authoritative tier). Member
// submissions are deliberately NOT shown as toggled-on here — otherwise
// untoggling a type an owner never added would silently delete a
// member's find. Those are confirmed from the Hub tab; this panel just
// surfaces a count and points there.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Check, ExternalLink, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import MobileSelect from '@/components/MobileSelect';
import { toast } from '@/lib/toast';
import { triggerHaptic } from '@/lib/haptic';
import { useLanguage } from '@/lib/LanguageContext';
import {
  IMPLEMENT_TYPE_META, IMPLEMENT_TYPE_SLUGS, implementTypeLabel,
  BRAND_META, BRAND_SLUGS, brandLabel, implementLabel,
} from '@/lib/equipmentCatalog';
import {
  listOwnerFloor, countPendingMemberEntries, addToGymFloor, removeSpaceEquipment,
} from '@/lib/data/equipment';

// The 57 implement types are unusable as one flat wall of pills. Grouped
// by the `kind` already on each type, in the order an owner walks a gym.
// `label` is the English fallback for `gymEquip.group.<id>`, resolved at the
// heading below. The GROUPS order is the order an owner walks a gym and must
// not move with the language.
const GROUPS = [
  { id: 'machine',    label: 'Machines' },
  { id: 'cable',      label: 'Cables' },
  { id: 'barbell',    label: 'Bars & racks' },
  { id: 'dumbbell',   label: 'Free weights' },
  { id: 'kettlebell', label: 'Kettlebells' },
  { id: 'band',       label: 'Bands' },
  { id: 'cardio',     label: 'Cardio' },
];

// Takes the translator: the sort has to run on the string the user reads,
// or a Spanish picker comes back in English alphabetical order. Called from
// a useMemo in the component so it re-sorts when the language changes.
const typesByGroup = (tf) => GROUPS.map(g => ({
  ...g,
  types: IMPLEMENT_TYPE_SLUGS
    .filter(s => IMPLEMENT_TYPE_META[s].kind === g.id)
    .sort((a, b) => implementTypeLabel(a, tf).localeCompare(implementTypeLabel(b, tf))),
})).filter(g => g.types.length > 0);

// Radix Select reserves the empty string for "cleared", and throws if an
// item uses it as a value — so the no-brand choice needs a real sentinel.
export const NO_BRAND = 'none';

/**
 * Map the picker's sentinel onto the value actually persisted. The
 * catalogue's own "not stated" brand is 'unknown'; NO_BRAND exists only
 * because Radix forbids an empty-string option value.
 *
 * Exported so it can be tested directly — driving a Radix Select in
 * jsdom means synthesising pointer events, which tests the library
 * rather than this logic.
 */
export function brandToPersist(houseBrand) {
  return !houseBrand || houseBrand === NO_BRAND ? 'unknown' : houseBrand;
}

// Commercial brands first — an owner is not kitting out with Bowflex.
// `label` on the sentinel row is the English fallback for
// `gymEquip.noHouseBrand`; the real brands come from brandLabel(), which is
// already keyed. Resolved where the Select is built, not here — this list is
// module scope and would freeze whatever language loaded first.
const brandOptions = (tf) => [
  { value: NO_BRAND, label: tf('gymEquip.noHouseBrand', 'No house brand') },
  ...BRAND_SLUGS
    .filter(s => BRAND_META[s].scope !== 'home' && s !== 'unknown' && s !== 'other')
    .map(s => ({ value: s, label: brandLabel(s) })),
];

export default function GymEquipmentEditor({ gymId, ownerId }) {
  const { tFallback } = useLanguage();
  const TYPES_BY_GROUP = useMemo(() => typesByGroup(tFallback), [tFallback]);
  const BRAND_ITEMS = useMemo(() => brandOptions(tFallback), [tFallback]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [houseBrand, setHouseBrand] = useState(NO_BRAND);
  // Collapsed by default. 57 pills is ~1600px, and this sits below the
  // Hours, Amenities and Photo editors — expanded by default it buries
  // everything after it and hides the Cardio group behind a long scroll.
  // Opens automatically for a gym that hasn't listed anything, since
  // that owner is the one who needs to see it.
  const [open, setOpen] = useState(false);
  const openedOnce = useRef(false);
  // Per-type in-flight flag so a double tap can't fire two writes.
  const busyRef = useRef(new Set());
  const [busyTick, setBusyTick] = useState(0);
  const markBusy = (t, on) => {
    if (on) busyRef.current.add(t); else busyRef.current.delete(t);
    setBusyTick(x => x + 1);
  };

  const refresh = useCallback(async () => {
    const [floor, count] = await Promise.all([
      listOwnerFloor(gymId, ownerId),
      countPendingMemberEntries(gymId, ownerId),
    ]);
    setRows(floor);
    setPending(count);
    setLoading(false);
    if (!openedOnce.current) {
      openedOnce.current = true;
      if (floor.length === 0) setOpen(true);
    }
  }, [gymId, ownerId]);

  useEffect(() => { refresh(); }, [refresh]);

  // implement_type → the row representing it, so a toggle knows what to
  // delete. An owner listing two of the same type is a Hub-tab concern;
  // here a type is simply on or off.
  const byType = useMemo(() => {
    const m = new Map();
    for (const r of rows) if (!m.has(r.implement_type)) m.set(r.implement_type, r);
    return m;
  }, [rows]);

  const brandForNew = brandToPersist(houseBrand);

  const toggle = async (type) => {
    if (busyRef.current.has(type)) return;
    markBusy(type, true);
    triggerHaptic('light');
    const existing = byType.get(type);
    try {
      if (existing) {
        // Optimistic removal — the pill should respond to the tap, not
        // to the round trip.
        setRows(prev => prev.filter(r => r.id !== existing.id));
        const ok = await removeSpaceEquipment(existing.id);
        if (!ok) {
          setRows(prev => [...prev, existing]);
          toast.error(tFallback('gymEquipEditor.removeFailed', "Couldn't remove that."));
        }
      } else {
        const created = await addToGymFloor({
          gymId,
          userId: ownerId,
          implement: {
            brand: brandForNew,
            line: null,
            model: null,
            implementType: type,
            label: implementLabel({ brand: brandForNew, implementType: type }),
          },
        });
        if (created) setRows(prev => [...prev, { ...created, implement_type: type }]);
        else toast.error(tFallback('gymEquipEditor.addFailed', "Couldn't add that."));
      }
    } finally {
      markBusy(type, false);
    }
  };

  const listedCount = byType.size;

  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
          {tFallback('gymEquipEditor.title', 'Equipment')}
        </p>
        {!loading && (
          <span className="text-micro text-muted-foreground shrink-0">
            {listedCount} {tFallback('gymEquipEditor.listed', 'listed')}
          </span>
        )}
      </div>
      <p className="text-micro text-muted-foreground mb-2.5">
        {tFallback(
          'gymEquipEditor.hint',
          'Tap what your gym has. Members see this in their workout equipment picker.'
        )}
      </p>

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-micro font-semibold
                   text-primary py-2 min-h-[36px] select-none-ui"
      >
        {open
          ? tFallback('gymEquipEditor.hide', 'Hide equipment list')
          : tFallback('gymEquipEditor.show', 'Choose equipment')}
        <ChevronDown
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (<>
      {/* House brand. Optional, and only applies to pills tapped AFTER
          it's set — changing it doesn't rewrite existing entries, which
          would be a surprising amount of silent editing. */}
      <div className="mb-3">
        <MobileSelect
          value={houseBrand}
          onValueChange={setHouseBrand}
          placeholder={tFallback('gymEquipEditor.houseBrand', 'House brand (optional)')}
          items={BRAND_ITEMS}
        />
        {houseBrand !== NO_BRAND && (
          <p className="text-micro text-muted-foreground mt-1">
            {tFallback('gymEquipEditor.houseBrandNote', 'Applies to equipment you add from now on.')}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {TYPES_BY_GROUP.map(group => (
            <div key={group.id}>
              <p className="text-micro font-semibold text-muted-foreground/80 mb-1.5">
                {tFallback(`gymEquip.group.${group.id}`, group.label)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.types.map(type => {
                  const isOn = byType.has(type);
                  const isBusy = busyRef.current.has(type);
                  return (
                    <button
                      key={`${type}-${busyTick}`}
                      type="button"
                      onClick={() => toggle(type)}
                      disabled={isBusy}
                      aria-pressed={isOn}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-micro
                                  font-medium border transition-colors min-h-[32px] select-none-ui
                                  disabled:opacity-50 ${
                        isOn
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-secondary/60 text-muted-foreground border-border hover:bg-secondary active:bg-secondary'
                      }`}
                    >
                      {isBusy
                        ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        : isOn && <Check className="w-3 h-3" aria-hidden="true" />}
                      {implementTypeLabel(type, tFallback)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      </>)}

      {/* Member submissions live on the Hub tab — this only points at
          them, so the two surfaces don't fight over the same rows. */}
      {pending > 0 && (
        <Link
          to={`/gym/${gymId}`}
          className="mt-3 flex items-center gap-1.5 text-micro font-semibold text-primary
                     hover:underline"
        >
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          {tFallback('gymEquipEditor.pending', '{n} member submission(s) to confirm', { n: pending })}
        </Link>
      )}
    </div>
  );
}
