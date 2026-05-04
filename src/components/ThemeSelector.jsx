// src/components/ThemeSelector.jsx
// Full-screen modal for choosing an app theme. Themes have an `unlockLevel`
// requirement; locked themes are shown grayed-out with a centered lock icon so
// users can see what they're working toward.

import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Check } from 'lucide-react';
import { useTheme, THEMES } from '@/lib/ThemeContext';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateLevelFromXp } from '@/lib/xpSystem';

export default function ThemeSelector({ open, onClose }) {
  const { t } = useLanguage();
  const { themeId, setThemeId } = useTheme();
  const { user } = useAuth();

  // Determine the user's current level. Prefer the DB-persisted column (updated
  // by migration 006 / increment_user_xp RPC); fall back to a client-side calc
  // from total_xp so the selector works even before the migration has been run.
  const level = user?.current_level
    ?? calculateLevelFromXp(Number(user?.total_xp) || 0).level;

  const handleSelect = useCallback((theme) => {
    if (level < theme.unlockLevel) return; // locked — ignore tap
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 48, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 48, scale: 0.97 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div>
                <h2 className="font-heading font-bold text-lg">{t('hub.themes.title')}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('hub.themes.subtitle').replace('{level}', level)}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-secondary transition-colors"
                aria-label={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Theme grid */}
            <div className="overflow-y-auto flex-1 p-4">
              <div className="grid grid-cols-2 gap-3">
                {THEMES.map((theme) => {
                  const isLocked   = level < theme.unlockLevel;
                  const isCurrent  = themeId === theme.id;

                  return (
                    <motion.button
                      key={theme.id}
                      whileTap={!isLocked ? { scale: 0.97 } : {}}
                      onClick={() => handleSelect(theme)}
                      disabled={isLocked}
                      className={[
                        'relative rounded-xl border-2 p-3 text-left transition-all overflow-hidden',
                        isCurrent
                          ? 'border-primary shadow-md'
                          : isLocked
                          ? 'border-border opacity-50 cursor-not-allowed'
                          : 'border-border hover:border-primary/50 hover:shadow-sm cursor-pointer',
                      ].join(' ')}
                    >
                      {/* Color preview swatches */}
                      <div className="flex gap-1.5 mb-2.5">
                        {theme.preview.map((hex, i) => (
                          <div
                            key={i}
                            className="w-7 h-7 rounded-full border border-white/20 shadow-sm"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>

                      {/* Name + description */}
                      <p className="font-heading font-bold text-sm leading-tight">{theme.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{theme.description}</p>

                      {/* Lock badge */}
                      {isLocked && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/60 rounded-xl gap-1">
                          <Lock className="w-5 h-5 text-muted-foreground" />
                          <span className="text-[10px] font-bold text-muted-foreground">
                            {t('hub.themes.lockedAt').replace('{n}', theme.unlockLevel)}
                          </span>
                        </div>
                      )}

                      {/* Active checkmark */}
                      {isCurrent && !isLocked && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="w-3 h-3 text-primary-foreground" />
                        </div>
                      )}
                    </motion.button>
                  );
                })}
              </div>

              {/* Hint about capsule themes */}
              <p className="text-center text-xs text-muted-foreground mt-4 px-2">
                {t('hub.themes.capsuleHint')}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
