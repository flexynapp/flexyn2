// src/components/hub/UserBag.jsx
// My Bag: Capsules | Stickers | Titles | Frames (| Themes, only if owned).
// Capsules come from user_capsules; everything else from user_inventory.
//
// Option C, "Shelves" (Kegan's pick, 2026-10-02). Each tab is one hero at the
// top and a sideways shelf per rarity under it, rarest first. The hero is the
// detail view: tap anything on a shelf and the hero shows it with the ONE
// action it has (sell, wear, equip, open). Shelves list what you own first
// and the spots you have not filled after it, dimmed, so the Bag is also the
// collection and the separate Collection sheet is gone.
//
// It replaced a grid of rarity-bordered boxes, each with its own rarity pill
// and Sell button, which read as generated UI and made "what am I missing"
// a second screen.

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Search, Package, Palette, Globe2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { supabase } from '@/api/supabaseClient';
import { patchProfile } from '@/api/profileCache';
import { safeSelect } from '@/api/safeSelect';
import * as inventory from '@/lib/data/inventory';
import * as capsules  from '@/lib/data/capsules';
import { getFlexCoins } from '@/lib/data/coinShop';
import { ITEMS, CAPSULE_GLYPH } from '@/lib/lootCatalog';
import { RarityBadge, RarityFrame } from '@/components/loot/RarityVisuals';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import CapsuleCanister from '@/components/capsules/CapsuleCanister';
import Sticker from '@/components/capsules/Sticker';
import { tierName, rarityName } from '@/components/capsules/words';
import {
  Shelf, ShelfSticker, ShelfTitle, ShelfFrame, FramedAvatar, shelvesOf, inkStyle,
} from '@/components/loot/Shelf';
import { catalogFor } from '@/lib/collection';
import { getLootThemeById } from '@/lib/lootThemes';
import { THEMES_ENABLED } from '@/lib/featureFlags';
import { reportError } from '@/lib/reportError';
import CoinShopModal from './CoinShopModal';
import { useNumberFormatter } from '@/lib/intl';
import { tileRow } from '@/lib/tileRows';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';
import { sellPriceFor } from '@/lib/sellPrice';
import { enT } from '@/lib/translatorArg';
import { haptic } from '@/lib/haptic';
import { DURATION, EASE_OUT } from '@/lib/motion';

// Sell price is half the hidden base value, rounded down. Shared with the
// capsule reveal through src/lib/sellPrice.js; the server prices the sale.

// Map capsule_type string → display metadata.
//
// The catalog ids are cap_standard / cap_premium / cap_elite — the
// lookups here said capsule_* and so had ALWAYS fallen through to the
// literals below. Corrected rather than deleted: the catalog carries the
// description the opener shows.
const CAPSULE_META = {
  standard: ITEMS.find(i => i.id === 'cap_standard') ?? { name: 'Standard Capsule', emoji: CAPSULE_GLYPH.standard, rarity: 'common'   },
  premium:  ITEMS.find(i => i.id === 'cap_premium')  ?? { name: 'Premium Capsule',  emoji: CAPSULE_GLYPH.premium,  rarity: 'uncommon' },
  elite:    ITEMS.find(i => i.id === 'cap_elite')    ?? { name: 'Elite Capsule',    emoji: CAPSULE_GLYPH.elite,    rarity: 'epic'     },
};

// Rarest first, the order the shelf and the tier picker read in.
const TIERS = ['elite', 'premium', 'standard'];

// Themes are off (src/lib/featureFlags.js); an owned theme still shows in its
// old tile grid rather than vanishing, so it keeps its wrapping row.
const TILE = tileRow({ gap: 3, cols: 3, smCols: 4 });

// The hero changes in place when you pick something; a short fade says it
// changed without moving anything (an Answer, in the motion tiers).
const HERO_FADE = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.fast, ease: EASE_OUT },
};

