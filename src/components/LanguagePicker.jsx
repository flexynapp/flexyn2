import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

export default function LanguagePicker({ variant = 'inline', onSelect, iconOnly = false }) {
  const { language, setLanguage, SUPPORTED_LANGUAGES, currentLanguage, tFallback } = useLanguage();
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState({});
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open && variant !== 'inline');
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    const handleMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const handleOpen = () => {
    if (triggerRef.current && variant !== 'inline') {
      const rect = triggerRef.current.getBoundingClientRect();
      const dropdownWidth = 208; // w-52
      const centerX = rect.left + rect.width / 2;
      const left = Math.max(8, Math.min(centerX - dropdownWidth / 2, window.innerWidth - dropdownWidth - 8));
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left,
        width: dropdownWidth,
      });
    }
    setOpen(o => !o);
  };

  const handleSelect = (code) => {
    setLanguage(code);
    setOpen(false);
    onSelect?.(code);
  };

  const dropdownVariants = {
    initial: { opacity: 0, y: 6, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 6, scale: 0.97 },
  };

  const dropdownTransition = {
    type: 'spring',
    stiffness: 400,
    damping: 30,
  };

  // One language on offer means there is nothing to pick. Rendering the control
  // anyway gives the user a menu whose only entry is the state they are already
  // in — it reads as a setting that does not work, which is worse than no
  // setting at all. This is derived, not hardcoded: re-release a locale in
  // SUPPORTED_LANGUAGES and the picker comes back at all four mount points
  // without anyone remembering it exists.
  //
  // Placed AFTER every hook. An early return above them changes the hook count
  // between renders, which is the crash LanguageContext's own header warns
  // about.
  if (SUPPORTED_LANGUAGES.length < 2) return null;

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger */}
      {variant === 'inline' ? (
        <button
          type="button"
          ref={triggerRef}
          onClick={handleOpen}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-background hover:bg-secondary active:bg-secondary text-sm font-medium transition-colors"
        >
          <span className="flex items-center gap-2">
            <span>{currentLanguage.flag}</span>
            <span>{currentLanguage.nativeLabel}</span>
          </span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </motion.span>
        </button>
      ) : iconOnly ? (
        <button
          type="button"
          ref={triggerRef}
          onClick={handleOpen}
          className="flex items-center gap-0.5 justify-center px-2 h-8 rounded-lg border border-border hover:bg-secondary active:bg-secondary transition-colors"
          title={tFallback("languagePicker.changeLanguage", "Change language")}
        >
          <span className="text-base leading-none">🌐</span>
        </button>
      ) : (
        <button
          type="button"
          ref={triggerRef}
          onClick={handleOpen}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:bg-secondary active:bg-secondary text-xs font-medium transition-colors"
          title="Change language / 언어 변경 / Idioma"
        >
          <span>🗣️</span>
          <span>{currentLanguage.flag}</span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </motion.span>
        </button>
      )}

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            variants={dropdownVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={dropdownTransition}
            className="z-50 bg-card border border-border rounded-xl shadow-xl overflow-y-auto max-h-64"
            style={variant === 'inline'
              ? { position: 'absolute', left: 0, right: 0, width: '100%', bottom: '100%', marginBottom: 4, maxHeight: 288 }
              : dropdownStyle
            }
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <motion.button
                key={lang.code}
                type="button"
                onClick={() => handleSelect(lang.code)}
                whileHover={{ backgroundColor: 'hsl(var(--secondary))' }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-start transition-colors"
              >
                <span className="text-base">{lang.flag}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium leading-tight">{lang.nativeLabel}</span>
                  <span className="block text-xs text-muted-foreground leading-tight">{lang.label}</span>
                </span>
                {language === lang.code && (
                  <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                )}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}