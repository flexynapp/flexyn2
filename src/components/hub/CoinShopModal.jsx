// src/components/hub/CoinShopModal.jsx
//
// Direct coin → item shop. Opens from the bag/inventory area. Sells:
//   • Capsules (Standard / Premium / Elite)
//   • Streak Freezes
//
// Marketplace remains player-to-player. This is the system shop.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Coins, X, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { SHOP_CATALOG, purchaseItem } from '@/lib/data/coinShop';

export default function CoinShopModal({ open, onClose }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busySku, setBusySku] = useState(null);

  // Subscribe to balance so the header updates after each purchase
  const { data: profile } = useQuery({
    queryKey: ['coinShopProfile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('user_profiles')
        .select('flex_coins')
        .eq('id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user?.id && open,
    staleTime: 5_000,
  });

  const balance = profile?.flex_coins ?? 0;

  const handlePurchase = async (sku) => {
    if (busySku) return;
    setBusySku(sku);
    try {
      const result = await purchaseItem(user, sku);
      if (result.success) {
        const item = SHOP_CATALOG[sku];
        toast.success(`Purchased ${item.name}!`, { icon: item.icon });
        queryClient.invalidateQueries({ queryKey: ['coinShopProfile'] });
        queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['userCapsules', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['loginStreakProfile'] });
      } else if (result.error === 'insufficient_coins') {
        toast.error('Not enough coins');
      } else {
        toast.error('Purchase failed — try again');
      }
    } finally {
      setBusySku(null);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-4"
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full md:w-[460px] max-h-[88vh] bg-card border-t md:border md:rounded-2xl rounded-t-2xl overflow-hidden flex flex-col shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div>
              <h2 className="font-heading font-bold text-base">Coin Shop</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Coins className="w-3.5 h-3.5 text-primary" />
                <span className="font-bold tabular-nums text-sm">{balance.toLocaleString()}</span>
                <span className="text-[11px] text-muted-foreground">balance</span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-md hover:bg-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {Object.values(SHOP_CATALOG).map((item) => (
              <ShopRow
                key={item.sku}
                item={item}
                balance={balance}
                busy={busySku === item.sku}
                onBuy={() => handlePurchase(item.sku)}
              />
            ))}
          </div>

          {/* Footer hint */}
          <div className="p-3 border-t border-border text-[11px] text-center text-muted-foreground">
            Earn coins from daily quests, login streaks, and level-ups.
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ShopRow({ item, balance, busy, onBuy }) {
  const affordable = balance >= item.price;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-background/60 border border-border/50 p-3">
      <div className="text-3xl shrink-0" aria-hidden="true">{item.icon}</div>
      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-sm truncate">{item.name}</p>
        <p className="text-[11px] text-muted-foreground">{item.description}</p>
      </div>
      <button
        onClick={onBuy}
        disabled={!affordable || busy}
        className="flex items-center gap-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity shrink-0"
      >
        {!affordable && <Lock className="w-3 h-3" />}
        <Coins className="w-3 h-3" />
        <span className="tabular-nums">{item.price}</span>
      </button>
    </div>
  );
}