// ─── Capsule hero ─────────────────────────────────────────────────────────────
// Exported for the regression test only — nothing else imports it, and the
// default export stays the component this module is about. It is exported
// rather than tested through <UserBag> because reaching this button that way
// means standing up auth, the query client and two live Supabase reads, none
// of which are the thing under test: what this card hands the opener.
export function CapsuleCard({ capsuleRow, onOpenCapsule, rows = [], onOpenCapsuleBatch }) {
  const { tFallback } = useLanguage();
  const tier = CAPSULE_META[capsuleRow.capsule_type] ? capsuleRow.capsule_type : 'standard';
  const meta = CAPSULE_META[tier];
  const n = Math.max(rows.length, 1);
  const take = Math.min(rows.length, 10);
  return (
    <div className="flex flex-col items-center">
      <CapsuleCanister tier={tier} height={168} />
      <p className="pt-2 font-heading font-bold text-title">
        {tFallback('userBag.tierCapsule', '{tier} capsule', { tier: tierName(tFallback, tier) })}
      </p>
      <p className="text-label text-muted-foreground tabular-nums">
        {tFallback('userBag.waiting', '{n} waiting', { n })}
      </p>
      <button
        type="button"
        // meta FIRST, row LAST. meta is a loot_catalog entry and carries its
        // own `id` ('cap_premium'), so spreading it second overwrote the
        // capsule row's UUID — the opener then sent 'cap_premium' to
        // open_capsule_atomic and Postgres answered `invalid input syntax
        // for type uuid`. Every capsule opened from a single card failed;
        // the batch button passes raw rows, which is why "open all" worked
        // and a lone capsule did not.
        onClick={() => { haptic('light'); onOpenCapsule?.({ ...meta, ...capsuleRow }); }}
        className="mt-6 w-full h-12 rounded-full bg-primary text-primary-foreground text-body font-bold active:scale-[0.98] transition-transform duration-150"
      >
        {tFallback('userBag.openOne', 'Open')}
      </button>
      {onOpenCapsuleBatch && rows.length > 1 && (
        <button
          type="button"
          onClick={() => { haptic('light'); onOpenCapsuleBatch(rows.slice(0, take)); }}
          className="mt-2 w-full min-h-11 flex flex-col items-center justify-center"
        >
          <span className="text-label font-semibold text-primary">
            {tier === 'elite'
              ? tFallback('userBag.openNElite', 'Open {n} elite', { n: take })
              : tier === 'premium'
                ? tFallback('userBag.openNPremium', 'Open {n} premium', { n: take })
                : tFallback('userBag.openNStandard', 'Open {n} standard', { n: take })}
          </span>
          <span className="text-caption text-muted-foreground">
            {rows.length > take
              ? tFallback('userBag.batchMore', 'One after another, then all of them at once. {n} more after.', { n: rows.length - take })
              : tFallback('userBag.batchHint', 'One after another, then all of them at once')}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Label for the sticker sell button.
 *
 * "extra" is a claim that a copy survives the sale. With one in the group
 * there is no extra — selling it empties the slot — so the old fixed
 * "Sell extra" was offering to sell the user's only Diamond as a spare.
 *
 * Keyed on the GROUP size, not on how many are unlisted: owning two where
 * one is already listed still leaves a copy behind, so that one is an extra.
 *
 * Exported for the test; same pattern as MarketFilterBar's applyFilters.
 */
export function sellLabelFor(count, tf = enT) {
  return count > 1
    ? tf('userBag.sellExtra', 'Sell extra')
    : tf('userBag.sell', 'Sell');
}

/**
 * Everything a tab can show: the catalog for that kind, each entry carrying
 * the inventory rows you hold of it. An owned item the catalog does not know
 * (a retired drop) is kept, on its own rarity's shelf, rather than hidden.
 */
function shelfItems(kind, rows) {
  const held = new Map();
  for (const r of rows) {
    // Skip rows with no item_id rather than collapsing them all under one
    // 'undefined' key, which would merge unrelated items.
    if (r?.item_id == null) continue;
    if (!held.has(r.item_id)) held.set(r.item_id, []);
    held.get(r.item_id).push(r);
  }
  const catalog = catalogFor(kind);
  const known = new Set(catalog.map(c => c.id));
  const items = catalog.map(c => ({
    id: c.id, name: c.name, emoji: c.emoji, rarity: c.rarity, rows: held.get(c.id) ?? [],
  }));
  for (const [id, rs] of held) {
    if (known.has(id)) continue;
    items.push({ id, name: rs[0].item_name, emoji: rs[0].item_emoji, rarity: rs[0].item_rarity, rows: rs });
  }
  return items;
}

/** Shelves for a tab: owned first on each, then the missing, with counts. */
function useShelves(items, q) {
  return useMemo(() => {
    const all = shelvesOf(items);
    return all
      .map(s => {
        const owned = s.items.filter(i => i.rows.length > 0);
        const missing = s.items.filter(i => i.rows.length === 0);
        const shown = [...owned, ...missing].filter(i => !q || (i.name || '').toLowerCase().includes(q));
        return { rarity: s.rarity, owned: owned.length, total: s.items.length, items: shown };
      })
      .filter(s => s.items.length > 0);
  }, [items, q]);
}

/** The rarest item you own, for a hero with nothing picked. */
function rarestOwned(items) {
  for (const s of shelvesOf(items.filter(i => i.rows.length > 0))) return s.items[0];
  return null;
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, label, onShop }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
      {Icon && <Icon className="w-10 h-10 text-muted-foreground/50" aria-hidden="true" />}
      <p className="text-muted-foreground text-label">{label}</p>
      {onShop && <ShopLink onShop={onShop} />}
    </div>
  );
}

function ShopLink({ onShop }) {
  const { tFallback } = useLanguage();
  return (
    <button type="button" onClick={onShop} className="min-h-11 px-2 text-label font-semibold text-primary">
      {tFallback('userBag.toCoinShop', 'Go to the coin shop')}
    </button>
  );
}

// ─── Two-tap sell button ──────────────────────────────────────────────────────
// First tap arms, second sells. Disarms on its own after a few seconds so a
// stray return tap cannot land on a primed destructive action.
function ArmedButton({ idle, armedLabel, onConfirm, disabled, className, armedClassName, resetKey, ms = 3000 }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { setArmed(false); }, [resetKey]);
  const onClick = () => {
    if (timer.current) clearTimeout(timer.current);
    if (!armed) {
      haptic('light');
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), ms);
    } else {
      setArmed(false);
      onConfirm();
    }
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={armed ? armedClassName : className}>
      {armed ? armedLabel : idle}
    </button>
  );
}

