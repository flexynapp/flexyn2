import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { WIDGET_DEFINITIONS, WIDGET_CATEGORIES } from '@/lib/widgetDefinitions';
import { useLanguage } from '@/lib/LanguageContext';

export default function WidgetLibrary({ open, onClose, onSelect, onRemove, activeWidgets = [] }) {
  const { t, tFallback } = useLanguage();
  const [selectedCategory, setSelectedCategory] = useState('all');

  const filteredWidgets = selectedCategory === 'all'
    ? WIDGET_DEFINITIONS
    : WIDGET_DEFINITIONS.filter(w => w.category === selectedCategory);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">{t('widgets.library')}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">{t('widgets.customize')}</p>
        </DialogHeader>

        {/* Category Filter */}
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={selectedCategory === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategory('all')}
          >
            {t('progress.all')}
          </Button>
          {WIDGET_CATEGORIES.map(cat => (
            <Button
              key={cat.id}
              variant={selectedCategory === cat.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(cat.id)}
            >
              {t(cat.labelKey)}
            </Button>
          ))}
        </div>

        {/* Widget Grid — crossfade between filtered category states */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={selectedCategory}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="grid grid-cols-1 md:grid-cols-2 gap-3"
          >
            {filteredWidgets.map((widget) => {
              const isActive = activeWidgets.includes(widget.id);
              // Whole card is a toggle: add if off, remove if on. The
              // library now stays open across taps (no auto-close), so a
              // user can add/remove several widgets in one pass and see
              // each card's state flip in place.
              const toggle = () => (isActive ? onRemove?.(widget.id) : onSelect(widget.id));
              return (
                <Card
                  key={widget.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isActive}
                  className={`p-4 cursor-pointer border-2 transition-all min-h-[44px] ${
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border active:border-primary/60'
                  }`}
                  onClick={toggle}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-2xl shrink-0">{widget.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{t(widget.nameKey)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t(widget.descriptionKey)}</p>
                      {/* Guard against a widget pointing at an
                          unknown category (deprecation drift between
                          WIDGET_DEFINITIONS and WIDGET_CATEGORIES) —
                          rendering t(undefined) printed the literal
                          string 'undefined' inside the badge. */}
                      {(() => {
                        const cat = WIDGET_CATEGORIES.find(c => c.id === widget.category);
                        if (!cat?.labelKey) return null;
                        return (
                          <div className="mt-2">
                            <Badge variant="secondary" className="text-xs">
                              {t(cat.labelKey)}
                            </Badge>
                          </div>
                        );
                      })()}
                    </div>
                    {/* Trailing toggle control — 44px tap target. Off = +,
                        On = green check that removes on tap (no hover needed,
                        so it works on touch). */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggle(); }}
                      aria-label={isActive
                        ? tFallback('widgets.removeFromDashboard', 'On dashboard — tap to remove')
                        : tFallback('widgets.addToDashboard', 'Add to dashboard')}
                      className={`shrink-0 h-11 w-11 rounded-full flex items-center justify-center transition-colors ${
                        isActive
                          ? 'bg-success text-white active:bg-success'
                          : 'bg-secondary text-foreground active:bg-primary/15'
                      }`}
                    >
                      {isActive ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                    </button>
                  </div>
                </Card>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}