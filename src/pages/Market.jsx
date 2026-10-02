// src/pages/Market.jsx
// Standalone Marketplace route — previously a feed-tab inside Hub. Lifted
// here so it's reachable by URL and so a "Message seller" CTA can
// navigate cleanly to /messages with a pending conversation target.

import { GraduationCap, Lock } from 'lucide-react';
import MarketplaceFeed from '@/components/market/MarketplaceFeed';
import ErrorBoundary from '@/components/ErrorBoundary';
import { requestOpenBag } from '@/lib/inventoryFlow';
import DailyFlexynDrop from '@/components/market/DailyFlexynDrop';
import { useStartConversation } from '@/lib/hubMessaging';
import { useLanguage } from '@/lib/LanguageContext';

export default function Market() {
  const { tFallback } = useLanguage();
  const startConversation = useStartConversation();

  return (
    <div className="px-4 pt-1 md:px-8 md:pt-8 lg:pb-8 max-w-3xl mx-auto">
      <ErrorBoundary label="Market">
        <MarketplaceFeed onStartConversation={startConversation} onOpenCollection={() => requestOpenBag('stickers')} />
      </ErrorBoundary>

      {/* Today's drop sits under the listings: the page is for listings,
          and the drop is the thing you find after scanning them. */}
      <div className="mt-6">
        <DailyFlexynDrop />
      </div>

      {/* Trainer Programs, coming soon. It used to open the page, above the
          listings, with a violet gradient, a pulsing violet glow, a shimmer
          and a purple pill. Purple is for rarity only, and a feature you
          cannot use yet should not be the first thing on the page, so it is
          a quiet flat row under the feed. */}
      <div className="w-full mt-6 mb-6 rounded-2xl border border-border bg-card p-4 flex items-center gap-3 text-start select-none">
        <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
          <GraduationCap className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-heading font-bold text-sm text-foreground">{tFallback("market.trainerPrograms", "Trainer Programs")}</p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-micro font-semibold text-muted-foreground">
              <Lock className="w-2.5 h-2.5" aria-hidden="true" />
              {tFallback("levelBar.comingSoon", "Coming Soon")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{tFallback("market.trainerProgramsSub", "Premium regimens from certified creators, launching soon")}</p>
        </div>
      </div>
    </div>
  );
}
