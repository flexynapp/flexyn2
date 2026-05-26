import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { WIDGET_DEFINITIONS, WIDGET_CATEGORIES } from '@/lib/widgetDefinitions';
import { useLanguage } from '@/lib/LanguageContext';

export default function WidgetLibrary({ open, onClose, onSelect, activeWidgets = [] }) {
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
              return (
                <Card
                  key={widget.id}
                  className={`p-4 cursor-pointer border-2 transition-all ${
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => !isActive && onSelect(widget.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-2xl shrink-0">{widget.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{t(widget.nameKey)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t(widget.descriptionKey)}</p>
                      <div className="mt-2">
                        <Badge variant="secondary" className="text-xs">
                          {t(WIDGET_CATEGORIES.find(c => c.id === widget.category)?.labelKey)}
                        </Badge>
                      </div>
                    </div>
                    {!isActive && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="shrink-0 h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(widget.id);
                        }}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    )}
                    {isActive && (
                      // Active widgets show "On Dashboard" rather than
                      // the same "Add" label as inactive widgets.
                      // Previously the badge text was identical and
                      // tapping did nothing — users couldn't tell which
                      // widgets were already in their dashboard.
                      // (Audit 08 #5.)
                      <Badge className="shrink-0 bg-green-600 text-white">{tFallback('widgets.onDashboard', 'On Dashboard')}</Badge>
                    )}
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