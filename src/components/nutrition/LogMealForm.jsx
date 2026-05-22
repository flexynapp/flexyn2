import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Barcode, Plus, Bookmark, Trash2, ImageIcon } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import { toast } from 'sonner';
import { loadSavedMeals, removeSavedMeal } from '@/lib/savedMeals';

// TABS are built inside the component to support t()

const NUTRIENT_FIELDS = [
  { key: 'calories',       labelKey: 'nutrition.macros.calories',    placeholder: '0', unit: 'kcal', textColor: 'text-orange-600', bgColor: 'bg-orange-50 dark:bg-orange-950/20' },
  { key: 'protein_g',      labelKey: 'nutrition.macros.protein',     placeholder: '0', unit: 'g',    textColor: 'text-red-600',    bgColor: 'bg-red-50 dark:bg-red-950/20' },
  { key: 'carbs_g',        labelKey: 'nutrition.macros.carbs',       placeholder: '0', unit: 'g',    textColor: 'text-blue-600',   bgColor: 'bg-blue-50 dark:bg-blue-950/20' },
  { key: 'fat_g',          labelKey: 'nutrition.macros.fat',         placeholder: '0', unit: 'g',    textColor: 'text-yellow-600', bgColor: 'bg-yellow-50 dark:bg-yellow-950/20' },
  { key: 'sodium_mg',      labelKey: 'nutrition.macros.sodium',      placeholder: '0', unit: 'mg',   textColor: 'text-pink-600',   bgColor: 'bg-pink-50 dark:bg-pink-950/20' },
  { key: 'fiber_g',        labelKey: 'nutrition.macros.fiber',       placeholder: '0', unit: 'g',    textColor: 'text-green-600',  bgColor: 'bg-green-50 dark:bg-green-950/20' },
  { key: 'sugar_g',        labelKey: 'nutrition.macros.sugar',       placeholder: '0', unit: 'g',    textColor: 'text-purple-600', bgColor: 'bg-purple-50 dark:bg-purple-950/20' },
  { key: 'cholesterol_mg', labelKey: 'nutrition.macros.cholesterol', placeholder: '0', unit: 'mg',   textColor: 'text-cyan-600',   bgColor: 'bg-cyan-50 dark:bg-cyan-950/20' },
];

const VITAMIN_FIELDS = [
  { key: 'iron_mg',         labelKey: 'nutrition.minerals.iron',      placeholder: '0', unit: 'mg',  textColor: 'text-red-600',     bgColor: 'bg-red-50 dark:bg-red-950/20' },
  { key: 'magnesium_mg',    labelKey: 'nutrition.minerals.magnesium', placeholder: '0', unit: 'mg',  textColor: 'text-emerald-600', bgColor: 'bg-emerald-50 dark:bg-emerald-950/20' },
  { key: 'calcium_mg',      labelKey: 'nutrition.minerals.calcium',   placeholder: '0', unit: 'mg',  textColor: 'text-slate-600',   bgColor: 'bg-slate-50 dark:bg-slate-950/20' },
  { key: 'potassium_mg',    labelKey: 'nutrition.minerals.potassium', placeholder: '0', unit: 'mg',  textColor: 'text-yellow-600',  bgColor: 'bg-yellow-50 dark:bg-yellow-950/20' },
  { key: 'vitamin_a_iu',    labelKey: 'nutrition.vitamins.a',         placeholder: '0', unit: 'IU',  textColor: 'text-orange-600',  bgColor: 'bg-orange-50 dark:bg-orange-950/20' },
  { key: 'vitamin_c_mg',    labelKey: 'nutrition.vitamins.c',         placeholder: '0', unit: 'mg',  textColor: 'text-rose-600',    bgColor: 'bg-rose-50 dark:bg-rose-950/20' },
  { key: 'vitamin_d_iu',    labelKey: 'nutrition.vitamins.d',         placeholder: '0', unit: 'IU',  textColor: 'text-amber-600',   bgColor: 'bg-amber-50 dark:bg-amber-950/20' },
  { key: 'vitamin_b12_mcg', labelKey: 'nutrition.vitamins.b12',       placeholder: '0', unit: 'mcg', textColor: 'text-purple-600',  bgColor: 'bg-purple-50 dark:bg-purple-950/20' },
];

