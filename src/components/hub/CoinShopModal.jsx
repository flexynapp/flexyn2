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
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { supabase } from '@/api/supabaseClient';
import { SHOP_CATALOG, purchaseItem } from '@/lib/data/coinShop';

// SKU → camelCase translation-key segment. Single source of truth so adding
// a new shop item only requires one edit instead of two chained replaces.
const SKU_TO_CAMEL = {
  capsule_standard: 'standardCapsule',
  capsule_premium:  'premiumCapsule',
  capsule_elite:    'eliteCapsule',
  streak_freeze:    'streakFreeze',
};

// Admin sandbox: same list as MarketplaceFeed
const ADMIN_USERNAMES = ['sean', 'seanj', 'kegan', 'admin'];

export default function CoinShopModal({ open, onClose }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const fmt = useNumberFormatter();
  const [busySku, setBusySku] = useState(null);

  // Admin bypass — skip RPC (which validates real DB balance) and directly grant
  const emailPrefix = user?.email?.split('@')[0]?.toLowerCase() || '';
  const isAdmin = ADMIN_USERNAMES.includes(user?.username?.toLowerCase()) ||
                  ADMIN_USERNAMES.includes(emailPrefix);

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
      const item = SHOP_CATALOG[sku];
      let result;

      if (isAdmin) {
        // Admin sandbox bypass — skip coin validation RPC and directly grant the item.
        // Admins carry a client-cached 1,000,000 flex coin balance but have low real DB balance.
        try {
          if (item.grants.type === 'capsule') {
            const { error } = await supabase.from('user_capsules').insert({
              user_id: user.id,
              user_email: user.email,
              capsule_type: item.grants.capsuleType,
            });
            if (error) throw error;
            result = { success: true, granted: { type: 'capsule', capsuleType: item.grants.capsuleType } };
          } else if (item.grants.type === 'streak_freeze') {
            // Read current count first, then increment
            const { data: prof } = await supabase
              .from('user_profiles')
              .select('streak_freezes_available')
              .eq('id', user.id)
              .maybeSingle();
            const current = prof?.streak_freezes_available ?? 0;
            const { error } = await supabase
              .from('user_profiles')
              .update({ streak_freezes_available: current + item.grants.amount })
              .eq('id', user.id);
            if (error) throw error;
            result = { success: true, granted: { type: 'streak_freeze', amount: item.grants.amount } };
          } else {
            result = { success: false, error: 'unknown_grant_type' };
          }
        } catch (err) {
          result = { success: false, error: err?.message || 'admin_grant_failed' };
        }
      } else {
        result = await purchaseItem(user, sku);
      }

      if (result.success) {
        // Use translated item name in the success toast
        const camel = SKU_TO_CAMEL[item.sku];
        const itemNameKey = camel ? `shop.${camel}.name` : null;
        const translatedName = itemNameKey ? t(itemNameKey) : null;
        const displayName = translatedName && translatedName !== itemNameKey ? translatedName : item.name;
        toast.success(t('shop.purchasedToast').replace('{item}', displayName), { icon: item.icon });
        queryClient.invalidateQueries({ queryKey: ['coinShopProfile'] });
        queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['userCapsules', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['loginStreakProfile'] });
      } else if (result.error === 'insufficient_coins') {
        toast.error(t('shop.notEnoughCoins'));
      } else {
        toast.error(t('shop.purchaseFailed'));
      }
    } finally {
      setBusySku(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
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
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.3 }}
          onDragEnd={(_e, info) => {
            if (info.velocity.y >= 300 || info.offset.y >= 80) onClose?.();
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div>
              <h2 className="font-heading font-bold text-base">{t('shop.title')}</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Coins className="w-3.5 h-3.5 text-primary" />
                <span className="font-bold tabular-nums text-sm">{fmt(balance)}</span>
                <span className="text-[11px] text-muted-foreground">{t('shop.balance')}</span>
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
                balance={isAdmin ? 1_000_000 : balance}
                busy={busySku === item.sku}
                onBuy={() => handlePurchase(item.sku)}
                t={t}
              />
            ))}
          </div>

          {/* Footer hint */}
          <div className="p-3 border-t border-border text-[11px] text-center text-muted-foreground">
            {t('shop.hint')}
          </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}

function ShopRow({ item, balance, busy, onBuy, t }) {
  const affordable = balance >= item.price;
  // Translation key derived from sku via SKU_TO_CAMEL (single source of truth).
  const camelKey = SKU_TO_CAMEL[item.sku] || null;
  const nameKey = camelKey ? `shop.${camelKey}.name` : null;
  const descKey = camelKey ? `shop.${camelKey}.desc` : null;
  const translatedName = nameKey ? t(nameKey) : null;
  const translatedDesc = descKey ? t(descKey) : null;
  const displayName = translatedName && translatedName !== nameKey ? translatedName : item.name;
  const displayDesc = translatedDesc && translatedDesc !== descKey ? translatedDesc : item.description;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-background/60 border border-border/50 p-3">
      <div className="text-3xl shrink-0" aria-hidden="true">{item.icon}</div>
      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-sm truncate">{displayName}</p>
        <p className="text-[11px] text-muted-foreground">{displayDesc}</p>
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
