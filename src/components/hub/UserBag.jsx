// src/components/hub/UserBag.jsx
// Inventory bag modal — Capsules | Stickers | Themes tabs.
// Capsules come from user_capsules table; stickers/themes from user_inventory.
// Stickers are grouped by item_id so duplicates are visible and sellable.

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Package, Sparkles, Palette, ShoppingBag, Coins, Store, Crown, Square } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { supabase } from '@/api/supabaseClient';
import * as inventory from '@/lib/data/inventory';
import * as capsules  from '@/lib/data/capsules';
import { RARITY, ITEMS, VARIANTS } from '@/lib/lootCatalog';
import { getLootThemeById } from '@/lib/lootThemes';
import { getLootFrameById } from '@/lib/lootFrames';
import StickerDisplay from './StickerDisplay';
import CoinShopModal from './CoinShopModal';

// Sell price is half the hidden base value, rounded down.
const SELL_PRICE = Object.fromEntries(
  Object.entries(RARITY).map(([k, v]) => [k, Math.floor((v.baseCoins ?? 10) / 2)])
);

// Map capsule_type string → display metadata
const CAPSULE_META = {
  standard: ITEMS.find(i => i.id === 'capsule_standard') ?? { name: 'Standard Capsule', emoji: '📦', rarity: 'common'   },
  premium:  ITEMS.find(i => i.id === 'capsule_premium')  ?? { name: 'Premium Capsule',  emoji: '🎁', rarity: 'uncommon' },
  elite:    ITEMS.find(i => i.id === 'capsule_elite')    ?? { name: 'Elite Capsule',    emoji: '💠', rarity: 'epic'     },
};

// ─── Rarity badge ─────────────────────────────────────────────────────────────
function RarityBadge({ rarity }) {
  const rc = RARITY[rarity] ?? RARITY.common;
  return (
    <span
      className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border"
      style={{ color: rc.color, borderColor: rc.color, background: `${rc.color}18` }}
    >
      {rc.label}
    </span>
  );
}

// ─── Capsule card ─────────────────────────────────────────────────────────────
function CapsuleCard({ capsuleRow, onOpenCapsule }) {
  const meta = CAPSULE_META[capsuleRow.capsule_type] ?? CAPSULE_META.standard;
  const rc   = RARITY[meta.rarity] ?? RARITY.common;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={['relative flex flex-col items-center p-3 rounded-xl border-2 bg-[#0f0f2a] gap-2 text-center', rc.borderClass].join(' ')}
    >
      <span className="text-5xl leading-none">{meta.emoji}</span>
      <span className="text-white text-xs font-semibold leading-tight">{meta.name}</span>
      <RarityBadge rarity={meta.rarity} />
      <button
        onClick={() => onOpenCapsule?.({ ...capsuleRow, ...meta })}
        className="mt-1 w-full py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-90 transition-opacity"
      >
        Open
      </button>
    </motion.div>
  );
}

// ─── Sticker group card (shows duplicates + sell button) ──────────────────────
function StickerGroupCard({ group, onSell, selling }) {
  // `group` is an array of inventory rows for the same item_id.
  // We use group[0] for display info, count for badge.
  const item   = group[0];
  const count  = group.length;
  const rc     = RARITY[item.item_rarity] ?? RARITY.common;
  const variantMult = item.variant ? (VARIANTS[item.variant]?.sellMultiplier ?? 1) : 1;
  const price  = Math.floor((SELL_PRICE[item.item_rarity] ?? 2) * variantMult);

  // Unlisted items are the ones available to sell.
  const unlisted = group.filter(i => !i.is_listed);
  // Can only sell if there are >1 unlisted copies (keep at least one).
  const canSell  = unlisted.length > 1;
  const extras   = unlisted.length - 1; // number available to sell

  // Two-step confirm: first click arms the button, second executes.
  const [armed, setArmed] = useState(false);

  const handleSellClick = useCallback(() => {
    if (!armed) {
      setArmed(true);
      // Auto-disarm after 3 s.
      setTimeout(() => setArmed(false), 3000);
    } else {
      setArmed(false);
      onSell(unlisted[unlisted.length - 1], price); // sell the last-acquired copy
    }
  }, [armed, unlisted, price, onSell]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={['relative flex flex-col items-center p-3 rounded-xl border-2 bg-[#0f0f2a] gap-2 text-center', rc.borderClass].join(' ')}
    >
      {/* Duplicate count badge */}
      {count > 1 && (
        <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 rounded-full bg-purple-600 text-white text-[10px] font-bold flex items-center justify-center">
          ×{count}
        </span>
      )}

      <StickerDisplay emoji={item.item_emoji} variant={item.variant} size={52} />
      {item.variant && (
        <span className="text-[10px] font-bold" style={{ color: VARIANTS[item.variant]?.color ?? '#fff' }}>
          {VARIANTS[item.variant]?.badge}
        </span>
      )}
      <span className="text-white text-xs font-semibold leading-tight line-clamp-2">{item.item_name}</span>
      <RarityBadge rarity={item.item_rarity} />

      {/* Sell duplicate button */}
      {canSell ? (
        <button
          onClick={handleSellClick}
          disabled={selling}
          className={[
            'mt-1 w-full py-1.5 rounded-lg text-xs font-bold transition-all duration-200',
            armed
              ? 'bg-red-500/80 text-white border border-red-400 scale-105'
              : 'bg-amber-500/15 text-amber-300 border border-amber-400/30 hover:bg-amber-500/25',
          ].join(' ')}
        >
          {armed ? (
            'Confirm sell?'
          ) : (
            <span className="flex items-center justify-center gap-1">
              Sell extra · 🪙 {price}
            </span>
          )}
        </button>
      ) : (
        <span className="text-gray-500 text-[10px] font-medium mt-1">In Bag</span>
      )}
    </motion.div>
  );
}

