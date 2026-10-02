// src/components/hub/UserBag.jsx
// Inventory bag modal — Capsules | Stickers | Titles | Frames | Themes tabs.
// Capsules come from user_capsules; everything else from user_inventory.
// Stickers are grouped by item_id so duplicates are visible and sellable.
// Titles / Frames update equipped_title_id / equipped_frame_id on user_profiles.

// useRef serves two needs: the per-tab equip-intent guard in
// TitleList / FrameList (origin/main fix — was `React.useRef` without
// the React import, which blanked the Titles / Frames tabs), and the
// sell-confirm disarm timer cleanup in StickerGroupCard (needs
// useEffect too).
import { lazy, Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Package, Sticker, Palette, ShoppingBag, Store, Crown, Square, Search, LibraryBig } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { supabase } from '@/api/supabaseClient';
import { patchProfile } from '@/api/profileCache';
import { safeSelect } from '@/api/safeSelect';
import * as inventory from '@/lib/data/inventory';
import * as capsules  from '@/lib/data/capsules';
import { getFlexCoins } from '@/lib/data/coinShop';
import { ITEMS, VARIANTS, CAPSULE_GLYPH } from '@/lib/lootCatalog';
import { RarityBadge, RarityFrame, rarityTint, COIN } from '@/components/loot/RarityVisuals';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import AnimatedNumber from '@/components/AnimatedNumber';
import CapsuleIcon from '@/components/loot/CapsuleIcon';
import { getLootThemeById } from '@/lib/lootThemes';
import { getLootFrameById } from '@/lib/lootFrames';
import { THEMES_ENABLED } from '@/lib/featureFlags';
import StickerDisplay from './StickerDisplay';
import { reportError } from '@/lib/reportError';
import CoinShopModal from './CoinShopModal';
import { useNumberFormatter } from '@/lib/intl';
import { tileRow } from '@/lib/tileRows';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';
import { sellPriceFor } from '@/lib/sellPrice';
import { enT } from '@/lib/translatorArg';

// Lazy — the Collection pulls in every catalog (themes alone is ~800
// lines) and only mounts on an explicit tap.
const CollectionModal = lazy(() => import('@/components/loot/CollectionModal'));

// Sell price is half the hidden base value, rounded down. Shared with the
// capsule reveal through src/lib/sellPrice.js; the server prices the sale.

// Map capsule_type string → display metadata.
//
// The catalog ids are cap_standard / cap_premium / cap_elite — the
// lookups here said capsule_* and so had ALWAYS fallen through to the
// literals below. Corrected rather than deleted: the catalog carries the
// description the opener shows. The glyph is only a text fallback now;
// the visible icon is <CapsuleIcon>, which draws the sphere.
const CAPSULE_META = {
  standard: ITEMS.find(i => i.id === 'cap_standard') ?? { name: 'Standard Capsule', emoji: CAPSULE_GLYPH.standard, rarity: 'common'   },
  premium:  ITEMS.find(i => i.id === 'cap_premium')  ?? { name: 'Premium Capsule',  emoji: CAPSULE_GLYPH.premium,  rarity: 'uncommon' },
  elite:    ITEMS.find(i => i.id === 'cap_elite')    ?? { name: 'Elite Capsule',    emoji: CAPSULE_GLYPH.elite,    rarity: 'epic'     },
};

// The rarity chip / rarity-tinted card shell now come from the shared
// loot primitives so the Bag, the Marketplace and the Capsule Opener can't
// drift apart again.

// An inventory count is arbitrary by nature, so a partial last row was the
// common case in every one of these — see src/lib/tileRows.js for what a grid
// did with one and why they all wrap and centre now.
const TILE  = tileRow({ gap: 3, cols: 3, smCols: 4 }); // capsules, stickers, themes
const FRAME = tileRow({ gap: 3, cols: 2, smCols: 3 }); // frames — bigger avatar
// Titles are list ROWS, not tiles: one per row on a phone, so centring is a
// no-op there and the left reading edge is untouched. It only takes effect
// from sm, where an odd count used to leave the last row in the left column.
const TITLE = tileRow({ gap: 2, cols: 1, smCols: 2 });

