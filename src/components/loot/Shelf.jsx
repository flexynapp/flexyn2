// src/components/loot/Shelf.jsx
//
// The shelf: one sideways row per rarity, rarest first. Kegan's pick for My
// Bag (option C, 2026-10-02), shared by the Bag tabs and the market's
// "pick an item to list" step so an item looks the same wherever you hold it.
//
// It replaced a grid of rarity-bordered boxes, each carrying its own rarity
// pill and Sell button. A shelf shows what you own first and the spots you
// have not filled after it, dimmed, so the Bag is also the collection: the
// separate Collection sheet is gone.
//
// No boxes. The rarity is the shelf's name, written in its colour, and the
// item art already carries the rarity as its accent.

import Sticker from '@/components/capsules/Sticker';
import { getLootFrameById } from '@/lib/lootFrames';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { rarityName } from '@/components/capsules/words';
import { useLanguage } from '@/lib/LanguageContext';

export const SHELF_ORDER = ['animated', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

/** Rarity colour as a CSS variable, read by `.rarity-ink` (darkened in light mode). */
export const inkStyle = (rarity) => ({ '--rarity': rarityTint(rarity)?.color });

/**
 * Group items into shelves, rarest first. `items` carry `rarity`; anything
 * whose rarity is not on the ladder lands on the common shelf rather than
 * vanishing.
 */
export function shelvesOf(items) {
  const by = new Map();
  for (const it of items) {
    const r = SHELF_ORDER.includes(it.rarity) ? it.rarity : 'common';
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(it);
  }
  return SHELF_ORDER.filter(r => by.has(r)).map(r => ({ rarity: r, items: by.get(r) }));
}

/** One rarity's row. `owned`/`total` are optional; without them no count shows. */
export function Shelf({ rarity, owned, total, children }) {
  const { tFallback } = useLanguage();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-2">
        <span className="text-label font-semibold rarity-ink" style={inkStyle(rarity)}>
          {rarityName(tFallback, rarity)}
        </span>
        {total != null && (
          <span className="text-caption tabular-nums text-muted-foreground">
            {tFallback('capsules.set.of', '{owned} of {total}', { owned, total })}
          </span>
        )}
      </h3>
      <ul className="-mx-5 px-5 flex gap-2 overflow-x-auto snap-x pb-1">
        {children}
      </ul>
    </section>
  );
}

/**
 * A sticker on a shelf. Missing ones are the same die-cut shape, greyed, so
 * the empty spot still says what goes there.
 */
export function ShelfSticker({ id, emoji, rarity, name, have = true, count = 1, selected = false, onSelect }) {
  const { tFallback } = useLanguage();
  return (
    <li className="shrink-0 snap-start">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={have ? name : tFallback('userBag.missingItem', '{name}, not collected yet', { name })}
        className="relative w-16 flex flex-col items-center gap-1 rounded-lg py-1 active:scale-95 transition-transform duration-150"
      >
        <Sticker
          itemId={id}
          emoji={emoji}
          rarity={rarity}
          size={selected ? 60 : 54}
          dim={!have}
          className="transition-[width,height] duration-200"
        />
        <span className={`w-full text-caption leading-tight text-center truncate ${have ? 'font-semibold' : 'text-muted-foreground'}`}>
          {name}
        </span>
        {count > 1 && (
          <span className="absolute top-0 end-0 text-caption font-bold tabular-nums">×{count}</span>
        )}
        {selected && <span className="absolute -bottom-1 h-0.5 w-6 rounded-full bg-primary" aria-hidden="true" />}
      </button>
    </li>
  );
}

// The die-cut stock a sticker is printed on (Sticker.jsx draws the same two
// layers as SVG strokes), so a title reads as a name tag cut from the sheet.
const BONE = '#F5F2F0';
const CUT = '#13171B';

/** A title as a die-cut name tag. Rarity colours the name, as on the Hub. */
export function TitleTag({ name, rarity, dim = false, size = 'md' }) {
  const tall = size === 'lg';
  return (
    <span
      className="inline-flex rounded-lg p-[3px]"
      style={{ background: BONE, boxShadow: '0 2px 0 rgba(0,0,0,0.35)', opacity: dim ? 0.45 : 1 }}
    >
      <span
        className={`inline-flex items-center rounded-md font-heading font-bold whitespace-nowrap ${tall ? 'h-10 px-3 text-body' : 'h-8 px-2.5 text-label'}`}
        style={{ background: CUT, color: dim ? '#89949F' : rarityTint(rarity)?.color }}
      >
        {name}
      </span>
    </span>
  );
}

/** A title on a shelf: the tag, and "Wearing" under the one you have on. */
export function ShelfTitle({ name, rarity, have = true, wearing = false, selected = false, onSelect }) {
  const { tFallback } = useLanguage();
  return (
    <li className="shrink-0 snap-start">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={have ? name : tFallback('userBag.missingItem', '{name}, not collected yet', { name })}
        className="relative flex flex-col items-center gap-1 py-1 active:scale-95 transition-transform duration-150"
      >
        <TitleTag name={name} rarity={rarity} dim={!have} />
        <span className="h-4 text-caption font-semibold text-primary">
          {wearing ? tFallback('userBag.wearing', 'Wearing') : ''}
        </span>
        {selected && <span className="absolute -bottom-1 h-0.5 w-6 rounded-full bg-primary" aria-hidden="true" />}
      </button>
    </li>
  );
}

/** An avatar wearing a frame. `avatarUrl` or `initial` fills it. */
export function FramedAvatar({ frameId, avatarUrl, initial, size = 48, dim = false }) {
  const css = frameId ? (getLootFrameById(frameId)?.css ?? {}) : {};
  return (
    <span
      className="rounded-full bg-secondary flex items-center justify-center overflow-hidden shrink-0 font-heading font-bold text-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), opacity: dim ? 0.45 : 1, ...css }}
    >
      {avatarUrl
        ? <img loading="lazy" src={avatarUrl} alt="" className="w-full h-full object-cover" />
        : (initial || '?').toUpperCase()}
    </span>
  );
}

/** A frame on a shelf, drawn on the viewer's own avatar. */
export function ShelfFrame({ id, name, have = true, wearing = false, selected = false, onSelect, avatarUrl, initial }) {
  const { tFallback } = useLanguage();
  return (
    <li className="shrink-0 snap-start">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={have ? name : tFallback('userBag.missingItem', '{name}, not collected yet', { name })}
        className="relative w-16 flex flex-col items-center gap-1 py-1 active:scale-95 transition-transform duration-150"
      >
        <FramedAvatar frameId={id} avatarUrl={avatarUrl} initial={initial} size={48} dim={!have} />
        <span className={`w-full text-caption leading-tight text-center truncate ${have ? 'font-semibold' : 'text-muted-foreground'}`}>
          {name}
        </span>
        {wearing && <span className="absolute top-0 end-1 w-2 h-2 rounded-full bg-primary" aria-hidden="true" />}
        {selected && <span className="absolute -bottom-1 h-0.5 w-6 rounded-full bg-primary" aria-hidden="true" />}
      </button>
    </li>
  );
}
