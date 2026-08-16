// src/components/gyms/GymEquipmentTab.jsx
//
// A gym's equipment floor. Members add what they find; the owner
// confirms it. Once a gym's floor is described, every member's
// equipment picker leads with real machines instead of a generic
// catalog — that's the payoff this tab exists for.
//
// ── Trust model ──────────────────────────────────────────────────────
// A gym's floor is the union of equipment across every member's
// training_space for that gym (see the note in lib/data/equipment.js —
// it falls out of the RLS, which won't let a member create a space the
// gym owns). Three tiers, rendered distinctly:
//
//   • added by the gym owner  → authoritative, no badge needed
//   • verified_by_owner       → "Confirmed" badge
//   • added by a member       → shown plainly; owner can confirm it
//
// Authorization is enforced by migration 268's RLS policies, not here.
// The owner-only controls below are an affordance, not a gate — a
// non-owner who forged a request still gets rejected server-side.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Check, Trash2, Loader2, BadgeCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import MobileSelect from '@/components/MobileSelect';
import EmptyState from '@/components/EmptyState';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { triggerHaptic } from '@/lib/haptic';
import {
  IMPLEMENT_TYPE_SLUGS, implementTypeLabel,
  BRAND_META, BRAND_SLUGS, brandLabel, implementLabel,
} from '@/lib/equipmentCatalog';
import {
  listGymFloor, addToGymFloor, setEquipmentVerified, removeSpaceEquipment,
} from '@/lib/data/equipment';
import EquipmentThumb from '@/components/workout/EquipmentThumb';

// Commercial-floor brands first — someone describing a gym is not
// picking Bowflex. `scope: 'home'` entries stay available at the bottom
// for the rare garage-style gym.
const BRAND_OPTIONS = [
  ...BRAND_SLUGS.filter(s => BRAND_META[s].scope !== 'home' && s !== 'unknown' && s !== 'other'),
  ...BRAND_SLUGS.filter(s => BRAND_META[s].scope === 'home'),
  'other', 'unknown',
].map(slug => ({ value: slug, label: brandLabel(slug) }));

