// src/components/hub/UserBag.jsx
// Inventory bag modal — Capsules | Stickers | Themes tabs.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { X, Package, Sparkles, ShoppingBag, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import * as inventory from '@/lib/data/inventory';
import * as capsules  from '@/lib/data/capsules';
import { RARITY } from '@/lib/lootCatalog';

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

// ─── Item card ────────────────────────────────────────────────────────────────
function ItemCard({ item, onOpenCapsule }) {
  const rc = RARITY[item.item_rarity] ?? RARITY.common;
  const isCapsule = item.item_type === 'capsule';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={[
        'relative flex flex-col items-center p-3 rounded-xl border-2 bg-[#0f0f2a] gap-2 text-center',
        rc.borderClass,
      ].join(' ')}
    >
      <span className="text-5xl leading-none">{item.item_emoji}</span>
      <span className="text-white text-xs font-semibold leading-tight line-clamp-2">{item.item_name}</span>
      <RarityBadge rarity={item.item_rarity} />

      {isCapsule && (
        <button
          onClick={() => onOpenCapsule?.(item)}
          className="mt-1 w-full py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-90 transition-opacity"
        >
          Open
        </button>
      )}
      {!isCapsule && item.item_type === 'sticker' && (
        <span className="text-gray-500 text-[10px] font-medium">In Bag</span>
      )}
      {item.item_type === 'theme' && (
        <button className="mt-1 w-full py-1.5 rounded-lg text-xs font-bold text-white bg-white/10 hover:bg-white/20 transition-colors">
          Equip
        </button>
      )}
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

// ─── Tabs config ──────────────────────────────────────────────────────────────
const TABS = [
  { id: 'capsules', label: 'Capsules', icon: Package,   type: 'capsule' },
  { id: 'stickers', label: 'Stickers', icon: Sparkles,  type: 'sticker' },
  { id: 'themes',   label: 'Themes',   icon: ShoppingBag, type: 'theme'  },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function UserBag({ open, onClose, onOpenCapsule }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('capsules');

  const { data: allItems = [], isLoading } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn:  () => inventory.listItems(user.email),
    enabled:  !!user?.email && open,
    staleTime: 30_000,
    onError:  (err) => toast.error('Could not load inventory: ' + err.message),
  });

  const flexCoins = user?.flex_coins ?? 0;

  const filteredItems = allItems.filter(i => {
    const tab = TABS.find(t => t.id === activeTab);
    return tab ? i.item_type === tab.type : false;
  });

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
          className={[
            'relative z-10 bg-[#0a0a1a] border border-white/10 shadow-2xl',
            'w-full sm:max-w-2xl sm:rounded-2xl',
            'rounded-t-2xl sm:rounded-2xl',
            'max-h-[90vh] flex flex-col overflow-hidden',
          ].join(' ')}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        >
          {/* Handle (mobile) */}
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
              {/* Flex Coins balance */}
              <div className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-400/30 rounded-full px-3 py-1">
                <span className="text-base">🪙</span>
                <span className="text-amber-300 font-bold text-sm">{flexCoins.toLocaleString()}</span>
              </div>
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10"
              >
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
                    'flex items-center gap-1.5 py-3 px-3 text-sm font-semibold border-b-2 transition-colors',
                    isActive
                      ? 'border-purple-400 text-purple-300'
                      : 'border-transparent text-gray-500 hover:text-gray-300',
                  ].join(' ')}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {/* Count badge */}
                  <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-purple-500/30 text-purple-200' : 'bg-gray-700 text-gray-400'}`}>
                    {allItems.filter(i => i.item_type === tab.type).length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />
              </div>
            ) : filteredItems.length === 0 ? (
              <EmptyState
                icon={TABS.find(t => t.id === activeTab)?.icon ?? Package}
                label={
                  activeTab === 'capsules'
                    ? 'No capsules yet — level up to earn them!'
                    : activeTab === 'stickers'
                    ? 'No stickers yet — open a capsule!'
                    : 'No themes yet — stay tuned!'
                }
              />
            ) : (
              <motion.div
                layout
                className="grid grid-cols-3 sm:grid-cols-4 gap-3"
              >
                {filteredItems.map(item => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    onOpenCapsule={onOpenCapsule}
                  />
                ))}
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
