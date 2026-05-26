import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Lock, Star } from 'lucide-react';
import { ACHIEVEMENT_DEFINITIONS } from '@/lib/achievementDefinitions';
import { useLanguage } from '@/lib/LanguageContext';
import { useDateFormatter } from '@/lib/intl';

const CATEGORY_COLORS = {
  workout: 'bg-primary/10 text-primary',
  regimen: 'bg-accent/10 text-accent',
  goal: 'bg-yellow-500/10 text-yellow-600',
  nutrition: 'bg-emerald-500/10 text-emerald-600',
  milestone: 'bg-purple-500/10 text-purple-600',
  cardio: 'bg-orange-500/10 text-orange-600',
};

export default function AchievementsModal({ open, onClose, achievements = [], user }) {
  const { t } = useLanguage();
  const fmtDate = useDateFormatter();
  const [activeTab, setActiveTab] = useState('active');

  const achievementMap = useMemo(() => {
    const map = {};
    achievements.forEach((a) => {
      map[a.achievement_id] = a;
    });
    return map;
  }, [achievements]);



  const categorized = useMemo(() => {
    const cats = {
      workout: [],
      regimen: [],
      goal: [],
      nutrition: [],
      milestone: [],
      cardio: [],
    };

    ACHIEVEMENT_DEFINITIONS.forEach((def) => {
      const userAch = achievementMap[def.achievement_id];
      if (cats[def.category]) {
        cats[def.category].push({
          ...def,
          id: userAch?.id,
          // Row presence = unlocked; table only has unlocked_at (the old
          // unlocked/unlocked_date columns never existed → all locked).
          unlocked: !!userAch,
          unlockedDate: userAch?.unlocked_at,
          progress: userAch?.progress || 0,
        });
      }
    });

    // Sort each category: locked first, then completed
    Object.keys(cats).forEach(cat => {
      cats[cat].sort((a, b) => {
        if (a.unlocked === b.unlocked) return 0;
        return a.unlocked ? 1 : -1;
      });
    });

    return cats;
  }, [achievementMap]);

  const activeAchievements = useMemo(() => {
    const filtered = {};
    Object.keys(categorized).forEach(cat => {
      filtered[cat] = categorized[cat].filter(a => !a.unlocked);
    });
    return filtered;
  }, [categorized]);

  const completedAchievements = useMemo(() => {
    const filtered = {};
    Object.keys(categorized).forEach(cat => {
      filtered[cat] = categorized[cat].filter(a => a.unlocked);
    });
    return filtered;
  }, [categorized]);

  const displayData = activeTab === 'active' ? activeAchievements : completedAchievements;
  // The `achievements` table has no `unlocked` boolean — row presence
  // means the achievement was unlocked (only `unlocked_at` exists).
  // The previous filter on `a.unlocked` always returned 0, so the
  // header counter read "0 / N" no matter how many badges the user
  // had. Same bug pattern was already fixed in AchievementsTab.jsx
  // (audit 11 #2); the modal counterpart had it too.
  const unlockedCount = achievements.length;
  const totalCount = ACHIEVEMENT_DEFINITIONS.length;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            {t('progress.achievements')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-3">
          {unlockedCount} {t('progress.of')} {totalCount} {t('progress.unlocked')}
        </p>

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-border mb-6">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'active'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('progress.activeAchievements')}
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'completed'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('progress.completedAchievements')}
          </button>
        </div>

        <div className="space-y-6">
            {Object.entries(displayData).map(([category, cats]) => {
              if (cats.length === 0) return null;
              return (
              <div key={category}>
                <h3 className="font-heading font-bold text-sm mb-3 capitalize">{t(`achievementDefs.cat.${category}`) || category}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <AnimatePresence>
                    {cats.map((ach) => (
                      <motion.div
                        key={ach.achievement_id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                      >
                        <Card
                          className={`p-4 border-none shadow-sm transition-all ${
                            ach.unlocked
                              ? `${CATEGORY_COLORS[category]} bg-opacity-20`
                              : 'bg-muted/50'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={`text-3xl flex-shrink-0 ${!ach.unlocked && 'opacity-30'}`}
                            >
                              {ach.unlocked ? ach.icon : <Lock className="w-8 h-8" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-sm">{t(ach.nameKey)}</p>
                                  <p className={`text-xs mt-0.5 ${ach.unlocked ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}>
                                    {t(ach.descriptionKey)}
                                  </p>
                                </div>
                                {ach.unlocked && (
                                  <Badge className="text-xs bg-green-600 text-white shrink-0">
                                    <Star className="w-2.5 h-2.5 mr-1" /> +{ach.xp_reward} XP
                                  </Badge>
                                )}
                              </div>

                              {/* Progress bar for locked achievements */}
                              {!ach.unlocked && ach.target > 1 && (
                                <div className="mt-2">
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs text-muted-foreground">
                                      {Math.round(ach.progress)} / {ach.target}
                                    </span>
                                    <span className="text-xs font-medium">
                                      {Math.round((ach.progress / ach.target) * 100)}%
                                    </span>
                                  </div>
                                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-primary transition-all duration-300"
                                      style={{
                                        width: `${Math.min((ach.progress / ach.target) * 100, 100)}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              )}

                              {ach.unlocked && ach.unlockedDate && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  {t('progress.unlockedOn')}{' '}
                                  {fmtDate(ach.unlockedDate)}
                                </p>
                              )}
                            </div>
                          </div>
                        </Card>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
              );
            })}
            
            {activeTab === 'active' && Object.values(displayData).every(arr => arr.length === 0) && (
              <div className="text-center py-8">
                <Trophy className="w-10 h-10 text-yellow-500 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">{t('progress.allCompleted')}</p>
              </div>
            )}
            {activeTab === 'completed' && Object.values(displayData).every(arr => arr.length === 0) && (
              <div className="text-center py-8">
                <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">{t('progress.noneCompleted')}</p>
              </div>
            )}
          </div>
      </DialogContent>
    </Dialog>
  );
}