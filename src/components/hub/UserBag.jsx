// src/components/hub/UserBag.jsx
// Inventory bag modal — Capsules | Stickers | Themes tabs.
// Capsules come from user_capsules table; stickers/themes from user_inventory.
// Stickers are grouped by item_id so duplicates are visible and sellable.

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Package, Sparkles, Palette, ShoppingBag, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import * as inventory from '@/lib/data/inventory';
import * as capsules  from '@/lib/data/capsules';
import { RARITY, ITEMS } from '@/lib/lootCatalog';

// Coin value per rarity (what a sold item earns)
const SELL_PRICE = Object.fromEntries(
  Object.entries(RARITY).map(([k, v]) => [k, v.baseCoins ?? 5])
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
  const price  = SELL_PRICE[item.item_rarity] ?? 5;

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

      <span className="text-5xl leading-none">{item.item_emoji}</span>
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

// ─── Theme card (no sell for themes) ─────────────────────────────────────────
function ThemeCard({ item }) {
  const rc = RARITY[item.item_rarity] ?? RARITY.common;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={['relative flex flex-col items-center p-3 rounded-xl border-2 bg-[#0f0f2a] gap-2 text-center', rc.borderClass].join(' ')}
    >
      <span className="text-5xl leading-none">{item.item_emoji}</span>
      <span className="text-white text-xs font-semibold leading-tight line-clamp-2">{item.item_name}</span>
      <RarityBadge rarity={item.item_rarity} />
      <span className="text-gray-500 text-[10px] font-medium">In Bag</span>
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

// ─── Component ────────────────────────────────────────────────────────────────
export default function UserBag({ open, onClose, onOpenCapsule }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('capsules');
  const [selling, setSelling] = useState(false);

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
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-400/30 rounded-full px-3 py-1">
                <span className="text-base">🪙</span>
                <span className="text-amber-300 font-bold text-sm">{flexCoins.toLocaleString()}</span>
              </div>
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
            ) : (
              themes.length === 0 ? (
                <EmptyState icon={Palette} label="No themes yet — open Elite capsules!" />
              ) : (
                <motion.div layout className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {themes.map(item => <ThemeCard key={item.id} item={item} />)}
                </motion.div>
              )
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
