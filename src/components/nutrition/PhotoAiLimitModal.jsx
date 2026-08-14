// src/components/nutrition/PhotoAiLimitModal.jsx
//
// Shown when the user has spent their daily Photo-AI scan allotment (default
// 3/day). Tells them they're out, that scans reset tomorrow, and offers a
// one-time unlock for unlimited scans.
//
// The "$2.99" button calls onPurchase — the integration point for the native
// in-app purchase (App Store / Play Store). This component never collects
// payment details itself.

import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, Clock, Infinity as InfinityIcon, Sparkles, Loader2 } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

export default function PhotoAiLimitModal({ open, used = 3, cap = 3, purchasing = false, onClose, onPurchase }) {
  const { tFallback } = useLanguage();
  useBodyScrollLock(open);
  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[9999] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-sm bg-card border border-border rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl"
        >
          {/* Hero */}
          <div
            className="relative px-6 pt-7 pb-6 text-center text-white overflow-hidden"
            style={{ background: 'linear-gradient(315deg, hsl(var(--primary) / 0.82) 0%, hsl(var(--primary)) 55%, hsl(var(--primary) / 0.92) 100%)' }}
          >
            <button
              onClick={onClose}
              aria-label={tFallback("common.close", "Close")}
              className="absolute top-3 end-3 w-8 h-8 rounded-full bg-black/20 text-white flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center mx-auto mb-3 backdrop-blur-sm">
              <Camera className="w-7 h-7" />
            </div>
            <h2 className="font-heading font-bold text-lg leading-tight">{tFallback("photoAiLimitModal.youReOutOfPhoto", "You're out of Photo-AI scans")}</h2>
            <p className="text-label text-white/85 mt-1">
              You've used all {cap} of today's scans.
            </p>

            {/* Usage dots */}
            <div className="flex items-center justify-center gap-1.5 mt-3">
              {Array.from({ length: cap }).map((_, i) => (
                <span
                  key={i}
                  className={`w-2.5 h-2.5 rounded-full ${i < Math.min(used, cap) ? 'bg-white' : 'bg-white/30'}`}
                />
              ))}
              <span className="ms-1.5 text-micro font-bold text-white/90 tabular-nums">{Math.min(used, cap)}/{cap} used</span>
            </div>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {/* Resets tomorrow */}
            <div className="flex items-center gap-2.5 rounded-xl bg-secondary/60 px-3.5 py-3">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <p className="text-label text-muted-foreground">
                Your free scans <span className="font-semibold text-foreground">reset tomorrow</span> — come back for {cap} more.
              </p>
            </div>

            {/* Unlimited upsell */}
            <button
              type="button"
              onClick={onPurchase}
              disabled={purchasing}
              className="w-full rounded-xl px-4 py-3.5 text-white flex items-center gap-3 text-start shadow-sm active:scale-[0.99] transition-transform disabled:opacity-70"
              style={{ background: 'linear-gradient(315deg, hsl(var(--primary) / 0.88) 0%, hsl(var(--primary)) 60%, hsl(var(--primary) / 0.95) 100%)' }}
            >
              <span className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                {purchasing ? <Loader2 className="w-5 h-5 animate-spin" /> : <InfinityIcon className="w-5 h-5" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 font-heading font-bold text-body">
                  Unlimited Photo-AI <Sparkles className="w-3.5 h-3.5" />
                </span>
                <span className="block text-micro text-white/85">One-time unlock — scan as much as you want</span>
              </span>
              <span className="font-heading font-black text-lg shrink-0">$2.99</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-full text-center text-label font-semibold text-muted-foreground hover:text-foreground active:text-foreground py-1.5 transition-colors"
            >
              Maybe tomorrow
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
