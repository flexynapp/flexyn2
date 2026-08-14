// src/components/market/TodayRail.jsx
//
// The two recurring "come back today" hooks, side by side.
//
// They used to be two full-width banners stacked above the grid. Combined
// with the tab strip, the banner header and the recently-viewed rail, a
// phone user scrolled roughly two and a half screens of promo chrome
// before reaching the first listing — on a page whose entire job is
// showing listings. Halving their height and pairing them into one row
// buys back most of that without dropping either hook.

import { motion } from 'framer-motion';
import { Package } from 'lucide-react';
import DailyChestBlock from './DailyChestBlock';
import { useLanguage } from '@/lib/LanguageContext';

export default function TodayRail({ user, onClaimed, onOpenShop }) {
  const { tFallback } = useLanguage();
  return (
    <div className="grid grid-cols-2 gap-3">
      {user && <DailyChestBlock user={user} onClaimed={onClaimed} />}

      <motion.button
        whileTap={{ scale: 0.97 }}
        whileHover={{ scale: 1.01 }}
        onClick={onOpenShop}
        className="rounded-2xl p-3 flex flex-col gap-2 border border-primary/30 bg-card text-start"
        style={{
          backgroundImage:
            'linear-gradient(135deg, hsl(var(--primary) / 0.22) 0%, hsl(var(--primary) / 0.06) 100%)',
        }}
      >
        <div className="flex items-center gap-2">
          <div className="shrink-0 w-9 h-9 rounded-xl bg-secondary border border-border flex items-center justify-center">
            <Package className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-heading font-bold text-sm leading-tight">{tFallback("todayRail.capsules", "Capsules")}</p>
            <p className="text-micro text-muted-foreground leading-tight">
              Standard · Premium · Elite
            </p>
          </div>
        </div>
        <span className="w-full py-1.5 rounded-lg text-xs font-bold bg-secondary text-secondary-foreground text-center">
          Open shop
        </span>
      </motion.button>
    </div>
  );
}
