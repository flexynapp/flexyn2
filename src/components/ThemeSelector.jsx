// src/components/ThemeSelector.jsx
// S-tier theme picker. Each card has its own layout rows so nothing ever
// overlaps or truncates. Locked themes dim and show the required level;
// tapping them shows a toast instead of silently ignoring the tap.

import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Check, Sparkles } from 'lucide-react';
import { useTheme, THEMES } from '@/lib/ThemeContext';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { toast } from 'sonner';

export default function ThemeSelector({ open, onClose }) {
  const { t } = useLanguage();
  const { themeId, setThemeId } = useTheme();
  const { user } = useAuth();

  const level = user?.current_level
    ?? calculateLevelFromXp(Number(user?.total_xp) || 0).level;

  const handleSelect = useCallback((theme) => {
    if (level < theme.unlockLevel) {
      toast(`🔒 ${theme.name} unlocks at Level ${theme.unlockLevel}`, {
        description: `You're Level ${level}. Keep training to unlock this theme!`,
        duration: 3000,
      });
      return;
    }
    setThemeId(theme.id);
  }, [level, setThemeId]);

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

            {/* Theme grid */}
            <div className="overflow-y-auto flex-1 px-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                {THEMES.map((theme) => {
                  const isLocked  = level < theme.unlockLevel;
                  const isCurrent = themeId === theme.id;

                  return (
                    <motion.button
                      key={theme.id}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelect(theme)}
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

              {/* Footer hint */}
              <div className="flex items-center justify-center gap-2 mt-5 mb-2 py-3 px-4 rounded-2xl bg-secondary/40 border border-border/50">
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                <p className="text-xs text-muted-foreground text-center leading-tight">
                  More themes coming — unlock them through <span className="font-semibold text-foreground">Loot Capsules</span>
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