function NutrientTile({ field, value, onChange, t }) {
  return (
    <div className={`${field.bgColor} rounded-lg p-3`}>
      <p className="text-xs text-muted-foreground mb-1.5 truncate">
        {t(field.labelKey)}
        <span className="ms-1 opacity-60">({field.unit})</span>
      </p>
      <Input
        type="number"
        min="0"
        step="0.1"
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        className={`h-8 text-sm font-heading font-bold border-0 bg-white/60 dark:bg-black/20 ${field.textColor} placeholder:text-muted-foreground/40 focus-visible:ring-1`}
      />
    </div>
  );
}

export default function LogMealForm({ newEntry, setNewEntry, onScan, onLog, isScanning, isLogging, defaultOpen = false }) {
  const { t } = useLanguage();
  const TABS = [
    { id: 'nutrients', label: t('nutrition.nutritionalValues') },
    { id: 'vitamins', label: t('nutrition.vitaminsAndMinerals') },
    { id: 'saved', label: '🔖 Saved' },
  ];
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState('nutrients');
  const [slideDir, setSlideDir] = useState(1);
  const [savedMeals, setSavedMeals] = useState([]);
  const [expandedSaved, setExpandedSaved] = useState(null);

  // Load saved meals whenever the tab becomes active
  useEffect(() => {
    if (activeTab === 'saved') setSavedMeals(loadSavedMeals());
  }, [activeTab, open]);

  const handleUnsaveMeal = (id) => {
    removeSavedMeal(id);
    setSavedMeals(prev => prev.filter(m => m.id !== id));
    if (expandedSaved === id) setExpandedSaved(null);
  };

  const handleUseSavedMeal = (meal) => {
    setNewEntry(prev => ({
      ...prev,
      food_name: meal.food_name || '',
      calories: meal.calories ?? '',
      protein_g: meal.protein_g ?? '',
      carbs_g: meal.carbs_g ?? '',
      fat_g: meal.fat_g ?? '',
    }));
    const fromIdx = TABS.findIndex(t => t.id === 'saved');
    const toIdx = TABS.findIndex(t => t.id === 'nutrients');
    setSlideDir(toIdx > fromIdx ? 1 : -1);
    setActiveTab('nutrients');
    toast.success(`"${meal.food_name}" prefilled — review and log!`);
  };

  // Allow parent to imperatively open the form (e.g. from dashboard deep-link)
  React.useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  const handleTabChange = (tabId) => {
    const fromIdx = TABS.findIndex(t => t.id === activeTab);
    const toIdx = TABS.findIndex(t => t.id === tabId);
    setSlideDir(toIdx > fromIdx ? 1 : -1);
    setActiveTab(tabId);
  };

  const handleChange = (key, value) => {
    setNewEntry(prev => ({ ...prev, [key]: value }));
  };

  const foodNameGuard = useProfanityGuard((val) => handleChange('food_name', val));

  const handleLog = () => {
    if (hasAnyProfanity(newEntry.food_name)) {
      toast.error('Please remove inappropriate language from food name before saving.');
      return;
    }
    onLog();
  };

  const slideVariants = {
    enter: (dir) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
  };

  return (
    <Card className="p-4 border-none shadow-sm">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between mb-0"
      >
        <h3 className="font-heading font-bold">{t('nutrition.logMealForm')}</h3>
        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.2 }}>
          <Plus className="w-5 h-5 text-primary" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
      {open && (
      <motion.div
        key="form-body"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.25, ease: 'easeInOut' }}
        style={{ overflow: 'hidden' }}
      >
      <div className="pt-4">

      {/* Food name */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('nutrition.foodName')}</label>
        <Input
          value={newEntry.food_name}
          onChange={(e) => foodNameGuard.handleChange(e.target.value)}
          placeholder={t('nutrition.foodNamePlaceholder')}
        />
      </div>

      {/* Slide tabs */}
      <div className="flex gap-1 p-1 bg-secondary rounded-lg mb-4 border border-border">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === tab.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Slide content */}
      <div className="overflow-hidden mb-4">
        <AnimatePresence mode="wait" custom={slideDir}>
          <motion.div
            key={activeTab}
            custom={slideDir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: 'easeInOut' }}
          >
            {activeTab === 'saved' ? (
              <div>
                {savedMeals.length === 0 ? (
                  <div className="text-center py-8">
                    <Bookmark className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="font-heading font-semibold text-sm">No saved meals yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Tap the bookmark icon on meal posts in the Hub to save them here.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedMeals.map(meal => {
                      const isExpanded = expandedSaved === meal.id;
                      return (
                        <div key={meal.id} className="rounded-xl border border-border overflow-hidden">
                          {/* Image */}
                          {meal.image_url && (
                            <div className="relative">
                              <img src={meal.image_url} alt={meal.food_name} className="w-full max-h-36 object-cover" />
                            </div>
                          )}
                          {/* Header row */}
                          <button
                            type="button"
                            onClick={() => setExpandedSaved(isExpanded ? null : meal.id)}
                            className="w-full flex items-start gap-2 px-3 py-2.5 text-start hover:bg-secondary/30 transition-colors"
                          >
                            {!meal.image_url && <ImageIcon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
                            <div className="flex-1 min-w-0">
                              <p className="font-heading font-semibold text-sm leading-tight truncate">{meal.food_name}</p>
                              {meal.author_name && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">{meal.author_name}</p>
                              )}
                              {/* Macro pills */}
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {meal.calories > 0 && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400">{Math.round(meal.calories)} kcal</span>
                                )}
                                {meal.protein_g > 0 && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400">{Math.round(meal.protein_g)}g P</span>
                                )}
                                {meal.carbs_g > 0 && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">{Math.round(meal.carbs_g)}g C</span>
                                )}
                                {meal.fat_g > 0 && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">{Math.round(meal.fat_g)}g F</span>
                                )}
                              </div>
                            </div>
                          </button>
                          {/* Expanded actions */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                style={{ overflow: 'hidden' }}
                              >
                                <div className="flex gap-2 px-3 pb-3 border-t border-border/50 pt-2 bg-secondary/10">
                                  <Button
                                    size="sm"
                                    className="flex-1 text-xs h-8"
                                    onClick={() => handleUseSavedMeal(meal)}
                                  >
                                    <Plus className="w-3.5 h-3.5 me-1" /> Use this meal
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-8 text-destructive hover:text-destructive border-destructive/30"
                                    onClick={() => handleUnsaveMeal(meal.id)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(activeTab === 'nutrients' ? NUTRIENT_FIELDS : VITAMIN_FIELDS).map(field => (
                  <NutrientTile
                    key={field.key}
                    field={field}
                    value={newEntry[field.key] ?? ''}
                    onChange={handleChange}
                    t={t}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Actions */}
      {activeTab !== 'saved' && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={onScan} className="flex-1" disabled={isScanning}>
            <Barcode className="w-4 h-4 me-2" /> {t('nutrition.scan')}
          </Button>
          <Button onClick={handleLog} className="flex-1" disabled={isLogging}>
            <Plus className="w-4 h-4 me-2" /> {t('nutrition.logMeal')}
          </Button>
        </div>
      )}
      <ProfanityWarningDialog open={foodNameGuard.open} onContinue={foodNameGuard.onContinue} />
      </div>
      </motion.div>
      )}
      </AnimatePresence>
    </Card>
  );
}