// ─── Sticker hero ─────────────────────────────────────────────────────────────
function StickerHero({ item, isDefault, onSell, selling, onShop }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const count = item.rows.length;
  const have = count > 0;
  const unlisted = item.rows.filter(r => !r.is_listed);
  // Sell the last-acquired unlisted copy. Any copy may be sold, the last one
  // included ("even if it's really small").
  const row = unlisted[unlisted.length - 1];
  const price = row ? sellPriceFor(row.item_rarity, row.variant) : 0;
  return (
    <motion.div key={item.id} {...HERO_FADE} className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Sticker
          itemId={item.id} emoji={item.emoji} rarity={item.rarity} size={96} shadow dim={!have}
          style={{ transform: 'rotate(-6deg)' }}
        />
        <div className="flex-1 min-w-0">
          {isDefault && <span className="stamp">{tFallback('userBag.rarestYouOwn', 'Rarest you own')}</span>}
          <p className="font-heading font-bold text-title truncate">{item.name}</p>
          <p className="text-label">
            <span className="font-semibold rarity-ink" style={inkStyle(item.rarity)}>{rarityName(tFallback, item.rarity)}</span>
            <span className="text-muted-foreground">
              {' · '}
              {have
                ? tFallback('userBag.youHave', 'You have {n}', { n: count })
                : tFallback('collectionModal.notCollectedYet', 'Not collected yet')}
            </span>
          </p>
        </div>
      </div>
      {have && row && (
        <ArmedButton
          resetKey={item.id}
          disabled={selling}
          onConfirm={() => onSell(row)}
          idle={(
            <span className="inline-flex items-center gap-1.5">
              {sellLabelFor(count, tFallback)}
              <FlexCoinIcon size={16} />
              <span className="tabular-nums">{fmt(price)}</span>
            </span>
          )}
          armedLabel={tFallback('userBag.confirmSell', 'Confirm sale?')}
          className="h-11 rounded-full border text-label font-semibold active:scale-[0.98] transition-transform duration-150"
          armedClassName="h-11 rounded-full bg-destructive text-destructive-foreground text-label font-bold"
        />
      )}
      {have && !row && (
        <p className="text-label text-muted-foreground">{tFallback('userBag.allListed', 'Every copy is listed on the market')}</p>
      )}
      {!have && <ShopLink onShop={onShop} />}
    </motion.div>
  );
}

// ─── Equipped title and frame ─────────────────────────────────────────────────
// One read for both tabs: the previews need the username and avatar, and the
// title preview wears the equipped frame.
function useEquipProfile(userId, enabled) {
  return useQuery({
    queryKey: ['userProfileEquip', userId],
    queryFn: async () => {
      // Resolve userId from the live session if the prop is missing —
      // covers the auth-still-loading edge where user.id hasn't propagated
      // through React context yet but supabase.auth has the session.
      let resolved = userId;
      if (!resolved) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        resolved = authUser?.id;
      }
      if (!resolved) return null;
      const { data, error } = await safeSelect({
        columns: ['equipped_title_id', 'equipped_frame_id', 'avatar_url', 'username'],
        build: (cols) => supabase.from('user_profiles').select(cols).eq('id', resolved).maybeSingle(),
      });
      if (error) {
        console.warn('[UserBag] read equipped items failed:', error);
        return null;
      }
      return data;
    },
    enabled,
    staleTime: 10_000,
  });
}

/**
 * Wear or take off a title or frame. `column` is equipped_title_id or
 * equipped_frame_id.
 *
 * Race-safe: the intent (what the user wants on right now) is held in a ref
 * so two fast taps read the projected state rather than the same stale cache
 * value, and in state so the hero updates before the server answers. ''
 * means "explicitly nothing"; null means no intent. The intent clears once
 * the server agrees, so a change from another device is not masked forever.
 */
function useEquip(column, userId, profile, featureTag) {
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const intentRef = useRef(null);
  const [intent, setIntent] = useState(null);
  const server = profile?.[column] ?? null;
  useEffect(() => {
    if (intentRef.current == null) return;
    if ((intentRef.current === '' && server == null) || intentRef.current === server) {
      intentRef.current = null;
      setIntent(null);
    }
  }, [server]);
  const current = intent == null ? server : (intent || null);

  const equip = async (itemId) => {
    let id = userId;
    if (!id) {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      id = authUser?.id;
    }
    if (!id) {
      toast.error(column === 'equipped_title_id'
        ? tFallback('userBag.signInRequiredToEquip2', 'Sign in required to equip titles')
        : tFallback('userBag.signInRequiredToEquip', 'Sign in required to equip frames'));
      return;
    }
    const projected = intentRef.current == null ? server : (intentRef.current || null);
    const newId = projected === itemId ? null : itemId;
    const prior = intentRef.current;
    intentRef.current = newId == null ? '' : newId;
    setIntent(intentRef.current);
    haptic('light');
    const { error } = await supabase.from('user_profiles').update({ [column]: newId }).eq('id', id);
    if (error) {
      // Revert so the hero does not show a state the server never took.
      intentRef.current = prior;
      setIntent(prior);
      // The toast is generic on purpose: raw error.message leaks Postgres
      // codes and column names. The two diagnosable cases keep their copy.
      reportError(error, { feature: featureTag, level: 'warning', userId: id });
      if (error.code === '42703' || new RegExp(`column.*${column}`, 'i').test(error.message || '')) {
        toast.error(tFallback('userBag.databaseNotMigratedRunMigration', 'Database not migrated. Run migration 019'));
      } else if (error.code === '42501') {
        toast.error(tFallback('userBag.permissionDeniedSignInAgain', 'Permission denied. Sign in again'));
      } else {
        toast.error(tFallback('userBag.saveFailed', 'Could not save. Try again.'));
      }
      return;
    }
    patchProfile({ [column]: newId });
    // No success toast: the hero and the shelf mark are the feedback.
    qc.invalidateQueries({ queryKey: ['userProfileEquip', id] });
    qc.invalidateQueries({ queryKey: ['hubAuthorsList'] });
    qc.invalidateQueries({ queryKey: ['hubProfileLookup'] });
    const type = column === 'equipped_title_id' ? 'title' : 'frame';
    try { window.dispatchEvent(new CustomEvent('flexyn:loot-equipped', { detail: { type, id: newId } })); } catch {}
  };

  return { current, equip };
}

