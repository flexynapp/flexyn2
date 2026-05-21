// src/pages/Bounties.jsx
// Dedicated bounty board page — linked from Dashboard and Hub.

import React from 'react';
import { Zap, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BountyBoard from '@/components/bounties/BountyBoard';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useLanguage } from '@/lib/LanguageContext';

export default function Bounties() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <div className="px-4 md:px-8 pb-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 pt-4 pb-5 sticky top-0 bg-background/95 backdrop-blur z-10">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-secondary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center">
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <h1 className="font-heading font-bold text-lg leading-tight">{t('bounties.title') || 'Bounties'}</h1>
            <p className="text-[10px] text-muted-foreground">{t('bounties.subtitle') || 'Daily social challenges · Pay to claim · Earn on completion'}</p>
          </div>
        </div>
      </div>

      <ErrorBoundary label="BountyBoard">
        <BountyBoard />
      </ErrorBoundary>
    </div>
  );
}
