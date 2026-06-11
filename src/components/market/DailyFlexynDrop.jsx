// src/components/market/DailyFlexynDrop.jsx
//
// "Today's Flexyn Drop" — three branded items, rotated deterministically
// every 24h. Same items for every user on the same calendar day, so
// it reads as a global "today's drop" event rather than a personalized
// recommendation.
//
// Buys go through purchase_branded_item(p_sku) (mig 165). The RPC is
// admin-gated on the server side for now — the client surfaces a
// friendly toast when the purchase fails so we can roll the migration
// out in stages.

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { BRANDED_ITEMS, getDailyDrop, RARITY } from '@/lib/lootCatalog';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';

const RARITY_TINT = {
  common:    { bg: 'from-zinc-400/15 to-transparent',    ring: 'ring-zinc-400/40',    text: 'text-zinc-600 dark:text-zinc-300' },
  uncommon:  { bg: 'from-emerald-400/15 to-transparent', ring: 'ring-emerald-400/45', text: 'text-emerald-600 dark:text-emerald-300' },
  rare:      { bg: 'from-sky-400/15 to-transparent',     ring: 'ring-sky-400/45',     text: 'text-sky-600 dark:text-sky-300' },
  epic:      { bg: 'from-violet-400/18 to-transparent',  ring: 'ring-violet-400/50',  text: 'text-violet-600 dark:text-violet-300' },
  legendary: { bg: 'from-amber-400/22 to-transparent',   ring: 'ring-amber-400/55',   text: 'text-amber-600 dark:text-amber-300' },
  mythic:    { bg: 'from-rose-400/24 to-transparent',    ring: 'ring-rose-400/55',    text: 'text-rose-600 dark:text-rose-300' },
};

function msUntilLocalMidnight() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return tomorrow.getTime() - now.getTime();
}

function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

export default function DailyFlexynDrop() {
  const { user } = useAuth();
  const [drop, setDrop] = useState(() => getDailyDrop());
  const [purchasing, setPurchasing] = useState(null); // sku of in-flight buy
  const [purchased, setPurchased] = useState(() => {
    // Per-day client-side cache so the "Owned" pill survives navigation
    try {
      const key = `flexyn.dailyDropPurchased.${user?.id || 'anon'}.${new Date().toDateString()}`;
      return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
    } catch { return new Set(); }
  });
  const [remaining, setRemaining] = useState(() => msUntilLocalMidnight());

  // Tick the countdown every minute; flip the drop at midnight.
  useEffect(() => {
    const id = setInterval(() => {
      const ms = msUntilLocalMidnight();
      setRemaining(ms);
      if (ms > 86_400_000 - 60_000 || ms < 60_000) {
        // Past midnight — recompute the drop.
        setDrop(getDailyDrop());
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const markPurchased = (sku) => {
    setPurchased(prev => {
      const next = new Set(prev);
      next.add(sku);
      try {
        const key = `flexyn.dailyDropPurchased.${user?.id || 'anon'}.${new Date().toDateString()}`;
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch { /* ignore */ }
      return next;
    });
  };

  const buy = async (item) => {
    if (!user?.id) { toast.error('Sign in to buy'); return; }
    if (purchased.has(item.id)) return;
    setPurchasing(item.id);
    try {
      const { data, error } = await supabase.rpc('purchase_branded_item', { p_sku: item.id });
      if (error) {
        const msg = error.message || '';
        if (error.code === '42883' || error.code === '42P01' || /unknown_sku|undefined_function/.test(msg)) {
          toast.error('Daily drop purchases roll out shortly — RPC not deployed yet.');
        } else if (/insufficient_coins/.test(msg)) {
          toast.error('Not enough Flex Coins.');
        } else {
          toast.error('Purchase failed — try again.');
        }
        return;
      }
      markPurchased(item.id);
      toast.success(`🎁 ${item.name} added to your bag!`);
    } catch (err) {
      console.error('[DailyFlexynDrop] purchase error', err);
      toast.error('Purchase failed — try again.');
    } finally {
      setPurchasing(null);
    }
  };

  if (drop.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="mb-4 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/8 via-orange-500/6 to-amber-500/5 p-3 md:p-4 relative overflow-hidden"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <div>
            <p className="font-heading font-bold text-sm leading-none">Today's Flexyn Drop</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Rotates in {formatCountdown(remaining)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {drop.map(item => {
          const tint = RARITY_TINT[item.rarity] || RARITY_TINT.common;
          const owned = purchased.has(item.id);
          const busy = purchasing === item.id;
          return (
            <div
              key={item.id}
              className={`relative rounded-xl bg-card ring-1 ${tint.ring} bg-gradient-to-br ${tint.bg} p-2.5 flex flex-col items-center text-center`}
            >
              <span className="text-3xl leading-none mb-1.5" aria-hidden="true">{item.emoji}</span>
              <p className="font-heading font-bold text-[11px] leading-tight line-clamp-2 h-7">
                {item.name}
              </p>
              <p className={`text-[9px] font-bold uppercase tracking-wide mt-0.5 ${tint.text}`}>
                {RARITY[item.rarity]?.label || item.rarity}
              </p>
              <button
                type="button"
                onClick={() => buy(item)}
                disabled={busy || owned}
                className={`mt-2 w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${
                  owned
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 cursor-default'
                    : 'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50'
                }`}
              >
                {owned
                  ? <><Check className="w-3 h-3" /> Owned</>
                  : busy
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> ...</>
                    : <>{item.baseCoins} ⚡</>}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground/80 mt-2 text-center">
        New drop every day at midnight · {BRANDED_ITEMS.length} branded items total
      </p>
    </motion.div>
  );
}