// ─── Capsule card ─────────────────────────────────────────────────────────────
// Exported for the regression test only — nothing else imports it, and the
// default export stays the component this module is about. It is exported
// rather than tested through <UserBag> because reaching this button that way
// means standing up auth, the query client and two live Supabase reads, none
// of which are the thing under test: what this card hands the opener.
export function CapsuleCard({ capsuleRow, onOpenCapsule }) {
  const { tFallback } = useLanguage();
  const meta = CAPSULE_META[capsuleRow.capsule_type] ?? CAPSULE_META.standard;
  return (
    <RarityFrame
      rarity={meta.rarity}
      as={motion.div}
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex flex-col items-center p-3 gap-2 text-center ${TILE.item}`}
    >
      <CapsuleIcon type={capsuleRow.capsule_type || 'standard'} size={56} />
      <span className="text-xs font-semibold leading-tight">{meta.name}</span>
      <RarityBadge rarity={meta.rarity} />
      <button
        // meta FIRST, row LAST. meta is a loot_catalog entry and carries its
        // own `id` ('cap_premium'), so spreading it second overwrote the
        // capsule row's UUID — the opener then sent 'cap_premium' to
        // open_capsule_atomic and Postgres answered `invalid input syntax
        // for type uuid`. Every capsule opened from a single card failed;
        // the batch button passes raw rows, which is why "open all" worked
        // and a lone capsule did not.
        onClick={() => onOpenCapsule?.({ ...meta, ...capsuleRow })}
        className="mt-1 w-full py-1.5 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
      >
        {tFallback("onboarding.invite_friend.cta", "Open")}
      </button>
    </RarityFrame>
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

// ─── Sticker group card (shows duplicates + sell button) ──────────────────────
function StickerGroupCard({ group, onSell, selling }) {
  const { tFallback } = useLanguage();
  // `group` is an array of inventory rows for the same item_id.
  // We use group[0] for display info, count for badge.
  const item   = group[0];
  const count  = group.length;
  const price  = sellPriceFor(item.item_rarity, item.variant);

  // Unlisted items are the ones available to sell.
  const unlisted = group.filter(i => !i.is_listed);
  // Any unlisted copy is sellable — including the last one. (Previously
  // we forced keeping one copy; per product the user can sell ANY item,
  // "even if it's really small.")
  const canSell  = unlisted.length >= 1;
  const sellLabel = sellLabelFor(count, tFallback);

  // Two-step confirm: first click arms the button, second executes.
  const [armed, setArmed] = useState(false);
  const disarmTimerRef = useRef(null);

  // Audit B-21 — clear any pending disarm on unmount so the bag-modal
  // close mid-armed doesn't fire setState on an unmounted card.
  useEffect(() => () => {
    if (disarmTimerRef.current) clearTimeout(disarmTimerRef.current);
  }, []);

  const handleSellClick = useCallback(() => {
    if (!armed) {
      setArmed(true);
      if (disarmTimerRef.current) clearTimeout(disarmTimerRef.current);
      disarmTimerRef.current = setTimeout(() => setArmed(false), 3000);
    } else {
      if (disarmTimerRef.current) clearTimeout(disarmTimerRef.current);
      setArmed(false);
      onSell(unlisted[unlisted.length - 1], price); // sell the last-acquired copy
    }
  }, [armed, unlisted, price, onSell]);

  return (
    <RarityFrame
      rarity={item.item_rarity}
      as={motion.div}
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex flex-col items-center p-3 gap-2 text-center ${TILE.item}`}
    >
      {/* Duplicate count badge */}
      {count > 1 && (
        <span className="absolute top-2 end-2 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-micro font-bold flex items-center justify-center">
          ×{count}
        </span>
      )}

      <StickerDisplay emoji={item.item_emoji} variant={item.variant} size={52} />
      {item.variant && (
        <span
          className="text-micro font-bold"
          style={{ color: VARIANTS[item.variant]?.color ?? 'hsl(var(--foreground))' }}
        >
          {VARIANTS[item.variant]?.badge}
        </span>
      )}
      <span className="text-xs font-semibold leading-tight line-clamp-2">{item.item_name}</span>
      <RarityBadge rarity={item.item_rarity} />

      {/* Sell duplicate button */}
      {canSell ? (
        <button
          onClick={handleSellClick}
          disabled={selling}
          className={[
            'mt-1 w-full py-1.5 rounded-lg text-xs font-bold transition-all duration-200',
            armed
              ? 'bg-destructive/80 text-white border border-destructive scale-105'
              : 'bg-primary/15 text-primary dark:text-primary border border-primary/30 hover:bg-primary/25 active:bg-primary/25',
          ].join(' ')}
        >
          {armed ? (
            tFallback('userBag.confirmSell', 'Confirm sale?')
          ) : (
            <span className="flex items-center justify-center gap-1">
              {sellLabel} · {COIN} {price}
            </span>
          )}
        </button>
      ) : (
        <span className="text-muted-foreground text-micro font-medium mt-1">{tFallback("userBag.inBag", "In Bag")}</span>
      )}
    </RarityFrame>
  );
}

// ─── Theme card ───────────────────────────────────────────────────────────────
function ThemeCard({ item, activeLootThemeId, onApply }) {
  const { tFallback } = useLanguage();
  const lootTheme = getLootThemeById(item.item_id);
  const isActive  = activeLootThemeId === item.item_id;

  return (
    <RarityFrame
      rarity={item.item_rarity}
      as={motion.div}
      active={isActive}
      // NOTE: no `layout` prop — framer-motion's layout animation shifts
      // sibling cards' positions when one becomes active, which lands stray
      // taps on the wrong card. The active border highlight is enough
      // feedback without animating the entire grid.
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex flex-col items-center p-3 gap-2 text-center ${TILE.item} ${isActive ? 'shadow-lg shadow-primary/20' : ''}`}
    >
      {/* Preview swatches */}
      {lootTheme?.preview && (
        <div className="flex gap-1.5 justify-center mb-0.5">
          {lootTheme.preview.map((hex, i) => (
            <div key={i} className="w-5 h-5 rounded-full ring-1 ring-white/20"
              style={{ backgroundColor: hex }} />
          ))}
        </div>
      )}
      <span className="text-4xl leading-none">{item.item_emoji}</span>
      <span className="text-xs font-semibold leading-tight line-clamp-2">{item.item_name}</span>
      <RarityBadge rarity={item.item_rarity} />
      {lootTheme?.animated && (
        <span className="text-micro font-bold px-1.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 uppercase tracking-wider">
          {tFallback("userBag.animated", "Animated")}
        </span>
      )}
      {/* Themes are off (src/lib/featureFlags.js) — a theme you already own
          stays visible in the Bag, because making owned items disappear
          reads as losing them. It just can't be equipped right now. */}
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

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, label }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <Icon className="w-10 h-10 text-muted-foreground/50" />
      <p className="text-muted-foreground text-sm">{label}</p>
    </div>
  );
}