// ─── Theme card ───────────────────────────────────────────────────────────────
function ThemeCard({ item, activeLootThemeId, onApply }) {
  const rc = RARITY[item.item_rarity] ?? RARITY.common;
  const lootTheme = getLootThemeById(item.item_id);
  const isActive  = activeLootThemeId === item.item_id;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={[
        'relative flex flex-col items-center p-3 rounded-xl border-2 bg-[#0f0f2a] gap-2 text-center transition-all',
        isActive ? 'border-purple-400 shadow-lg shadow-purple-500/20' : rc.borderClass,
      ].join(' ')}
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
      <span className="text-white text-xs font-semibold leading-tight line-clamp-2">{item.item_name}</span>
      <RarityBadge rarity={item.item_rarity} />
      {lootTheme?.animated && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-400/30 uppercase tracking-wider">
          Animated
        </span>
      )}
      <button
        onClick={() => onApply(item.item_id)}
        className={[
          'mt-1 w-full py-1.5 rounded-lg text-xs font-bold transition-all duration-200',
          isActive
            ? 'bg-purple-500/30 text-purple-200 border border-purple-400/50'
            : 'bg-purple-600/70 text-white hover:bg-purple-500/80',
        ].join(' ')}
      >
        {isActive ? '✓ Active' : 'Apply'}
      </button>
    </motion.div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, label }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <Icon className="w-10 h-10 text-gray-600" />
      <p className="text-gray-500 text-sm">{label}</p>
    </div>
  );
}

// ─── Title equip list ─────────────────────────────────────────────────────────