// The button under a title or frame hero.
function WearButton({ have, wearing, onWear, onShop, wearLabel }) {
  const { tFallback } = useLanguage();
  if (!have) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-label text-muted-foreground">{tFallback('collectionModal.notCollectedYet', 'Not collected yet')}</span>
        <ShopLink onShop={onShop} />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onWear}
      className={`h-11 rounded-full text-label font-bold active:scale-[0.98] transition-transform duration-150 ${
        wearing ? 'border text-foreground' : 'bg-primary text-primary-foreground'
      }`}
    >
      {wearing ? tFallback('userBag.takeOff', 'Take off') : wearLabel}
    </button>
  );
}

// ─── Titles: a Hub post header wearing the title you pick ─────────────────────
function TitlesTab({ items, q, userId, profile, fallbackName, onShop }) {
  const { tFallback } = useLanguage();
  const { current, equip } = useEquip('equipped_title_id', userId, profile, 'userBag.equip-title');
  const [picked, setPicked] = useState(null);
  const shelves = useShelves(items, q);
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const shown = byId.get(picked) ?? byId.get(current) ?? rarestOwned(items);
  const name = profile?.username || fallbackName || '';

  return (
    <>
      <div className="sticky top-0 z-10 -mx-5 px-5 pb-4 bg-card border-b">
        {/* The Hub post header, exactly as a post shows it: name on top, the
            title in its rarity colour on the meta row with time and privacy. */}
        <div className="flex items-center gap-3 rounded-lg border bg-background p-3" aria-label={tFallback('userBag.hubPreview', 'How it looks on your posts')}>
          <FramedAvatar frameId={profile?.equipped_frame_id} avatarUrl={profile?.avatar_url} initial={name[0]} size={36} />
          <div className="min-w-0">
            <p className="font-heading font-bold text-sm truncate">{name}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {shown && (
                <>
                  <span className="font-semibold rarity-ink" style={inkStyle(shown.rarity)}>{shown.name}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>{tFallback('sync.justNow', 'just now')}</span>
              <span aria-hidden="true">·</span>
              <Globe2 className="w-3 h-3" aria-hidden="true" />
              <span>{tFallback('hub.privacy.public', 'Public')}</span>
            </p>
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {shown ? (
            <motion.div key={shown.id} {...HERO_FADE} className="pt-4 flex flex-col gap-2">
              <p className="text-label">
                <span className="font-semibold">{shown.name}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="font-semibold rarity-ink" style={inkStyle(shown.rarity)}>{rarityName(tFallback, shown.rarity)}</span>
              </p>
              <WearButton
                have={shown.rows.length > 0}
                wearing={current === shown.id}
                onWear={() => equip(shown.id)}
                onShop={onShop}
                wearLabel={tFallback('userBag.wearIt', 'Wear it')}
              />
            </motion.div>
          ) : (
            <p key="empty" className="pt-4 text-label text-muted-foreground">
              {tFallback('userBag.noTitles', 'No titles yet. Open capsules to earn them.')}
            </p>
          )}
        </AnimatePresence>
      </div>
      <ShelfList shelves={shelves} q={q} emptyMatch={tFallback('userBag.noTitlesMatch', 'No titles match "{q}".', { q })}>
        {(it) => (
          <ShelfTitle
            key={it.id}
            name={it.name}
            rarity={it.rarity}
            have={it.rows.length > 0}
            wearing={current === it.id}
            selected={shown?.id === it.id}
            onSelect={() => setPicked(it.id)}
          />
        )}
      </ShelfList>
    </>
  );
}

// ─── Frames: your avatar wearing the frame you pick ───────────────────────────
function FramesTab({ items, q, userId, profile, fallbackName, onShop }) {
  const { tFallback } = useLanguage();
  const { current, equip } = useEquip('equipped_frame_id', userId, profile, 'userBag.equip-frame');
  const [picked, setPicked] = useState(null);
  const shelves = useShelves(items, q);
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const shown = byId.get(picked) ?? byId.get(current) ?? rarestOwned(items);
  const initial = (profile?.username || fallbackName || '?')[0];

  return (
    <>
      <div className="sticky top-0 z-10 -mx-5 px-5 pb-4 bg-card border-b">
        <AnimatePresence mode="wait" initial={false}>
          {shown ? (
            <motion.div key={shown.id} {...HERO_FADE} className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <FramedAvatar frameId={shown.id} avatarUrl={profile?.avatar_url} initial={initial} size={88} />
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-title truncate">{shown.name}</p>
                  <p className="text-label font-semibold rarity-ink" style={inkStyle(shown.rarity)}>{rarityName(tFallback, shown.rarity)}</p>
                </div>
              </div>
              <WearButton
                have={shown.rows.length > 0}
                wearing={current === shown.id}
                onWear={() => equip(shown.id)}
                onShop={onShop}
                wearLabel={tFallback('userBag.equip', 'Equip')}
              />
            </motion.div>
          ) : (
            <p key="empty" className="text-label text-muted-foreground">
              {tFallback('userBag.noFrames', 'No frames yet. Open capsules to earn them.')}
            </p>
          )}
        </AnimatePresence>
      </div>
      <ShelfList shelves={shelves} q={q} emptyMatch={tFallback('userBag.noFramesMatch', 'No frames match "{q}".', { q })}>
        {(it) => (
          <ShelfFrame
            key={it.id}
            id={it.id}
            name={it.name}
            have={it.rows.length > 0}
            wearing={current === it.id}
            selected={shown?.id === it.id}
            onSelect={() => setPicked(it.id)}
            avatarUrl={profile?.avatar_url}
            initial={initial}
          />
        )}
      </ShelfList>
    </>
  );
}

// The shelves under a hero, or a line saying the search found nothing.
function ShelfList({ shelves, q, emptyMatch, children }) {
  if (q && shelves.length === 0) {
    return <p className="pt-6 text-label text-muted-foreground text-center">{emptyMatch}</p>;
  }
  return (
    <div className="pt-6 flex flex-col gap-6">
      {shelves.map(s => (
        <Shelf key={s.rarity} rarity={s.rarity} owned={s.owned} total={s.total}>
          {s.items.map(children)}
        </Shelf>
      ))}
    </div>
  );
}

// ─── Theme card ───────────────────────────────────────────────────────────────
// Themes are off; this tab only appears for someone who already owns one,
// because making owned items disappear reads as losing them.
function ThemeCard({ item, activeLootThemeId, onApply }) {
  const { tFallback } = useLanguage();
  const lootTheme = getLootThemeById(item.item_id);
  const isActive  = activeLootThemeId === item.item_id;

  return (
    <RarityFrame
      rarity={item.item_rarity}
      active={isActive}
      className={`flex flex-col items-center p-3 gap-2 text-center ${TILE.item}`}
    >
      {lootTheme?.preview && (
        <div className="flex gap-1.5 justify-center mb-0.5">
          {lootTheme.preview.map((hex, i) => (
            <div key={i} className="w-5 h-5 rounded-full ring-1 ring-white/20" style={{ backgroundColor: hex }} />
          ))}
        </div>
      )}
      <span className="text-4xl leading-none">{item.item_emoji}</span>
      <span className="text-xs font-semibold leading-tight line-clamp-2">{item.item_name}</span>
      <RarityBadge rarity={item.item_rarity} />
      <button
        onClick={() => onApply(item.item_id)}
        disabled={!THEMES_ENABLED}
        className={[
          'mt-1 w-full py-1.5 rounded-lg text-xs font-bold transition-all duration-200',
          !THEMES_ENABLED
            ? 'bg-secondary text-muted-foreground border border-border cursor-default'
            : isActive
              ? 'bg-primary/25 text-primary border border-primary/50'
              : 'bg-primary text-primary-foreground hover:opacity-90',
        ].join(' ')}
      >
        {!THEMES_ENABLED
          ? tFallback('levelBar.comingSoon', 'Coming Soon')
          : isActive
            ? tFallback('userBag.themeActive', '✓ Active')
            : tFallback('userBag.themeApply', 'Apply')}
      </button>
    </RarityFrame>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function UserBag({ open, onClose, onOpenCapsule, onOpenCapsuleBatch, initialTab = 'capsules' }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const { user } = useAuth();
  const { lootThemeId, setLootThemeId } = useTheme();
  const qc = useQueryClient();
  const fmt = useNumberFormatter();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [selling, setSelling] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [pickedSticker, setPickedSticker] = useState(null);
  const [pickedTier, setPickedTier] = useState(null);

  // Open on the tab the caller asked for, and reset everything on close —
  // otherwise the next user (account switch on a shared device) opens to the
  // prior session's tab, query and selection.
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab || 'capsules');
    } else {
      setQuery('');
      setSearchOpen(false);
      setPickedSticker(null);
      setPickedTier(null);
    }
  }, [open, initialTab]);

  // Preserve scroll position per tab so switching away and back does not
  // snap to the top. Reset on close, same as the tab and query.
  const scrollRef = useRef(null);
  const tabScrollMemoryRef = useRef({});
  useEffect(() => {
    if (!open) {
      tabScrollMemoryRef.current = {};
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const saved = tabScrollMemoryRef.current[activeTab];
    el.scrollTop = typeof saved === 'number' ? saved : 0;
  }, [open, activeTab]);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    tabScrollMemoryRef.current[activeTab] = el.scrollTop;
  }, [activeTab]);

  const handleApplyTheme = useCallback((itemId) => {
    // Tap again to deactivate. No toast: the global theme visibly changes.
    setLootThemeId(lootThemeId === itemId ? null : itemId);
  }, [lootThemeId, setLootThemeId]);

  // Capsules live in user_capsules (separate from inventory)
  const { data: capsuleRows = [], isLoading: capsLoading, error: capsError } = useQuery({
    queryKey: ['userCapsules', user?.email],
    queryFn:  () => capsules.listUnopenedCapsules(user.email),
    enabled:  !!user?.email && open,
    staleTime: 15_000,
  });

  // Stickers, titles, frames and themes live in user_inventory
  const { data: inventoryItems = [], isLoading: invLoading, error: invError } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn:  () => inventory.listItems(user.email),
    enabled:  !!user?.email && open,
    staleTime: 30_000,
  });

  const { data: equipProfile } = useEquipProfile(user?.id, open && (activeTab === 'titles' || activeTab === 'frames'));

  // Surface fetch failures so a regression doesn't silently leave the bag
  // stuck on an empty state.
  useEffect(() => {
    if (capsError) reportError(capsError, { feature: 'userBag.capsules', level: 'warning', userEmail: user?.email });
  }, [capsError, user?.email]);
  useEffect(() => {
    if (invError) reportError(invError, { feature: 'userBag.inventory', level: 'warning', userEmail: user?.email });
  }, [invError, user?.email]);

  const byType = useMemo(() => {
    const out = { sticker: [], title: [], frame: [], theme: [] };
    for (const r of inventoryItems) if (out[r.item_type]) out[r.item_type].push(r);
    return out;
  }, [inventoryItems]);
  const stickerItems = useMemo(() => shelfItems('stickers', byType.sticker), [byType.sticker]);
  const titleItems   = useMemo(() => shelfItems('titles', byType.title), [byType.title]);
  const frameItems   = useMemo(() => shelfItems('frames', byType.frame), [byType.frame]);
  const themes = byType.theme;
  const isLoading = capsLoading || invLoading;

  const q = query.trim().toLowerCase();
  const stickerShelves = useShelves(stickerItems, q);

  // ── Coin balance ────────────────────────────────────────────────────────────
  // NOT `user.flex_coins` alone. That is AuthContext's bootstrap snapshot and
  // nothing a sale does re-renders it, so the header kept the pre-sale number
  // after every sale (audit 2026-09-30). This reads the same ['flexCoins', id]
  // query the Market and Capsules pages use, and each sale writes the balance
  // the sell_inventory_item RPC RETURNED into it. Never a client sum: 264's
  // ledger trigger can clamp a credit, so only the server knows what landed.
  // Falls back to the snapshot while the query loads, never to 0.
  const { data: liveCoins } = useQuery({
    queryKey: ['flexCoins', user?.id],
    queryFn:  () => getFlexCoins(user.id),
    enabled:  !!user?.id && open,
    staleTime: 15_000,
  });
  const flexCoins = Number(liveCoins ?? user?.flex_coins ?? 0);

  // Apply a balance the server returned, then refetch to be sure. inventory.
  // sellItem has already patched the profile cache with the same value.
  const applyServerBalance = useCallback((newBalance) => {
    if (!user?.id) return;
    if (typeof newBalance === 'number' && Number.isFinite(newBalance)) {
      qc.setQueryData(['flexCoins', user.id], newBalance);
    }
    qc.invalidateQueries({ queryKey: ['flexCoins', user.id] });
  }, [qc, user?.id]);

  // ── Sell one copy ───────────────────────────────────────────────────────────
  const handleSell = useCallback(async (inventoryRow) => {
    if (!user?.id) { toast.error(tFallback('userBag.notSigned', 'Not signed in')); return; }
    setSelling(true);
    try {
      // The server prices the sale and reports what it actually credited,
      // so the toast shows that number rather than the one on the button.
      const { coins, newBalance } = await inventory.sellItem(inventoryRow.id);
      applyServerBalance(newBalance);
      haptic('success');
      qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
      qc.invalidateQueries({ queryKey: ['userProfile', user.email] });
      toast.success(tFallback('userBag.soldOne', 'Sold {item} for {coins} coins.', { item: inventoryRow.item_name, coins }));
    } catch (err) {
      if (err?.code === 'COIN_CAP') {
        toast.error(tFallback('userBag.sellCapped', "You've hit today's coin limit. Your item is still in your bag."));
      } else {
        console.error('[UserBag] sell failed:', err);
        toast.error(tFallback('userBag.sellFailed', 'Could not sell item. Try again.'));
      }
    } finally {
      setSelling(false);
    }
  }, [user?.id, user?.email, qc, tFallback, applyServerBalance]);

  // ── Sell every extra at once ────────────────────────────────────────────────
  // Every copy BEYOND THE FIRST of each sticker; never the last one, so the
  // collection itself is never dented by a bulk action.
  const duplicateSales = useMemo(() => stickerItems.flatMap(it => {
    const unlisted = it.rows.filter(i => !i.is_listed);
    const extras = unlisted.slice(0, Math.max(0, unlisted.length - 1)); // keep one
    return extras.map(row => ({ row, price: sellPriceFor(row.item_rarity, row.variant) }));
  }), [stickerItems]);
  const duplicateTotal = duplicateSales.reduce((n, d) => n + d.price, 0);

  const handleSellAllDuplicates = useCallback(async () => {
    if (!user?.id || duplicateSales.length === 0) return;
    setSelling(true);
    let sold = 0;
    let earned = 0;
    let capped = false;
    let lastBalance = null;
    // Sequential on purpose: each sale credits coins, and the daily mint cap
    // is checked per sale. Stop at the cap instead of burning through the
    // rest, every one of which the server would refuse anyway.
    for (const { row } of duplicateSales) {
      try {
        const { coins, newBalance } = await inventory.sellItem(row.id);
        if (typeof newBalance === 'number') lastBalance = newBalance;
        sold += 1;
        earned += coins;
      } catch (err) {
        if (err?.code === 'COIN_CAP') { capped = true; break; }
        console.warn('[UserBag] bulk sell failed for', row.id, err?.message);
      }
    }
    applyServerBalance(lastBalance);
    qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
    qc.invalidateQueries({ queryKey: ['userProfile', user.email] });
    setSelling(false);
    if (sold > 0) {
      haptic('success');
      toast.success(sold === 1
        ? tFallback('userBag.soldDupOne', 'Sold 1 duplicate for {coins} coins.', { coins: earned })
        : tFallback('userBag.soldDupMany', 'Sold {n} duplicates for {coins} coins.', { n: sold, coins: earned }));
    }
    if (capped) {
      toast.error(tFallback('userBag.sellCapped', "You've hit today's coin limit. Your item is still in your bag."));
    } else if (sold < duplicateSales.length) {
      toast.error(tFallback('userBag.someUnsold', '{n} could not be sold. Try again.', { n: duplicateSales.length - sold }));
    }
  }, [user?.id, user?.email, duplicateSales, qc, tFallback, applyServerBalance]);

  // ── Capsules by tier ────────────────────────────────────────────────────────
  const capsulesByTier = useMemo(() => {
    const out = {};
    for (const row of capsuleRows) {
      const t = CAPSULE_META[row.capsule_type] ? row.capsule_type : 'standard';
      (out[t] ||= []).push(row);
    }
    return out;
  }, [capsuleRows]);
  const heldTiers = TIERS.filter(t => capsulesByTier[t]?.length);
  const tier = heldTiers.includes(pickedTier) ? pickedTier : heldTiers[0];

  const openShop = () => setShopOpen(true);

  const TABS = [
    { id: 'capsules', label: tFallback('collectionModal.tab.capsules', 'Capsules'), count: capsuleRows.length },
    { id: 'stickers', label: tFallback('collectionModal.tab.stickers', 'Stickers'), count: stickerItems.filter(i => i.rows.length).length },
    { id: 'titles',   label: tFallback('collectionModal.tab.titles', 'Titles'),     count: titleItems.filter(i => i.rows.length).length },
    { id: 'frames',   label: tFallback('collectionModal.tab.frames', 'Frames'),     count: frameItems.filter(i => i.rows.length).length },
    ...(themes.length > 0 ? [{ id: 'themes', label: tFallback('collectionModal.tab.themes', 'Themes'), count: themes.length }] : []),
  ];
  // Capsules carry no names worth searching, and themes are a short grid.
  const canSearch = activeTab === 'stickers' || activeTab === 'titles' || activeTab === 'frames';

  if (!open) return null;

  const pickedStickerItem = stickerItems.find(i => i.id === pickedSticker);
  const heroSticker = pickedStickerItem ?? rarestOwned(stickerItems);

  return (
    <>
    {/* CoinShopModal sits OUTSIDE this AnimatePresence: every direct child of
        AnimatePresence must be keyed, and the shop owns its own transition. */}
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
        <motion.div
          className="absolute inset-0 bg-black/55"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={tFallback('userBag.title', 'My bag')}
          className="relative z-10 bg-card border shadow-md w-full max-w-lg rounded-t-2xl sm:rounded-2xl h-[88vh] sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
        >
          {/* Header: the title, your coins (which open the shop), search, close. */}
          <header className="flex items-center gap-1 ps-5 pe-2 pt-4">
            <h2 className="flex-1 font-heading font-bold text-title">{tFallback('userBag.title', 'My bag')}</h2>
            <button
              type="button"
              onClick={openShop}
              aria-label={tFallback('userBag.openCoinShop', 'Open Coin Shop')}
              className="min-h-11 px-2 inline-flex items-center gap-1.5 text-label font-semibold tabular-nums"
            >
              <FlexCoinIcon size={18} />
              <span>{fmt(flexCoins)}</span>
            </button>
            {canSearch && (
              <button
                type="button"
                onClick={() => { setSearchOpen(v => !v); if (searchOpen) setQuery(''); }}
                aria-label={tFallback('userBag.searchYourBag', 'Search your bag')}
                aria-pressed={searchOpen}
                className={`w-11 h-11 inline-flex items-center justify-center rounded-full ${searchOpen ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                <Search className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={tFallback('userBag.closeBag', 'Close bag')}
              className="w-11 h-11 inline-flex items-center justify-center rounded-full text-muted-foreground"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </header>

          {/* Tabs: words and counts, an underline for the one you are on. */}
          <nav className="px-5 pt-2 flex gap-5 border-b overflow-x-auto">
            {TABS.map(tab => {
              const on = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={on}
                  className={`shrink-0 pb-2.5 -mb-px border-b-2 text-label font-semibold transition-colors ${
                    on ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
                  }`}
                >
                  {tab.label} <span className="tabular-nums font-normal text-muted-foreground">{tab.count}</span>
                </button>
              );
            })}
          </nav>

          {canSearch && searchOpen && (
            <div className="px-5 pt-3">
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tFallback('userBag.searchYourBag2', 'Search your bag…')}
                aria-label={tFallback('userBag.searchYourBag', 'Search your bag')}
                className="w-full h-11 bg-background border rounded-lg px-3 text-body placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
            </div>
          )}

          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-5 pt-4"
            style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            ) : activeTab === 'capsules' ? (
              tier ? (
                <div className="flex flex-col">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={tier} {...HERO_FADE}>
                      <CapsuleCard
                        capsuleRow={capsulesByTier[tier][0]}
                        rows={capsulesByTier[tier]}
                        onOpenCapsule={onOpenCapsule}
                        onOpenCapsuleBatch={onOpenCapsuleBatch}
                      />
                    </motion.div>
                  </AnimatePresence>
                  {heldTiers.length > 1 && (
                    <div className="mt-6 pt-4 border-t flex justify-center gap-6">
                      {heldTiers.map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => { haptic('light'); setPickedTier(t); }}
                          aria-pressed={t === tier}
                          className={`flex flex-col items-center gap-1 transition-opacity duration-150 ${t === tier ? '' : 'opacity-55'}`}
                        >
                          <CapsuleCanister tier={t} height={56} />
                          <span className="text-caption font-semibold tabular-nums">
                            {tierName(tFallback, t)} ×{capsulesByTier[t].length}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center pt-4 gap-2 text-center">
                  <CapsuleCanister tier="standard" height={120} style={{ opacity: 0.4 }} />
                  <p className="pt-2 text-label text-muted-foreground">
                    {tFallback('userBag.noCapsules', 'No capsules yet. Level up to earn them.')}
                  </p>
                  <ShopLink onShop={openShop} />
                </div>
              )
            ) : activeTab === 'stickers' ? (
              <>
                <div className="sticky top-0 z-10 -mx-5 px-5 pb-4 bg-card border-b">
                  <AnimatePresence mode="wait" initial={false}>
                    {heroSticker ? (
                      <StickerHero
                        key={heroSticker.id}
                        item={heroSticker}
                        isDefault={!pickedStickerItem}
                        onSell={handleSell}
                        selling={selling}
                        onShop={openShop}
                      />
                    ) : (
                      <EmptyState key="empty" icon={Package} label={tFallback('userBag.noStickers', 'No stickers yet. Open a capsule.')} onShop={openShop} />
                    )}
                  </AnimatePresence>
                  {duplicateSales.length > 0 && (
                    <ArmedButton
                      ms={4000}
                      disabled={selling}
                      onConfirm={handleSellAllDuplicates}
                      idle={selling
                        ? tFallback('userBag.selling', 'Selling…')
                        : tFallback('userBag.sellExtras', 'Sell {n} extras for {total} coins', { n: duplicateSales.length, total: fmt(duplicateTotal) })}
                      armedLabel={tFallback('userBag.confirmSellExtras', 'Tap again to sell {n} extras', { n: duplicateSales.length })}
                      className="mt-2 w-full min-h-11 text-label font-semibold text-primary"
                      armedClassName="mt-2 w-full min-h-11 text-label font-bold text-destructive"
                    />
                  )}
                </div>
                <ShelfList
                  shelves={stickerShelves}
                  q={q}
                  emptyMatch={tFallback('userBag.noStickersMatch', 'No stickers match "{q}".', { q: query })}
                >
                  {(it) => (
                    <ShelfSticker
                      key={it.id}
                      id={it.id}
                      emoji={it.emoji}
                      rarity={it.rarity}
                      name={it.name}
                      have={it.rows.length > 0}
                      count={it.rows.length}
                      selected={heroSticker?.id === it.id}
                      onSelect={() => setPickedSticker(it.id)}
                    />
                  )}
                </ShelfList>
              </>
            ) : activeTab === 'titles' ? (
              <TitlesTab items={titleItems} q={q} userId={user?.id} profile={equipProfile} fallbackName={user?.username} onShop={openShop} />
            ) : activeTab === 'frames' ? (
              <FramesTab items={frameItems} q={q} userId={user?.id} profile={equipProfile} fallbackName={user?.username} onShop={openShop} />
            ) : (
              themes.length === 0 ? (
                <EmptyState icon={Palette} label={tFallback('userBag.themesSoon', 'Themes are coming soon.')} />
              ) : (
                <div className={TILE.row}>
                  {themes.map(item => (
                    <ThemeCard key={item.id} item={item} activeLootThemeId={lootThemeId} onApply={handleApplyTheme} />
                  ))}
                </div>
              )
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>

    <CoinShopModal open={shopOpen} onClose={() => setShopOpen(false)} />
    </>
  );
}