export default function GymEquipmentTab({ gymId, gymOwnerId, isMember }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const isOwner = !!(user?.id && gymOwnerId && user.id === gymOwnerId);
  const canContribute = isOwner || !!isMember;

  const refresh = useCallback(async () => {
    setLoading(true);
    const floor = await listGymFloor(gymId, gymOwnerId);
    setRows(floor);
    setLoading(false);
  }, [gymId, gymOwnerId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Group by implement type so a floor with 40 machines reads as a floor
  // plan rather than a flat list.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = r.implement_type;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.entries()].sort((a, b) =>
      implementTypeLabel(a[0], tFallback).localeCompare(implementTypeLabel(b[0], tFallback))
    );
  }, [rows, tFallback]);

  const handleAdd = async (implement) => {
    setAdding(false);
    const created = await addToGymFloor({ gymId, userId: user?.id, implement });
    if (!created) {
      toast.error(tFallback('gymEquip.addFailed', "Couldn't add that."));
      return;
    }
    triggerHaptic('light');
    toast.success(tFallback('gymEquip.added', 'Added to the floor'));
    refresh();
  };

  const handleVerify = async (row) => {
    setBusyId(row.id);
    const ok = await setEquipmentVerified(row.id, !row.verified_by_owner);
    setBusyId(null);
    if (!ok) {
      toast.error(tFallback('gymEquip.verifyFailed', "Couldn't update that."));
      return;
    }
    triggerHaptic('light');
    refresh();
  };

  const handleRemove = async (row) => {
    setBusyId(row.id);
    const ok = await removeSpaceEquipment(row.id);
    setBusyId(null);
    if (!ok) {
      toast.error(tFallback('gymEquip.removeFailed', "Couldn't remove that."));
      return;
    }
    refresh();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canContribute && (
        adding
          ? <AddEquipmentForm onSubmit={handleAdd} onCancel={() => setAdding(false)} />
          : (
            <Button
              onClick={() => setAdding(true)}
              variant="outline"
              className="w-full min-h-[44px]"
            >
              <Plus className="w-4 h-4 me-1.5" />
              {tFallback('gymEquip.add', 'Add equipment')}
            </Button>
          )
      )}

      {rows.length === 0 && !adding && (
        <EmptyState
          title={tFallback('gymEquip.emptyTitle', 'No equipment listed yet')}
          description={
            canContribute
              ? tFallback('gymEquip.emptyMine', "Add what's on the floor — it'll show up in everyone's workout picker.")
              : tFallback('gymEquip.emptyOther', 'Nobody has described this gym’s floor yet.')
          }
        />
      )}

      {grouped.map(([type, items]) => (
        <div key={type}>
          <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground px-1 mb-1.5">
            {implementTypeLabel(type, tFallback)}
          </p>
          <div className="space-y-1.5">
            {items.map(row => (
              <EquipmentRow
                key={row.id}
                row={row}
                isOwner={isOwner}
                canRemove={isOwner || row.added_by === user?.id}
                busy={busyId === row.id}
                onVerify={() => handleVerify(row)}
                onRemove={() => handleRemove(row)}
                tFallback={tFallback}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EquipmentRow({ row, isOwner, canRemove, busy, onVerify, onRemove, tFallback }) {
  const label = row.label_override || implementTypeLabel(row.implement_type, tFallback);
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-card border border-border">
      <EquipmentThumb
        implement={{ implementType: row.implement_type, photoUrl: row.photo_url }}
        size={40}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        {(row.fromOwnerSpace || row.verified_by_owner) && (
          <span className="inline-flex items-center gap-1 text-micro font-semibold text-primary mt-0.5">
            <BadgeCheck className="w-3 h-3" aria-hidden="true" />
            {row.fromOwnerSpace
              ? tFallback('gymEquip.byGym', 'Listed by the gym')
              : tFallback('gymEquip.confirmed', 'Confirmed')}
          </span>
        )}
      </div>

      {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}

      {/* Owner can confirm a member's find. Nothing to confirm on the
          gym's own entries — they're authoritative by definition. */}
      {!busy && isOwner && !row.fromOwnerSpace && (
        <button
          type="button"
          onClick={onVerify}
          aria-label={row.verified_by_owner
            ? tFallback('gymEquip.unconfirm', 'Remove confirmation')
            : tFallback('gymEquip.confirm', 'Confirm this is on the floor')}
          className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg
                      transition-colors select-none-ui ${
            row.verified_by_owner
              ? 'text-primary bg-primary/10'
              : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
          }`}
        >
          <Check className="w-4 h-4" />
        </button>
      )}

      {!busy && canRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={tFallback('gymEquip.remove', 'Remove')}
          className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg
                     text-muted-foreground hover:text-destructive active:text-destructive hover:bg-secondary active:bg-secondary
                     transition-colors select-none-ui"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function AddEquipmentForm({ onSubmit, onCancel }) {
  const { tFallback } = useLanguage();

  // Same list as the tab above, rebuilt here because this sub-component has
  // its own tFallback — see the note there on sorting the translated string.
  const TYPE_OPTIONS = useMemo(
    () => IMPLEMENT_TYPE_SLUGS
      .map(slug => ({ value: slug, label: implementTypeLabel(slug, tFallback) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [tFallback],
  );
  const [implementType, setImplementType] = useState('');
  const [brand, setBrand] = useState('unknown');
  const [line, setLine] = useState('');

  const submit = () => {
    if (!implementType) return;
    const trimmed = line.trim();
    onSubmit({
      brand,
      line: trimmed || null,
      model: null,
      implementType,
      label: implementLabel({ brand, line: trimmed || null, implementType }),
    });
  };

  return (
    <div className="p-3 rounded-xl bg-secondary/40 border border-border space-y-2.5">
      <MobileSelect
        value={implementType}
        onValueChange={setImplementType}
        placeholder={tFallback('gymEquip.pickType', 'What kind of equipment?')}
        items={TYPE_OPTIONS}
      />
      <MobileSelect
        value={brand}
        onValueChange={setBrand}
        placeholder={tFallback('gymEquip.pickBrand', 'Brand')}
        items={BRAND_OPTIONS}
      />
      <Input
        value={line}
        onChange={(e) => setLine(e.target.value)}
        placeholder={tFallback('gymEquip.linePlaceholder', 'Series or model (optional)')}
        maxLength={60}
      />
      <div className="flex gap-2">
        <Button onClick={submit} disabled={!implementType} className="flex-1 min-h-[44px]">
          {tFallback('gymEquip.save', 'Add')}
        </Button>
        <Button variant="ghost" onClick={onCancel} className="min-h-[44px]">
          {tFallback('common.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
}