function TitleList({ items, userId }) {
  const qc = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ['userProfileEquip', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase
        .from('user_profiles')
        .select('equipped_title_id')
        .eq('id', userId)
        .maybeSingle();
      return data;
    },
    enabled: !!userId,
    staleTime: 10_000,
  });
  const equippedId = profile?.equipped_title_id;

  const equip = async (titleId) => {
    if (!userId) return;
    const newId = equippedId === titleId ? null : titleId;
    const { error } = await supabase
      .from('user_profiles')
      .update({ equipped_title_id: newId })
      .eq('id', userId);
    if (error) { toast.error('Could not save'); return; }
    toast.success(newId ? 'Title equipped' : 'Title removed');
    qc.invalidateQueries({ queryKey: ['userProfileEquip', userId] });
  };

  // Dedupe by item_id (multiple drops of the same title)
  const seen = new Set();
  const unique = items.filter(i => {
    if (seen.has(i.item_id)) return false;
    seen.add(i.item_id);
    return true;
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {unique.map(item => {
        const isEquipped = equippedId === item.item_id;
        const rarityBadge = (RARITY[item.item_rarity] ?? RARITY.common);
        return (
          <button
            key={item.id}
            onClick={() => equip(item.item_id)}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
              isEquipped ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
          >
            <span className="text-2xl shrink-0">{item.item_emoji || '🏷️'}</span>
            <div className="flex-1 min-w-0">
              <p className="font-heading font-bold text-sm text-white">{item.item_name}</p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: rarityBadge.color }}>{item.item_rarity}</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary shrink-0">
              {isEquipped ? 'Equipped' : 'Equip'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Frame equip list ─────────────────────────────────────────────────────────

function FrameList({ items, userId }) {
  const qc = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ['userProfileEquipFrame', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase
        .from('user_profiles')
        .select('equipped_frame_id, avatar_url, username')
        .eq('id', userId)
        .maybeSingle();
      return data;
    },
    enabled: !!userId,
    staleTime: 10_000,
  });
  const equippedId = profile?.equipped_frame_id;

  const equip = async (frameId) => {
    if (!userId) return;
    const newId = equippedId === frameId ? null : frameId;
    const { error } = await supabase
      .from('user_profiles')
      .update({ equipped_frame_id: newId })
      .eq('id', userId);
    if (error) { toast.error('Could not save'); return; }
    toast.success(newId ? 'Frame equipped' : 'Frame removed');
    qc.invalidateQueries({ queryKey: ['userProfileEquipFrame', userId] });
  };

  const seen = new Set();
  const unique = items.filter(i => {
    if (seen.has(i.item_id)) return false;
    seen.add(i.item_id);
    return true;
  });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {unique.map(item => {
        const isEquipped = equippedId === item.item_id;
        const frameDef = getLootFrameById(item.item_id);
        const rarityBadge = (RARITY[item.item_rarity] ?? RARITY.common);
        return (
          <button
            key={item.id}
            onClick={() => equip(item.item_id)}
            className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${
              isEquipped ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
          >
            <div
              className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center overflow-hidden"
              style={frameDef?.css || {}}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="font-heading font-bold text-foreground">
                  {(profile?.username?.[0] || '?').toUpperCase()}
                </span>
              )}
            </div>
            <p className="font-heading font-bold text-xs text-white text-center leading-tight">{item.item_name}</p>
            <p className="text-[9px] uppercase tracking-wider" style={{ color: rarityBadge.color }}>{item.item_rarity}</p>
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              {isEquipped ? 'Equipped' : 'Equip'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function UserBag({ open, onClose, onOpenCapsule }) {
  const { user } = useAuth();
  const { lootThemeId, setLootThemeId } = useTheme();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('capsules');
  const [selling, setSelling] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);

  const handleApplyTheme = useCallback((itemId) => {
    if (lootThemeId === itemId) {
      // Tap again to deactivate
      setLootThemeId(null);
      toast('Theme removed — base theme restored.');
    } else {
      setLootThemeId(itemId);
      toast('🎨 Theme applied!');
    }
  }, [lootThemeId, setLootThemeId]);

  // Capsules live in user_capsules (separate from inventory)
  const { data: capsuleRows = [], isLoading: capsLoading } = useQuery({
    queryKey: ['userCapsules', user?.email],
    queryFn:  () => capsules.listUnopenedCapsules(user.email),
    enabled:  !!user?.email && open,
    staleTime: 15_000,
  });

  // Stickers and themes live in user_inventory
  const { data: inventoryItems = [], isLoading: invLoading } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn:  () => inventory.listItems(user.email),
    enabled:  !!user?.email && open,
    staleTime: 30_000,
  });

  // Group stickers by item_id so duplicates are visible
  const stickers = inventoryItems.filter(i => i.item_type === 'sticker');
  const stickerGroups = Object.values(
    stickers.reduce((acc, item) => {
      const key = item.item_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {})
  );
  const duplicateCount = stickerGroups.filter(g => g.filter(i => !i.is_listed).length > 1).length;

  const themes     = inventoryItems.filter(i => i.item_type === 'theme');
  const titles     = inventoryItems.filter(i => i.item_type === 'title');
  const frames     = inventoryItems.filter(i => i.item_type === 'frame');
  const isLoading  = capsLoading || invLoading;

  // Flex coins from auth user profile
  const flexCoins = Number(user?.flex_coins ?? 0);

  // ── Sell a duplicate ────────────────────────────────────────────────────────
  const handleSell = useCallback(async (inventoryRow, price) => {
    if (!user?.id) { toast.error('Not signed in'); return; }
    setSelling(true);
    try {
      const newTotal = await inventory.sellItem(inventoryRow.id, user.id, price);
      qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
      qc.invalidateQueries({ queryKey: ['userProfile', user.email] });
      toast.success(`🪙 +${price} Flex Coins! Sold ${inventoryRow.item_emoji} ${inventoryRow.item_name}.`);
    } catch (err) {
      console.error('[UserBag] sell failed:', err);
      toast.error('Could not sell item. Try again.');
    } finally {
      setSelling(false);
    }
  }, [user?.id, user?.email, qc]);

  const TABS = [
    { id: 'capsules', label: 'Capsules', icon: Package,  count: capsuleRows.length },
    { id: 'stickers', label: 'Stickers', icon: Sparkles, count: stickers.length, badge: duplicateCount > 0 ? `${duplicateCount} dupe${duplicateCount > 1 ? 's' : ''}` : null },
    { id: 'titles',   label: 'Titles',   icon: Crown,    count: titles.length    },
    { id: 'frames',   label: 'Frames',   icon: Square,   count: frames.length    },
    { id: 'themes',   label: 'Themes',   icon: Palette,  count: themes.length    },
  ];

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Sheet / modal */}
        <motion.div
          className="relative z-10 bg-[#0a0a1a] border border-white/10 shadow-2xl w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col overflow-hidden"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        >
          {/* Mobile drag handle */}
          <div className="sm:hidden flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-gray-600" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10">
            <div className="flex items-center gap-3">
              <ShoppingBag className="w-5 h-5 text-purple-400" />
              <h2 className="text-white font-bold text-lg">My Bag</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShopOpen(true)}
                aria-label="Open Coin Shop"
                className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-400/30 rounded-full px-3 py-1 hover:bg-amber-500/25 transition-colors"
              >
                <span className="text-base">🪙</span>
                <span className="text-amber-300 font-bold text-sm tabular-nums">{flexCoins.toLocaleString()}</span>
                <Store className="w-3.5 h-3.5 text-amber-300/80 ml-0.5" />
              </button>
              <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/10 px-5">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    'relative flex items-center gap-1.5 py-3 px-3 text-sm font-semibold border-b-2 transition-colors',
                    isActive ? 'border-purple-400 text-purple-300' : 'border-transparent text-gray-500 hover:text-gray-300',
                  ].join(' ')}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-purple-500/30 text-purple-200' : 'bg-gray-700 text-gray-400'}`}>
                    {tab.count}
                  </span>
                  {/* Duplicate indicator pill */}
                  {tab.badge && (
                    <span className="ml-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30 font-bold">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Sell-duplicates info bar — shown on stickers tab when dupes exist */}
          {activeTab === 'stickers' && duplicateCount > 0 && (
            <div className="flex items-center gap-2 px-5 py-2.5 bg-amber-500/8 border-b border-amber-400/15">
              <Coins className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-amber-300 text-xs">
                You have <span className="font-bold">{duplicateCount} duplicate sticker{duplicateCount > 1 ? 's' : ''}</span> — sell the extras for Flex Coins.
              </p>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />
              </div>
            ) : activeTab === 'capsules' ? (
              capsuleRows.length === 0 ? (
                <EmptyState icon={Package} label="No capsules yet — level up to earn them!" />
              ) : (
                <motion.div layout className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {capsuleRows.map(row => (
                    <CapsuleCard key={row.id} capsuleRow={row} onOpenCapsule={onOpenCapsule} />
                  ))}
                </motion.div>
              )
            ) : activeTab === 'stickers' ? (
              stickerGroups.length === 0 ? (
                <EmptyState icon={Sparkles} label="No stickers yet — open a capsule!" />
              ) : (
                <motion.div layout className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {stickerGroups.map(group => (
                    <StickerGroupCard
                      key={group[0].item_id}
                      group={group}
                      onSell={handleSell}
                      selling={selling}
                    />
                  ))}
                </motion.div>
              )
            ) : activeTab === 'titles' ? (
              titles.length === 0 ? (
                <EmptyState icon={Crown} label="No titles yet — open capsules to earn them!" />
              ) : (
                <TitleList items={titles} userId={user?.id} />
              )
            ) : activeTab === 'frames' ? (
              frames.length === 0 ? (
                <EmptyState icon={Square} label="No frames yet — open capsules to earn them!" />
              ) : (
                <FrameList items={frames} userId={user?.id} />
              )
            ) : (
              themes.length === 0 ? (
                <EmptyState icon={Palette} label="No themes yet — open Elite capsules!" />
              ) : (
                <motion.div layout className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {themes.map(item => (
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
      <CoinShopModal open={shopOpen} onClose={() => setShopOpen(false)} />
    </AnimatePresence>
  );
}
