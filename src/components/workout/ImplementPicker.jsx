// src/components/workout/ImplementPicker.jsx
//
// The dropdown next to an exercise title in an active workout that lets
// a lifter record the SPECIFIC implement they're on — their gym's
// Hammer Strength row rather than "a row", or their own Bowflex 552s.
//
// ── Why this isn't MobileSelect ──────────────────────────────────────
// MobileSelect renders a flat, unsearchable, ungrouped list of
// {value,label} with no thumbnails. This picker needs grouped sections,
// a search field once the list passes ~8 entries, photo thumbnails, and
// an add-your-own path. It uses the same BottomSheet as the rest of the
// app's mobile surfaces, so it still feels native.
//
// ── Where the options come from ──────────────────────────────────────
// Three sources, in descending order of how likely each is to be the
// machine actually in front of you:
//
//   1. "Your equipment"  — this user's own pick history (localStorage,
//                          via recentImplements). What you have chosen
//                          before is the strongest single signal.
//   2. "At <your gym>"   — the gym's shared floor (space_equipment,
//                          fetched lazily when the drawer opens). What
//                          exists on the floor, including machines you
//                          have not used yet.
//   3. "Common models"   — the bundled SEED_MODELS catalog.
//
// Plus "add your own", which is first-class rather than a fallback: no
// catalog will ever cover every gym floor and garage.
//
// Sources 2 and 3 are additive — the picker is fully usable offline off
// the bundled catalog alone, and a failing gym query degrades to an
// absent section rather than a blocked workout.
//
// Photo thumbnails run the fallback chain in lib/equipmentImage.js and
// always terminate in a drawn silhouette. No manufacturer imagery,
// ever — see docs/gym-equipment-picker-research.md §3.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, Search, Plus, X, Camera, Loader2 } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/LanguageContext';
import { triggerHaptic } from '@/lib/haptic';
import { toast } from '@/lib/toast';
import {
  implementTypeForExercise, implementTypeLabel, seedModelsForType,
  implementLabel, brandLabel,
} from '@/lib/equipmentCatalog';
import { getRecentImplements, recordImplementUse, implementKey } from '@/lib/recentImplements';
import EquipmentThumb from './EquipmentThumb';
import { compressImage } from '@/lib/imageCompress';
import { db } from '@/api/db';
import { persistEquipmentPhoto, listGymFloor } from '@/lib/data/equipment';
import { listMyGyms } from '@/lib/data/gymBusinesses';
import { getTodayCheckinGymId } from '@/lib/data/gymCheckins';

/**
 * React key for a picker row. Catalog and history entries are identified
 * by brand+line+model; gym-floor entries carry a DB id because two
 * unbranded machines of the same type are indistinguishable otherwise.
 */
function rowKey(item) {
  return item?.id || implementKey(item);
}

/** Normalize a catalog seed row into the shape we persist. */
function fromSeed(seed, implementType) {
  return {
    brand: seed.brand,
    line: seed.line || null,
    model: seed.model || null,
    implementType,
    label: implementLabel({ brand: seed.brand, line: seed.line, model: seed.model, implementType }),
  };
}

