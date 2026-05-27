// src/pages/Market.jsx
// Standalone Marketplace route — previously a feed-tab inside Hub. Lifted
// here so it's reachable by URL and so a "Message seller" CTA can
// navigate cleanly to /messages with a pending conversation target.

import { useNavigate } from 'react-router-dom';
import { Sparkles, ChevronRight } from 'lucide-react';
import MarketplaceFeed from '@/components/hub/MarketplaceFeed';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useStartConversation } from '@/lib/hubMessaging';
import { useLanguage } from '@/lib/LanguageContext';

export default function Market() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const startConversation = useStartConversation();

  return (
    <div className="px-4 pt-4 md:px-8 md:pt-8 lg:pb-8 max-w-3xl mx-auto">
      {/* Trainer Programs entry — premium paywalled regimens, separate
          from the coin-based peer marketplace below. */}
      <button
        type="button"
        onClick={() => navigate('/trainer/market')}
        className="w-full mb-4 rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/10 via-violet-500/10 to-primary/10 p-4 flex items-center gap-3 hover:border-primary/50 transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading font-bold text-sm">Trainer Programs</p>
          <p className="text-xs text-muted-foreground">Premium regimens from creators · sell your own</p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      <ErrorBoundary label="Market">
        <MarketplaceFeed onStartConversation={startConversation} />
      </ErrorBoundary>
    </div>
  );
}
