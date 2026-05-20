// src/pages/Market.jsx
// Standalone Marketplace route — previously a feed-tab inside Hub. Lifted
// here so it's reachable by URL and so a "Message seller" CTA can
// navigate cleanly to /messages with a pending conversation target.

import MarketplaceFeed from '@/components/hub/MarketplaceFeed';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useStartConversation } from '@/lib/hubMessaging';
import { useLanguage } from '@/lib/LanguageContext';

export default function Market() {
  const { t } = useLanguage();
  const startConversation = useStartConversation();

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <ErrorBoundary label="Market">
        <MarketplaceFeed onStartConversation={startConversation} />
      </ErrorBoundary>
    </div>
  );
}
