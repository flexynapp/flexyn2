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

import { useState, useEffect } from 'react';
import { Loader2, Check } from 'lucide-react';
import { toast } from '@/lib/toast';
import { getDailyDrop } from '@/lib/lootCatalog';
import Sticker from '@/components/capsules/Sticker';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { useNumberFormatter } from '@/lib/intl';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';

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
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
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
    if (!user?.id) { toast.error(tFallback("dailyFlexynDrop.signInToBuy", "Sign in to buy")); return; }
    if (purchased.has(item.id)) return;
    setPurchasing(item.id);
    try {
      const { data, error } = await supabase.rpc('purchase_branded_item', { p_sku: item.id });
      if (error) {
        const msg = error.message || '';
        if (error.code === '42883' || error.code === '42P01' || /unknown_sku|undefined_function/.test(msg)) {
          toast.error(tFallback('dailyFlexynDrop.rpcMissing', 'Daily drop purchases roll out shortly, RPC not deployed yet.'));
        } else if (/insufficient_coins/.test(msg)) {
          toast.error(tFallback('bountyCard.err.insufficientCoins', 'Not enough Flex Coins.'));
        } else {
          toast.error(tFallback('dailyFlexynDrop.purchaseFailed', 'Purchase failed. Try again.'));
        }
        return;
      }
      markPurchased(item.id);
      toast.success(tFallback('dailyFlexynDrop.addedToBag', '🎁 {name} added to your bag!', { name: item.name }));
    } catch (err) {
      console.error('[DailyFlexynDrop] purchase error', err);
      toast.error(tFallback('dailyFlexynDrop.purchaseFailed', 'Purchase failed. Try again.'));
    } finally {
      setPurchasing(null);
    }
  };

  if (drop.length === 0) return null;

  // The round 2 layout: a hairline, "Today's drop" with the time to the next
  // one, and three stickers with their prices. Each tile is its own buy.
  return (
    <section className="pt-3 border-t flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="eyebrow">{tFallback('dailyFlexynDrop.title', "Today's drop")}</h2>
        <span className="text-caption text-muted-foreground tabular-nums">
          {tFallback('dailyFlexynDrop.newIn', 'New in {time}', { time: formatCountdown(remaining) })}
        </span>
      </div>
      <ul className="flex justify-between gap-2">
        {drop.map(item => {
          const owned = purchased.has(item.id);
          const busy = purchasing === item.id;
          return (
            <li key={item.id} className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => buy(item)}
                disabled={busy || owned}
                aria-busy={busy}
                aria-label={owned
                  ? tFallback('dailyFlexynDrop.ownedLabel', '{name}, owned', { name: item.name })
                  : tFallback('dailyFlexynDrop.buyLabel', 'Buy {name} for {price} coins', { name: item.name, price: fmt(item.baseCoins) })}
                className="w-full min-h-11 flex flex-col items-center gap-2 disabled:cursor-default"
              >
                <Sticker itemId={item.id} emoji={item.emoji} rarity={item.rarity} size={52} />
                <span className="flex flex-col items-center gap-0.5 min-w-0 max-w-full">
                  <span className="text-label font-semibold truncate max-w-full">{item.name}</span>
                  <span className={`inline-flex items-center gap-1 text-caption tabular-nums ${owned ? 'text-success' : 'text-muted-foreground'}`}>
                    {owned
                      ? <><Check className="w-3 h-3" aria-hidden="true" />{tFallback('dailyFlexynDrop.owned', 'Owned')}</>
                      : busy
                        ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        : <><FlexCoinIcon size={12} />{fmt(item.baseCoins)}</>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
