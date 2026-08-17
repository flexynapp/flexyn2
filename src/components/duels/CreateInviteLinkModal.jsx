// src/components/duels/CreateInviteLinkModal.jsx
//
// Modal on the Duels page that lets a user generate a shareable
// duel-invite URL — pick a duel type, hit Create, get a copy/share
// affordance. The recipient opens the URL and lands on
// /duel-invite/<token>; if they're not on Flexyn yet they go through
// signup and bounce back. This is the viral wedge for Duels.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Swords, Copy, Share2, Loader2, Check, Link as LinkIcon } from 'lucide-react';
import { toast } from '@/lib/toast';
import { createInviteLink, buildInviteUrl } from '@/lib/data/duelInvites';
import { useDateFormatter } from '@/lib/intl';
import { useLanguage } from '@/lib/LanguageContext';

const TYPE_OPTIONS = [
  { id: 'open',     label: 'Open',     desc: 'Most total volume wins' },
  { id: 'mirror',   label: 'Mirror',   desc: 'Complete the same session' },
  { id: 'exercise', label: 'Exercise', desc: 'Single exercise showdown' },
];

export default function CreateInviteLinkModal({ open, onOpenChange }) {
  const { tFallback } = useLanguage();
  const fmtDate = useDateFormatter();
  const [duelType, setDuelType] = useState('open');
  const [windowHours, setWindowHours] = useState(24);
  const [creating, setCreating] = useState(false);
  const [generated, setGenerated] = useState(null); // { token, expires_at, ... }
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setDuelType('open');
    setWindowHours(24);
    setCreating(false);
    setGenerated(null);
    setCopied(false);
  };

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const result = await createInviteLink({
        duelType,
        windowHours,
      });
      setGenerated(result);
    } catch (err) {
      const code = err?.code || err?.status;
      if (code === '42883' || code === '42P01') {
        toast.error(tFallback('createInviteLinkModal.migrationMissing', 'Invite system pending. Apply migration 072.'));
      } else {
        toast.error(tFallback('createInviteLinkModal.createFailed', 'Could not create invite. Try again.'));
      }
      console.error('[CreateInviteLinkModal] create failed:', err);
    } finally {
      setCreating(false);
    }
  };

  const url = generated ? buildInviteUrl(generated.token) : '';

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(tFallback("referral.copied", "Link copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(tFallback("createInviteLinkModal.couldNotCopy", "Could not copy"));
    }
  };

  const handleNativeShare = async () => {
    if (!url) return;
    if (typeof navigator.share !== 'function') return handleCopy();
    try {
      await navigator.share({
        title: tFallback('createInviteLinkModal.shareTitle', 'Flexyn duel'),
        text: tFallback('createInviteLinkModal.shareText', 'I am challenging you to a duel on Flexyn:'),
        url,
      });
    } catch { /* user cancelled */ }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading">
            <LinkIcon className="w-5 h-5 text-rose-500" />
            {tFallback("createInviteLinkModal.challengeByLink", "Challenge by link")}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Generate a shareable URL. Anyone with the link can accept —
            including friends who aren't on Flexyn yet.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {!generated ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="space-y-4 mt-2"
            >
              {/* Type picker */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{tFallback("createInviteLinkModal.duelType", "Duel type")}</p>
                <div className="space-y-1.5">
                  {TYPE_OPTIONS.map(opt => {
                    const active = duelType === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setDuelType(opt.id)}
                        className={`w-full text-start p-3 rounded-xl border-2 transition-colors ${
                          active
                            ? 'border-rose-500 bg-rose-500/10'
                            : 'border-border hover:border-border/80'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm">{tFallback(`duel.type.${opt.id}.chip`, opt.label)}</span>
                          {active && <Check className="w-4 h-4 text-rose-500" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{tFallback(`duel.type.${opt.id}.rulesShort`, opt.desc)}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Window picker — simple chips */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {tFallback("createInviteLinkModal.timeWindowAfterAccept", "Time window after accept")}
                </p>
                <div className="flex gap-2">
                  {[24, 48, 72].map(h => {
                    const active = windowHours === h;
                    return (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setWindowHours(h)}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold border ${
                          active
                            ? 'bg-rose-500 text-white border-transparent'
                            : 'bg-secondary text-muted-foreground border-border hover:text-foreground active:text-foreground'
                        }`}
                      >
                        {h}h
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={handleCreate}
                disabled={creating}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 active:bg-rose-600 disabled:opacity-50 transition-colors shadow-md"
              >
                {creating
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Swords className="w-4 h-4" />}
                {creating ? 'Generating…' : 'Generate invite link'}
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="space-y-3 mt-2"
            >
              <div className="rounded-xl bg-secondary/50 border border-border p-3">
                <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  {tFallback("createInviteLinkModal.yourInviteLink", "Your invite link")}
                </p>
                <p className="text-xs font-mono break-all text-foreground">{url}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-secondary text-sm font-bold border border-border hover:bg-secondary/80 active:bg-secondary/80 transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={handleNativeShare}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 active:bg-primary/90 transition-colors"
                >
                  <Share2 className="w-4 h-4" /> {tFallback("common.share", "Share")}
                </button>
              </div>
              <p className="text-micro text-muted-foreground text-center">
                Expires {fmtDate(generated.expires_at)} ·
                {' '}{generated.window_hours}h window after accept
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