// ─── Title equip list ─────────────────────────────────────────────────────────

function TitleList({ items, userId }) {
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const { data: profile } = useQuery({
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
      const { data, error } = await supabase
        .from('user_profiles')
        .select('equipped_title_id')
        .eq('id', resolved)
        .maybeSingle();
      if (error) {
        console.warn('[TitleList] read equipped_title_id failed:', error);
        return null;
      }
      return data;
    },
    staleTime: 10_000,
  });
  // Race-safe equippedId: a useRef holds the "intent" — what the user wants
  // equipped right now, regardless of whether the query cache has caught up.
  // Without this, two fast taps on the same title (toggle off) could read
  // the same pre-invalidate equippedId of `null` and re-equip the title
  // instead of clearing it.
  const intentRef = useRef(null);
  // Clear the intent ref once the query has caught up — leaving it
  // pinned forever caused a flicker when the server value moved
  // independently (e.g. another device cleared the title; this device
  // kept showing the local intent). Empty sentinel '' = explicitly
  // unequipped; null = no intent expressed yet.
  useEffect(() => {
    if (intentRef.current == null) return;
    const intentMatchesServer =
      (intentRef.current === '' && (profile?.equipped_title_id == null))
      || intentRef.current === profile?.equipped_title_id;
    if (intentMatchesServer) intentRef.current = null;
  }, [profile?.equipped_title_id]);
  const equippedId = intentRef.current ?? profile?.equipped_title_id;

  const equip = async (titleId) => {
    let id = userId;
    if (!id) {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      id = authUser?.id;
    }
    if (!id) {
      toast.error(tFallback("userBag.signInRequiredToEquip2", "Sign in required to equip titles"));
      return;
    }
    const newId = equippedId === titleId ? null : titleId;
    // Record intent immediately so a follow-up tap sees the projected state.
    // Sentinel '' = unequipped (so it isn't confused with "unknown" null).
    const priorIntent = intentRef.current;
    intentRef.current = newId == null ? '' : newId;
    const { error } = await supabase
      .from('user_profiles')
      .update({ equipped_title_id: newId })
      .eq('id', id);
    if (!error) patchProfile({ equipped_title_id: newId });
    if (error) {
      // Revert intent on failure so the UI doesn't show the wrong
      // equipped state forever while the server still has the old value.
      intentRef.current = priorIntent;
      // Route to Sentry with full detail (feature tag + error). The user
      // toast is intentionally generic — surfacing raw error.message
      // leaks Postgres error codes / column names / RLS hints that aid
      // attackers mapping the schema. The two diagnosable cases keep
      // their actionable copy.
      reportError(error, { feature: 'userBag.equip-title', level: 'warning', userId: id });
      if (error.code === '42703' || /column.*equipped_title_id/i.test(error.message || '')) {
        toast.error(tFallback("userBag.databaseNotMigratedRunMigration", "Database not migrated. Run migration 019"));
      } else if (error.code === '42501') {
        toast.error(tFallback("userBag.permissionDeniedSignInAgain", "Permission denied. Sign in again"));
      } else {
        toast.error(tFallback('userBag.saveFailed', 'Could not save. Try again.'));
      }
      return;
    }
    // No success toast — the "Equipped" pill on the card itself is the feedback.
    // Stacking toasts on every tap was blocking the next button click.
    qc.invalidateQueries({ queryKey: ['userProfileEquip', id] });
    qc.invalidateQueries({ queryKey: ['hubAuthorsList'] });
    qc.invalidateQueries({ queryKey: ['hubProfileLookup'] });
    try { window.dispatchEvent(new CustomEvent('flexyn:loot-equipped', { detail: { type: 'title', id: newId } })); } catch {}
  };

  // Dedupe by item_id (multiple drops of the same title)
  const seen = new Set();
  const unique = items.filter(i => {
    if (seen.has(i.item_id)) return false;
    seen.add(i.item_id);
    return true;
  });

  return (
    <div className={TITLE.row}>
      {unique.map(item => {
        const isEquipped = equippedId === item.item_id;
        const tint = rarityTint(item.item_rarity);
        return (
          <button
            key={item.id}
            onClick={() => equip(item.item_id)}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors text-start ${TITLE.item} ${
              isEquipped ? 'border-primary bg-primary/10' : 'border-border bg-secondary/50 hover:bg-secondary active:bg-secondary'
            }`}
          >
            <span className="text-2xl shrink-0">{item.item_emoji || '🏷️'}</span>
            <div className="flex-1 min-w-0">
              <p className="font-heading font-bold text-sm">{item.item_name}</p>
              <p className="text-micro uppercase tracking-wider" style={{ color: tint.color }}>{item.item_rarity}</p>
            </div>
            <span className="text-micro font-bold uppercase tracking-wider text-primary shrink-0">
              {isEquipped ? tFallback('userBag.equipped', 'Equipped') : tFallback('userBag.equip', 'Equip')}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Frame equip list ─────────────────────────────────────────────────────────

function FrameList({ items, userId }) {
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ['userProfileEquipFrame', userId],
    queryFn: async () => {
      let resolved = userId;
      if (!resolved) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        resolved = authUser?.id;
      }
      if (!resolved) return null;
      const { data, error } = await safeSelect({
        columns: ['equipped_frame_id', 'avatar_url', 'username'],
        build: (cols) => supabase
          .from('user_profiles')
          .select(cols)
          .eq('id', resolved)
          .maybeSingle(),
      });
      if (error) {
        console.warn('[FrameList] read equipped_frame_id failed:', error);
        return null;
      }
      return data;
    },
    staleTime: 10_000,
  });
  // See TitleList for the rationale on the intent ref — prevents a fast
  // double-tap from reading the same pre-invalidate cache and re-equipping
  // a frame that the user was trying to toggle off. Same flicker-clear
  // pattern as TitleList — drop the intent once the server converges.
  const intentRef = useRef(null);
  useEffect(() => {
    if (intentRef.current == null) return;
    const matches =
      (intentRef.current === '' && (profile?.equipped_frame_id == null))
      || intentRef.current === profile?.equipped_frame_id;
    if (matches) intentRef.current = null;
  }, [profile?.equipped_frame_id]);
  const equippedId = intentRef.current ?? profile?.equipped_frame_id;

  const equip = async (frameId) => {
    let id = userId;
    if (!id) {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      id = authUser?.id;
    }
    if (!id) {
      toast.error(tFallback("userBag.signInRequiredToEquip", "Sign in required to equip frames"));
      return;
    }
    const newId = equippedId === frameId ? null : frameId;
    const priorIntent = intentRef.current;
    intentRef.current = newId == null ? '' : newId;
    const { error } = await supabase
      .from('user_profiles')
      .update({ equipped_frame_id: newId })
      .eq('id', id);
    if (!error) patchProfile({ equipped_frame_id: newId });
    if (error) {
      // Revert intent on failure so the UI doesn't drift from the server state.
      intentRef.current = priorIntent;
      // See TitleList equip for the rationale on generic toast + Sentry routing.
      reportError(error, { feature: 'userBag.equip-frame', level: 'warning', userId: id });
      if (error.code === '42703' || /column.*equipped_frame_id/i.test(error.message || '')) {
        toast.error(tFallback("userBag.databaseNotMigratedRunMigration", "Database not migrated. Run migration 019"));
      } else if (error.code === '42501') {
        toast.error(tFallback("userBag.permissionDeniedSignInAgain", "Permission denied. Sign in again"));
      } else {
        toast.error(tFallback('userBag.saveFailed', 'Could not save. Try again.'));
      }
      return;
    }
    // No success toast — the equipped border on the card is the feedback.
    qc.invalidateQueries({ queryKey: ['userProfileEquipFrame', id] });
    qc.invalidateQueries({ queryKey: ['hubAuthorsList'] });
    qc.invalidateQueries({ queryKey: ['hubProfileLookup'] });
    try { window.dispatchEvent(new CustomEvent('flexyn:loot-equipped', { detail: { type: 'frame', id: newId } })); } catch {}
  };

  const seen = new Set();
  const unique = items.filter(i => {
    if (seen.has(i.item_id)) return false;
    seen.add(i.item_id);
    return true;
  });

  return (
    <div className={FRAME.row}>
      {unique.map(item => {
        const isEquipped = equippedId === item.item_id;
        const frameDef = getLootFrameById(item.item_id);
        const tint = rarityTint(item.item_rarity);
        return (
          <button
            key={item.id}
            onClick={() => equip(item.item_id)}
            className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${FRAME.item} ${
              isEquipped ? 'border-primary bg-primary/10' : 'border-border bg-secondary/50 hover:bg-secondary active:bg-secondary'
            }`}
          >
            <div
              className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center overflow-hidden"
              style={frameDef?.css || {}}
            >
              {profile?.avatar_url ? (
                <img loading="lazy" src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="font-heading font-bold text-foreground">
                  {(profile?.username?.[0] || '?').toUpperCase()}
                </span>
              )}
            </div>
            <p className="font-heading font-bold text-xs text-center leading-tight">{item.item_name}</p>
            <p className="text-micro uppercase tracking-wider" style={{ color: tint.color }}>{item.item_rarity}</p>
            <span className="text-micro font-bold uppercase tracking-wider text-primary">
              {isEquipped ? tFallback('userBag.equipped', 'Equipped') : tFallback('userBag.equip', 'Equip')}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function UserBag({ open, onClose, onOpenCapsule, onOpenCapsuleBatch }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const { user } = useAuth();
  const { lootThemeId, setLootThemeId } = useTheme();
  const qc = useQueryClient();
  const fmt = useNumberFormatter();
  const [activeTab, setActiveTab] = useState('capsules');
  const [selling, setSelling] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Reset to the capsules tab when the bag is closed AND reset the
  // search query — otherwise the next user (account switch on a shared
  // device) opens to the prior session's tab + query, which can
  // surface unexpected results if the new account doesn't own that
  // inventory category.
  useEffect(() => {
    if (!open) {
      setActiveTab('capsules');
      setQuery('');
    }
  }, [open]);

  // Preserve scroll position per tab so switching between Capsules
  // and Stickers, then back to Capsules, doesn't snap to the top —
  // a user browsing a long sticker list and tabbing away momentarily
  // expects to return to where they were. Reset on close (same as
  // tab + query) so account switch doesn't restore the prior user's
  // scroll into the new user's content.
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
    if (typeof saved === 'number') {
      el.scrollTop = saved;
    } else {
      el.scrollTop = 0;
    }
  }, [open, activeTab]);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    tabScrollMemoryRef.current[activeTab] = el.scrollTop;
  }, [activeTab]);

  const handleApplyTheme = useCallback((itemId) => {
    if (lootThemeId === itemId) {
      // Tap again to deactivate
      setLootThemeId(null);
    } else {
      setLootThemeId(itemId);
    }
    // No toast — the "✓ Active" pill on the card is the feedback. The
    // global theme also visibly changes immediately, so a toast would just
    // overlay the next button the user wants to tap.
  }, [lootThemeId, setLootThemeId]);

  // Capsules live in user_capsules (separate from inventory)
  const { data: capsuleRows = [], isLoading: capsLoading, error: capsError } = useQuery({
    queryKey: ['userCapsules', user?.email],
    queryFn:  () => capsules.listUnopenedCapsules(user.email),
    enabled:  !!user?.email && open,
    staleTime: 15_000,
  });

  // Stickers and themes live in user_inventory
  const { data: inventoryItems = [], isLoading: invLoading, error: invError } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn:  () => inventory.listItems(user.email),
    enabled:  !!user?.email && open,
    staleTime: 30_000,
  });

  // Surface fetch failures so a regression doesn't silently leave the bag stuck
  // on an empty skeleton — which is what the comment on these queries always
  // claimed, while the `onError` options carrying it had been inert since the
  // react-query v5 upgrade removed them. `reportError` is imported at the top
  // of this file, so the dynamic import these used is gone with them.
  useEffect(() => {
    if (capsError) reportError(capsError, { feature: 'userBag.capsules', level: 'warning', userEmail: user?.email });
  }, [capsError, user?.email]);
  useEffect(() => {
    if (invError) reportError(invError, { feature: 'userBag.inventory', level: 'warning', userEmail: user?.email });
  }, [invError, user?.email]);

  // Group stickers by item_id so duplicates are visible. Skip rows
  // with no item_id rather than collapsing them all under an
  // 'undefined' key — corrupt rows would otherwise merge unrelated
  // stickers into a single visual group.
  const stickers = inventoryItems.filter(i => i.item_type === 'sticker');
  const stickerGroups = Object.values(
    stickers.reduce((acc, item) => {
      const key = item.item_id;
      if (key == null) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {})
  );
  // (duplicateCount was used by the now-removed dupes badge + info bar.
  //  Per-card ×N display does the same job inline without copy noise.)

  const themes     = inventoryItems.filter(i => i.item_type === 'theme');
  const titles     = inventoryItems.filter(i => i.item_type === 'title');
  const frames     = inventoryItems.filter(i => i.item_type === 'frame');
  const isLoading  = capsLoading || invLoading;

  // ── Search filter (My Bag search) ───────────────────────────────────
  // Filters the ACTIVE tab's items by name (capsules by their type label).
  // Empty query → everything. Tab count badges keep showing totals.
  const q = query.trim().toLowerCase();
  const nameMatch = (i) => !q || (i?.item_name || '').toLowerCase().includes(q);
  const fStickerGroups = q ? stickerGroups.filter(g => nameMatch(g[0])) : stickerGroups;
  const fTitles = q ? titles.filter(nameMatch) : titles;
  const fFrames = q ? frames.filter(nameMatch) : frames;
  const fThemes = q ? themes.filter(nameMatch) : themes;
  const fCapsules = q ? capsuleRows.filter(r => (r?.capsule_type || '').toLowerCase().includes(q)) : capsuleRows;

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

  // ── Sell a duplicate ────────────────────────────────────────────────────────
  const handleSell = useCallback(async (inventoryRow) => {
    if (!user?.id) { toast.error(tFallback("userBag.notSigned", "Not signed in")); return; }
    setSelling(true);
    try {
      // The server prices the sale and reports what it actually credited,
      // so the toast shows that number rather than the one on the card.
      const { coins, newBalance } = await inventory.sellItem(inventoryRow.id);
      applyServerBalance(newBalance);
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

  // ── Sell every duplicate at once ────────────────────────────────────────────
  // The per-card flow is arm-then-confirm, two taps per copy. A user
  // sitting on 40 duplicates faced 80 taps to clear them. This sells every
  // copy BEYOND THE FIRST of each sticker — never the last one, so the
  // collection itself is never dented by a bulk action.
  const [bulkArmed, setBulkArmed] = useState(false);
  const bulkDisarmRef = useRef(null);
  useEffect(() => () => {
    if (bulkDisarmRef.current) clearTimeout(bulkDisarmRef.current);
  }, []);
  // Disarm when the bag closes or the user leaves the Stickers tab —
  // otherwise a stray return tap lands on a primed destructive action.
  useEffect(() => {
    if (!open || activeTab !== 'stickers') setBulkArmed(false);
  }, [open, activeTab]);

  const duplicateSales = stickerGroups.flatMap(group => {
    const unlisted = group.filter(i => !i.is_listed);
    const extras = unlisted.slice(0, Math.max(0, unlisted.length - 1)); // keep one
    return extras.map(row => ({
      row,
      price: sellPriceFor(row.item_rarity, row.variant),
    }));
  });
  const duplicateTotal = duplicateSales.reduce((n, d) => n + d.price, 0);

  const handleSellAllDuplicates = useCallback(async () => {
    if (!user?.id || duplicateSales.length === 0) return;
    setBulkArmed(false);
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

  // ── Capsules grouped by type, for the batch-open bars ───────────────────────
  const capsulesByType = fCapsules.reduce((acc, row) => {
    const t = row.capsule_type || 'standard';
    (acc[t] ||= []).push(row);
    return acc;
  }, {});

  // Capsules is the only one of the five with no Collection counterpart, so it
  // is the only new key. The other four resolve to what that screen already
  // says, which is the point.
  const tabLabel = (tab) => tFallback(`collectionModal.tab.${tab.id}`, tab.label);

  const TABS = [
    { id: 'capsules', label: 'Capsules', icon: Package,  count: capsuleRows.length },
    // "Stickers" tab no longer carries a "N dupes" badge — duplicates
    // are already visualized by the per-card ×N count, so labeling the
    // tab with "dupes" was redundant and a bit jargony.
    { id: 'stickers', label: 'Stickers', icon: Sticker, count: stickers.length },
    { id: 'titles',   label: 'Titles',   icon: Crown,    count: titles.length    },
    { id: 'frames',   label: 'Frames',   icon: Square,   count: frames.length    },
    { id: 'themes',   label: 'Themes',   icon: Palette,  count: themes.length    },
  ];

  if (!open) return null;

  return (
    <>
    {/* CoinShopModal / CollectionModal sit OUTSIDE this AnimatePresence.
        AnimatePresence requires every direct child to be keyed; three
        unkeyed siblings produced a stream of "Encountered two children
        with the same key" errors in the console (seen on device). They're
        independent modals that own their own transitions, so they don't
        belong in the bag's presence group at all. */}
    <AnimatePresence>
      {/* Centered modal (was bottom-sheet w/ drag handle). Screenshot
          feedback flagged that the drag handle at the top suggested the
          sheet could expand to fullscreen, but that interaction didn't
          do anything — so they're back to a centered popup with no
          drag affordance. Also dropped the drag-to-dismiss because
          there's no longer a handle to grip. */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop. Two dials here, and the scrim is the one that reads as
            "heavy" — 70% black flattened the marketplace behind the bag into
            a grey slab. Softened to 55% black + 2px blur so the page is still
            legibly there behind the modal without competing with it. */}
        <motion.div
          className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Centered modal — zoom-in entrance, no drag */}
        <motion.div
          className="relative z-10 bg-card border border-border shadow-2xl w-full max-w-2xl rounded-2xl max-h-[90vh] flex flex-col overflow-hidden"
          initial={{ scale: 0.92, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 12 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              <ShoppingBag className="w-5 h-5 text-primary" />
              <h2 className="font-heading font-bold text-lg">{tFallback("profile.myBag", "My Bag")}</h2>
            </div>
            <div className="flex items-center gap-2">
              {/* Collection — the Bag answers "what do I have"; this is the
                  other half of the question. Same surface the Marketplace
                  and the Capsule Opener open. */}
              <button
                onClick={() => setCollectionOpen(true)}
                aria-label={tFallback("userBag.openCollection", "Open Collection")}
                title={tFallback("userBag.collectionEverythingInTheGame", "Collection, everything in the game")}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors"
              >
                <LibraryBig className="w-4.5 h-4.5" aria-hidden="true" />
              </button>
              <button
                onClick={() => setShopOpen(true)}
                aria-label={tFallback("userBag.openCoinShop", "Open Coin Shop")}
                className="flex items-center gap-1.5 bg-primary/15 border border-primary/30 rounded-full px-3 py-1 hover:bg-primary/25 active:bg-primary/25 transition-colors"
              >
                <FlexCoinIcon size={18} />
                <span className="text-primary dark:text-primary font-bold text-sm tabular-nums"><AnimatedNumber roll value={flexCoins} format={fmt} /></span>
                <Store className="w-3.5 h-3.5 text-primary/80 dark:text-primary/80 ms-0.5" />
              </button>
              <button
                onClick={onClose}
                aria-label={tFallback("userBag.closeBag", "Close bag")}
                className="text-muted-foreground hover:text-foreground active:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary active:bg-secondary"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Tabs — 5 equal slices, stacked icon-over-label so even narrow
              phones fit all of them without horizontal scroll. The tab row
              uses table-fixed-style equal columns; nothing breaks layout. */}
          <div className="grid grid-cols-5 border-b border-border w-full">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  title={tabLabel(tab)}
                  aria-label={tabLabel(tab)}
                  aria-pressed={isActive}
                  className={[
                    'relative flex flex-col items-center justify-center gap-0.5 py-2 px-1 border-b-2 transition-colors min-w-0 overflow-hidden',
                    isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground active:text-foreground',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-1 max-w-full">
                    {/* Five tabs across 375px leaves ~67px of usable width per
                        cell. With the icon inline, every label truncated
                        ("Caps…", "Stick…", "Them…") — verified on device. The
                        icon is the first thing to go: it's decorative here,
                        the word is not. Restored once there's room. */}
                    <Icon className="w-3.5 h-3.5 shrink-0 hidden min-[420px]:block" />
                    <span className="text-micro font-semibold truncate">{tabLabel(tab)}</span>
                  </div>
                  <span className={`text-micro px-1.5 leading-tight rounded-full shrink-0 ${isActive ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                    {tab.count}
                  </span>
                  {/* Duplicate indicator — corner badge, doesn't take row space */}
                  {tab.badge && (
                    <span className="absolute top-0.5 end-0.5 text-micro px-1 leading-tight rounded-full bg-primary/20 text-primary dark:text-primary border border-primary/30 font-bold whitespace-nowrap">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* The sell-duplicates info bar was removed because the
              per-card ×N count + the in-line "Sell duplicate" button
              on every duplicate card already communicate both the
              presence of duplicates and the action available. A
              full-width banner repeating the count read as noise. */}

          {/* Search */}
          <div className="px-5 pt-3">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tFallback("userBag.searchYourBag2", "Search your bag…")}
                aria-label={tFallback("userBag.searchYourBag", "Search your bag")}
                className="w-full bg-secondary/50 border border-border rounded-lg ps-9 pe-8 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={tFallback("nutrition.search.clear", "Clear search")}
                  className="absolute end-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground active:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            ) : activeTab === 'capsules' ? (
              fCapsules.length === 0 ? (
                <EmptyState icon={Package} label={q
                  ? tFallback('userBag.noCapsulesMatch', 'No capsules match "{q}".', { q: query })
                  : tFallback('userBag.noCapsules', 'No capsules yet. Level up to earn them.')} />
              ) : (
                <>
                  {/* Batch open — one bar per type the user holds 2+ of.
                      Opening ten capsules used to mean ten full trips
                      through the opener modal. */}
                  {onOpenCapsuleBatch && Object.entries(capsulesByType)
                    .filter(([, rows]) => rows.length > 1)
                    .map(([type, rows]) => {
                      const take = Math.min(rows.length, 10);
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => onOpenCapsuleBatch(rows.slice(0, take))}
                          className="w-full mb-3 flex items-center gap-3 px-3 py-2 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/15 active:bg-primary/15 transition-colors text-start"
                        >
                          <CapsuleIcon type={type} size={26} className="shrink-0" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-bold leading-tight">
                              {type === 'elite'
                                ? tFallback('userBag.openNElite', 'Open {n} elite', { n: take })
                                : type === 'premium'
                                  ? tFallback('userBag.openNPremium', 'Open {n} premium', { n: take })
                                  : tFallback('userBag.openNStandard', 'Open {n} standard', { n: take })}
                            </span>
                            <span className="block text-micro text-muted-foreground leading-tight">
                              {rows.length > take
                                ? tFallback('userBag.batchMore', 'One after another, then all of them at once. {n} more after.', { n: rows.length - take })
                                : tFallback('userBag.batchHint', 'One after another, then all of them at once')}
                            </span>
                          </span>
                          <span className="text-xs font-bold text-primary shrink-0">{tFallback('userBag.openAll', 'Open all')}</span>
                        </button>
                      );
                    })}
                  <motion.div layout className={TILE.row}>
                    {fCapsules.map(row => (
                      <CapsuleCard key={row.id} capsuleRow={row} onOpenCapsule={onOpenCapsule} />
                    ))}
                  </motion.div>
                </>
              )
            ) : activeTab === 'stickers' ? (
              fStickerGroups.length === 0 ? (
                <EmptyState icon={Package} label={q
                  ? tFallback('userBag.noStickersMatch', 'No stickers match "{q}".', { q: query })
                  : tFallback('userBag.noStickers', 'No stickers yet. Open a capsule.')} />
              ) : (
                <>
                  {duplicateSales.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!bulkArmed) {
                          setBulkArmed(true);
                          if (bulkDisarmRef.current) clearTimeout(bulkDisarmRef.current);
                          bulkDisarmRef.current = setTimeout(() => setBulkArmed(false), 4000);
                        } else {
                          if (bulkDisarmRef.current) clearTimeout(bulkDisarmRef.current);
                          handleSellAllDuplicates();
                        }
                      }}
                      disabled={selling}
                      className={`w-full mb-3 py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                        bulkArmed
                          ? 'bg-destructive/80 text-white border-destructive'
                          : 'bg-primary/15 text-primary dark:text-primary border-primary/30 hover:bg-primary/25 active:bg-primary/25'
                      }`}
                    >
                      {selling
                        ? tFallback('userBag.selling', 'Selling…')
                        : bulkArmed
                          ? tFallback('userBag.confirmSellDups', 'Sell {n} duplicates for {coin} {total}?', { n: duplicateSales.length, coin: COIN, total: duplicateTotal })
                          : tFallback('userBag.sellAllDups', 'Sell all duplicates: {n} extra for {coin} {total}', { n: duplicateSales.length, coin: COIN, total: duplicateTotal })}
                    </button>
                  )}
                  <motion.div layout className={TILE.row}>
                    {fStickerGroups.map(group => (
                      <StickerGroupCard
                        key={group[0].item_id}
                        group={group}
                        onSell={handleSell}
                        selling={selling}
                      />
                    ))}
                  </motion.div>
                </>
              )
            ) : activeTab === 'titles' ? (
              fTitles.length === 0 ? (
                <EmptyState icon={Crown} label={q
                  ? tFallback('userBag.noTitlesMatch', 'No titles match "{q}".', { q: query })
                  : tFallback('userBag.noTitles', 'No titles yet. Open capsules to earn them.')} />
              ) : (
                <TitleList items={fTitles} userId={user?.id} />
              )
            ) : activeTab === 'frames' ? (
              fFrames.length === 0 ? (
                <EmptyState icon={Square} label={q
                  ? tFallback('userBag.noFramesMatch', 'No frames match "{q}".', { q: query })
                  : tFallback('userBag.noFrames', 'No frames yet. Open capsules to earn them.')} />
              ) : (
                <FrameList items={fFrames} userId={user?.id} />
              )
            ) : (
              fThemes.length === 0 ? (
                <EmptyState
                  icon={Palette}
                  label={q
                    ? tFallback('userBag.noThemesMatch', 'No themes match "{q}".', { q: query })
                    : THEMES_ENABLED
                      ? tFallback('userBag.noThemes', 'No themes yet. Open elite capsules.')
                      // Don't send anyone spending Elite capsules chasing a
                      // drop the server no longer rolls (migration 281).
                      : tFallback('userBag.themesSoon', 'Themes are coming soon.')}
                />
              ) : (
                <motion.div layout className={TILE.row}>
                  {fThemes.map(item => (
                    <ThemeCard
                      key={item.id}
                      item={item}
                      activeLootThemeId={lootThemeId}
                      onApply={handleApplyTheme}
                    />
                  ))}
                </motion.div>
              )
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>

    <CoinShopModal open={shopOpen} onClose={() => setShopOpen(false)} />
    {collectionOpen && (
      <Suspense fallback={null}>
        <CollectionModal open={collectionOpen} onClose={() => setCollectionOpen(false)} />
      </Suspense>
    )}
    </>
  );
}