export default function ImplementPicker({ exerciseName, value, onChange, userId }) {
  const { tFallback } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [customBrand, setCustomBrand] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const implementType = useMemo(
    () => implementTypeForExercise(exerciseName),
    [exerciseName]
  );

  const recent = useMemo(
    () => (open ? getRecentImplements(userId, implementType) : []),
    [open, userId, implementType]
  );

  // The gym's floor, fetched lazily when the drawer opens. Kept inside
  // this component rather than threaded down from Workout.jsx so the
  // picker stays self-contained — and so a slow or failing gym query
  // can never delay the workout screen itself. Empty on any failure;
  // the catalog below still works.
  const [gymFloor, setGymFloor] = useState([]);
  const [gymName, setGymName] = useState(null);

  useEffect(() => {
    if (!open || !userId || !implementType) return;
    let cancelled = false;
    (async () => {
      const [allGyms, checkedInGymId] = await Promise.all([
        listMyGyms(userId).catch(() => []),
        getTodayCheckinGymId().catch(() => null),
      ]);
      if (cancelled || !allGyms?.length) return;

      // If they checked in somewhere today, that's where they are —
      // show that floor rather than the union of every gym they belong
      // to. Falls back to all gyms when the check-in doesn't match one
      // we know about (stale membership, or they checked into a gym
      // they haven't joined).
      const scoped = checkedInGymId
        ? allGyms.filter(g => (g.id ?? g.gym_id) === checkedInGymId)
        : [];
      const gyms = scoped.length ? scoped : allGyms;

      const floors = await Promise.all(
        gyms.map(g => listGymFloor(g.id ?? g.gym_id, g.owner_id))
      );
      if (cancelled) return;
      setGymName(gyms.length === 1 ? (gyms[0].name ?? null) : null);
      setGymFloor(
        floors.flat()
          .filter(r => r.implement_type === implementType)
          .map(r => ({
            // The row's DB id is the only thing that reliably tells two
            // gym-floor entries apart: a floor with two unbranded leg
            // presses produces identical brand/line/model on both, so
            // implementKey collides and React sees duplicate keys.
            id: r.id,
            brand: 'unknown',
            line: r.label_override || null,
            model: null,
            implementType: r.implement_type,
            label: r.label_override || implementTypeLabel(r.implement_type),
            photoUrl: r.photo_url || null,
            verified: r.verified_by_owner || r.fromOwnerSpace,
          }))
      );
    })();
    return () => { cancelled = true; };
  }, [open, userId, implementType]);

  // Section order is deliberate: what YOU have picked before beats what
  // is merely present at your gym, which beats the generic catalog. A
  // machine you've used three times is a stronger signal than one that
  // exists somewhere on the floor.
  const gym = useMemo(() => {
    const recentKeys = new Set(recent.map(implementKey));
    return gymFloor.filter(m => !recentKeys.has(implementKey(m)));
  }, [gymFloor, recent]);

  const catalog = useMemo(() => {
    if (!implementType) return [];
    const seen = new Set([...recent, ...gym].map(implementKey));
    return seedModelsForType(implementType)
      .map(s => fromSeed(s, implementType))
      // Don't list a machine twice — if it's already above, it's not
      // also a fresh catalog suggestion.
      .filter(m => !seen.has(implementKey(m)));
  }, [implementType, recent, gym]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { recent, gym, catalog };
    const match = (m) => (m.label || '').toLowerCase().includes(q)
      || brandLabel(m.brand).toLowerCase().includes(q);
    return {
      recent: recent.filter(match),
      gym: gym.filter(match),
      catalog: catalog.filter(match),
    };
  }, [query, recent, gym, catalog]);

  // Exercises with no nameable implement (pure bodyweight) get no
  // control at all — an empty dropdown is worse than no dropdown.
  if (!implementType) return null;

  const commit = (implement) => {
    triggerHaptic('light');
    if (implement) recordImplementUse(userId, implementType, implement);
    onChange?.(implement);
    setOpen(false);
    setQuery('');
    setShowCustom(false);
    setCustomBrand('');
  };

  const commitCustom = () => {
    const name = customBrand.trim();
    if (!name) return;
    commit({
      brand: 'other',
      line: name,
      model: null,
      implementType,
      label: name,
    });
  };

  const pickPhoto = () => fileRef.current?.click();

  /**
   * Photograph the machine you're standing at.
   *
   * The upload is best-effort by design: the URL is attached to the
   * in-session selection as soon as Storage returns it, and the
   * training_spaces / space_equipment / equipment_photos rows are
   * written after. If that persistence fails the user still sees their
   * photo for this workout — losing a photo is not a reason to
   * interrupt someone mid-set.
   */
  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(tFallback('implement.photoType', 'Pick an image file.'));
      return;
    }

    setUploading(true);
    try {
      // A 12MP phone photo shouldn't cost 4 MB of mobile data for
      // something rendered at 56px. Same budget as AvatarUploader.
      const compressed = await compressImage(file, { maxWidth: 800, maxHeight: 800, quality: 0.85 });
      const { file_url } = await db.integrations.Core.UploadFile({ file: compressed });
      if (!file_url) throw new Error('No URL returned');

      const next = { ...value, photoUrl: file_url };
      onChange?.(next);
      recordImplementUse(userId, implementType, next);
      toast.success(tFallback('implement.photoSaved', 'Photo added'));

      // Persist to the shared catalog so this machine has a photo for
      // everyone next time. Null return = couldn't persist; the photo
      // still shows for this session.
      persistEquipmentPhoto({ implement: next, url: file_url, userId });
    } catch {
      toast.error(tFallback('implement.photoFailed', "Couldn't upload that photo."));
    } finally {
      setUploading(false);
    }
  };

  const typeLabel = implementTypeLabel(implementType);
  const showSearch = (recent.length + catalog.length) > 8;

  return (
    <>
      {/* Trigger chip. Sits inline next to the exercise title, styled to
          match the existing bar-weight select in the same header so the
          two controls read as siblings. */}
      <button
        type="button"
        onClick={() => { triggerHaptic('light'); setOpen(true); }}
        // Announce what's actually selected, not just the affordance —
        // otherwise a screen reader says "Choose equipment" whether the
        // user is on the Cybex or hasn't picked anything at all.
        aria-label={
          value?.label
            ? `${tFallback('implement.choose', 'Choose equipment')}: ${value.label}`
            : tFallback('implement.choose', 'Choose equipment')
        }
        className="inline-flex items-center gap-1 max-w-[55vw] text-micro font-medium
                   bg-secondary/60 border border-border rounded-md px-1.5 py-1
                   min-h-[32px] text-muted-foreground hover:text-foreground
                   hover:border-primary/40 transition-colors select-none-ui"
      >
        <span className="truncate">
          {value?.label || tFallback('implement.add', 'Add equipment')}
        </span>
        <ChevronDown className="w-3 h-3 shrink-0 opacity-60" aria-hidden="true" />
      </button>

      <BottomSheet
        open={open}
        onClose={() => { setOpen(false); setShowCustom(false); }}
        title={typeLabel}
      >
        <div className="px-4 pb-6">
          {showSearch && (
            <div className="relative mb-3">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tFallback('implement.search', 'Search brands and models')}
                className="ps-9"
              />
            </div>
          )}

          {/* Currently selected — the photo affordance and the undo.
              Users who tapped the wrong machine need a way back that
              isn't "guess which entry was the old one". */}
          {value && (
            <div className="mb-3 p-3 rounded-xl bg-secondary/40 border border-border">
              <div className="flex items-center gap-3">
                <EquipmentThumb implement={value} size={56} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{value.label}</p>
                  <p className="text-micro text-muted-foreground">
                    {value.photoUrl
                      ? tFallback('implement.yourPhoto', 'Your photo')
                      : tFallback('implement.noPhoto', 'No photo yet')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-2.5">
                <button
                  type="button"
                  onClick={pickPhoto}
                  disabled={uploading}
                  className="flex-1 inline-flex items-center justify-center gap-1.5
                             text-xs font-semibold text-primary rounded-lg py-2.5
                             min-h-[44px] hover:bg-secondary transition-colors
                             disabled:opacity-60 select-none-ui"
                >
                  {uploading
                    ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    : <Camera className="w-4 h-4" aria-hidden="true" />}
                  {value.photoUrl
                    ? tFallback('implement.replacePhoto', 'Replace photo')
                    : tFallback('implement.addPhoto', 'Add a photo')}
                </button>
                <button
                  type="button"
                  onClick={() => commit(null)}
                  className="inline-flex items-center justify-center gap-1.5 px-3
                             text-xs font-medium text-muted-foreground rounded-lg
                             min-h-[44px] hover:bg-secondary transition-colors select-none-ui"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                  {tFallback('implement.clear', 'Clear')}
                </button>
              </div>
              {/* capture="environment" opens the rear camera straight
                  away on mobile — the user is standing at the machine. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhoto}
              />
            </div>
          )}

          <Section title={tFallback('implement.yourGear', 'Your equipment')} items={filtered.recent}>
            {(item) => (
              <Row
                key={rowKey(item)}
                item={item}
                selected={value && implementKey(value) === implementKey(item)}
                onSelect={() => commit(item)}
              />
            )}
          </Section>

          {/* Placeholder rather than "At" + name — concatenating a
              preposition onto a noun assumes English word order and
              breaks in most of the other 14 locales. */}
          <Section
            title={gymName
              ? tFallback('implement.atGymNamed', 'At {gym}').replace('{gym}', gymName)
              : tFallback('implement.atYourGym', 'At your gym')}
            items={filtered.gym}
          >
            {(item) => (
              <Row
                key={rowKey(item)}
                item={item}
                selected={value && implementKey(value) === implementKey(item)}
                onSelect={() => commit(item)}
              />
            )}
          </Section>

          <Section title={tFallback('implement.catalog', 'Common models')} items={filtered.catalog}>
            {(item) => (
              <Row
                key={rowKey(item)}
                item={item}
                selected={value && implementKey(value) === implementKey(item)}
                onSelect={() => commit(item)}
              />
            )}
          </Section>

          {filtered.recent.length === 0 && filtered.gym.length === 0
            && filtered.catalog.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {query
                ? tFallback('implement.noMatch', 'No match — add it below.')
                : tFallback('implement.empty', 'No models listed for this yet — add yours below.')}
            </p>
          )}

          {/* Add-your-own. The catalog will never cover every gym floor
              or garage, so this is a first-class path, not a fallback. */}
          {showCustom ? (
            <div className="mt-3 space-y-2">
              <Input
                autoFocus
                value={customBrand}
                onChange={(e) => setCustomBrand(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitCustom(); }}
                placeholder={tFallback('implement.customPlaceholder', 'e.g. Atlantis leg press')}
                maxLength={60}
              />
              <div className="flex gap-2">
                <Button onClick={commitCustom} disabled={!customBrand.trim()} className="flex-1 min-h-[44px]">
                  {tFallback('implement.save', 'Save')}
                </Button>
                <Button variant="ghost" onClick={() => setShowCustom(false)} className="min-h-[44px]">
                  {tFallback('common.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCustom(true)}
              className="w-full flex items-center gap-2 px-3 py-3 mt-3 rounded-lg
                         text-sm font-medium text-primary hover:bg-secondary
                         transition-colors min-h-[44px] select-none-ui"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              {tFallback('implement.addCustom', 'Add your own')}
            </button>
          )}
        </div>
      </BottomSheet>
    </>
  );
}

function Section({ title, items, children }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground px-1 mb-1">
        {title}
      </p>
      <div className="space-y-0.5">{items.map(children)}</div>
    </div>
  );
}

function Row({ item, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-start
                 hover:bg-secondary transition-colors min-h-[44px] select-none-ui"
    >
      <EquipmentThumb implement={item} size={36} />
      <span className="flex-1 min-w-0">
        {/* Wraps to two lines rather than truncating. Truncation cut the
            MODEL — "Hammer Strength Plate Loaded S…" — which is exactly
            the part that tells two machines apart, in a list whose only
            job is telling machines apart. */}
        <span className="block text-sm font-medium line-clamp-2 leading-snug">{item.label}</span>
        {item.count > 1 && (
          <span className="block text-micro text-muted-foreground">
            used {item.count}×
          </span>
        )}
      </span>
      {selected && <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />}
    </button>
  );
}
