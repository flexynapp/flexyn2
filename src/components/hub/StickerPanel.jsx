// src/components/hub/StickerPanel.jsx
// Sticker panel: shows who reacted with which sticker (viewer),
// and lets the current user pick a sticker from their inventory to react.

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';
import { playSound, SOUND } from '@/lib/playSound';
import { triggerHaptic } from '@/lib/haptic';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import * as inventory from '@/lib/data/inventory';
import * as stickerReactions from '@/lib/data/stickerReactions';
import { reportError } from '@/lib/reportError';
import StickerDisplay from './StickerDisplay';
import { RARITY } from '@/lib/lootCatalog';

function RarityBadge({ rarity, variant }) {
  const rc = RARITY[rarity] ?? RARITY.common;
  return (
    <span
      className="text-micro font-bold px-1.5 py-0.5 rounded-full border leading-none"
      style={{ color: rc.color, borderColor: rc.color, background: `${rc.color}18` }}
    >
      {rc.label}
    </span>
  );
}

export default function StickerPanel({ postId, onClose, onAuthorClick = null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('reactions'); // 'reactions' | 'pick'
  const [busy, setBusy] = useState(false);

  // All reactions on this post
  const { data: reactions = [] } = useQuery({
    queryKey: ['stickerReactions', postId],
    queryFn: () => stickerReactions.getPostReactions(postId),
    enabled: !!postId,
    staleTime: 10_000,
  });

  // Current user's reaction
  const myReaction = reactions.find(r => r.user_id === user?.id) ?? null;

  // User's inventory stickers
  const { data: rawItems } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn: () => inventory.listItems(user.email),
    enabled: !!user?.email,
    staleTime: 30_000,
  });
  const myStickers = Array.isArray(rawItems)
    ? rawItems.filter(i => i.item_type === 'sticker' && !i.is_listed)
    : [];
  // Deduplicate by item_id+variant (show one of each)
  const uniqueStickers = Object.values(
    myStickers.reduce((acc, item) => {
      const key = `${item.item_id}__${item.variant ?? ''}`;
      if (!acc[key]) acc[key] = item;
      return acc;
    }, {})
  );

  const handlePick = useCallback(async (sticker) => {
    if (!user?.id) return;
    setBusy(true);
    try {
      // Toggle: if already reacted with this exact sticker, remove it
      const alreadySame =
        myReaction?.item_id === sticker.item_id &&
        (myReaction?.variant ?? null) === (sticker.variant ?? null);

      if (alreadySame) {
        await stickerReactions.removeReaction(postId, user.id);
        toast('Sticker reaction removed');
      } else {
        await stickerReactions.reactWithSticker(postId, user, {
          item_id:    sticker.item_id,
          item_name:  sticker.item_name || sticker.name || sticker.item_emoji || 'Sticker',
          item_emoji: sticker.item_emoji,
          item_rarity: sticker.item_rarity,
          variant:    sticker.variant ?? null,
        });
        // Sound + haptic: sticker reactions are a premium feel moment
        playSound(SOUND.capsuleOpen); // bright, celebratory chime
        triggerHaptic('primary');
        toast(`${sticker.item_emoji} Sticker reaction added!`);
      }
      qc.invalidateQueries({ queryKey: ['stickerReactions', postId] });
      setTab('reactions');
    } catch (err) {
      // Generic toast — raw Postgres error.message can leak column / RLS
      // hints. Full detail still goes to Sentry via reportError.
      reportError(err, { feature: 'stickerPanel.react', level: 'warning', userEmail: user?.email, postId });
      toast.error('Could not react — try again.');
    } finally {
      setBusy(false);
    }
  }, [user, postId, myReaction, qc]);

  return (
    <motion.div
      className="bg-card border border-border rounded-xl overflow-hidden shadow-lg"
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('reactions')}
            className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${
              tab === 'reactions'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            Reactions {reactions.length > 0 && `(${reactions.length})`}
          </button>
          <button
            onClick={() => setTab('pick')}
            className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${
              tab === 'pick'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            My Stickers
          </button>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-md">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <AnimatePresence mode="wait">

        {/* ── Reactions tab ─────────────────────────────────────────────── */}
        {tab === 'reactions' && (
          <motion.div
            key="reactions"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="p-3 max-h-52 overflow-y-auto"
          >
            {reactions.length === 0 ? (
              <div className="flex flex-col items-center py-4 gap-2 text-center">
                <Sparkles className="w-6 h-6 text-muted-foreground/40" />
                <p className="text-muted-foreground text-xs">No sticker reactions yet.</p>
                <button
                  onClick={() => setTab('pick')}
                  className="text-xs text-primary hover:underline"
                >
                  Be the first — add yours!
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {reactions.map(r => {
                  const handleProfileClick = () => {
                    if (!onAuthorClick || !r.user_email) return;
                    onAuthorClick({
                      email: r.user_email,
                      username: r.user_name,
                      avatar_url: r.user_avatar_url,
                    });
                    onClose?.();
                  };
                  const profileClickable = !!(onAuthorClick && r.user_email);
                  return (
                  <div key={r.id} className="flex items-center gap-2.5">
                    {/* Avatar — clickable when onAuthorClick is wired */}
                    <button
                      type="button"
                      onClick={handleProfileClick}
                      disabled={!profileClickable}
                      className={`w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-micro font-bold text-primary shrink-0 overflow-hidden ${profileClickable ? 'hover:ring-2 hover:ring-primary/30 transition-shadow' : 'cursor-default'}`}
                      aria-label={profileClickable ? `Open ${r.user_name}'s profile` : undefined}
                    >
                      {r.user_avatar_url ? (
                        <img loading="lazy" src={r.user_avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        (r.user_name?.[0] ?? '?').toUpperCase()
                      )}
                    </button>
                    {profileClickable ? (
                      <button
                        type="button"
                        onClick={handleProfileClick}
                        className="text-xs text-muted-foreground hover:text-primary hover:underline flex-1 truncate text-start transition-colors"
                      >
                        @{r.user_name ?? 'athlete'}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground flex-1 truncate">
                        @{r.user_name ?? 'athlete'}
                      </span>
                    )}
                    <StickerDisplay
                      emoji={r.item_emoji}
                      variant={r.variant}
                      size={28}
                    />
                    {r.variant && (
                      <span className="text-micro font-bold capitalize" style={{ color: r.variant === 'gold' ? '#f59e0b' : r.variant === 'diamond' ? '#67e8f9' : '#e2e8f0' }}>
                        {r.variant}
                      </span>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Pick tab ──────────────────────────────────────────────────── */}
        {tab === 'pick' && (
          <motion.div
            key="pick"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="p-3 max-h-52 overflow-y-auto"
          >
            {uniqueStickers.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-xs">No stickers yet — open capsules!</p>
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {uniqueStickers.map(sticker => {
                  const isSelected =
                    myReaction?.item_id === sticker.item_id &&
                    (myReaction?.variant ?? null) === (sticker.variant ?? null);
                  return (
                    <motion.button
                      key={`${sticker.item_id}__${sticker.variant ?? ''}`}
                      whileTap={{ scale: 0.88 }}
                      onClick={() => !busy && handlePick(sticker)}
                      disabled={busy}
                      className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl border-2 transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : 'border-transparent hover:border-border hover:bg-secondary'
                      }`}
                      title={sticker.item_name + (sticker.variant ? ` (${sticker.variant})` : '')}
                    >
                      <StickerDisplay
                        emoji={sticker.item_emoji}
                        variant={sticker.variant}
                        size={32}
                      />
                    </motion.button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

      </AnimatePresence>
    </motion.div>
  );
}
