// src/components/ThemeSelector.jsx
// Theme picker with two sections: level-up themes + owned loot themes from capsules.

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Check, Sparkles, Package } from 'lucide-react';
import { useTheme, THEMES } from '@/lib/ThemeContext';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { LOOT_THEMES } from '@/lib/lootThemes';
import * as inventory from '@/lib/data/inventory';
import { toast } from 'sonner';

// Rarity colour tokens
const RARITY_COLORS = {
  common:    { ring: '#6b7280', label: 'text-muted-foreground', bg: 'bg-secondary/40' },
  uncommon:  { ring: '#22c55e', label: 'text-green-500',        bg: 'bg-green-500/10' },
  rare:      { ring: '#3b82f6', label: 'text-blue-500',         bg: 'bg-blue-500/10'  },
  epic:      { ring: '#a855f7', label: 'text-purple-500',       bg: 'bg-purple-500/10' },
  legendary: { ring: '#f59e0b', label: 'text-amber-400',        bg: 'bg-amber-400/10' },
};

export default function ThemeSelector({ open, onClose }) {
  const { t } = useLanguage();
  const { themeId, setThemeId, lootThemeId, setLootThemeId } = useTheme();
  const { user } = useAuth();

  const level = user?.current_level
    ?? calculateLevelFromXp(Number(user?.total_xp) || 0).level;

  // Fetch user's inventory to find owned themes
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn: () => inventory.listItems(user.email),
    enabled: !!user?.email && open,
  });

  // Build a set of owned loot theme ids
  const ownedLootIds = new Set(
    inventoryItems
      .filter(i => i.item_type === 'theme')
      .map(i => i.item_id)
  );

  // Only show loot themes the user owns
  const ownedLootThemes = LOOT_THEMES.filter(t => ownedLootIds.has(t.id));

  const handleSelectBase = useCallback((theme) => {
    if (level < theme.unlockLevel) {
      toast(`🔒 ${theme.name} unlocks at Level ${theme.unlockLevel}`, {
        description: `You're Level ${level}. Keep training to unlock this theme!`,
        duration: 3000,
      });
      return;
    }
    setThemeId(theme.id);
    onClose();
  }, [level, setThemeId, onClose]);

  const handleSelectLoot = useCallback((lootTheme) => {
    if (lootThemeId === lootTheme.id) {
      // Deactivate — revert to base theme
      setLootThemeId(null);
    } else {
      setLootThemeId(lootTheme.id);
    }
    onClose();
  }, [lootThemeId, setLootThemeId, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="theme-selector-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 56, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 56, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-border shrink-0">
              <div>
                <h2 className="font-heading font-bold text-xl tracking-tight">Themes</h2>
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <p className="text-sm text-muted-foreground">
                    Your level: <span className="font-semibold text-foreground">{level}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-secondary transition-colors -mt-0.5"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-4 py-4 space-y-6">

              {/* ── Loot themes section (only shown if user owns any) ── */}
              {ownedLootThemes.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Package className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-semibold text-primary uppercase tracking-wide">Capsule Drops</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {ownedLootThemes.map((lootTheme) => {
                      const isCurrent = lootThemeId === lootTheme.id;
                      const rc = RARITY_COLORS[lootTheme.rarity] || RARITY_COLORS.common;

                      return (
                        <motion.button
                          key={lootTheme.id}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => handleSelectLoot(lootTheme)}
                          className={[
                            'relative flex flex-col p-4 rounded-2xl border-2 text-left transition-all duration-200',
                            isCurrent
                              ? 'shadow-lg'
                              : 'border-border bg-card hover:border-primary/50 hover:shadow-md hover:bg-secondary/30',
                          ].join(' ')}
                          style={isCurrent ? { borderColor: rc.ring, background: `${rc.ring}18` } : {}}
                        >
                          {/* Active check */}
                          {isCurrent && (
                            <div className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center shadow-sm"
                              style={{ background: rc.ring }}>
                              <Check className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}

                          {/* Emoji + animated hint */}
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-2xl">{lootTheme.emoji}</span>
                            {lootTheme.animated && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                                style={{ background: `${rc.ring}30`, color: rc.ring }}>
                                Animated
                              </span>
                            )}
                          </div>

                          {/* Color swatches */}
                          <div className="flex gap-1.5 mb-2.5">
                            {lootTheme.preview.map((hex, i) => (
                              <div key={i} className="w-7 h-7 rounded-full shadow-sm ring-2 ring-white/20"
                                style={{ backgroundColor: hex }} />
                            ))}
                          </div>

                          {/* Name */}
                          <p className="font-heading font-bold text-sm leading-tight text-foreground">
                            {lootTheme.name}
                          </p>

                          {/* Description */}
                          <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                            {lootTheme.description}
                          </p>

                          {/* Rarity badge */}
                          <div className={`flex items-center gap-1 mt-2 px-1.5 py-0.5 rounded-full self-start ${rc.bg}`}>
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: rc.ring }} />
                            <span className={`text-[10px] font-semibold capitalize ${rc.label}`}>
                              {lootTheme.rarity}
                            </span>
                          </div>

                          {isCurrent && (
                            <div className="flex items-center gap-1 mt-2">
                              <div className="w-1.5 h-1.5 rounded-full" style={{ background: rc.ring }} />
                              <span className="text-[11px] font-semibold" style={{ color: rc.ring }}>Active</span>
                            </div>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Level-up themes ── */}
              <div>
                {ownedLootThemes.length > 0 && (
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Level Themes</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {THEMES.map((theme) => {
                    const isLocked  = level < theme.unlockLevel;
                    // A base theme is "current" only if no loot theme is active
                    const isCurrent = !lootThemeId && themeId === theme.id;

                    return (
                      <motion.button
                        key={theme.id}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => handleSelectBase(theme)}
                        className={[
                          'relative flex flex-col p-4 rounded-2xl border-2 text-left transition-all duration-200 group',
                          isCurrent
                            ? 'border-primary bg-primary/5 shadow-lg shadow-primary/15'
                            : isLocked
                            ? 'border-border/60 bg-muted/20'
                            : 'border-border bg-card hover:border-primary/50 hover:shadow-md hover:bg-secondary/30',
                        ].join(' ')}
                      >
                        {/* Active check badge */}
                        {isCurrent && (
                          <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary flex items-center justify-center shadow-sm">
                            <Check className="w-3.5 h-3.5 text-primary-foreground" />
                          </div>
                        )}

                        {/* Color swatches */}
                        <div className={`flex gap-2 mb-3 ${isLocked ? 'opacity-50' : ''}`}>
                          {theme.preview.map((hex, i) => (
                            <div
                              key={i}
                              className="w-9 h-9 rounded-full shadow-md ring-2 ring-white/30"
                              style={{ backgroundColor: hex }}
                            />
                          ))}
                        </div>

                        {/* Name */}
                        <p className={`font-heading font-bold text-sm leading-tight ${isLocked ? 'text-muted-foreground' : 'text-foreground'}`}>
                          {theme.name}
                        </p>

                        {/* Description */}
                        <p className="text-[11px] text-muted-foreground leading-tight mt-1">
                          {theme.description}
                        </p>

                        {/* Lock row */}
                        {isLocked && (
                          <div className="flex items-center gap-1.5 mt-2.5">
                            <div className="flex items-center justify-center w-4 h-4 rounded-full bg-muted">
                              <Lock className="w-2.5 h-2.5 text-muted-foreground" />
                            </div>
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              Level {theme.unlockLevel}
                            </span>
                          </div>
                        )}

                        {/* "Active" label for current unlocked theme */}
                        {isCurrent && !isLocked && (
                          <div className="flex items-center gap-1 mt-2.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                            <span className="text-[11px] font-semibold text-primary">Active</span>
                          </div>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Footer hint */}
              <div className="flex items-center justify-center gap-2 mb-2 py-3 px-4 rounded-2xl bg-secondary/40 border border-border/50">
                <Package className="w-3.5 h-3.5 text-primary shrink-0" />
                <p className="text-xs text-muted-foreground text-center leading-tight">
                  Animated themes drop from <span className="font-semibold text-foreground">Loot Capsules</span> — higher tier capsules have better odds
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
