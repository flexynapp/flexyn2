// src/pages/Market.jsx
// Standalone Marketplace route — previously a feed-tab inside Hub. Lifted
// here so it's reachable by URL and so a "Message seller" CTA can
// navigate cleanly to /messages with a pending conversation target.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Lock, Book } from 'lucide-react';
import { motion } from 'framer-motion';
import MarketplaceFeed from '@/components/hub/MarketplaceFeed';
import ErrorBoundary from '@/components/ErrorBoundary';
import ItemIndexModal from '@/components/market/ItemIndexModal';
import DailyFlexynDrop from '@/components/market/DailyFlexynDrop';
import { useStartConversation } from '@/lib/hubMessaging';
import { useLanguage } from '@/lib/LanguageContext';

export default function Market() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const startConversation = useStartConversation();
  const [indexOpen, setIndexOpen] = useState(false);

  return (
    <div className="px-4 pt-4 md:px-8 md:pt-8 lg:pb-8 max-w-3xl mx-auto">
      {/* Header row — Browse every item button (book icon) */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-heading text-2xl md:text-3xl font-bold tracking-tight">Marketplace</h1>
        <button
          type="button"
          onClick={() => setIndexOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-secondary transition-colors text-xs font-semibold"
          title="Browse every item in the game"
        >
          <Book className="w-3.5 h-3.5" />
          Item Index
        </button>
      </div>

      {/* Trainer Programs — Coming Soon */}
      <motion.div
        className="w-full mb-4 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/8 via-violet-500/8 to-primary/8 p-4 flex items-center gap-3 text-start relative overflow-hidden select-none opacity-75"
        animate={{ boxShadow: ['0 0 0px rgba(139,92,246,0)', '0 0 18px rgba(139,92,246,0.25)', '0 0 0px rgba(139,92,246,0)'] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Animated shimmer */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(139,92,246,0.07) 50%, transparent 100%)' }}
          animate={{ x: ['-100%', '200%'] }}
          transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 2, ease: 'easeInOut' }}
        />
        <div className="w-10 h-10 rounded-xl bg-primary/12 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-primary/60" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-heading font-bold text-sm text-foreground/70">Trainer Programs</p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-400/25 text-[10px] font-bold uppercase tracking-wider text-violet-500">
              <Lock className="w-2.5 h-2.5" />
              Coming Soon
            </span>
          </div>
          <p className="text-xs text-muted-foreground/70">Premium regimens from certified creators — launching soon</p>
        </div>
      </motion.div>

      <ErrorBoundary label="Market">
        <MarketplaceFeed onStartConversation={startConversation} />
      </ErrorBoundary>

      {/* Daily Flexyn Drop — branded items, rotates every 24h.
          Moved BELOW the main marketplace feed per user feedback:
          the drop was eating prime real-estate at the top of the page
          where users expect to see browse/feed/listings. It still
          rotates daily and counts as "today's drop" — just lives
          underneath the main marketplace UI now. */}
      <div className="mt-4">
        <DailyFlexynDrop />
      </div>

      <ItemIndexModal open={indexOpen} onClose={() => setIndexOpen(false)} />
    </div>
  );
}
