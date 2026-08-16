// src/pages/Bounties.jsx
// Dedicated bounty board page — linked from Dashboard and Hub.

import React, { useState, lazy, Suspense } from 'react';
import { Zap, ArrowLeft, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import BountyBoard from '@/components/bounties/BountyBoard';
import SoloChallengesSection from '@/components/bounties/SoloChallengesSection';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useLanguage } from '@/lib/LanguageContext';

const CreateBountyModal = lazy(() => import('@/components/bounties/CreateBountyModal'));

export default function Bounties() {
  const navigate = useNavigate();
  const { t, tFallback } = useLanguage();
  const qc = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);

  return (
    <div className="px-4 md:px-8 pb-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 pt-4 pb-5 sticky top-0 bg-background/95 backdrop-blur z-10">
        <button
          onClick={() => {
            // A user who deep-linked here (push notification, shared URL)
            // has empty history → `navigate(-1)` silently no-ops. Fall back
            // to a safe parent route so the back button always does
            // something.
            if (window.history.length > 1) navigate(-1);
            else navigate('/dashboard');
          }}
          className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-secondary active:bg-secondary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <div className="min-w-0">
            <h1 className="font-heading font-bold text-lg leading-tight">{tFallback('bounties.title', 'Bounties')}</h1>
            <p className="text-micro text-muted-foreground truncate">{tFallback('bounties.subtitle', 'Daily social challenges · Pay to claim · Earn on completion')}</p>
          </div>
        </div>
        {/* Post-your-own — user-created bounty composer (A4). Server-
            enforces caller==target so this only ever creates a bounty
            on the caller's own record. */}
        <button
          onClick={() => setComposeOpen(true)}
          className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-amber-500 hover:bg-amber-600 active:bg-amber-600 text-white text-xs font-bold transition-colors"
          aria-label={tFallback('bounties.post', 'Post your own bounty')}
        >
          <Plus className="w-3.5 h-3.5" />
          {tFallback('bounties.post', 'Post your own bounty')}
        </button>
      </div>

      {/* Solo Challenges — non-targeted, anyone-can-claim bounties.
          Lives above the targeted bounty board so users encounter
          the "lift X this week" challenges before scrolling into
          social ones. (See migration 171 + soloChallenges.js.) */}
      <ErrorBoundary label="SoloChallengesSection">
        <SoloChallengesSection />
      </ErrorBoundary>

      <ErrorBoundary label="BountyBoard">
        <BountyBoard />
      </ErrorBoundary>

      {composeOpen && (
        <Suspense fallback={null}>
          <CreateBountyModal
            open={composeOpen}
            onClose={() => setComposeOpen(false)}
            onCreated={() => {
              // Refresh the board so the new user-created bounty
              // shows up immediately. The list query lives in
              // BountyBoard.jsx with key ['bounties', ...].
              qc.invalidateQueries({ queryKey: ['bounties'] });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
